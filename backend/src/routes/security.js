const express = require('express');
const { body, validationResult, param, query } = require('express-validator');
const router = express.Router();

// Import services and middleware
const { authenticate, requireMFA, requireRole } = require('../middleware/advancedAuth');
const securityService = require('../services/securityService');
const mfaService = require('../services/mfaService');
const apiKeyService = require('../services/apiKeyService');
const gdprService = require('../services/gdprService');
const oauthService = require('../services/oauthService');
const { rateLimiters } = require('../middleware/security');
const logger = require('../utils/logger');

/**
 * @swagger
 * components:
 *   schemas:
 *     SecurityDashboard:
 *       type: object
 *       properties:
 *         metrics:
 *           type: object
 *         threats:
 *           type: array
 *         failedLogins:
 *           type: object
 *         generated:
 *           type: string
 *           format: date-time
 */

// Apply rate limiting to all security endpoints
router.use(rateLimiters.general);

/**
 * @swagger
 * /security/dashboard:
 *   get:
 *     summary: Get security dashboard data
 *     tags: [Security]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: timeRange
 *         schema:
 *           type: string
 *           enum: [1h, 24h, 7d, 30d]
 *           default: 24h
 *         description: Time range for metrics
 *     responses:
 *       200:
 *         description: Security dashboard data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/SecurityDashboard'
 */
router.get('/dashboard', authenticate, requireRole(['admin', 'security']), async (req, res) => {
  try {
    const timeRange = req.query.timeRange || '24h';
    const dashboard = await securityService.getSecurityDashboard(timeRange);

    res.json({
      success: true,
      data: dashboard
    });
  } catch (error) {
    logger.error('Error getting security dashboard:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve security dashboard'
    });
  }
});

/**
 * @swagger
 * /security/audit-logs:
 *   get:
 *     summary: Get audit logs
 *     tags: [Security]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Start date for log export
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: End date for log export
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [json, csv]
 *           default: json
 *         description: Export format
 *     responses:
 *       200:
 *         description: Audit logs exported
 */
router.get('/audit-logs', authenticate, requireRole(['admin']), requireMFA, async (req, res) => {
  try {
    const { startDate, endDate, format = 'json' } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'Start date and end date are required'
      });
    }

    const logs = await securityService.exportSecurityLogs(
      new Date(startDate),
      new Date(endDate),
      format
    );

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=audit-logs.csv');
      res.send(logs);
    } else {
      res.json({
        success: true,
        data: { logs }
      });
    }

    await securityService.handleSecurityEvent('security.audit_export', {
      adminId: req.user.id,
      adminEmail: req.user.email,
      startDate,
      endDate,
      format
    }, req);
  } catch (error) {
    logger.error('Error exporting audit logs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export audit logs'
    });
  }
});

// MFA Management Routes

/**
 * @swagger
 * /security/mfa/setup:
 *   post:
 *     summary: Setup MFA for user
 *     tags: [Security, MFA]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: MFA setup initiated
 */
router.post('/mfa/setup', authenticate, async (req, res) => {
  try {
    const mfaSetup = await mfaService.generateTOTPSecret(req.user);

    res.json({
      success: true,
      data: {
        secret: mfaSetup.secret,
        qrCode: mfaSetup.qrCode,
        backupCodes: mfaSetup.backupCodes
      }
    });
  } catch (error) {
    logger.error('Error setting up MFA:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to setup MFA'
    });
  }
});

/**
 * @swagger
 * /security/mfa/enable:
 *   post:
 *     summary: Enable MFA after verification
 *     tags: [Security, MFA]
 *     security:
 *       - bearerAuth: []
 */
router.post('/mfa/enable', authenticate, [
  body('token')
    .isLength({ min: 6, max: 6 })
    .isNumeric()
    .withMessage('Token must be a 6-digit number')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { token } = req.body;
    await mfaService.enableTOTP(req.user, token);

    res.json({
      success: true,
      message: 'MFA enabled successfully'
    });
  } catch (error) {
    logger.error('Error enabling MFA:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @swagger
 * /security/mfa/disable:
 *   post:
 *     summary: Disable MFA
 *     tags: [Security, MFA]
 *     security:
 *       - bearerAuth: []
 */
router.post('/mfa/disable', authenticate, [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),
  body('mfaToken')
    .isLength({ min: 6, max: 8 })
    .withMessage('Valid MFA token is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { currentPassword, mfaToken } = req.body;
    await mfaService.disableMFA(req.user, currentPassword, mfaToken);

    res.json({
      success: true,
      message: 'MFA disabled successfully'
    });
  } catch (error) {
    logger.error('Error disabling MFA:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @swagger
 * /security/mfa/backup-codes:
 *   post:
 *     summary: Regenerate backup codes
 *     tags: [Security, MFA]
 *     security:
 *       - bearerAuth: []
 */
router.post('/mfa/backup-codes', authenticate, [
  body('mfaToken')
    .isLength({ min: 6, max: 8 })
    .withMessage('Valid MFA token is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { mfaToken } = req.body;
    const backupCodes = await mfaService.regenerateBackupCodes(req.user, mfaToken);

    res.json({
      success: true,
      data: { backupCodes }
    });
  } catch (error) {
    logger.error('Error regenerating backup codes:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @swagger
 * /security/mfa/status:
 *   get:
 *     summary: Get MFA status
 *     tags: [Security, MFA]
 *     security:
 *       - bearerAuth: []
 */
router.get('/mfa/status', authenticate, async (req, res) => {
  try {
    const status = await mfaService.getMFAStatus(req.user);

    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    logger.error('Error getting MFA status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get MFA status'
    });
  }
});

// API Key Management Routes

/**
 * @swagger
 * /security/api-keys:
 *   get:
 *     summary: Get user's API keys
 *     tags: [Security, API Keys]
 *     security:
 *       - bearerAuth: []
 */
router.get('/api-keys', authenticate, async (req, res) => {
  try {
    const apiKeys = await apiKeyService.getUserAPIKeys(req.user);

    res.json({
      success: true,
      data: { apiKeys }
    });
  } catch (error) {
    logger.error('Error getting API keys:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve API keys'
    });
  }
});

/**
 * @swagger
 * /security/api-keys:
 *   post:
 *     summary: Generate new API key
 *     tags: [Security, API Keys]
 *     security:
 *       - bearerAuth: []
 */
router.post('/api-keys', authenticate, requireMFA, [
  body('name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Name must be between 1 and 100 characters'),
  body('permissions')
    .isArray()
    .withMessage('Permissions must be an array'),
  body('permissions.*')
    .isIn(['transcription:read', 'transcription:create', 'transcription:delete', 'webhook:manage', 'vocabulary:manage'])
    .withMessage('Invalid permission')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { name, permissions, expiresIn } = req.body;
    const apiKey = await apiKeyService.generateAPIKey(req.user, {
      name,
      permissions,
      expiresIn: expiresIn ? parseInt(expiresIn) : undefined
    });

    res.json({
      success: true,
      data: { apiKey }
    });
  } catch (error) {
    logger.error('Error generating API key:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @swagger
 * /security/api-keys/{keyId}:
 *   put:
 *     summary: Update API key
 *     tags: [Security, API Keys]
 *     security:
 *       - bearerAuth: []
 */
router.put('/api-keys/:keyId', authenticate, requireMFA, [
  param('keyId').isUUID().withMessage('Invalid key ID'),
  body('name').optional().trim().isLength({ min: 1, max: 100 }),
  body('permissions').optional().isArray()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { keyId } = req.params;
    const updates = req.body;

    await apiKeyService.updateAPIKey(req.user, keyId, updates);

    res.json({
      success: true,
      message: 'API key updated successfully'
    });
  } catch (error) {
    logger.error('Error updating API key:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @swagger
 * /security/api-keys/{keyId}:
 *   delete:
 *     summary: Delete API key
 *     tags: [Security, API Keys]
 *     security:
 *       - bearerAuth: []
 */
router.delete('/api-keys/:keyId', authenticate, requireMFA, [
  param('keyId').isUUID().withMessage('Invalid key ID')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { keyId } = req.params;
    await apiKeyService.deleteAPIKey(req.user, keyId);

    res.json({
      success: true,
      message: 'API key deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting API key:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// OAuth Management Routes

/**
 * @swagger
 * /security/oauth/providers:
 *   get:
 *     summary: Get linked OAuth providers
 *     tags: [Security, OAuth]
 *     security:
 *       - bearerAuth: []
 */
router.get('/oauth/providers', authenticate, async (req, res) => {
  try {
    const providers = await oauthService.getUserOAuthProviders(req.user.id);

    res.json({
      success: true,
      data: { providers }
    });
  } catch (error) {
    logger.error('Error getting OAuth providers:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve OAuth providers'
    });
  }
});

/**
 * @swagger
 * /security/oauth/unlink/{provider}:
 *   delete:
 *     summary: Unlink OAuth provider
 *     tags: [Security, OAuth]
 *     security:
 *       - bearerAuth: []
 */
router.delete('/oauth/unlink/:provider', authenticate, requireMFA, [
  param('provider').isIn(['google', 'microsoft']).withMessage('Invalid provider')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { provider } = req.params;
    const result = await oauthService.unlinkOAuthProvider(req.user.id, provider);

    res.json(result);
  } catch (error) {
    logger.error('Error unlinking OAuth provider:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// GDPR and Privacy Routes

/**
 * @swagger
 * /security/privacy/export:
 *   post:
 *     summary: Request data export
 *     tags: [Security, GDPR]
 *     security:
 *       - bearerAuth: []
 */
router.post('/privacy/export', authenticate, requireMFA, [
  body('format')
    .optional()
    .isIn(['json', 'csv', 'xml'])
    .withMessage('Invalid format'),
  body('includeFiles')
    .optional()
    .isBoolean()
    .withMessage('includeFiles must be boolean')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { format = 'json', includeFiles = false } = req.body;

    // Send email MFA for this sensitive operation
    await mfaService.sendEmailMFA(req.user, 'data_export', req);

    res.json({
      success: true,
      message: 'Data export MFA verification sent to your email'
    });
  } catch (error) {
    logger.error('Error requesting data export:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to request data export'
    });
  }
});

/**
 * @swagger
 * /security/privacy/export/confirm:
 *   post:
 *     summary: Confirm data export with MFA
 *     tags: [Security, GDPR]
 *     security:
 *       - bearerAuth: []
 */
router.post('/privacy/export/confirm', authenticate, [
  body('mfaCode')
    .isLength({ min: 6, max: 6 })
    .isNumeric()
    .withMessage('MFA code must be a 6-digit number'),
  body('format')
    .optional()
    .isIn(['json', 'csv', 'xml'])
    .withMessage('Invalid format'),
  body('includeFiles')
    .optional()
    .isBoolean()
    .withMessage('includeFiles must be boolean')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { mfaCode, format = 'json', includeFiles = false } = req.body;

    // Verify email MFA
    await mfaService.verifyEmailMFA(req.user, 'data_export', mfaCode);

    // Start export process
    const exportResult = await gdprService.exportUserData(req.user.id, format, includeFiles);

    res.json({
      success: true,
      data: exportResult
    });
  } catch (error) {
    logger.error('Error confirming data export:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @swagger
 * /security/privacy/delete:
 *   post:
 *     summary: Request account deletion
 *     tags: [Security, GDPR]
 *     security:
 *       - bearerAuth: []
 */
router.post('/privacy/delete', authenticate, requireMFA, async (req, res) => {
  try {
    // Send email MFA for this sensitive operation
    await mfaService.sendEmailMFA(req.user, 'account_deletion', req);

    res.json({
      success: true,
      message: 'Account deletion MFA verification sent to your email'
    });
  } catch (error) {
    logger.error('Error requesting account deletion:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to request account deletion'
    });
  }
});

/**
 * @swagger
 * /security/privacy/delete/confirm:
 *   post:
 *     summary: Confirm account deletion with MFA
 *     tags: [Security, GDPR]
 *     security:
 *       - bearerAuth: []
 */
router.post('/privacy/delete/confirm', authenticate, [
  body('mfaCode')
    .isLength({ min: 6, max: 6 })
    .isNumeric()
    .withMessage('MFA code must be a 6-digit number'),
  body('confirmText')
    .equals('DELETE MY ACCOUNT')
    .withMessage('Confirmation text must be exactly "DELETE MY ACCOUNT"')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { mfaCode } = req.body;

    // Verify email MFA
    await mfaService.verifyEmailMFA(req.user, 'account_deletion', mfaCode);

    // Start deletion process
    const deletionResult = await gdprService.deleteUserData(req.user.id, 'user_request');

    res.json({
      success: true,
      data: deletionResult
    });
  } catch (error) {
    logger.error('Error confirming account deletion:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @swagger
 * /security/privacy/consent:
 *   get:
 *     summary: Get current consent status
 *     tags: [Security, GDPR]
 *     security:
 *       - bearerAuth: []
 */
router.get('/privacy/consent', authenticate, async (req, res) => {
  try {
    const consent = await gdprService.getUserConsent(req.user.id);

    res.json({
      success: true,
      data: consent
    });
  } catch (error) {
    logger.error('Error getting consent status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get consent status'
    });
  }
});

/**
 * @swagger
 * /security/privacy/consent:
 *   put:
 *     summary: Update consent preferences
 *     tags: [Security, GDPR]
 *     security:
 *       - bearerAuth: []
 */
router.put('/privacy/consent', authenticate, [
  body('allowDataProcessing').isBoolean().withMessage('allowDataProcessing must be boolean'),
  body('allowAnalytics').isBoolean().withMessage('allowAnalytics must be boolean'),
  body('allowMarketing').isBoolean().withMessage('allowMarketing must be boolean'),
  body('version').optional().isString().withMessage('version must be string')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const consentData = req.body;
    const result = await gdprService.updateUserConsent(req.user.id, consentData);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Error updating consent:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Admin-only routes for security management

/**
 * @swagger
 * /security/admin/users/{userId}/reset-security:
 *   post:
 *     summary: Reset user security settings (Admin only)
 *     tags: [Security, Admin]
 *     security:
 *       - bearerAuth: []
 */
router.post('/admin/users/:userId/reset-security', authenticate, requireRole(['admin']), requireMFA, [
  param('userId').isUUID().withMessage('Invalid user ID')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { userId } = req.params;
    const targetUser = await User.findByPk(userId);

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Reset security settings
    await targetUser.update({
      mfaEnabled: false,
      mfaSecret: null,
      mfaBackupCodes: [],
      failedLoginAttempts: 0,
      lockedUntil: null,
      apiKeys: []
    });

    await securityService.handleSecurityEvent('admin.security_reset', {
      adminId: req.user.id,
      adminEmail: req.user.email,
      targetUserId: userId,
      targetEmail: targetUser.email
    }, req);

    res.json({
      success: true,
      message: 'User security settings reset successfully'
    });
  } catch (error) {
    logger.error('Error resetting user security:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reset user security settings'
    });
  }
});

/**
 * @swagger
 * /security/admin/compliance-report:
 *   get:
 *     summary: Generate GDPR compliance report (Admin only)
 *     tags: [Security, Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get('/admin/compliance-report', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const report = await gdprService.generateComplianceReport();

    res.json({
      success: true,
      data: report
    });
  } catch (error) {
    logger.error('Error generating compliance report:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate compliance report'
    });
  }
});

module.exports = router;