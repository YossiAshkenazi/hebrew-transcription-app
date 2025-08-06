const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss');
const hpp = require('hpp');
const validator = require('validator');
const securityConfig = require('../config/security');
const securityService = require('../services/securityService');
const logger = require('../utils/logger');
const redis = require('redis');

// Initialize Redis client for rate limiting
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  password: process.env.REDIS_PASSWORD,
  database: parseInt(process.env.REDIS_RATE_LIMIT_DB) || 2
});

if (!redisClient.isOpen) {
  redisClient.connect().catch(logger.error);
}

// Enhanced security headers middleware
const securityHeaders = (req, res, next) => {
  // Use helmet with custom configuration
  helmet({
    contentSecurityPolicy: securityConfig.headers.contentSecurityPolicy ? {
      directives: securityConfig.headers.contentSecurityPolicy.directives,
      reportOnly: process.env.NODE_ENV === 'development'
    } : false,
    
    hsts: process.env.NODE_ENV === 'production' ? {
      maxAge: securityConfig.headers.hsts.maxAge,
      includeSubDomains: securityConfig.headers.hsts.includeSubDomains,
      preload: securityConfig.headers.hsts.preload
    } : false,
    
    referrerPolicy: {
      policy: securityConfig.headers.referrerPolicy
    },
    
    crossOriginEmbedderPolicy: {
      policy: securityConfig.headers.crossOriginEmbedderPolicy
    },
    
    crossOriginOpenerPolicy: {
      policy: securityConfig.headers.crossOriginOpenerPolicy
    },
    
    crossOriginResourcePolicy: {
      policy: securityConfig.headers.crossOriginResourcePolicy
    },
    
    // Additional security headers
    frameguard: { action: 'deny' },
    noSniff: true,
    xssFilter: true,
    ieNoOpen: true,
    dnsPrefetchControl: { allow: false },
    hidePoweredBy: true
  })(req, res, next);
};

// Advanced rate limiting with Redis store
const createAdvancedRateLimit = (config, keyGenerator) => {
  return rateLimit({
    windowMs: config.windowMs,
    max: config.max,
    message: {
      success: false,
      error: config.message || 'Too many requests from this IP, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyGenerator || ((req) => req.ip),
    store: process.env.NODE_ENV === 'production' ? new (require('rate-limit-redis'))({
      client: redisClient,
      prefix: 'rl:'
    }) : undefined,
    handler: (req, res) => {
      // Log rate limit hit
      securityService.handleSecurityEvent('rate_limit.hit', {
        ip: req.ip,
        endpoint: req.originalUrl,
        limit: config.max,
        window: config.windowMs
      }, req);

      res.status(429).json({
        success: false,
        error: config.message || 'Too many requests from this IP, please try again later.',
        retryAfter: Math.ceil(config.windowMs / 1000)
      });
    }
  });
};

// Speed limiter for DoS protection
const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 2, // Allow 2 requests per windowMs without delay
  delayMs: 500, // Add 500ms delay per request after delayAfter
  maxDelayMs: 20000, // Maximum delay of 20 seconds
  skipFailedRequests: false,
  skipSuccessfulRequests: false,
  keyGenerator: (req) => req.ip,
  store: process.env.NODE_ENV === 'production' ? new (require('rate-limit-redis'))({
    client: redisClient,
    prefix: 'sl:'
  }) : undefined
});

// IP blocking middleware
const ipBlocker = async (req, res, next) => {
  try {
    const blockedKey = `blocked_ip:${req.ip}`;
    const blockData = await redisClient.get(blockedKey);
    
    if (blockData) {
      const blockInfo = JSON.parse(blockData);
      
      await securityService.handleSecurityEvent('access.blocked', {
        ip: req.ip,
        reason: 'ip_blocked',
        blockInfo
      }, req);

      return res.status(403).json({
        success: false,
        error: 'Access denied',
        code: 'IP_BLOCKED'
      });
    }

    next();
  } catch (error) {
    logger.error('Error in IP blocker middleware:', error);
    next();
  }
};

// Account lockout checker
const accountLockoutChecker = async (req, res, next) => {
  try {
    // Only check for authentication endpoints
    if (!req.originalUrl.includes('/auth/')) {
      return next();
    }

    const email = req.body?.email;
    if (!email) {
      return next();
    }

    const lockInfo = await securityService.accountLockout.isAccountLocked(email);
    if (lockInfo) {
      await securityService.handleSecurityEvent('access.blocked', {
        email,
        reason: 'account_locked',
        lockInfo
      }, req);

      return res.status(423).json({
        success: false,
        error: 'Account is temporarily locked due to multiple failed login attempts',
        code: 'ACCOUNT_LOCKED',
        unlockAt: lockInfo.unlockAt
      });
    }

    next();
  } catch (error) {
    logger.error('Error in account lockout checker:', error);
    next();
  }
};

// Input sanitization and validation
const inputSanitizer = (req, res, next) => {
  try {
    // Sanitize against NoSQL injection
    mongoSanitize()(req, res, () => {
      // XSS protection for string inputs
      const sanitizeObject = (obj) => {
        if (typeof obj === 'string') {
          // Clean XSS but preserve Hebrew text
          return xss(obj, {
            whiteList: {}, // No HTML tags allowed
            stripIgnoreTag: true,
            stripIgnoreTagBody: ['script']
          });
        }
        
        if (typeof obj === 'object' && obj !== null) {
          const sanitized = {};
          for (const [key, value] of Object.entries(obj)) {
            sanitized[key] = sanitizeObject(value);
          }
          return sanitized;
        }
        
        return obj;
      };

      // Sanitize request body
      if (req.body) {
        req.body = sanitizeObject(req.body);
      }

      // Sanitize query parameters
      if (req.query) {
        req.query = sanitizeObject(req.query);
      }

      next();
    });
  } catch (error) {
    logger.error('Error in input sanitizer:', error);
    next();
  }
};

// HTTP Parameter Pollution protection
const hppProtection = hpp({
  whitelist: ['tags', 'categories'] // Allow arrays for these parameters
});

// Request validation middleware
const requestValidator = (req, res, next) => {
  try {
    // Validate common security issues
    const issues = [];

    // Check for suspicious user agents
    const userAgent = req.get('User-Agent') || '';
    const suspiciousAgents = [
      'sqlmap', 'nikto', 'nessus', 'openvas', 'w3af', 'masscan', 'nmap'
    ];
    
    if (suspiciousAgents.some(agent => userAgent.toLowerCase().includes(agent))) {
      issues.push('suspicious_user_agent');
    }

    // Check for suspicious headers
    const suspiciousHeaders = ['x-forwarded-host', 'x-real-ip'];
    suspiciousHeaders.forEach(header => {
      if (req.headers[header] && req.headers[header] !== req.get('host')) {
        issues.push('suspicious_header');
      }
    });

    // Check request size
    const contentLength = parseInt(req.get('content-length') || '0');
    if (contentLength > 10 * 1024 * 1024) { // 10MB limit
      issues.push('large_request');
    }

    // Check for path traversal in URL
    if (req.originalUrl.includes('..') || req.originalUrl.includes('%2e%2e')) {
      issues.push('path_traversal');
    }

    // If issues found, log and potentially block
    if (issues.length > 0) {
      securityService.handleSecurityEvent('request.suspicious', {
        issues,
        url: req.originalUrl,
        userAgent,
        contentLength
      }, req);

      // Block highly suspicious requests
      if (issues.includes('path_traversal') || issues.includes('suspicious_user_agent')) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request',
          code: 'SUSPICIOUS_REQUEST'
        });
      }
    }

    next();
  } catch (error) {
    logger.error('Error in request validator:', error);
    next();
  }
};

// File upload security
const fileUploadSecurity = (req, res, next) => {
  try {
    if (!req.file && !req.files) {
      return next();
    }

    const files = req.files || [req.file];
    
    for (const file of files) {
      if (!file) {continue;}

      // Check file size
      if (file.size > securityConfig.fileUpload.maxSize) {
        return res.status(413).json({
          success: false,
          error: 'File too large',
          maxSize: securityConfig.fileUpload.maxSize
        });
      }

      // Check MIME type
      if (!securityConfig.fileUpload.allowedMimeTypes.includes(file.mimetype)) {
        return res.status(415).json({
          success: false,
          error: 'File type not allowed',
          allowedTypes: securityConfig.fileUpload.allowedMimeTypes
        });
      }

      // Check for malicious file names
      const suspiciousExtensions = ['.exe', '.bat', '.cmd', '.scr', '.pif', '.vbs', '.js', '.jar'];
      const hasEvilExtension = suspiciousExtensions.some(ext => 
        file.originalname.toLowerCase().endsWith(ext)
      );

      if (hasEvilExtension) {
        return res.status(400).json({
          success: false,
          error: 'File type not allowed',
          code: 'SUSPICIOUS_FILE_TYPE'
        });
      }

      // Log file upload
      securityService.handleSecurityEvent('file.upload', {
        filename: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        userId: req.user?.id
      }, req);
    }

    next();
  } catch (error) {
    logger.error('Error in file upload security:', error);
    return res.status(500).json({
      success: false,
      error: 'File upload security check failed'
    });
  }
};

// CORS configuration
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, etc.)
    if (!origin) {return callback(null, true);}
    
    // Check if origin is allowed
    if (securityConfig.cors.origin === true || securityConfig.cors.origin.includes(origin)) {
      return callback(null, true);
    }
    
    // Log unauthorized origin attempt
    logger.warn('CORS: Unauthorized origin attempt', { origin });
    callback(new Error('Not allowed by CORS'));
  },
  credentials: securityConfig.cors.credentials,
  optionsSuccessStatus: securityConfig.cors.optionsSuccessStatus,
  methods: securityConfig.cors.methods,
  allowedHeaders: securityConfig.cors.allowedHeaders
};

// Security event logger
const securityEventLogger = (req, res, next) => {
  // Log all requests for security monitoring
  const startTime = Date.now();
  
  // Capture response end
  const originalSend = res.send;
  res.send = function(data) {
    const responseTime = Date.now() - startTime;
    
    // Log security-relevant events
    if (res.statusCode >= 400) {
      securityService.handleSecurityEvent('request.error', {
        method: req.method,
        url: req.originalUrl,
        statusCode: res.statusCode,
        responseTime,
        userAgent: req.get('User-Agent'),
        userId: req.user?.id
      }, req);
    }

    // Log slow requests
    if (responseTime > 5000) {
      securityService.handleSecurityEvent('request.slow', {
        method: req.method,
        url: req.originalUrl,
        responseTime,
        userId: req.user?.id
      }, req);
    }

    return originalSend.call(this, data);
  };

  next();
};

// Rate limiters for different endpoints
const rateLimiters = {
  general: createAdvancedRateLimit(securityConfig.rateLimit.general),
  auth: createAdvancedRateLimit(securityConfig.rateLimit.auth),
  passwordReset: createAdvancedRateLimit(securityConfig.rateLimit.passwordReset),
  upload: createAdvancedRateLimit(securityConfig.rateLimit.upload),
  
  // API key rate limiter
  apiKey: createAdvancedRateLimit(
    securityConfig.apiKey.rateLimit,
    (req) => req.headers['x-api-key'] || req.ip
  )
};

// Export all security middleware
module.exports = {
  securityHeaders,
  rateLimiters,
  speedLimiter,
  ipBlocker,
  accountLockoutChecker,
  inputSanitizer,
  hppProtection,
  requestValidator,
  fileUploadSecurity,
  corsOptions,
  securityEventLogger,
  
  // Combined security stack
  basicSecurity: [
    securityHeaders,
    speedLimiter,
    ipBlocker,
    requestValidator,
    inputSanitizer,
    hppProtection,
    securityEventLogger
  ],
  
  // Authentication security stack
  authSecurity: [
    accountLockoutChecker,
    rateLimiters.auth
  ],
  
  // File upload security stack
  uploadSecurity: [
    rateLimiters.upload,
    fileUploadSecurity
  ]
};