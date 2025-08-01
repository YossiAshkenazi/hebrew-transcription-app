const redis = require('redis');
const logger = require('../utils/logger');
const securityConfig = require('../config/security');
const emailService = require('./emailService');
const { User } = require('../models');
const crypto = require('crypto');

// Initialize Redis client for security monitoring
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  password: process.env.REDIS_PASSWORD,
  database: parseInt(process.env.REDIS_SECURITY_DB) || 1
});

redisClient.on('error', (err) => {
  logger.error('Security Redis connection error:', err);
});

if (!redisClient.isOpen) {
  redisClient.connect().catch(logger.error);
}

class SecurityService {
  constructor() {
    this.auditLog = new AuditLogger();
    this.threatDetector = new ThreatDetector();
    this.accountLockout = new AccountLockoutManager();
    this.securityMonitor = new SecurityMonitor();
  }

  // Main security event handler
  async handleSecurityEvent(eventType, data, req = {}) {
    try {
      // Log the security event
      await this.auditLog.log(eventType, data, req);

      // Check for threats
      await this.threatDetector.analyze(eventType, data, req);

      // Update security metrics
      await this.securityMonitor.updateMetrics(eventType, data);

      return true;
    } catch (error) {
      logger.error('Error handling security event:', error);
      return false;
    }
  }

  // Authentication events
  async logAuthEvent(type, user, req, success = true, details = {}) {
    const eventData = {
      userId: user?.id,
      email: user?.email,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      success,
      timestamp: new Date().toISOString(),
      ...details
    };

    await this.handleSecurityEvent(`auth.${type}`, eventData, req);

    // Handle failed login attempts
    if (!success && type === 'login') {
      await this.accountLockout.recordFailedAttempt(user?.email || req.body?.email, req.ip);
    }

    // Reset failed attempts on successful login
    if (success && type === 'login') {
      await this.accountLockout.resetFailedAttempts(user.email);
    }
  }

  // Data access events
  async logDataAccess(resource, action, user, req, data = {}) {
    const eventData = {
      resource,
      action,
      userId: user?.id,
      email: user?.email,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString(),
      ...data
    };

    await this.handleSecurityEvent('data.access', eventData, req);
  }

  // Administrative events
  async logAdminEvent(action, adminUser, req, targetData = {}) {
    const eventData = {
      action,
      adminId: adminUser.id,
      adminEmail: adminUser.email,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString(),
      ...targetData
    };

    await this.handleSecurityEvent('admin.action', eventData, req);
  }

  // Get security dashboard data
  async getSecurityDashboard(timeRange = '24h') {
    try {
      const metrics = await this.securityMonitor.getMetrics(timeRange);
      const threats = await this.threatDetector.getRecentThreats(timeRange);
      const failedLogins = await this.accountLockout.getFailedLoginStats(timeRange);

      return {
        metrics,
        threats,
        failedLogins,
        generated: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Error generating security dashboard:', error);
      throw error;
    }
  }

  // Export security logs for compliance
  async exportSecurityLogs(startDate, endDate, format = 'json') {
    try {
      return await this.auditLog.export(startDate, endDate, format);
    } catch (error) {
      logger.error('Error exporting security logs:', error);
      throw error;
    }
  }
}

class AuditLogger {
  constructor() {
    this.sensitiveFields = securityConfig.audit.sensitiveFields;
  }

  async log(eventType, data, req = {}) {
    try {
      const auditEntry = {
        id: crypto.randomUUID(),
        eventType,
        timestamp: new Date().toISOString(),
        data: this.sanitizeData(data),
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get ? req.get('User-Agent') : null,
          method: req.method,
          url: req.originalUrl,
          sessionId: req.session?.sessionId
        }
      };

      // Store in Redis with TTL based on retention policy
      const key = `audit:${eventType}:${auditEntry.id}`;
      const ttl = securityConfig.audit.retentionDays * 24 * 60 * 60; // Convert to seconds

      await redisClient.setEx(key, ttl, JSON.stringify(auditEntry));

      // Also log to Winston for immediate visibility
      logger.info('Security Event', auditEntry);

      return auditEntry.id;
    } catch (error) {
      logger.error('Error logging audit event:', error);
      throw error;
    }
  }

  sanitizeData(data) {
    const sanitized = { ...data };
    
    this.sensitiveFields.forEach(field => {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    });

    return sanitized;
  }

  async export(startDate, endDate, format = 'json') {
    try {
      const pattern = 'audit:*';
      const keys = await redisClient.keys(pattern);
      const logs = [];

      for (const key of keys) {
        const logData = await redisClient.get(key);
        if (logData) {
          const log = JSON.parse(logData);
          const logDate = new Date(log.timestamp);
          
          if (logDate >= startDate && logDate <= endDate) {
            logs.push(log);
          }
        }
      }

      // Sort by timestamp
      logs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      if (format === 'csv') {
        return this.convertToCSV(logs);
      }

      return logs;
    } catch (error) {
      logger.error('Error exporting audit logs:', error);
      throw error;
    }
  }

  convertToCSV(logs) {
    if (logs.length === 0) return '';

    const headers = ['id', 'eventType', 'timestamp', 'userId', 'ipAddress', 'userAgent'];
    const rows = logs.map(log => [
      log.id,
      log.eventType,
      log.timestamp,
      log.data.userId || '',
      log.metadata.ipAddress || '',
      log.metadata.userAgent || ''
    ]);

    return [headers, ...rows].map(row => row.join(',')).join('\n');
  }
}

class ThreatDetector {
  async analyze(eventType, data, req) {
    try {
      const threats = [];

      // Analyze rapid requests
      if (await this.detectRapidRequests(req.ip)) {
        threats.push('rapid_requests');
      }

      // Analyze failed login patterns
      if (eventType === 'auth.login' && !data.success) {
        if (await this.detectFailedLoginPattern(data.email, req.ip)) {
          threats.push('failed_login_pattern');
        }
      }

      // Analyze unusual locations (basic IP geolocation check)
      if (await this.detectUnusualLocation(data.userId, req.ip)) {
        threats.push('unusual_location');
      }

      // Check for SQL injection attempts
      if (this.detectSQLInjection(req)) {
        threats.push('sql_injection');
      }

      // Check for XSS attempts
      if (this.detectXSS(req)) {
        threats.push('xss_attempt');
      }

      // Check for path traversal
      if (this.detectPathTraversal(req)) {
        threats.push('path_traversal');
      }

      // If threats detected, handle them
      if (threats.length > 0) {
        await this.handleThreats(threats, data, req);
      }

      return threats;
    } catch (error) {
      logger.error('Error in threat detection:', error);
      return [];
    }
  }

  async detectRapidRequests(ipAddress) {
    try {
      const key = `rapid_requests:${ipAddress}`;
      const count = await redisClient.incr(key);
      await redisClient.expire(key, securityConfig.threatDetection.suspiciousPatterns.rapidRequests.window / 1000);

      return count > securityConfig.threatDetection.suspiciousPatterns.rapidRequests.threshold;
    } catch (error) {
      logger.error('Error detecting rapid requests:', error);
      return false;
    }
  }

  async detectFailedLoginPattern(email, ipAddress) {
    try {
      const emailKey = `failed_logins:email:${email}`;
      const ipKey = `failed_logins:ip:${ipAddress}`;

      const emailCount = await redisClient.incr(emailKey);
      const ipCount = await redisClient.incr(ipKey);

      await redisClient.expire(emailKey, securityConfig.threatDetection.suspiciousPatterns.failedLogins.window / 1000);
      await redisClient.expire(ipKey, securityConfig.threatDetection.suspiciousPatterns.failedLogins.window / 1000);

      const threshold = securityConfig.threatDetection.suspiciousPatterns.failedLogins.threshold;
      return emailCount > threshold || ipCount > threshold;
    } catch (error) {
      logger.error('Error detecting failed login pattern:', error);
      return false;
    }
  }

  async detectUnusualLocation(userId, ipAddress) {
    if (!userId || !securityConfig.threatDetection.suspiciousPatterns.unusualLocations) {
      return false;
    }

    try {
      const key = `user_locations:${userId}`;
      const knownLocations = await redisClient.sMembers(key);
      
      // Simple IP-based location check (in production, use proper geolocation service)
      const ipPrefix = ipAddress.split('.').slice(0, 2).join('.');
      
      if (knownLocations.length === 0) {
        // First login, store location
        await redisClient.sAdd(key, ipPrefix);
        await redisClient.expire(key, 30 * 24 * 60 * 60); // 30 days
        return false;
      }

      const isKnownLocation = knownLocations.some(location => location === ipPrefix);
      
      if (!isKnownLocation) {
        await redisClient.sAdd(key, ipPrefix);
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Error detecting unusual location:', error);
      return false;
    }
  }

  detectSQLInjection(req) {
    const sqlPatterns = [
      /('|(\\"|\\';|;|\\)|\\(|\||\|\|)/i,
      /(union|select|insert|delete|update|drop|create|alter|exec|execute)/i,
      /(script|javascript|vbscript|onload|onerror)/i
    ];

    const checkString = JSON.stringify(req.body) + JSON.stringify(req.query) + JSON.stringify(req.params);
    
    return sqlPatterns.some(pattern => pattern.test(checkString));
  }

  detectXSS(req) {
    const xssPatterns = [
      /<script[^>]*>.*?<\/script>/gi,
      /<iframe[^>]*>.*?<\/iframe>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi
    ];

    const checkString = JSON.stringify(req.body) + JSON.stringify(req.query);
    
    return xssPatterns.some(pattern => pattern.test(checkString));
  }

  detectPathTraversal(req) {
    const pathTraversalPatterns = [
      /\.\.\/|\.\.\\|\.\.\%2f|\.\.\%5c/gi,
      /\/etc\/passwd|\/etc\/shadow|\/windows\/system32/gi
    ];

    const checkString = req.originalUrl + JSON.stringify(req.query) + JSON.stringify(req.params);
    
    return pathTraversalPatterns.some(pattern => pattern.test(checkString));
  }

  async handleThreats(threats, data, req) {
    try {
      const threatEvent = {
        threats,
        data,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        timestamp: new Date().toISOString(),
        severity: this.calculateThreatSeverity(threats)
      };

      // Log threat event
      const key = `threat:${crypto.randomUUID()}`;
      await redisClient.setEx(key, 24 * 60 * 60, JSON.stringify(threatEvent)); // 24 hours retention

      logger.warn('Security threat detected', threatEvent);

      // Send alerts for high severity threats
      if (threatEvent.severity >= 7) {
        await this.sendSecurityAlert(threatEvent);
      }

      // Block IP if configured
      if (securityConfig.threatDetection.responseActions.block) {
        await this.blockIP(req.ip, threats);
      }

    } catch (error) {
      logger.error('Error handling threats:', error);
    }
  }

  calculateThreatSeverity(threats) {
    const severityMap = {
      rapid_requests: 3,
      failed_login_pattern: 5,
      unusual_location: 4,
      sql_injection: 9,
      xss_attempt: 7,
      path_traversal: 8
    };

    return Math.max(...threats.map(threat => severityMap[threat] || 1));
  }

  async sendSecurityAlert(threatEvent) {
    try {
      if (securityConfig.monitoring.notifications.email) {
        await emailService.sendEmail({
          to: securityConfig.monitoring.notifications.email,
          subject: 'Security Threat Detected - Hebrew Transcription App',
          html: `
            <h2>Security Alert</h2>
            <p><strong>Severity:</strong> ${threatEvent.severity}/10</p>
            <p><strong>Threats:</strong> ${threatEvent.threats.join(', ')}</p>
            <p><strong>IP Address:</strong> ${threatEvent.ipAddress}</p>
            <p><strong>Timestamp:</strong> ${threatEvent.timestamp}</p>
            <p><strong>Details:</strong> ${JSON.stringify(threatEvent.data, null, 2)}</p>
          `
        });
      }
    } catch (error) {
      logger.error('Error sending security alert:', error);
    }
  }

  async blockIP(ipAddress, threats) {
    try {
      const blockDuration = 60 * 60; // 1 hour
      const key = `blocked_ip:${ipAddress}`;
      
      await redisClient.setEx(key, blockDuration, JSON.stringify({
        threats,
        blockedAt: new Date().toISOString()
      }));

      logger.info(`Blocked IP ${ipAddress} for threats: ${threats.join(', ')}`);
    } catch (error) {
      logger.error('Error blocking IP:', error);
    }
  }

  async getRecentThreats(timeRange = '24h') {
    try {
      const pattern = 'threat:*';
      const keys = await redisClient.keys(pattern);
      const threats = [];

      for (const key of keys) {
        const threatData = await redisClient.get(key);
        if (threatData) {
          threats.push(JSON.parse(threatData));
        }
      }

      return threats.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    } catch (error) {
      logger.error('Error getting recent threats:', error);
      return [];
    }
  }
}

class AccountLockoutManager {
  async recordFailedAttempt(email, ipAddress) {
    try {
      const emailKey = `lockout:email:${email}`;
      const ipKey = `lockout:ip:${ipAddress}`;

      const emailCount = await redisClient.incr(emailKey);
      const ipCount = await redisClient.incr(ipKey);

      // Set expiration for failed attempt counters
      await redisClient.expire(emailKey, 60 * 60); // 1 hour
      await redisClient.expire(ipKey, 60 * 60);

      // Check if account should be locked
      if (emailCount >= securityConfig.accountLockout.maxFailedAttempts) {
        await this.lockAccount(email, 'too_many_failed_attempts');
      }

      // Check if IP should be blocked
      if (ipCount >= securityConfig.accountLockout.maxFailedAttempts * 2) {
        await this.blockIP(ipAddress, 'too_many_failed_attempts');
      }

      return { emailCount, ipCount };
    } catch (error) {
      logger.error('Error recording failed attempt:', error);
      return { emailCount: 0, ipCount: 0 };
    }
  }

  async lockAccount(email, reason) {
    try {
      const lockKey = `account_locked:${email}`;
      const lockData = {
        reason,
        lockedAt: new Date().toISOString(),
        unlockAt: new Date(Date.now() + securityConfig.accountLockout.lockoutDuration).toISOString()
      };

      await redisClient.setEx(
        lockKey,
        Math.floor(securityConfig.accountLockout.lockoutDuration / 1000),
        JSON.stringify(lockData)
      );

      logger.warn(`Account locked: ${email}, reason: ${reason}`);

      // Send notification email if configured
      if (securityConfig.accountLockout.notifyOnLockout) {
        await this.sendLockoutNotification(email, lockData);
      }

      return true;
    } catch (error) {
      logger.error('Error locking account:', error);
      return false;
    }
  }

  async isAccountLocked(email) {
    try {
      const lockKey = `account_locked:${email}`;
      const lockData = await redisClient.get(lockKey);
      
      if (lockData) {
        return JSON.parse(lockData);
      }
      
      return null;
    } catch (error) {
      logger.error('Error checking account lock status:', error);
      return null;
    }
  }

  async resetFailedAttempts(email) {
    try {
      const emailKey = `lockout:email:${email}`;
      await redisClient.del(emailKey);
      return true;
    } catch (error) {
      logger.error('Error resetting failed attempts:', error);
      return false;
    }
  }

  async sendLockoutNotification(email, lockData) {
    try {
      await emailService.sendEmail({
        to: email,
        subject: 'Account Temporarily Locked - Hebrew Transcription App',
        html: `
          <h2>Account Security Alert</h2>
          <p>Your account has been temporarily locked due to multiple failed login attempts.</p>
          <p><strong>Locked at:</strong> ${lockData.lockedAt}</p>
          <p><strong>Will unlock at:</strong> ${lockData.unlockAt}</p>
          <p>If this wasn't you, please contact support immediately.</p>
        `
      });
    } catch (error) {
      logger.error('Error sending lockout notification:', error);
    }
  }

  async getFailedLoginStats(timeRange = '24h') {
    try {
      const pattern = 'lockout:*';
      const keys = await redisClient.keys(pattern);
      const stats = {
        totalFailedAttempts: 0,
        uniqueEmails: new Set(),
        uniqueIPs: new Set(),
        lockedAccounts: 0
      };

      for (const key of keys) {
        const count = await redisClient.get(key);
        if (count) {
          stats.totalFailedAttempts += parseInt(count);
          
          if (key.includes(':email:')) {
            stats.uniqueEmails.add(key.split(':')[2]);
          } else if (key.includes(':ip:')) {
            stats.uniqueIPs.add(key.split(':')[2]);
          }
        }
      }

      // Count locked accounts
      const lockPattern = 'account_locked:*';
      const lockKeys = await redisClient.keys(lockPattern);
      stats.lockedAccounts = lockKeys.length;

      return {
        totalFailedAttempts: stats.totalFailedAttempts,
        uniqueEmails: stats.uniqueEmails.size,
        uniqueIPs: stats.uniqueIPs.size,
        lockedAccounts: stats.lockedAccounts
      };
    } catch (error) {
      logger.error('Error getting failed login stats:', error);
      return {
        totalFailedAttempts: 0,
        uniqueEmails: 0,
        uniqueIPs: 0,
        lockedAccounts: 0
      };
    }
  }
}

class SecurityMonitor {
  async updateMetrics(eventType, data) {
    try {
      const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const hour = new Date().getHours();
      
      // Daily metrics
      const dailyKey = `metrics:daily:${date}`;
      await redisClient.hIncrBy(dailyKey, eventType, 1);
      await redisClient.expire(dailyKey, 30 * 24 * 60 * 60); // 30 days

      // Hourly metrics
      const hourlyKey = `metrics:hourly:${date}:${hour}`;
      await redisClient.hIncrBy(hourlyKey, eventType, 1);
      await redisClient.expire(hourlyKey, 7 * 24 * 60 * 60); // 7 days

      return true;
    } catch (error) {
      logger.error('Error updating security metrics:', error);
      return false;
    }
  }

  async getMetrics(timeRange = '24h') {
    try {
      const metrics = {};
      const now = new Date();
      
      if (timeRange === '24h') {
        // Get last 24 hours of hourly data
        for (let i = 0; i < 24; i++) {
          const date = new Date(now.getTime() - i * 60 * 60 * 1000);
          const dateStr = date.toISOString().split('T')[0];
          const hour = date.getHours();
          const key = `metrics:hourly:${dateStr}:${hour}`;
          
          const hourMetrics = await redisClient.hGetAll(key) || {};
          const timestamp = `${dateStr}T${hour.toString().padStart(2, '0')}:00:00Z`;
          metrics[timestamp] = hourMetrics;
        }
      } else if (timeRange === '7d') {
        // Get last 7 days of daily data
        for (let i = 0; i < 7; i++) {
          const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
          const dateStr = date.toISOString().split('T')[0];
          const key = `metrics:daily:${dateStr}`;
          
          const dailyMetrics = await redisClient.hGetAll(key) || {};
          metrics[dateStr] = dailyMetrics;
        }
      }

      return metrics;
    } catch (error) {
      logger.error('Error getting security metrics:', error);
      return {};
    }
  }
}

// Export singleton instance
const securityService = new SecurityService();
module.exports = securityService;