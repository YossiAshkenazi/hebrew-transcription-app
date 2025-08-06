const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const logger = require('../utils/logger');

// Import integration services
const SlackIntegration = require('../integrations/slack');
const TeamsIntegration = require('../integrations/teams');
const GoogleDriveIntegration = require('../integrations/googleDrive');
const DiscordIntegration = require('../integrations/discord');
const advancedWebhookService = require('../services/advancedWebhookService');

/**
 * Integration Management Routes
 * Provides comprehensive API for managing third-party integrations
 */

// Integration instances
const integrations = {
  slack: new SlackIntegration(),
  teams: new TeamsIntegration(),
  'google-drive': new GoogleDriveIntegration(),
  discord: new DiscordIntegration()
};

/**
 * GET /api/integrations
 * Get all available integrations and their status
 */
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const integrationStatuses = {};

    for (const [name, integration] of Object.entries(integrations)) {
      integrationStatuses[name] = await integration.getStatus();
    }

    res.json({
      success: true,
      data: {
        integrations: integrationStatuses,
        availableServices: Object.keys(integrations),
        totalIntegrations: Object.keys(integrations).length
      }
    });

  } catch (error) {
    logger.error('Failed to get integrations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve integrations'
    });
  }
});

/**
 * GET /api/integrations/templates
 * Get all available webhook templates
 */
router.get('/templates', auth, async (req, res) => {
  try {
    const templates = advancedWebhookService.getAllTemplates();
    
    // Group templates by service
    const groupedTemplates = {};
    for (const [key, template] of Object.entries(templates)) {
      const service = template.service || 'general';
      if (!groupedTemplates[service]) {
        groupedTemplates[service] = {};
      }
      groupedTemplates[service][key] = template;
    }

    res.json({
      success: true,
      data: {
        templates: groupedTemplates,
        totalTemplates: Object.keys(templates).length,
        services: Object.keys(groupedTemplates)
      }
    });

  } catch (error) {
    logger.error('Failed to get webhook templates:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve webhook templates'
    });
  }
});

/**
 * GET /api/integrations/:service
 * Get specific integration details and configuration template
 */
router.get('/:service', 
  auth, 
  param('service').isIn(Object.keys(integrations)).withMessage('Invalid integration service'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { service } = req.params;
      const integration = integrations[service];

      const status = await integration.getStatus();
      const configTemplate = integration.getConfigTemplate();
      const templates = service === 'slack' ? SlackIntegration.getWebhookTemplates() :
        service === 'teams' ? TeamsIntegration.getWebhookTemplates() :
          service === 'discord' ? DiscordIntegration.getWebhookTemplates() : {};

      res.json({
        success: true,
        data: {
          service,
          status,
          configTemplate,
          webhookTemplates: templates,
          capabilities: {
            notifications: true,
            fileUpload: service === 'google-drive',
            webhooks: service !== 'google-drive',
            realtime: service === 'discord'
          }
        }
      });

    } catch (error) {
      logger.error(`Failed to get integration ${req.params.service}:`, error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve integration details'
      });
    }
  }
);

/**
 * POST /api/integrations/:service/configure
 * Configure integration with credentials and settings
 */
router.post('/:service/configure',
  auth,
  param('service').isIn(Object.keys(integrations)).withMessage('Invalid integration service'),
  body('credentials').isObject().withMessage('Credentials object is required'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { service } = req.params;
      const { credentials, settings = {} } = req.body;
      const userId = req.user.id;

      const integration = integrations[service];

      // Initialize integration with credentials
      await integration.initialize(credentials);

      // Store configuration (in production, this would be encrypted and stored in database)
      logger.info(`Integration ${service} configured for user ${userId}`);

      const status = await integration.getStatus();

      res.json({
        success: true,
        message: `${service} integration configured successfully`,
        data: {
          service,
          status,
          configuredAt: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error(`Failed to configure integration ${req.params.service}:`, error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to configure integration'
      });
    }
  }
);

/**
 * POST /api/integrations/:service/test
 * Test integration connection
 */
router.post('/:service/test',
  auth,
  param('service').isIn(Object.keys(integrations)).withMessage('Invalid integration service'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { service } = req.params;
      const { testPayload } = req.body;
      const integration = integrations[service];

      const testResult = await integration.testConnection();
      
      // If test payload provided and service supports it, send test message
      if (testPayload && service !== 'google-drive') {
        try {
          await integration.sendTranscriptionNotification(testPayload, req.user);
        } catch (testError) {
          logger.warn(`Test message failed for ${service}:`, testError);
        }
      }

      res.json({
        success: true,
        data: {
          service,
          testResult,
          testedAt: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error(`Integration test failed for ${req.params.service}:`, error);
      res.status(500).json({
        success: false,
        error: error.message || 'Integration test failed'
      });
    }
  }
);

/**
 * POST /api/integrations/webhook/test
 * Test webhook with advanced features
 */
router.post('/webhook/test',
  auth,
  body('webhookConfig').isObject().withMessage('Webhook configuration is required'),
  body('webhookConfig.url').isURL().withMessage('Valid webhook URL is required'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { webhookConfig, testPayload } = req.body;
      const userId = req.user.id;

      // Add user context to webhook config
      const configWithUser = {
        ...webhookConfig,
        userId,
        testMode: true
      };

      const testResult = await advancedWebhookService.sendAdvancedWebhook(
        configWithUser,
        'webhook.test',
        testPayload || {
          event: 'webhook.test',
          timestamp: new Date().toISOString(),
          user: { id: userId },
          message: 'This is a test webhook from Hebrew Transcription Service'
        }
      );

      res.json({
        success: true,
        message: 'Webhook test completed',
        data: {
          testResult,
          webhookId: testResult.webhookId,
          testedAt: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error('Webhook test failed:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Webhook test failed'
      });
    }
  }
);

/**
 * GET /api/integrations/webhook/analytics
 * Get webhook analytics and performance metrics
 */
router.get('/webhook/analytics',
  auth,
  query('webhookId').optional().isUUID().withMessage('Invalid webhook ID'),
  query('timeRange').optional().isIn(['1h', '6h', '24h', '7d', '30d']).withMessage('Invalid time range'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { webhookId, timeRange = '24h' } = req.query;

      let analytics;
      if (webhookId) {
        analytics = advancedWebhookService.getWebhookAnalytics(webhookId, timeRange);
      } else {
        analytics = advancedWebhookService.getAllAnalyticsSummary(timeRange);
      }

      res.json({
        success: true,
        data: {
          analytics,
          timeRange,
          generatedAt: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error('Failed to get webhook analytics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve webhook analytics'
      });
    }
  }
);

/**
 * POST /api/integrations/:service/notify
 * Send notification through specific integration
 */
router.post('/:service/notify',
  auth,
  param('service').isIn(Object.keys(integrations)).withMessage('Invalid integration service'),
  body('transcriptionId').isUUID().withMessage('Valid transcription ID is required'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { service } = req.params;
      const { transcriptionId, customMessage } = req.body;
      const userId = req.user.id;

      const integration = integrations[service];

      if (!integration.isReady()) {
        return res.status(400).json({
          success: false,
          error: `${service} integration is not configured or ready`
        });
      }

      // Get transcription data (simplified - would fetch from database)
      const mockTranscription = {
        id: transcriptionId,
        originalFilename: 'example-audio.mp3',
        status: 'completed',
        transcriptionText: customMessage || 'Test transcription content',
        confidence: 0.95,
        duration: 120
      };

      const result = await integration.sendTranscriptionNotification(mockTranscription, req.user);

      res.json({
        success: true,
        message: `Notification sent via ${service}`,
        data: {
          service,
          transcriptionId,
          result,
          sentAt: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error(`Failed to send notification via ${req.params.service}:`, error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to send notification'
      });
    }
  }
);

/**
 * GET /api/integrations/:service/auth/url
 * Get OAuth authorization URL for services that require it
 */
router.get('/:service/auth/url',
  auth,
  param('service').isIn(['google-drive']).withMessage('OAuth not supported for this service'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { service } = req.params;
      const integration = integrations[service];

      if (service === 'google-drive') {
        const authUrl = integration.getAuthUrl();
        res.json({
          success: true,
          data: {
            authUrl,
            service,
            instructions: 'Visit this URL to authorize the application and return with the authorization code'
          }
        });
      } else {
        res.status(400).json({
          success: false,
          error: 'OAuth not supported for this service'
        });
      }

    } catch (error) {
      logger.error(`Failed to get auth URL for ${req.params.service}:`, error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate authorization URL'
      });
    }
  }
);

/**
 * POST /api/integrations/:service/auth/callback
 * Handle OAuth callback for services that require it
 */
router.post('/:service/auth/callback',
  auth,
  param('service').isIn(['google-drive']).withMessage('OAuth not supported for this service'),
  body('code').notEmpty().withMessage('Authorization code is required'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { service } = req.params;
      const { code } = req.body;
      const integration = integrations[service];

      if (service === 'google-drive') {
        const tokens = await integration.getTokens(code);
        
        res.json({
          success: true,
          message: 'Authorization successful',
          data: {
            service,
            tokens: {
              // Only return safe token info
              hasAccessToken: !!tokens.access_token,
              hasRefreshToken: !!tokens.refresh_token,
              expiresAt: tokens.expiry_date
            },
            authorizedAt: new Date().toISOString()
          }
        });
      } else {
        res.status(400).json({
          success: false,
          error: 'OAuth not supported for this service'
        });
      }

    } catch (error) {
      logger.error(`OAuth callback failed for ${req.params.service}:`, error);
      res.status(400).json({
        success: false,
        error: error.message || 'Authorization failed'
      });
    }
  }
);

/**
 * DELETE /api/integrations/:service
 * Disable/remove integration
 */
router.delete('/:service',
  auth,
  param('service').isIn(Object.keys(integrations)).withMessage('Invalid integration service'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { service } = req.params;
      const userId = req.user.id;
      const integration = integrations[service];

      await integration.cleanup();

      logger.info(`Integration ${service} disabled for user ${userId}`);

      res.json({
        success: true,
        message: `${service} integration disabled successfully`,
        data: {
          service,
          disabledAt: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error(`Failed to disable integration ${req.params.service}:`, error);
      res.status(500).json({
        success: false,
        error: 'Failed to disable integration'
      });
    }
  }
);

/**
 * GET /api/integrations/google-drive/files
 * List files in Google Drive (specific to Google Drive integration)
 */
router.get('/google-drive/files',
  auth,
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { limit = 50 } = req.query;
      const googleDrive = integrations['google-drive'];

      if (!googleDrive.isReady()) {
        return res.status(400).json({
          success: false,
          error: 'Google Drive integration is not configured'
        });
      }

      const files = await googleDrive.listTranscriptionFiles(parseInt(limit));

      res.json({
        success: true,
        data: {
          files,
          totalFiles: files.length,
          retrievedAt: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error('Failed to list Google Drive files:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve Google Drive files'
      });
    }
  }
);

/**
 * POST /api/integrations/google-drive/upload
 * Upload transcription to Google Drive
 */
router.post('/google-drive/upload',
  auth,
  body('transcriptionId').isUUID().withMessage('Valid transcription ID is required'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { transcriptionId, shareEmails } = req.body;
      const googleDrive = integrations['google-drive'];

      if (!googleDrive.isReady()) {
        return res.status(400).json({
          success: false,
          error: 'Google Drive integration is not configured'
        });
      }

      // Mock transcription data - in production, fetch from database
      const mockTranscription = {
        id: transcriptionId,
        originalFilename: 'transcription-upload.mp3',
        transcriptionText: 'Sample transcription content for upload test',
        confidence: 0.92,
        duration: 180
      };

      const uploadResult = await googleDrive.uploadTranscription(mockTranscription, req.user);

      // Share with specified emails if provided
      if (shareEmails && shareEmails.length > 0) {
        await googleDrive.shareFile(uploadResult.id, shareEmails);
      }

      res.json({
        success: true,
        message: 'Transcription uploaded to Google Drive successfully',
        data: {
          transcriptionId,
          uploadResult,
          sharedWith: shareEmails || [],
          uploadedAt: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error('Failed to upload to Google Drive:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to upload to Google Drive'
      });
    }
  }
);

module.exports = router;