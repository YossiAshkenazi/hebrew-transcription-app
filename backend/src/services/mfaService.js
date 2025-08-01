const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const crypto = require('crypto');
const redis = require('redis');
const { User } = require('../models');
const emailService = require('./emailService');
const securityService = require('./securityService');
const securityConfig = require('../config/security');
const logger = require('../utils/logger');

// Initialize Redis client for MFA tokens
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  password: process.env.REDIS_PASSWORD,
  database: parseInt(process.env.REDIS_MFA_DB) || 3
});

if (!redisClient.isOpen) {
  redisClient.connect().catch(logger.error);
}

class MFAService {
  // Generate TOTP secret for a user
  async generateTOTPSecret(user) {
    try {
      const secret = speakeasy.generateSecret({
        name: `${securityConfig.mfa.issuer} (${user.email})`,
        issuer: securityConfig.mfa.issuer,
        length: 32
      });

      // Store temporary secret (not yet confirmed)
      const tempKey = `mfa_temp:${user.id}`;
      await redisClient.setEx(tempKey, 10 * 60, JSON.stringify({
        secret: secret.base32,
        ascii: secret.ascii,
        hex: secret.hex,
        otpauth_url: secret.otpauth_url,
        createdAt: new Date().toISOString()
      }));

      // Generate QR code
      const qrCode = await QRCode.toDataURL(secret.otpauth_url);

      await securityService.handleSecurityEvent('mfa.secret_generated', {
        userId: user.id,
        email: user.email
      });

      return {
        secret: secret.base32,
        qrCode,
        backupCodes: await this.generateBackupCodes(user.id)
      };
    } catch (error) {
      logger.error('Error generating TOTP secret:', error);
      throw new Error('Failed to generate MFA secret');
    }
  }

  // Verify TOTP token and enable MFA
  async enableTOTP(user, token) {
    try {
      const tempKey = `mfa_temp:${user.id}`;
      const tempData = await redisClient.get(tempKey);
      
      if (!tempData) {
        throw new Error('No pending MFA setup found');
      }

      const { secret } = JSON.parse(tempData);
      
      const verified = speakeasy.totp.verify({
        secret,
        encoding: 'base32',
        token,
        window: securityConfig.mfa.window,
        step: securityConfig.mfa.step
      });

      if (!verified) {
        await securityService.handleSecurityEvent('mfa.verification_failed', {
          userId: user.id,
          email: user.email,
          type: 'totp_enable'
        });
        throw new Error('Invalid MFA token');
      }

      // Save MFA settings to user
      await user.update({
        mfaEnabled: true,
        mfaSecret: this.encryptSecret(secret),
        mfaBackupCodes: await this.getBackupCodes(user.id)
      });

      // Clear temporary data
      await redisClient.del(tempKey);
      await redisClient.del(`backup_codes:${user.id}`);

      await securityService.handleSecurityEvent('mfa.enabled', {
        userId: user.id,
        email: user.email,
        type: 'totp'
      });

      logger.info(`MFA enabled for user ${user.email}`);
      return true;
    } catch (error) {
      logger.error('Error enabling TOTP:', error);
      throw error;
    }
  }

  // Verify TOTP token for authentication
  async verifyTOTP(user, token) {
    try {
      if (!user.mfaEnabled || !user.mfaSecret) {
        throw new Error('MFA not enabled for user');
      }

      const secret = this.decryptSecret(user.mfaSecret);
      
      const verified = speakeasy.totp.verify({
        secret,
        encoding: 'base32',
        token,
        window: securityConfig.mfa.window,
        step: securityConfig.mfa.step
      });

      if (verified) {
        await securityService.handleSecurityEvent('mfa.verification_success', {
          userId: user.id,
          email: user.email,
          type: 'totp'
        });
        return true;
      }

      // Check if it's a backup code
      if (await this.verifyBackupCode(user, token)) {
        return true;
      }

      await securityService.handleSecurityEvent('mfa.verification_failed', {
        userId: user.id,
        email: user.email,
        type: 'totp'
      });

      return false;
    } catch (error) {
      logger.error('Error verifying TOTP:', error);
      return false;
    }
  }

  // Generate backup codes
  async generateBackupCodes(userId) {
    try {
      const codes = [];
      for (let i = 0; i < securityConfig.mfa.backupCodes.count; i++) {
        codes.push(crypto.randomBytes(securityConfig.mfa.backupCodes.length / 2).toString('hex'));
      }

      // Store encrypted backup codes in Redis temporarily
      const key = `backup_codes:${userId}`;
      const encryptedCodes = codes.map(code => this.encryptSecret(code));
      await redisClient.setEx(key, 10 * 60, JSON.stringify(encryptedCodes)); // 10 minutes

      return codes;
    } catch (error) {
      logger.error('Error generating backup codes:', error);
      throw new Error('Failed to generate backup codes');
    }
  }

  // Get backup codes from temporary storage
  async getBackupCodes(userId) {
    try {
      const key = `backup_codes:${userId}`;
      const codesData = await redisClient.get(key);
      return codesData ? JSON.parse(codesData) : [];
    } catch (error) {
      logger.error('Error getting backup codes:', error);
      return [];
    }
  }

  // Verify backup code
  async verifyBackupCode(user, code) {
    try {
      if (!user.mfaBackupCodes || user.mfaBackupCodes.length === 0) {
        return false;
      }

      const encryptedCode = this.encryptSecret(code);
      const codeIndex = user.mfaBackupCodes.indexOf(encryptedCode);
      
      if (codeIndex === -1) {
        return false;
      }

      // Remove used backup code
      const updatedCodes = [...user.mfaBackupCodes];
      updatedCodes.splice(codeIndex, 1);
      
      await user.update({ mfaBackupCodes: updatedCodes });

      await securityService.handleSecurityEvent('mfa.backup_code_used', {
        userId: user.id,
        email: user.email,
        remainingCodes: updatedCodes.length
      });

      // Alert user if running low on backup codes
      if (updatedCodes.length <= 2) {
        await this.sendBackupCodeAlert(user, updatedCodes.length);
      }

      return true;
    } catch (error) {
      logger.error('Error verifying backup code:', error);
      return false;
    }
  }

  // Disable MFA for a user
  async disableMFA(user, currentPassword, mfaToken) {
    try {
      // Verify current password
      const isPasswordValid = await user.validatePassword(currentPassword);
      if (!isPasswordValid) {
        throw new Error('Invalid current password');
      }

      // Verify MFA token
      const isMFAValid = await this.verifyTOTP(user, mfaToken);
      if (!isMFAValid) {
        throw new Error('Invalid MFA token');
      }

      // Disable MFA
      await user.update({
        mfaEnabled: false,
        mfaSecret: null,
        mfaBackupCodes: []
      });

      await securityService.handleSecurityEvent('mfa.disabled', {
        userId: user.id,
        email: user.email
      });

      // Send notification email
      await this.sendMFADisabledNotification(user);

      logger.info(`MFA disabled for user ${user.email}`);
      return true;
    } catch (error) {
      logger.error('Error disabling MFA:', error);
      throw error;
    }
  }

  // Email-based 2FA for sensitive operations
  async sendEmailMFA(user, operation, req) {
    try {
      const code = crypto.randomInt(100000, 999999).toString(); // 6-digit code
      const key = `email_mfa:${user.id}:${operation}`;
      
      // Store code with 10-minute expiration
      await redisClient.setEx(key, 10 * 60, JSON.stringify({
        code: this.hashCode(code),
        operation,
        createdAt: new Date().toISOString(),
        ipAddress: req?.ip,
        userAgent: req?.get('User-Agent')
      }));

      // Send email with code
      await emailService.sendEmail({
        to: user.email,
        subject: `Security Code for ${operation} - Hebrew Transcription App`,
        html: `
          <h2>Security Verification Required</h2>
          <p>Hello ${user.firstName},</p>
          <p>You are attempting to perform a sensitive operation: <strong>${operation}</strong></p>
          <p>Your verification code is:</p>
          <div style="font-size: 24px; font-weight: bold; color: #2196F3; margin: 20px 0;">
            ${code}
          </div>
          <p>This code will expire in 10 minutes.</p>
          <p>If you didn't request this action, please secure your account immediately.</p>
          <hr>
          <p style="font-size: 12px; color: #666;">
            Request from IP: ${req?.ip || 'Unknown'}<br>
            Time: ${new Date().toISOString()}
          </p>
        `
      });

      await securityService.handleSecurityEvent('mfa.email_sent', {
        userId: user.id,
        email: user.email,
        operation
      }, req);

      return true;
    } catch (error) {
      logger.error('Error sending email MFA:', error);
      throw new Error('Failed to send verification code');
    }
  }

  // Verify email MFA code
  async verifyEmailMFA(user, operation, code) {
    try {
      const key = `email_mfa:${user.id}:${operation}`;
      const storedData = await redisClient.get(key);
      
      if (!storedData) {
        await securityService.handleSecurityEvent('mfa.email_verification_failed', {
          userId: user.id,
          email: user.email,
          operation,
          reason: 'expired_or_not_found'
        });
        throw new Error('Verification code expired or not found');
      }

      const { code: hashedCode, createdAt } = JSON.parse(storedData);
      
      // Check if code is still valid (double-check expiration)
      const codeAge = Date.now() - new Date(createdAt).getTime();
      if (codeAge > 10 * 60 * 1000) { // 10 minutes
        await redisClient.del(key);
        throw new Error('Verification code expired');
      }

      // Verify code
      const isCodeValid = this.verifyHashedCode(code, hashedCode);
      
      if (!isCodeValid) {
        await securityService.handleSecurityEvent('mfa.email_verification_failed', {
          userId: user.id,
          email: user.email,
          operation,
          reason: 'invalid_code'
        });
        throw new Error('Invalid verification code');
      }

      // Delete used code
      await redisClient.del(key);

      await securityService.handleSecurityEvent('mfa.email_verification_success', {
        userId: user.id,
        email: user.email,
        operation
      });

      return true;
    } catch (error) {
      logger.error('Error verifying email MFA:', error);
      throw error;
    }
  }

  // Generate new backup codes
  async regenerateBackupCodes(user, mfaToken) {
    try {
      // Verify MFA token
      const isMFAValid = await this.verifyTOTP(user, mfaToken);
      if (!isMFAValid) {
        throw new Error('Invalid MFA token');
      }

      // Generate new backup codes
      const newCodes = [];
      for (let i = 0; i < securityConfig.mfa.backupCodes.count; i++) {
        newCodes.push(crypto.randomBytes(securityConfig.mfa.backupCodes.length / 2).toString('hex'));
      }

      // Encrypt and store new codes
      const encryptedCodes = newCodes.map(code => this.encryptSecret(code));
      await user.update({ mfaBackupCodes: encryptedCodes });

      await securityService.handleSecurityEvent('mfa.backup_codes_regenerated', {
        userId: user.id,
        email: user.email
      });

      // Send notification email
      await this.sendBackupCodesRegeneratedNotification(user);

      return newCodes;
    } catch (error) {
      logger.error('Error regenerating backup codes:', error);
      throw error;
    }
  }

  // Utility methods
  encryptSecret(secret) {
    const cipher = crypto.createCipher('aes-256-cbc', process.env.MFA_ENCRYPTION_KEY || 'default-key');
    let encrypted = cipher.update(secret, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
  }

  decryptSecret(encryptedSecret) {
    const decipher = crypto.createDecipher('aes-256-cbc', process.env.MFA_ENCRYPTION_KEY || 'default-key');
    let decrypted = decipher.update(encryptedSecret, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  hashCode(code) {
    return crypto.createHash('sha256').update(code + process.env.MFA_CODE_SALT || 'salt').digest('hex');
  }

  verifyHashedCode(code, hashedCode) {
    return this.hashCode(code) === hashedCode;
  }

  // Notification methods
  async sendMFADisabledNotification(user) {
    try {
      await emailService.sendEmail({
        to: user.email,
        subject: 'Multi-Factor Authentication Disabled - Hebrew Transcription App',
        html: `
          <h2>Security Alert</h2>
          <p>Hello ${user.firstName},</p>
          <p>Multi-factor authentication has been disabled for your account.</p>
          <p>If you didn't make this change, please contact support immediately.</p>
          <p>Time: ${new Date().toISOString()}</p>
        `
      });
    } catch (error) {
      logger.error('Error sending MFA disabled notification:', error);
    }
  }

  async sendBackupCodeAlert(user, remainingCodes) {
    try {
      await emailService.sendEmail({
        to: user.email,
        subject: 'Low Backup Codes Alert - Hebrew Transcription App',
        html: `
          <h2>Backup Code Alert</h2>
          <p>Hello ${user.firstName},</p>
          <p>You have only ${remainingCodes} backup codes remaining.</p>
          <p>Please generate new backup codes to ensure you can access your account if you lose access to your authenticator app.</p>
          <p><a href="${process.env.FRONTEND_URL}/settings/security">Manage Security Settings</a></p>
        `
      });
    } catch (error) {
      logger.error('Error sending backup code alert:', error);
    }
  }

  async sendBackupCodesRegeneratedNotification(user) {
    try {
      await emailService.sendEmail({
        to: user.email,
        subject: 'Backup Codes Regenerated - Hebrew Transcription App',
        html: `
          <h2>Security Notification</h2>
          <p>Hello ${user.firstName},</p>
          <p>New backup codes have been generated for your account.</p>
          <p>Your previous backup codes are no longer valid.</p>
          <p>Time: ${new Date().toISOString()}</p>
        `
      });
    } catch (error) {
      logger.error('Error sending backup codes regenerated notification:', error);
    }
  }

  // Get MFA status for user
  async getMFAStatus(user) {
    try {
      return {
        enabled: user.mfaEnabled || false,
        backupCodesCount: user.mfaBackupCodes ? user.mfaBackupCodes.length : 0,
        lastUsed: null // Could track this if needed
      };
    } catch (error) {
      logger.error('Error getting MFA status:', error);
      return {
        enabled: false,
        backupCodesCount: 0,
        lastUsed: null
      };
    }
  }
}

// Export singleton instance
const mfaService = new MFAService();
module.exports = mfaService;