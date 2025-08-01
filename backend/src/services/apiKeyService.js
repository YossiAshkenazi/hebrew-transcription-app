const crypto = require('crypto');
const redis = require('redis');
const { User } = require('../models');
const securityService = require('./securityService');
const securityConfig = require('../config/security');
const logger = require('../utils/logger');

// Initialize Redis client for API key rate limiting
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  password: process.env.REDIS_PASSWORD,
  database: parseInt(process.env.REDIS_API_KEY_DB) || 4
});

if (!redisClient.isOpen) {
  redisClient.connect().catch(logger.error);
}

class APIKeyService {
  // Generate a new API key for a user
  async generateAPIKey(user, options = {}) {
    try {
      const {
        name = 'Default API Key',
        permissions = ['transcription:read', 'transcription:create'],
        expiresIn = securityConfig.apiKey.defaultExpiry,
        rateLimit = securityConfig.apiKey.rateLimit
      } = options;

      // Check if user already has maximum number of keys
      const existingKeys = user.apiKeys || [];
      if (existingKeys.length >= securityConfig.apiKey.maxKeysPerUser) {
        throw new Error('Maximum number of API keys reached');
      }

      // Generate key
      const keyId = crypto.randomUUID();
      const keySecret = crypto.randomBytes(securityConfig.apiKey.keyLength).toString('hex');
      const apiKey = securityConfig.apiKey.prefix + keySecret;
      
      // Hash the key for storage
      const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');
      
      // Create key metadata
      const keyData = {
        id: keyId,
        name,
        key: hashedKey,
        permissions,
        rateLimit,
        active: true,
        lastUsed: null,
        usageCount: 0,
        createdAt: new Date().toISOString(),
        expiresAt: expiresIn ? new Date(Date.now() + expiresIn).toISOString() : null
      };

      // Update user with new API key
      const updatedKeys = [...existingKeys, keyData];
      await user.update({ apiKeys: updatedKeys });

      // Store key metadata in Redis for fast lookups
      const redisKey = `api_key:${hashedKey}`;
      await redisClient.setEx(redisKey, Math.floor(expiresIn ? expiresIn / 1000 : 365 * 24 * 60 * 60), JSON.stringify({
        userId: user.id,
        keyId,
        permissions,
        rateLimit,
        active: true
      }));

      await securityService.handleSecurityEvent('api_key.generated', {
        userId: user.id,
        email: user.email,
        keyId,
        keyName: name,
        permissions
      });

      logger.info(`API key generated for user ${user.email}: ${keyId}`);

      // Return the plain key only once
      return {
        id: keyId,
        key: apiKey,
        name,
        permissions,
        expiresAt: keyData.expiresAt,
        createdAt: keyData.createdAt
      };
    } catch (error) {
      logger.error('Error generating API key:', error);
      throw error;
    }
  }

  // Validate API key and return user data
  async validateAPIKey(apiKey) {
    try {
      // Check key format
      if (!apiKey.startsWith(securityConfig.apiKey.prefix)) {
        return null;
      }

      // Hash the key
      const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');
      
      // Check Redis cache first
      const redisKey = `api_key:${hashedKey}`;
      const cachedData = await redisClient.get(redisKey);
      
      if (cachedData) {
        const keyData = JSON.parse(cachedData);
        
        if (!keyData.active) {
          return null;
        }

        // Get user data
        const user = await User.findByPk(keyData.userId);
        if (!user || !user.isActive) {
          return null;
        }

        // Update usage statistics
        await this.updateKeyUsage(user, keyData.keyId);

        return {
          user,
          keyData: {
            id: keyData.keyId,
            permissions: keyData.permissions,
            rateLimit: keyData.rateLimit
          }
        };
      }

      // Fallback to database lookup
      const users = await User.findAll({
        where: {
          apiKeys: {
            [require('sequelize').Op.contains]: [{ key: hashedKey, active: true }]
          }
        }
      });

      if (users.length === 0) {
        return null;
      }

      const user = users[0];
      const keyData = user.apiKeys.find(k => k.key === hashedKey && k.active);
      
      if (!keyData) {
        return null;
      }

      // Check expiration
      if (keyData.expiresAt && new Date(keyData.expiresAt) < new Date()) {
        await this.deactivateAPIKey(user, keyData.id);
        return null;
      }

      // Cache in Redis
      await redisClient.setEx(redisKey, 3600, JSON.stringify({
        userId: user.id,
        keyId: keyData.id,
        permissions: keyData.permissions,
        rateLimit: keyData.rateLimit,
        active: true
      }));

      // Update usage statistics
      await this.updateKeyUsage(user, keyData.id);

      return {
        user,
        keyData: {
          id: keyData.id,
          permissions: keyData.permissions,
          rateLimit: keyData.rateLimit
        }
      };
    } catch (error) {
      logger.error('Error validating API key:', error);
      return null;
    }
  }

  // Update API key usage statistics
  async updateKeyUsage(user, keyId) {
    try {
      const apiKeys = user.apiKeys || [];
      const keyIndex = apiKeys.findIndex(k => k.id === keyId);
      
      if (keyIndex !== -1) {
        apiKeys[keyIndex].lastUsed = new Date().toISOString();
        apiKeys[keyIndex].usageCount = (apiKeys[keyIndex].usageCount || 0) + 1;
        
        await user.update({ apiKeys });
      }
    } catch (error) {
      logger.error('Error updating key usage:', error);
    }
  }

  // Get user's API keys (without actual key values)
  async getUserAPIKeys(user) {
    try {
      const apiKeys = user.apiKeys || [];
      
      return apiKeys
        .filter(key => key.active)
        .map(key => ({
          id: key.id,
          name: key.name,
          permissions: key.permissions,
          lastUsed: key.lastUsed,
          usageCount: key.usageCount || 0,
          createdAt: key.createdAt,
          expiresAt: key.expiresAt,
          isExpired: key.expiresAt ? new Date(key.expiresAt) < new Date() : false
        }));
    } catch (error) {
      logger.error('Error getting user API keys:', error);
      return [];
    }
  }

  // Update API key permissions
  async updateAPIKey(user, keyId, updates) {
    try {
      const apiKeys = user.apiKeys || [];
      const keyIndex = apiKeys.findIndex(k => k.id === keyId && k.active);
      
      if (keyIndex === -1) {
        throw new Error('API key not found');
      }

      const key = apiKeys[keyIndex];
      
      // Update allowed fields
      if (updates.name) key.name = updates.name;
      if (updates.permissions) key.permissions = updates.permissions;
      if (updates.rateLimit) key.rateLimit = updates.rateLimit;
      
      key.updatedAt = new Date().toISOString();
      
      await user.update({ apiKeys });

      // Update Redis cache
      const redisKey = `api_key:${key.key}`;
      await redisClient.del(redisKey); // Clear cache to force refresh

      await securityService.handleSecurityEvent('api_key.updated', {
        userId: user.id,
        email: user.email,
        keyId,
        updates
      });

      logger.info(`API key updated for user ${user.email}: ${keyId}`);

      return true;
    } catch (error) {
      logger.error('Error updating API key:', error);
      throw error;
    }
  }

  // Deactivate API key
  async deactivateAPIKey(user, keyId) {
    try {
      const apiKeys = user.apiKeys || [];
      const keyIndex = apiKeys.findIndex(k => k.id === keyId);
      
      if (keyIndex === -1) {
        throw new Error('API key not found');
      }

      // Mark as inactive
      apiKeys[keyIndex].active = false;
      apiKeys[keyIndex].deactivatedAt = new Date().toISOString();
      
      await user.update({ apiKeys });

      // Remove from Redis cache
      const redisKey = `api_key:${apiKeys[keyIndex].key}`;
      await redisClient.del(redisKey);

      await securityService.handleSecurityEvent('api_key.deactivated', {
        userId: user.id,
        email: user.email,
        keyId
      });

      logger.info(`API key deactivated for user ${user.email}: ${keyId}`);

      return true;
    } catch (error) {
      logger.error('Error deactivating API key:', error);
      throw error;
    }
  }

  // Delete API key (permanent removal)
  async deleteAPIKey(user, keyId) {
    try {
      const apiKeys = user.apiKeys || [];
      const keyIndex = apiKeys.findIndex(k => k.id === keyId);
      
      if (keyIndex === -1) {
        throw new Error('API key not found');
      }

      const key = apiKeys[keyIndex];
      
      // Remove from array
      apiKeys.splice(keyIndex, 1);
      await user.update({ apiKeys });

      // Remove from Redis cache
      const redisKey = `api_key:${key.key}`;
      await redisClient.del(redisKey);

      await securityService.handleSecurityEvent('api_key.deleted', {
        userId: user.id,
        email: user.email,
        keyId
      });

      logger.info(`API key deleted for user ${user.email}: ${keyId}`);

      return true;
    } catch (error) {
      logger.error('Error deleting API key:', error);
      throw error;
    }
  }

  // Check API key permissions
  hasPermission(keyData, requiredPermission) {
    if (!keyData || !keyData.permissions) {
      return false;
    }

    // Check for wildcard permission
    if (keyData.permissions.includes('*')) {
      return true;
    }

    // Check for exact permission match
    if (keyData.permissions.includes(requiredPermission)) {
      return true;
    }

    // Check for wildcard resource permissions (e.g., 'transcription:*')
    const [resource] = requiredPermission.split(':');
    if (keyData.permissions.includes(`${resource}:*`)) {
      return true;
    }

    return false;
  }

  // Rate limit check for API key
  async checkRateLimit(keyData, keyId) {
    try {
      const rateLimitKey = `api_rate_limit:${keyId}`;
      const currentCount = await redisClient.get(rateLimitKey) || 0;
      
      const limit = keyData.rateLimit?.max || securityConfig.apiKey.rateLimit.max;
      const window = keyData.rateLimit?.windowMs || securityConfig.apiKey.rateLimit.windowMs;
      
      if (parseInt(currentCount) >= limit) {
        return {
          allowed: false,
          limit,
          current: parseInt(currentCount),
          resetTime: Date.now() + window
        };
      }

      // Increment counter
      await redisClient.incr(rateLimitKey);
      await redisClient.expire(rateLimitKey, Math.floor(window / 1000));

      return {
        allowed: true,
        limit,
        current: parseInt(currentCount) + 1,
        resetTime: Date.now() + window
      };
    } catch (error) {
      logger.error('Error checking API key rate limit:', error);
      // Allow request on error
      return { allowed: true, limit: 0, current: 0, resetTime: 0 };
    }
  }

  // Get API key usage statistics
  async getAPIKeyStats(user, keyId = null) {
    try {
      const apiKeys = user.apiKeys || [];
      
      if (keyId) {
        const key = apiKeys.find(k => k.id === keyId);
        if (!key) {
          throw new Error('API key not found');
        }

        return {
          id: key.id,
          name: key.name,
          usageCount: key.usageCount || 0,
          lastUsed: key.lastUsed,
          createdAt: key.createdAt,
          isActive: key.active
        };
      }

      // Return stats for all keys
      return apiKeys.map(key => ({
        id: key.id,
        name: key.name,
        usageCount: key.usageCount || 0,
        lastUsed: key.lastUsed,
        createdAt: key.createdAt,
        isActive: key.active
      }));
    } catch (error) {
      logger.error('Error getting API key stats:', error);
      throw error;
    }
  }

  // Clean up expired API keys
  async cleanupExpiredKeys() {
    try {
      const users = await User.findAll({
        where: {
          apiKeys: {
            [require('sequelize').Op.ne]: null
          }
        }
      });

      let cleanedCount = 0;

      for (const user of users) {
        const apiKeys = user.apiKeys || [];
        const validKeys = apiKeys.filter(key => {
          if (!key.expiresAt) return true;
          
          const isExpired = new Date(key.expiresAt) < new Date();
          if (isExpired && key.active) {
            cleanedCount++;
            
            // Remove from Redis cache
            const redisKey = `api_key:${key.key}`;
            redisClient.del(redisKey).catch(logger.error);
            
            // Mark as inactive
            key.active = false;
            key.deactivatedAt = new Date().toISOString();
          }
          
          return true; // Keep all keys but mark expired ones as inactive
        });

        if (validKeys.length !== apiKeys.length) {
          await user.update({ apiKeys: validKeys });
        }
      }

      logger.info(`Cleaned up ${cleanedCount} expired API keys`);
      return cleanedCount;
    } catch (error) {
      logger.error('Error cleaning up expired API keys:', error);
      return 0;
    }
  }

  // Rotate API key (generate new key, keep old one for grace period)
  async rotateAPIKey(user, keyId, gracePeriodMs = 24 * 60 * 60 * 1000) {
    try {
      const apiKeys = user.apiKeys || [];
      const keyIndex = apiKeys.findIndex(k => k.id === keyId && k.active);
      
      if (keyIndex === -1) {
        throw new Error('API key not found');
      }

      const oldKey = apiKeys[keyIndex];
      
      // Generate new key with same properties
      const newKeyData = await this.generateAPIKey(user, {
        name: oldKey.name + ' (Rotated)',
        permissions: oldKey.permissions,
        expiresIn: oldKey.expiresAt ? new Date(oldKey.expiresAt).getTime() - Date.now() : securityConfig.apiKey.defaultExpiry,
        rateLimit: oldKey.rateLimit
      });

      // Mark old key for rotation (inactive after grace period)
      oldKey.rotatedAt = new Date().toISOString();
      oldKey.deactivatesAt = new Date(Date.now() + gracePeriodMs).toISOString();
      
      await user.reload(); // Reload to get updated apiKeys after generating new key

      const updatedKeys = user.apiKeys.map(k => k.id === keyId ? oldKey : k);
      await user.update({ apiKeys: updatedKeys });

      // Schedule old key deactivation
      setTimeout(async () => {
        try {
          await this.deactivateAPIKey(user, keyId);
        } catch (error) {
          logger.error('Error deactivating rotated API key:', error);
        }
      }, gracePeriodMs);

      await securityService.handleSecurityEvent('api_key.rotated', {
        userId: user.id,
        email: user.email,
        oldKeyId: keyId,
        newKeyId: newKeyData.id
      });

      logger.info(`API key rotated for user ${user.email}: ${keyId} -> ${newKeyData.id}`);

      return newKeyData;
    } catch (error) {
      logger.error('Error rotating API key:', error);
      throw error;
    }
  }
}

// Export singleton instance
const apiKeyService = new APIKeyService();
module.exports = apiKeyService;