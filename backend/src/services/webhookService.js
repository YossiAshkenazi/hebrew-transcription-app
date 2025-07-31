const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { WebhookConfig } = require('../models');

class WebhookService {
  constructor() {
    this.timeout = parseInt(process.env.WEBHOOK_TIMEOUT_MS) || 30000;
    this.maxRetries = parseInt(process.env.WEBHOOK_RETRY_ATTEMPTS) || 3;
  }

  async triggerWebhook(userId, event, data, retryCount = 0) {
    try {
      // Get active webhooks for this user and event
      const webhooks = await WebhookConfig.findAll({
        where: {
          userId: userId,
          isActive: true,
          events: {
            [require('sequelize').Op.contains]: [event]
          }
        }
      });

      if (webhooks.length === 0) {
        logger.info(`No active webhooks found for user ${userId} and event ${event}`);
        return;
      }

      // Trigger all matching webhooks
      const results = await Promise.allSettled(
        webhooks.map(webhook => this.sendWebhook(webhook, event, data, retryCount))
      );

      // Log results
      results.forEach((result, index) => {
        const webhook = webhooks[index];
        if (result.status === 'fulfilled') {
          logger.info(`Webhook ${webhook.id} triggered successfully`);
        } else {
          logger.error(`Webhook ${webhook.id} failed:`, result.reason);
        }
      });

      return results;
    } catch (error) {
      logger.error('Webhook trigger error:', error);
      throw error;
    }
  }

  async sendWebhook(webhookConfig, event, data, retryCount = 0) {
    try {
      // Update trigger count
      webhookConfig.incrementTrigger();
      
      // Prepare payload
      const payload = {
        event: event,
        timestamp: new Date().toISOString(),
        data: data,
        webhook: {
          id: webhookConfig.id,
          name: webhookConfig.name
        }
      };

      // Prepare headers
      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'Hebrew-Transcription-Webhook/1.0',
        ...webhookConfig.headers
      };

      // Add signature if secret is configured
      if (webhookConfig.secret) {
        const signature = this.generateSignature(payload, webhookConfig.secret);
        headers['X-Webhook-Signature'] = signature;
      }

      // Send the webhook
      const response = await axios({
        method: webhookConfig.method.toLowerCase(),
        url: webhookConfig.url,
        data: payload,
        headers: headers,
        timeout: webhookConfig.timeout || this.timeout,
        validateStatus: (status) => status >= 200 && status < 300
      });

      // Record success
      webhookConfig.recordSuccess();
      await webhookConfig.save();

      logger.info(`Webhook sent successfully to ${webhookConfig.url}`, {
        webhookId: webhookConfig.id,
        event: event,
        statusCode: response.status,
        retryCount: retryCount
      });

      return {
        success: true,
        statusCode: response.status,
        response: response.data
      };

    } catch (error) {
      const errorMessage = error.response 
        ? `HTTP ${error.response.status}: ${error.response.statusText}`
        : error.message;

      // Record failure
      webhookConfig.recordFailure(errorMessage);
      await webhookConfig.save();

      logger.error(`Webhook failed for ${webhookConfig.url}:`, {
        webhookId: webhookConfig.id,
        event: event,
        error: errorMessage,
        retryCount: retryCount
      });

      // Retry if we haven't exceeded max retries
      if (retryCount < webhookConfig.retryAttempts) {
        logger.info(`Retrying webhook ${webhookConfig.id} (attempt ${retryCount + 1}/${webhookConfig.retryAttempts})`);
        
        // Wait before retry (exponential backoff)
        const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s, etc.
        await new Promise(resolve => setTimeout(resolve, delay));
        
        return this.sendWebhook(webhookConfig, event, data, retryCount + 1);
      }

      throw new Error(`Webhook failed after ${retryCount + 1} attempts: ${errorMessage}`);
    }
  }

  generateSignature(payload, secret) {
    const payloadString = JSON.stringify(payload);
    const signature = crypto
      .createHmac('sha256', secret)
      .update(payloadString)
      .digest('hex');
    
    return `sha256=${signature}`;
  }

  async testWebhook(webhookConfig) {
    try {
      const testPayload = {
        event: 'webhook.test',
        timestamp: new Date().toISOString(),
        data: {
          message: 'This is a test webhook from Hebrew Transcription Service',
          webhookId: webhookConfig.id,
          webhookName: webhookConfig.name
        },
        webhook: {
          id: webhookConfig.id,
          name: webhookConfig.name
        }
      };

      const result = await this.sendWebhook(webhookConfig, 'webhook.test', testPayload.data, 0);
      
      return {
        success: true,
        result: result
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async triggerTranscriptionComplete(transcription, userId) {
    const eventData = {
      transcription: {
        id: transcription.id,
        originalFilename: transcription.originalFilename,
        status: transcription.status,
        duration: transcription.duration,
        confidence: transcription.confidence,
        language: transcription.language,
        processingTime: transcription.processingTime,
        createdAt: transcription.createdAt,
        completedAt: new Date().toISOString()
      },
      result: {
        text: transcription.transcriptionText,
        speakerLabels: transcription.speakerLabels,
        lowConfidenceWords: transcription.lowConfidenceWords
      },
      metadata: transcription.metadata
    };

    return this.triggerWebhook(userId, 'transcription.completed', eventData);
  }

  async triggerTranscriptionFailed(transcription, userId, errorMessage) {
    const eventData = {
      transcription: {
        id: transcription.id,
        originalFilename: transcription.originalFilename,
        status: transcription.status,
        duration: transcription.duration,
        language: transcription.language,
        createdAt: transcription.createdAt,
        failedAt: new Date().toISOString()
      },
      error: {
        message: errorMessage,
        timestamp: new Date().toISOString()
      }
    };

    return this.triggerWebhook(userId, 'transcription.failed', eventData);
  }

  async getWebhookStats(userId) {
    try {
      const webhooks = await WebhookConfig.findAll({
        where: { userId: userId },
        attributes: ['id', 'name', 'url', 'isActive', 'totalTriggers', 'totalSuccesses', 'totalFailures', 'lastSuccessAt', 'lastFailureAt']
      });

      return webhooks.map(webhook => ({
        id: webhook.id,
        name: webhook.name,
        url: webhook.url,
        isActive: webhook.isActive,
        totalTriggers: webhook.totalTriggers,
        totalSuccesses: webhook.totalSuccesses,
        totalFailures: webhook.totalFailures,
        successRate: webhook.getSuccessRate(),
        lastSuccessAt: webhook.lastSuccessAt,
        lastFailureAt: webhook.lastFailureAt
      }));
    } catch (error) {
      logger.error('Error getting webhook stats:', error);
      throw error;
    }
  }
}

module.exports = new WebhookService();
