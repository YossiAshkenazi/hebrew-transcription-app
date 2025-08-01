const BaseIntegration = require('./BaseIntegration');
const logger = require('../utils/logger');

/**
 * Microsoft Teams Integration Service
 * Provides webhook templates and notification capabilities for Teams
 */
class TeamsIntegration extends BaseIntegration {
  constructor(config = {}) {
    super('teams', config);
    this.webhookUrl = null;
    this.themeColor = config.themeColor || '0078D4'; // Microsoft blue
  }

  /**
   * Initialize Teams integration with webhook URL
   */
  async initialize(credentials = {}) {
    this.webhookUrl = credentials.webhookUrl;
    if (!this.webhookUrl) {
      throw new Error('Teams webhook URL is required');
    }
    
    await super.initialize(credentials);
    return true;
  }

  /**
   * Validate Teams webhook URL by sending a test message
   */
  async validateCredentials() {
    if (!this.webhookUrl) {
      throw new Error('Teams webhook URL is required');
    }

    try {
      const testMessage = {
        '@type': 'MessageCard',
        '@context': 'http://schema.org/extensions',
        themeColor: this.themeColor,
        summary: 'Hebrew Transcription Service Test',
        sections: [
          {
            activityTitle: 'Connection Test',
            activitySubtitle: 'Hebrew Transcription Service',
            text: 'This is a test message to verify the Teams integration is working correctly.'
          }
        ]
      };

      await this.makeRequest({
        method: 'POST',
        url: this.webhookUrl,
        data: testMessage
      });

      return true;
    } catch (error) {
      throw new Error(`Invalid Teams webhook URL: ${error.message}`);
    }
  }

  /**
   * Check if credentials are valid
   */
  hasValidCredentials() {
    return Boolean(this.webhookUrl);
  }

  /**
   * Get authentication headers
   */
  getAuthHeaders() {
    return {
      'Content-Type': 'application/json'
    };
  }

  /**
   * Send transcription completion notification to Teams
   */
  async sendTranscriptionNotification(transcription, user) {
    if (!this.isReady()) {
      throw new Error('Teams integration is not ready');
    }

    try {
      const message = this.buildTranscriptionMessage(transcription, user);
      
      const response = await this.makeRequest({
        method: 'POST',
        url: this.webhookUrl,
        data: message
      });

      this.updateLastActivity();
      logger.info(`Teams notification sent for transcription ${transcription.id}`);
      
      return {
        success: true,
        messageId: response.data?.id || null
      };
    } catch (error) {
      logger.error(`Failed to send Teams notification:`, error);
      throw error;
    }
  }

  /**
   * Build Teams message card for transcription completion
   */
  buildTranscriptionMessage(transcription, user) {
    const isCompleted = transcription.status === 'completed';
    const confidence = transcription.confidence ? Math.round(transcription.confidence * 100) : 'N/A';
    const duration = transcription.duration ? `${Math.round(transcription.duration / 60)} minutes` : 'Unknown';
    
    const facts = [
      {
        name: 'File Name',
        value: transcription.originalFilename
      },
      {
        name: 'Duration',
        value: duration
      },
      {
        name: 'Language',
        value: 'Hebrew'
      },
      {
        name: 'Status',
        value: transcription.status.charAt(0).toUpperCase() + transcription.status.slice(1)
      }
    ];

    if (isCompleted) {
      facts.push({
        name: 'Confidence',
        value: `${confidence}%`
      });
    }

    const sections = [
      {
        activityTitle: `Hebrew Transcription ${isCompleted ? 'Completed' : 'Failed'}`,
        activitySubtitle: `File: ${transcription.originalFilename}`,
        activityImage: 'https://cdn-icons-png.flaticon.com/512/2190/2190552.png', // Microphone icon
        facts: facts,
        markdown: true
      }
    ];

    // Add transcription preview for completed transcriptions
    if (isCompleted && transcription.transcriptionText) {
      const previewText = transcription.transcriptionText.length > 300 
        ? transcription.transcriptionText.substring(0, 300) + '...'
        : transcription.transcriptionText;

      sections.push({
        activityTitle: 'Transcription Preview',
        text: previewText,
        markdown: true
      });
    }

    // Add error information for failed transcriptions
    if (!isCompleted && transcription.errorMessage) {
      sections.push({
        activityTitle: 'Error Details',
        text: transcription.errorMessage,
        markdown: true
      });
    }

    return {
      '@type': 'MessageCard',
      '@context': 'http://schema.org/extensions',
      themeColor: isCompleted ? '00C851' : 'FF4444', // Green for success, red for failure
      summary: `Hebrew Transcription ${isCompleted ? 'Completed' : 'Failed'}`,
      sections: sections,
      potentialAction: [
        {
          '@type': 'OpenUri',
          name: 'View Transcription',
          targets: [
            {
              os: 'default',
              uri: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/transcriptions/${transcription.id}`
            }
          ]
        }
      ]
    };
  }

  /**
   * Send custom message to Teams
   */
  async sendCustomMessage(title, text, options = {}) {
    if (!this.isReady()) {
      throw new Error('Teams integration is not ready');
    }

    const message = {
      '@type': 'MessageCard',
      '@context': 'http://schema.org/extensions',
      themeColor: options.themeColor || this.themeColor,
      summary: title,
      sections: [
        {
          activityTitle: title,
          text: text,
          markdown: true
        }
      ],
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
        messageId: response.data?.id || null
      };
    } catch (error) {
      logger.error(`Failed to send custom Teams message:`, error);
      throw error;
    }
  }

  /**
   * Send rich message with facts and actions
   */
  async sendRichMessage(title, subtitle, facts = [], actions = [], options = {}) {
    if (!this.isReady()) {
      throw new Error('Teams integration is not ready');
    }

    const message = {
      '@type': 'MessageCard',
      '@context': 'http://schema.org/extensions',
      themeColor: options.themeColor || this.themeColor,
      summary: title,
      sections: [
        {
          activityTitle: title,
          activitySubtitle: subtitle,
          facts: facts,
          markdown: true
        }
      ],
      potentialAction: actions
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
        messageId: response.data?.id || null
      };
    } catch (error) {
      logger.error(`Failed to send rich Teams message:`, error);
      throw error;
    }
  }

  /**
   * Get Teams webhook templates
   */
  static getWebhookTemplates() {
    return {
      transcription_completed: {
        name: 'Teams - Transcription Completed',
        description: 'Send notification to Microsoft Teams when transcription is completed',
        service: 'teams',
        events: ['transcription.completed'],
        template: {
          '@type': 'MessageCard',
          '@context': 'http://schema.org/extensions',
          themeColor: '00C851',
          summary: 'Hebrew transcription completed',
          sections: [
            {
              activityTitle: 'Hebrew Transcription Completed',
              activitySubtitle: 'File: {{originalFilename}}',
              facts: [
                {
                  name: 'File Name',
                  value: '{{originalFilename}}'
                },
                {
                  name: 'Duration',
                  value: '{{duration}} minutes'
                },
                {
                  name: 'Confidence',
                  value: '{{confidence}}%'
                }
              ]
            }
          ]
        }
      },
      transcription_failed: {
        name: 'Teams - Transcription Failed',
        description: 'Send notification to Microsoft Teams when transcription fails',
        service: 'teams',
        events: ['transcription.failed'],
        template: {
          '@type': 'MessageCard',
          '@context': 'http://schema.org/extensions',
          themeColor: 'FF4444',
          summary: 'Hebrew transcription failed',
          sections: [
            {
              activityTitle: 'Hebrew Transcription Failed',
              activitySubtitle: 'File: {{originalFilename}}',
              facts: [
                {
                  name: 'File Name',
                  value: '{{originalFilename}}'
                },
                {
                  name: 'Error',
                  value: '{{errorMessage}}'
                }
              ]
            }
          ]
        }
      },
      batch_completed: {
        name: 'Teams - Batch Processing Completed',
        description: 'Send notification when batch processing is completed',
        service: 'teams',
        events: ['batch.completed'],
        template: {
          '@type': 'MessageCard',
          '@context': 'http://schema.org/extensions',
          themeColor: '0078D4',
          summary: 'Batch processing completed',
          sections: [
            {
              activityTitle: 'Batch Processing Completed',
              activitySubtitle: '{{totalFiles}} files processed',
              facts: [
                {
                  name: 'Total Files',
                  value: '{{totalFiles}}'
                },
                {
                  name: 'Successful',
                  value: '{{successCount}}'
                },
                {
                  name: 'Failed',
                  value: '{{failureCount}}'
                },
                {
                  name: 'Processing Time',
                  value: '{{processingTime}}'
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
      name: 'Microsoft Teams',
      description: 'Send notifications to Microsoft Teams channels via webhooks',
      credentials: [
        {
          name: 'webhookUrl',
          label: 'Webhook URL',
          type: 'url',
          required: true,
          description: 'Teams webhook URL from your connector configuration'
        }
      ],
      settings: {
        themeColor: {
          label: 'Theme Color',
          type: 'color',
          default: '0078D4',
          description: 'Hex color code for message cards (without #)'
        }
      }
    };
  }
}

module.exports = TeamsIntegration;