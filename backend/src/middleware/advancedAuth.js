const jwt = require('jsonwebtoken');
const redis = require('redis');
const { User } = require('../models');
const logger = require('../utils/logger');
const securityConfig = require('../config/security');
const crypto = require('crypto');

// Initialize Redis client for token blacklist and session management
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  password: process.env.REDIS_PASSWORD,
  database: parseInt(process.env.REDIS_DB) || 0
});

redisClient.on('error', (err) => {
  logger.error('Redis connection error:', err);
});

redisClient.on('connect', () => {
  logger.info('Connected to Redis for session management');
});

// Connect to Redis
if (!redisClient.isOpen) {
  redisClient.connect().catch(logger.error);
}

// Token blacklist operations
const tokenBlacklist = {
  async add(token, exp) {
    try {
      const ttl = exp - Math.floor(Date.now() / 1000);
      if (ttl > 0) {
        await redisClient.setEx(`blacklist:${token}`, ttl, 'blacklisted');
      }
    } catch (error) {
      logger.error('Error adding token to blacklist:', error);
    }
  },

  async isBlacklisted(token) {
    try {
      const result = await redisClient.get(`blacklist:${token}`);
      return result === 'blacklisted';
    } catch (error) {
      logger.error('Error checking token blacklist:', error);
      return false;
    }
  },

  async clear(token) {
    try {
      await redisClient.del(`blacklist:${token}`);
    } catch (error) {
      logger.error('Error clearing token from blacklist:', error);
    }
  }
};

// Session management
const sessionManager = {
  async create(userId, sessionData) {
    try {
      const sessionId = crypto.randomBytes(32).toString('hex');
      const sessionKey = `session:${userId}:${sessionId}`;
      
      await redisClient.setEx(
        sessionKey,
        Math.floor(securityConfig.session.maxAge / 1000),
        JSON.stringify({
          ...sessionData,
          sessionId,
          createdAt: new Date().toISOString(),
          lastActivity: new Date().toISOString()
        })
      );
      
      return sessionId;
    } catch (error) {
      logger.error('Error creating session:', error);
      return null;
    }
  },

  async get(userId, sessionId) {
    try {
      const sessionKey = `session:${userId}:${sessionId}`;
      const sessionData = await redisClient.get(sessionKey);
      return sessionData ? JSON.parse(sessionData) : null;
    } catch (error) {
      logger.error('Error getting session:', error);
      return null;
    }
  },

  async update(userId, sessionId, data) {
    try {
      const sessionKey = `session:${userId}:${sessionId}`;
      const existingSession = await this.get(userId, sessionId);
      
      if (existingSession) {
        const updatedSession = {
          ...existingSession,
          ...data,
          lastActivity: new Date().toISOString()
        };
        
        await redisClient.setEx(
          sessionKey,
          Math.floor(securityConfig.session.maxAge / 1000),
          JSON.stringify(updatedSession)
        );
        
        return updatedSession;
      }
      
      return null;
    } catch (error) {
      logger.error('Error updating session:', error);
      return null;
    }
  },

  async delete(userId, sessionId) {
    try {
      const sessionKey = `session:${userId}:${sessionId}`;
      await redisClient.del(sessionKey);
    } catch (error) {
      logger.error('Error deleting session:', error);
    }
  },

  async deleteAllUserSessions(userId) {
    try {
      const pattern = `session:${userId}:*`;
      const keys = await redisClient.keys(pattern);
      
      if (keys.length > 0) {
        await redisClient.del(keys);
      }
      
      logger.info(`Deleted ${keys.length} sessions for user ${userId}`);
    } catch (error) {
      logger.error('Error deleting user sessions:', error);
    }
  }
};

// Generate token pair (access + refresh)
const generateTokenPair = (user, sessionId) => {
  const accessTokenPayload = {
    id: user.id,
    email: user.email,
    sessionId,
    type: 'access',
    iat: Math.floor(Date.now() / 1000)
  };

  const refreshTokenPayload = {
    id: user.id,
    sessionId,
    type: 'refresh',
    iat: Math.floor(Date.now() / 1000)
  };

  const accessToken = jwt.sign(accessTokenPayload, securityConfig.jwt.secret, {
    expiresIn: securityConfig.jwt.accessTokenExpiry,
    issuer: securityConfig.jwt.issuer,
    audience: securityConfig.jwt.audience,
    algorithm: securityConfig.jwt.algorithm
  });

  const refreshToken = jwt.sign(refreshTokenPayload, securityConfig.jwt.secret, {
    expiresIn: securityConfig.jwt.refreshTokenExpiry,
    issuer: securityConfig.jwt.issuer,
    audience: securityConfig.jwt.audience,
    algorithm: securityConfig.jwt.algorithm
  });

  return { accessToken, refreshToken };
};

// Advanced authentication middleware
const advancedAuth = {
  // Main authentication middleware
  authenticate: async (req, res, next) => {
    try {
      let token;
      
      // Get token from Authorization header or API key header
      if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
      } else if (req.headers['x-api-key']) {
        return advancedAuth.authenticateApiKey(req, res, next);
      }

      if (!token) {
        return res.status(401).json({
          success: false,
          error: 'Authentication token required'
        });
      }

      // Check if token is blacklisted
      if (await tokenBlacklist.isBlacklisted(token)) {
        return res.status(401).json({
          success: false,
          error: 'Token has been revoked'
        });
      }

      // Verify token
      const decoded = jwt.verify(token, securityConfig.jwt.secret, {
        issuer: securityConfig.jwt.issuer,
        audience: securityConfig.jwt.audience,
        algorithms: [securityConfig.jwt.algorithm]
      });

      // Ensure it's an access token
      if (decoded.type !== 'access') {
        return res.status(401).json({
          success: false,
          error: 'Invalid token type'
        });
      }

      // Get user
      const user = await User.findByPk(decoded.id);
      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'User not found'
        });
      }

      if (!user.isActive) {
        return res.status(401).json({
          success: false,
          error: 'Account is deactivated'
        });
      }

      // Verify session
      const session = await sessionManager.get(decoded.id, decoded.sessionId);
      if (!session) {
        return res.status(401).json({
          success: false,
          error: 'Session expired or invalid'
        });
      }

      // Update session activity
      await sessionManager.update(decoded.id, decoded.sessionId, {
        lastActivity: new Date().toISOString(),
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      // Attach user and session to request
      req.user = user;
      req.session = session;
      req.tokenPayload = decoded;

      next();
    } catch (error) {
      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({
          success: false,
          error: 'Invalid token'
        });
      }
      
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          error: 'Token expired'
        });
      }

      logger.error('Authentication error:', error);
      return res.status(500).json({
        success: false,
        error: 'Authentication failed'
      });
    }
  },

  // Optional authentication (doesn't fail if no token)
  optional: async (req, res, next) => {
    try {
      let token;
      
      if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
      } else if (req.headers['x-api-key']) {
        // Try API key authentication
        const apiKeyResult = await advancedAuth.authenticateApiKey(req, res, () => {});
        if (req.user) {
          return next();
        }
      }

      if (!token) {
        req.user = null;
        req.session = null;
        return next();
      }

      // Check blacklist
      if (await tokenBlacklist.isBlacklisted(token)) {
        req.user = null;
        req.session = null;
        return next();
      }

      // Verify token
      const decoded = jwt.verify(token, securityConfig.jwt.secret, {
        issuer: securityConfig.jwt.issuer,
        audience: securityConfig.jwt.audience,
        algorithms: [securityConfig.jwt.algorithm]
      });

      if (decoded.type !== 'access') {
        req.user = null;
        req.session = null;
        return next();
      }

      // Get user
      const user = await User.findByPk(decoded.id);
      if (!user || !user.isActive) {
        req.user = null;
        req.session = null;
        return next();
      }

      // Verify session
      const session = await sessionManager.get(decoded.id, decoded.sessionId);
      if (!session) {
        req.user = null;
        req.session = null;
        return next();
      }

      req.user = user;
      req.session = session;
      req.tokenPayload = decoded;

      next();
    } catch (error) {
      req.user = null;
      req.session = null;
      next();
    }
  },

  // API Key authentication
  authenticateApiKey: async (req, res, next) => {
    try {
      const apiKey = req.headers['x-api-key'];
      
      if (!apiKey) {
        return res.status(401).json({
          success: false,
          error: 'API key required'
        });
      }

      // Validate API key format
      if (!apiKey.startsWith(securityConfig.apiKey.prefix)) {
        return res.status(401).json({
          success: false,
          error: 'Invalid API key format'
        });
      }

      // Find user by API key (implementation depends on your API key storage)
      const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');
      const user = await User.findOne({
        where: {
          apiKeys: {
            [require('sequelize').Op.contains]: [{ key: hashedKey, active: true }]
          }
        }
      });

      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'Invalid API key'
        });
      }

      if (!user.isActive) {
        return res.status(401).json({
          success: false,
          error: 'Account is deactivated'
        });
      }

      // Check API key rate limits
      const rateLimitKey = `api_rate_limit:${hashedKey}`;
      const currentCount = await redisClient.get(rateLimitKey) || 0;
      
      if (parseInt(currentCount) >= securityConfig.apiKey.rateLimit.max) {
        return res.status(429).json({
          success: false,
          error: 'API key rate limit exceeded'
        });
      }

      // Increment rate limit counter
      await redisClient.incr(rateLimitKey);
      await redisClient.expire(rateLimitKey, Math.floor(securityConfig.apiKey.rateLimit.windowMs / 1000));

      req.user = user;
      req.apiKey = apiKey;
      req.authMethod = 'api_key';

      next();
    } catch (error) {
      logger.error('API key authentication error:', error);
      return res.status(500).json({
        success: false,
        error: 'Authentication failed'
      });
    }
  },

  // Require MFA for sensitive operations
  requireMFA: async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      // Skip MFA for API key access
      if (req.authMethod === 'api_key') {
        return next();
      }

      // Check if user has MFA enabled
      if (!req.user.mfaEnabled) {
        return res.status(403).json({
          success: false,
          error: 'Multi-factor authentication required for this operation'
        });
      }

      // Check if session is MFA verified
      if (!req.session.mfaVerified) {
        return res.status(403).json({
          success: false,
          error: 'MFA verification required for this operation'
        });
      }

      next();
    } catch (error) {
      logger.error('MFA check error:', error);
      return res.status(500).json({
        success: false,
        error: 'MFA verification failed'
      });
    }
  },

  // Role-based authorization
  requireRole: (roles) => {
    return async (req, res, next) => {
      try {
        if (!req.user) {
          return res.status(401).json({
            success: false,
            error: 'Authentication required'
          });
        }

        const userRoles = req.user.roles || [];
        const hasRequiredRole = roles.some(role => userRoles.includes(role));

        if (!hasRequiredRole) {
          return res.status(403).json({
            success: false,
            error: 'Insufficient permissions'
          });
        }

        next();
      } catch (error) {
        logger.error('Role check error:', error);
        return res.status(500).json({
          success: false,
          error: 'Authorization failed'
        });
      }
    };
  }
};

// Token management utilities
const tokenUtils = {
  generateTokenPair,
  sessionManager,
  tokenBlacklist,

  // Refresh access token
  refreshToken: async (refreshToken) => {
    try {
      const decoded = jwt.verify(refreshToken, securityConfig.jwt.secret, {
        issuer: securityConfig.jwt.issuer,
        audience: securityConfig.jwt.audience,
        algorithms: [securityConfig.jwt.algorithm]
      });

      if (decoded.type !== 'refresh') {
        throw new Error('Invalid token type');
      }

      // Check if refresh token is blacklisted
      if (await tokenBlacklist.isBlacklisted(refreshToken)) {
        throw new Error('Token has been revoked');
      }

      // Get user and session
      const user = await User.findByPk(decoded.id);
      const session = await sessionManager.get(decoded.id, decoded.sessionId);

      if (!user || !user.isActive || !session) {
        throw new Error('Invalid refresh token');
      }

      // Generate new token pair
      const tokens = generateTokenPair(user, decoded.sessionId);

      // Blacklist old refresh token
      await tokenBlacklist.add(refreshToken, decoded.exp);

      return {
        success: true,
        tokens,
        user: user.toJSON()
      };
    } catch (error) {
      logger.error('Token refresh error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  // Revoke all user tokens
  revokeAllTokens: async (userId) => {
    try {
      await sessionManager.deleteAllUserSessions(userId);
      logger.info(`Revoked all tokens for user ${userId}`);
      return true;
    } catch (error) {
      logger.error('Error revoking all tokens:', error);
      return false;
    }
  }
};

module.exports = {
  ...advancedAuth,
  tokenUtils,
  sessionManager,
  tokenBlacklist
};