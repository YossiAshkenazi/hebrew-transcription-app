const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');
const { User, Transcription, WebhookConfig, CustomVocabulary } = require('../models');
const securityService = require('./securityService');
const emailService = require('./emailService');
const { encryptionService } = require('../utils/encryption');
const logger = require('../utils/logger');
const securityConfig = require('../config/security');

class GDPRService {
  constructor() {
    this.exportPath = process.env.GDPR_EXPORT_PATH || path.join(__dirname, '../../exports');
    this.ensureExportDirectory();
  }

  async ensureExportDirectory() {
    try {
      await fs.mkdir(this.exportPath, { recursive: true });
    } catch (error) {
      logger.error('Error creating export directory:', error);
    }
  }

  // Export all user data (GDPR Article 20 - Right to data portability)
  async exportUserData(userId, format = 'json', includeFiles = false) {
    try {
      const user = await User.findByPk(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Check if user has consented to data processing
      if (!user.hasConsent('data_processing')) {
        throw new Error('User has not consented to data processing');
      }

      const exportId = crypto.randomUUID();
      const exportDir = path.join(this.exportPath, exportId);
      await fs.mkdir(exportDir, { recursive: true });

      // Collect all user data
      const userData = await this.collectUserData(user, includeFiles);

      // Generate export based on format
      let exportFile;
      switch (format.toLowerCase()) {
        case 'json':
          exportFile = await this.exportAsJSON(userData, exportDir, exportId);
          break;
        case 'csv':
          exportFile = await this.exportAsCSV(userData, exportDir, exportId);
          break;
        case 'xml':
          exportFile = await this.exportAsXML(userData, exportDir, exportId);
          break;
        default:
          throw new Error('Unsupported export format');
      }

      // Log the export
      await securityService.handleSecurityEvent('gdpr.data_exported', {
        userId: user.id,
        email: user.email,
        exportId,
        format,
        includeFiles
      });

      // Send notification email
      await this.sendExportNotification(user, exportFile);

      logger.info(`Data export completed for user ${user.email}: ${exportId}`);

      return {
        exportId,
        exportFile,
        format,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
      };
    } catch (error) {
      logger.error('Error exporting user data:', error);
      throw error;
    }
  }

  // Collect all user data from various sources
  async collectUserData(user, includeFiles = false) {
    try {
      const userData = {
        personal: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          phoneNumber: user.phoneNumber,
          phoneVerified: user.phoneVerified,
          emailVerified: user.emailVerified,
          isActive: user.isActive,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
          lastLoginAt: user.lastLoginAt,
          lastPasswordChange: user.lastPasswordChange,
          lastSecurityUpdate: user.lastSecurityUpdate
        },
        preferences: {
          settings: user.settings,
          securitySettings: this.sanitizeSecuritySettings(user.securitySettings),
          privacySettings: user.privacySettings
        },
        security: {
          mfaEnabled: user.mfaEnabled,
          failedLoginAttempts: user.failedLoginAttempts,
          lastFailedLoginAt: user.lastFailedLoginAt,
          riskScore: user.riskScore,
          oauthProviders: user.oauthProviders?.map(p => ({
            provider: p.provider,
            email: p.email,
            connectedAt: p.connectedAt
          }))
        },
        transcriptions: [],
        webhooks: [],
        vocabulary: [],
        files: []
      };

      // Get transcriptions
      const transcriptions = await Transcription.findAll({
        where: { userId: user.id },
        order: [['createdAt', 'DESC']]
      });

      userData.transcriptions = transcriptions.map(t => ({
        id: t.id,
        filename: t.filename,
        originalFilename: t.originalFilename,
        status: t.status,
        language: t.language,
        duration: t.duration,
        transcriptionText: t.transcriptionText,
        speakerDetection: t.speakerDetection,
        confidence: t.confidence,
        processingMetadata: t.processingMetadata,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        completedAt: t.completedAt
      }));

      // Get webhook configurations
      const webhooks = await WebhookConfig.findAll({
        where: { userId: user.id }
      });

      userData.webhooks = webhooks.map(w => ({
        id: w.id,
        name: w.name,
        url: w.url,
        events: w.events,
        isActive: w.isActive,
        secret: '[REDACTED]', // Don't export webhook secrets
        headers: w.headers,
        retryPolicy: w.retryPolicy,
        totalDeliveries: w.totalDeliveries,
        totalFailures: w.totalFailures,
        lastTriggeredAt: w.lastTriggeredAt,
        lastSuccessAt: w.lastSuccessAt,
        lastFailureAt: w.lastFailureAt,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt
      }));

      // Get custom vocabulary
      const vocabulary = await CustomVocabulary.findAll({
        where: { userId: user.id }
      });

      userData.vocabulary = vocabulary.map(v => ({
        id: v.id,
        word: v.word,
        pronunciation: v.pronunciation,
        category: v.category,
        frequency: v.frequency,
        isActive: v.isActive,
        metadata: v.metadata,
        createdAt: v.createdAt,
        updatedAt: v.updatedAt
      }));

      // Include files if requested
      if (includeFiles) {
        userData.files = await this.collectUserFiles(user, transcriptions);
      }

      // Add metadata about the export
      userData._metadata = {
        exportDate: new Date().toISOString(),
        exportedBy: 'Hebrew Transcription App GDPR Service',
        dataController: 'Hebrew Transcription App',
        legalBasis: 'GDPR Article 20 - Right to data portability',
        retentionPolicy: `Data retention: ${user.privacySettings?.dataRetentionDays || 365} days`,
        contactInfo: process.env.DPO_EMAIL || 'privacy@example.com'
      };

      return userData;
    } catch (error) {
      logger.error('Error collecting user data:', error);
      throw error;
    }
  }

  // Sanitize security settings for export (remove sensitive data)
  sanitizeSecuritySettings(securitySettings) {
    if (!securitySettings) return {};

    const sanitized = { ...securitySettings };
    
    // Remove sensitive arrays
    delete sanitized.trustedDevices;
    delete sanitized.allowedIPs;
    
    return {
      loginNotifications: sanitized.loginNotifications,
      suspiciousActivityAlerts: sanitized.suspiciousActivityAlerts,
      sessionTimeout: sanitized.sessionTimeout,
      requireMfaForSensitiveOps: sanitized.requireMfaForSensitiveOps
    };
  }

  // Collect user files (audio files, etc.)
  async collectUserFiles(user, transcriptions) {
    const files = [];
    
    for (const transcription of transcriptions) {
      if (transcription.filePath) {
        try {
          const stats = await fs.stat(transcription.filePath);
          files.push({
            transcriptionId: transcription.id,
            filename: transcription.originalFilename,
            path: transcription.filePath,
            size: stats.size,
            mimeType: transcription.mimeType,
            createdAt: transcription.createdAt
          });
        } catch (error) {
          // File might not exist anymore
          logger.warn(`File not found for transcription ${transcription.id}: ${transcription.filePath}`);
        }
      }
    }
    
    return files;
  }

  // Export as JSON
  async exportAsJSON(userData, exportDir, exportId) {
    try {
      const filename = `gdpr-export-${exportId}.json`;
      const filePath = path.join(exportDir, filename);
      
      await fs.writeFile(filePath, JSON.stringify(userData, null, 2));
      
      return {
        filename,
        path: filePath,
        size: (await fs.stat(filePath)).size
      };
    } catch (error) {
      logger.error('Error exporting as JSON:', error);
      throw error;
    }
  }

  // Export as CSV (multiple files)
  async exportAsCSV(userData, exportDir, exportId) {
    try {
      const files = [];
      
      // Personal data CSV
      const personalCsv = this.convertToCSV([userData.personal]);
      const personalFile = path.join(exportDir, `personal-data-${exportId}.csv`);
      await fs.writeFile(personalFile, personalCsv);
      files.push(personalFile);
      
      // Transcriptions CSV
      if (userData.transcriptions.length > 0) {
        const transcriptionsCsv = this.convertToCSV(userData.transcriptions);
        const transcriptionsFile = path.join(exportDir, `transcriptions-${exportId}.csv`);
        await fs.writeFile(transcriptionsFile, transcriptionsCsv);
        files.push(transcriptionsFile);
      }
      
      // Webhooks CSV
      if (userData.webhooks.length > 0) {
        const webhooksCsv = this.convertToCSV(userData.webhooks);
        const webhooksFile = path.join(exportDir, `webhooks-${exportId}.csv`);
        await fs.writeFile(webhooksFile, webhooksCsv);
        files.push(webhooksFile);
      }
      
      // Vocabulary CSV
      if (userData.vocabulary.length > 0) {
        const vocabularyCsv = this.convertToCSV(userData.vocabulary);
        const vocabularyFile = path.join(exportDir, `vocabulary-${exportId}.csv`);
        await fs.writeFile(vocabularyFile, vocabularyCsv);
        files.push(vocabularyFile);
      }
      
      // Create ZIP file
      const zipFilename = `gdpr-export-${exportId}.zip`;
      const zipPath = path.join(exportDir, zipFilename);
      await this.createZipArchive(files, zipPath);
      
      return {
        filename: zipFilename,
        path: zipPath,
        size: (await fs.stat(zipPath)).size
      };
    } catch (error) {
      logger.error('Error exporting as CSV:', error);
      throw error;
    }
  }

  // Export as XML
  async exportAsXML(userData, exportDir, exportId) {
    try {
      const xml = this.convertToXML(userData);
      const filename = `gdpr-export-${exportId}.xml`;
      const filePath = path.join(exportDir, filename);
      
      await fs.writeFile(filePath, xml);
      
      return {
        filename,
        path: filePath,
        size: (await fs.stat(filePath)).size
      };
    } catch (error) {
      logger.error('Error exporting as XML:', error);
      throw error;
    }
  }

  // Convert array of objects to CSV
  convertToCSV(data) {
    if (!data || data.length === 0) return '';
    
    const headers = Object.keys(data[0]);
    const rows = data.map(row => 
      headers.map(header => {
        const value = row[header];
        if (value === null || value === undefined) return '';
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value).replace(/"/g, '""');
      }).map(field => `"${field}"`).join(',')
    );
    
    return [headers.join(','), ...rows].join('\n');
  }

  // Convert data to XML
  convertToXML(data, rootElement = 'gdpr-export') {
    const escapeXml = (str) => {
      if (typeof str !== 'string') str = String(str);
      return str.replace(/[<>&'"]/g, (c) => {
        switch (c) {
          case '<': return '&lt;';
          case '>': return '&gt;';
          case '&': return '&amp;';
          case "'": return '&apos;';
          case '"': return '&quot;';
          default: return c;
        }
      });
    };

    const objectToXml = (obj, indent = '') => {
      let xml = '';
      
      for (const [key, value] of Object.entries(obj)) {
        if (Array.isArray(value)) {
          xml += `${indent}<${key}>\n`;
          value.forEach((item, index) => {
            xml += `${indent}  <item index="${index}">\n`;
            if (typeof item === 'object') {
              xml += objectToXml(item, indent + '    ');
            } else {
              xml += `${indent}    ${escapeXml(item)}\n`;
            }
            xml += `${indent}  </item>\n`;
          });
          xml += `${indent}</${key}>\n`;
        } else if (typeof value === 'object' && value !== null) {
          xml += `${indent}<${key}>\n`;
          xml += objectToXml(value, indent + '  ');
          xml += `${indent}</${key}>\n`;
        } else {
          xml += `${indent}<${key}>${escapeXml(value || '')}</${key}>\n`;
        }
      }
      
      return xml;
    };

    return `<?xml version="1.0" encoding="UTF-8"?>\n<${rootElement}>\n${objectToXml(data, '  ')}</${rootElement}>`;
  }

  // Create ZIP archive
  async createZipArchive(files, outputPath) {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(outputPath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      
      output.on('close', () => resolve());
      archive.on('error', reject);
      
      archive.pipe(output);
      
      files.forEach(file => {
        archive.file(file, { name: path.basename(file) });
      });
      
      archive.finalize();
    });
  }

  // Delete all user data (GDPR Article 17 - Right to erasure/Right to be forgotten)
  async deleteUserData(userId, reason = 'user_request', adminId = null) {
    try {
      const user = await User.findByPk(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const deletionId = crypto.randomUUID();
      
      // Log the deletion request
      await securityService.handleSecurityEvent('gdpr.deletion_requested', {
        userId: user.id,
        email: user.email,
        deletionId,
        reason,
        adminId
      });

      // Collect data to be deleted for audit purposes
      const dataInventory = await this.createDeletionInventory(user);

      // Start deletion process
      const deletionResult = await this.performDataDeletion(user, deletionId);

      // Log completion
      await securityService.handleSecurityEvent('gdpr.deletion_completed', {
        userId: user.id,
        email: user.email,
        deletionId,
        reason,
        adminId,
        dataInventory,
        deletionResult
      });

      // Send confirmation email (if user still exists and consents)
      if (reason === 'user_request' && user.email) {
        await this.sendDeletionConfirmation(user.email, deletionId);
      }

      logger.info(`User data deletion completed: ${user.email} (${deletionId})`);

      return {
        deletionId,
        userId: user.id,
        email: user.email,
        reason,
        deletedAt: new Date().toISOString(),
        dataInventory,
        deletionResult
      };
    } catch (error) {
      logger.error('Error deleting user data:', error);
      throw error;
    }
  }

  // Create inventory of data to be deleted
  async createDeletionInventory(user) {
    try {
      const transcriptionCount = await Transcription.count({ where: { userId: user.id } });
      const webhookCount = await WebhookConfig.count({ where: { userId: user.id } });
      const vocabularyCount = await CustomVocabulary.count({ where: { userId: user.id } });

      return {
        user: {
          id: user.id,
          email: user.email,
          createdAt: user.createdAt
        },
        counts: {
          transcriptions: transcriptionCount,
          webhooks: webhookCount,
          customVocabulary: vocabularyCount
        },
        inventoryCreatedAt: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Error creating deletion inventory:', error);
      return { error: error.message };
    }
  }

  // Perform the actual data deletion
  async performDataDeletion(user, deletionId) {
    const results = {
      deletionId,
      steps: []
    };

    try {
      // 1. Delete transcriptions and associated files
      const transcriptions = await Transcription.findAll({
        where: { userId: user.id }
      });

      for (const transcription of transcriptions) {
        try {
          // Delete physical file if it exists
          if (transcription.filePath) {
            await fs.unlink(transcription.filePath).catch(() => {
              // File might not exist, continue
            });
          }
          
          // Delete S3 file if it exists
          if (transcription.s3Key) {
            // S3 deletion would be handled here
            // await s3Service.deleteFile(transcription.s3Key);
          }
        } catch (error) {
          logger.warn(`Error deleting file for transcription ${transcription.id}:`, error);
        }
      }

      const deletedTranscriptions = await Transcription.destroy({
        where: { userId: user.id }
      });
      results.steps.push({
        step: 'transcriptions',
        deleted: deletedTranscriptions,
        timestamp: new Date().toISOString()
      });

      // 2. Delete webhook configurations
      const deletedWebhooks = await WebhookConfig.destroy({
        where: { userId: user.id }
      });
      results.steps.push({
        step: 'webhooks',
        deleted: deletedWebhooks,
        timestamp: new Date().toISOString()
      });

      // 3. Delete custom vocabulary
      const deletedVocabulary = await CustomVocabulary.destroy({
        where: { userId: user.id }
      });
      results.steps.push({
        step: 'vocabulary',
        deleted: deletedVocabulary,
        timestamp: new Date().toISOString()
      });

      // 4. Clear Redis data
      await this.clearUserRedisData(user.id);
      results.steps.push({
        step: 'redis_data',
        deleted: 'cleared',
        timestamp: new Date().toISOString()
      });

      // 5. Delete user account (or anonymize if required by law)
      const anonymizeOnly = process.env.GDPR_ANONYMIZE_ONLY === 'true';
      
      if (anonymizeOnly) {
        // Anonymize user data instead of deleting
        await user.update({
          email: `deleted-${crypto.randomBytes(8).toString('hex')}@deleted.local`,
          firstName: '[DELETED]',
          lastName: '[DELETED]',
          phoneNumber: null,
          isActive: false,
          settings: {},
          securitySettings: {},
          privacySettings: {},
          mfaEnabled: false,
          mfaSecret: null,
          mfaBackupCodes: [],
          apiKeys: [],
          oauthProviders: [],
          passwordHistory: [],
          activeSessions: [],
          riskFactors: []
        });
        results.steps.push({
          step: 'user_account',
          deleted: 'anonymized',
          timestamp: new Date().toISOString()
        });
      } else {
        await user.destroy();
        results.steps.push({
          step: 'user_account',
          deleted: 1,
          timestamp: new Date().toISOString()
        });
      }

      results.completedAt = new Date().toISOString();
      results.success = true;

      return results;
    } catch (error) {
      logger.error('Error performing data deletion:', error);
      results.error = error.message;
      results.success = false;
      return results;
    }
  }

  // Clear user data from Redis
  async clearUserRedisData(userId) {
    try {
      const redis = require('redis');
      const client = redis.createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        password: process.env.REDIS_PASSWORD
      });

      if (!client.isOpen) {
        await client.connect();
      }

      // Clear session data
      const sessionKeys = await client.keys(`session:${userId}:*`);
      if (sessionKeys.length > 0) {
        await client.del(sessionKeys);
      }

      // Clear MFA data
      const mfaKeys = await client.keys(`*:${userId}:*`);
      if (mfaKeys.length > 0) {
        await client.del(mfaKeys);
      }

      // Clear rate limit data
      const rateLimitKeys = await client.keys(`*rate_limit*${userId}*`);
      if (rateLimitKeys.length > 0) {
        await client.del(rateLimitKeys);
      }

      await client.quit();
    } catch (error) {
      logger.error('Error clearing Redis data:', error);
    }
  }

  // Send export notification
  async sendExportNotification(user, exportFile) {
    try {
      await emailService.sendEmail({
        to: user.email,
        subject: 'Your Data Export is Ready - Hebrew Transcription App',
        html: `
          <h2>Data Export Completed</h2>
          <p>Hello ${user.firstName},</p>
          <p>Your data export has been completed and is ready for download.</p>
          <p><strong>Export Details:</strong></p>
          <ul>
            <li>File: ${exportFile.filename}</li>
            <li>Size: ${Math.round(exportFile.size / 1024)} KB</li>
            <li>Created: ${new Date().toISOString()}</li>
          </ul>
          <p>This export will be available for 7 days, after which it will be automatically deleted.</p>
          <p>If you have any questions about your data export, please contact our support team.</p>
          <hr>
          <p style="font-size: 12px; color: #666;">
            This export was generated in compliance with GDPR Article 20 (Right to data portability).
          </p>
        `
      });
    } catch (error) {
      logger.error('Error sending export notification:', error);
    }
  }

  // Send deletion confirmation
  async sendDeletionConfirmation(email, deletionId) {
    try {
      await emailService.sendEmail({
        to: email,
        subject: 'Account Deletion Completed - Hebrew Transcription App',
        html: `
          <h2>Account Deletion Completed</h2>
          <p>This confirms that your account and all associated data have been permanently deleted from our systems.</p>
          <p><strong>Deletion Details:</strong></p>
          <ul>
            <li>Deletion ID: ${deletionId}</li>
            <li>Completed: ${new Date().toISOString()}</li>
          </ul>
          <p>All your personal data, transcriptions, settings, and files have been removed in compliance with GDPR Article 17 (Right to erasure).</p>
          <p>If you have any questions about this deletion, please contact our Data Protection Officer.</p>
          <hr>
          <p style="font-size: 12px; color: #666;">
            This deletion was performed in compliance with GDPR Article 17 (Right to erasure).
          </p>
        `
      });
    } catch (error) {
      logger.error('Error sending deletion confirmation:', error);
    }
  }

  // Update user consent
  async updateUserConsent(userId, consentData) {
    try {
      const user = await User.findByPk(userId);
      if (!user) {
        throw new Error('User not found');
      }

      await user.updateConsent(consentData);

      await securityService.handleSecurityEvent('gdpr.consent_updated', {
        userId: user.id,
        email: user.email,
        consentData: {
          version: consentData.version,
          allowDataProcessing: consentData.allowDataProcessing,
          allowAnalytics: consentData.allowAnalytics,
          allowMarketing: consentData.allowMarketing
        }
      });

      logger.info(`Consent updated for user ${user.email}`);

      return {
        success: true,
        updatedAt: new Date().toISOString(),
        consentVersion: consentData.version || '1.0'
      };
    } catch (error) {
      logger.error('Error updating user consent:', error);
      throw error;
    }
  }

  // Get user's current consent status
  async getUserConsent(userId) {
    try {
      const user = await User.findByPk(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const privacy = user.privacySettings || {};

      return {
        hasConsent: {
          dataProcessing: user.hasConsent('data_processing'),
          analytics: user.hasConsent('analytics'),
          marketing: user.hasConsent('marketing')
        },
        consentDate: privacy.consentDate,
        consentVersion: privacy.consentVersion || '1.0',
        dataRetentionDays: privacy.dataRetentionDays || 365
      };
    } catch (error) {
      logger.error('Error getting user consent:', error);
      throw error;
    }
  }

  // Cleanup expired exports
  async cleanupExpiredExports() {
    try {
      const exportDirs = await fs.readdir(this.exportPath);
      let cleanedCount = 0;

      for (const dir of exportDirs) {
        const dirPath = path.join(this.exportPath, dir);
        const stat = await fs.stat(dirPath);

        if (stat.isDirectory()) {
          const ageInDays = Math.floor((Date.now() - stat.mtime.getTime()) / (1000 * 60 * 60 * 24));
          
          if (ageInDays > 7) {
            await fs.rmdir(dirPath, { recursive: true });
            cleanedCount++;
          }
        }
      }

      logger.info(`Cleaned up ${cleanedCount} expired GDPR exports`);
      return cleanedCount;
    } catch (error) {
      logger.error('Error cleaning up expired exports:', error);
      return 0;
    }
  }

  // Generate GDPR compliance report
  async generateComplianceReport() {
    try {
      const totalUsers = await User.count();
      const activeUsers = await User.count({ where: { isActive: true } });
      const usersWithConsent = await User.count({
        where: {
          privacySettings: {
            allowDataProcessing: true
          }
        }
      });

      const report = {
        generatedAt: new Date().toISOString(),
        userStatistics: {
          total: totalUsers,
          active: activeUsers,
          withConsent: usersWithConsent,
          consentRate: totalUsers > 0 ? Math.round((usersWithConsent / totalUsers) * 100) : 0
        },
        dataRetention: {
          defaultRetentionDays: securityConfig.dataProtection.dataRetentionDays,
          anonymizationEnabled: securityConfig.dataProtection.anonymizationEnabled,
          exportFormats: securityConfig.dataProtection.exportFormats
        },
        compliance: {
          gdprEnabled: securityConfig.dataProtection.enabled,
          consentTracking: securityConfig.dataProtection.consentTracking,
          deletionGracePeriod: securityConfig.dataProtection.deletionGracePeriod / (24 * 60 * 60 * 1000)
        }
      };

      return report;
    } catch (error) {
      logger.error('Error generating compliance report:', error);
      throw error;
    }
  }
}

// Export singleton instance
const gdprService = new GDPRService();
module.exports = gdprService;