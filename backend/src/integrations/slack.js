const BaseIntegration = require('./BaseIntegration');
const logger = require('../utils/logger');

/**
 * Slack Integration Service
 * Provides webhook templates and notification capabilities for Slack
 */
class SlackIntegration extends BaseIntegration {
  constructor(config = {}) {
    super('slack', config);
    this.webhookUrl = null;
    this.channel = config.channel || '#general';
    this.username = config.username || 'Hebrew Transcription Bot';
    this.iconEmoji = config.iconEmoji || ':speech_balloon:';
  }

  /**
   * Initialize Slack integration with webhook URL
   */
  async initialize(credentials = {}) {
    this.webhookUrl = credentials.webhookUrl;
    if (!this.webhookUrl) {
      throw new Error('Slack webhook URL is required');
    }
    
    await super.initialize(credentials);
    return true;
  }

  /**
   * Validate Slack webhook URL by sending a test message
   */
  async validateCredentials() {
    if (!this.webhookUrl) {
      throw new Error('Slack webhook URL is required');
    }

    try {
      const testMessage = {
        text: 'Hebrew Transcription Service connection test',
        channel: this.channel,
        username: this.username,
        icon_emoji: this.iconEmoji
      };

      await this.makeRequest({
        method: 'POST',
        url: this.webhookUrl,
        data: testMessage
      });

      return true;
    } catch (error) {
      throw new Error(`Invalid Slack webhook URL: ${error.message}`);
    }
  }

  /**
   * Check if credentials are valid
   */
  hasValidCredentials() {
    return Boolean(this.webhookUrl);
  }

  /**
   * Get authentication headers (not needed for webhook)
   */
  getAuthHeaders() {
    return {
      'Content-Type': 'application/json'
    };
  }

  /**
   * Send transcription completion notification to Slack
   */
  async sendTranscriptionNotification(transcription, user) {
    if (!this.isReady()) {
      throw new Error('Slack integration is not ready');
    }

    try {
      const message = this.buildTranscriptionMessage(transcription, user);
      
      const response = await this.makeRequest({
        method: 'POST',
        url: this.webhookUrl,
        data: message
      });

      this.updateLastActivity();
      logger.info(`Slack notification sent for transcription ${transcription.id}`);
      
      return {
        success: true,
        messageId: response.data?.ts || null
      };
    } catch (error) {
      logger.error(`Failed to send Slack notification:`, error);
      throw error;
    }
  }

  /**
   * Build Slack message for transcription completion
   */
  buildTranscriptionMessage(transcription, user) {
    const statusEmoji = transcription.status === 'completed' ? ':white_check_mark:' : ':x:';
    const confidence = transcription.confidence ? Math.round(transcription.confidence * 100) : 'N/A';
    const duration = transcription.duration ? `${Math.round(transcription.duration / 60)} minutes` : 'Unknown';
    
    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${statusEmoji} Hebrew Transcription ${transcription.status === 'completed' ? 'Completed' : 'Failed'}`
        }
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*File:* ${transcription.originalFilename}`
          },
          {
            type: 'mrkdwn',
            text: `*Duration:* ${duration}`
          },
          {
            type: 'mrkdwn',
            text: `*Confidence:* ${confidence}%`
          },
          {
            type: 'mrkdwn',
            text: `*Language:* Hebrew`
          }
        ]
      }
    ];

    if (transcription.status === 'completed' && transcription.transcriptionText) {
      const previewText = transcription.transcriptionText.length > 200 
        ? transcription.transcriptionText.substring(0, 200) + '...'
        : transcription.transcriptionText;

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Preview:*\n\`\`\`${previewText}\`\`\``
        }
      });
    }

    if (transcription.status === 'failed' && transcription.errorMessage) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Error:* ${transcription.errorMessage}`
        }
      });
    }

    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Transcription ID: ${transcription.id} | Processed: ${new Date().toLocaleString()}`
        }
      ]
    });

    return {
      channel: this.channel,
      username: this.username,
      icon_emoji: this.iconEmoji,
      blocks: blocks
    };
  }

  /**
   * Send custom message to Slack
   */
  async sendCustomMessage(text, options = {}) {
    if (!this.isReady()) {
      throw new Error('Slack integration is not ready');
    }

    const message = {
      text: text,
      channel: options.channel || this.channel,
      username: options.username || this.username,
      icon_emoji: options.iconEmoji || this.iconEmoji,
      ...options
    };

    try {
      const response = await this.makeRequest({
        method: 'POST',
        url: this.webhookUrl,
        data: message
      });

      this.updateLastActivity();
      return {
        success: true,
        messageId: response.data?.ts || null
      };
    } catch (error) {
      logger.error(`Failed to send custom Slack message:`, error);
      throw error;
    }
  }

  /**
   * Get Slack webhook templates
   */
  static getWebhookTemplates() {
    return {
      transcription_completed: {
        name: 'Slack - Transcription Completed',
        description: 'Send notification to Slack when transcription is completed',
        service: 'slack',
        events: ['transcription.completed'],
        template: {
          text: 'Hebrew transcription completed for {{originalFilename}}',
          channel: '#general',
          username: 'Hebrew Transcription Bot',
          icon_emoji: ':speech_balloon:',
          blocks: [
            {
              type: 'header',
              text: {
                type: 'plain_text',
                text: ':white_check_mark: Hebrew Transcription Completed'
              }
            },
            {
              type: 'section',
              fields: [
                {
                  type: 'mrkdwn',
                  text: '*File:* {{originalFilename}}'
                },
                {
                  type: 'mrkdwn',
                  text: '*Duration:* {{duration}} minutes'
                },
                {
                  type: 'mrkdwn',
                  text: '*Confidence:* {{confidence}}%'
                }
              ]
            }
          ]
        }
      },
      transcription_failed: {
        name: 'Slack - Transcription Failed',
        description: 'Send notification to Slack when transcription fails',
        service: 'slack',
        events: ['transcription.failed'],
        template: {
          text: 'Hebrew transcription failed for {{originalFilename}}',
          channel: '#general',
          username: 'Hebrew Transcription Bot',
          icon_emoji: ':x:',
          blocks: [
            {
              type: 'header',
              text: {
                type: 'plain_text',
                text: ':x: Hebrew Transcription Failed'
              }
            },
            {
              type: 'section',
              fields: [
                {
                  type: 'mrkdwn',
                  text: '*File:* {{originalFilename}}'
                },
                {
                  type: 'mrkdwn',
                  text: '*Error:* {{errorMessage}}'
                }
              ]
            }
          ]
        }
      }
    };
  }

  /**
   * Get integration configuration template
   */
  getConfigTemplate() {
    return {
      name: 'Slack',
      description: 'Send notifications to Slack channels via webhooks',
      credentials: [
        {
          name: 'webhookUrl',
          label: 'Webhook URL',
          type: 'url',
          required: true,
          description: 'Slack webhook URL from your app configuration'
        }
      ],
      settings: {
        channel: {
          label: 'Default Channel',
          type: 'text',
          default: '#general',
          description: 'Default channel to send notifications'
        },
        username: {
          label: 'Bot Username',
          type: 'text',
          default: 'Hebrew Transcription Bot',
          description: 'Display name for the bot'
        },
        iconEmoji: {
          label: 'Bot Icon',
          type: 'text',
          default: ':speech_balloon:',
          description: 'Emoji to use as bot icon'
        }
      }
    };
  }
}

module.exports = SlackIntegration;