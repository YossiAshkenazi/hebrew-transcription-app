const BaseIntegration = require('./BaseIntegration');
const logger = require('../utils/logger');

/**
 * Discord Integration Service
 * Provides webhook templates and notification capabilities for Discord
 */
class DiscordIntegration extends BaseIntegration {
  constructor(config = {}) {
    super('discord', config);
    this.webhookUrl = null;
    this.username = config.username || 'Hebrew Transcription Bot';
    this.avatarUrl = config.avatarUrl || null;
  }

  /**
   * Initialize Discord integration with webhook URL
   */
  async initialize(credentials = {}) {
    this.webhookUrl = credentials.webhookUrl;
    if (!this.webhookUrl) {
      throw new Error('Discord webhook URL is required');
    }
    
    await super.initialize(credentials);
    return true;
  }

  /**
   * Validate Discord webhook URL by sending a test message
   */
  async validateCredentials() {
    if (!this.webhookUrl) {
      throw new Error('Discord webhook URL is required');
    }

    try {
      const testMessage = {
        content: 'Hebrew Transcription Service connection test',
        username: this.username,
        avatar_url: this.avatarUrl,
        embeds: [
          {
            title: 'Connection Test',
            description: 'This is a test message to verify the Discord integration is working correctly.',
            color: 5025616, // Green color
            timestamp: new Date().toISOString(),
            footer: {
              text: 'Hebrew Transcription Service'
            }
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
      throw new Error(`Invalid Discord webhook URL: ${error.message}`);
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
   * Send transcription completion notification to Discord
   */
  async sendTranscriptionNotification(transcription, user) {
    if (!this.isReady()) {
      throw new Error('Discord integration is not ready');
    }

    try {
      const message = this.buildTranscriptionMessage(transcription, user);
      
      const response = await this.makeRequest({
        method: 'POST',
        url: this.webhookUrl,
        data: message
      });

      this.updateLastActivity();
      logger.info(`Discord notification sent for transcription ${transcription.id}`);
      
      return {
        success: true,
        messageId: response.data?.id || null
      };
    } catch (error) {
      logger.error(`Failed to send Discord notification:`, error);
      throw error;
    }
  }

  /**
   * Build Discord message for transcription completion
   */
  buildTranscriptionMessage(transcription, user) {
    const isCompleted = transcription.status === 'completed';
    const confidence = transcription.confidence ? Math.round(transcription.confidence * 100) : 'N/A';
    const duration = transcription.duration ? this.formatDuration(transcription.duration) : 'Unknown';
    
    const embed = {
      title: `${isCompleted ? '✅' : '❌'} Hebrew Transcription ${isCompleted ? 'Completed' : 'Failed'}`,
      color: isCompleted ? 5025616 : 15158332, // Green for success, red for failure
      fields: [
        {
          name: '📁 File',
          value: transcription.originalFilename,
          inline: true
        },
        {
          name: '⏱️ Duration',
          value: duration,
          inline: true
        },
        {
          name: '🌍 Language',
          value: 'Hebrew',
          inline: true
        }
      ],
      timestamp: new Date().toISOString(),
      footer: {
        text: `Transcription ID: ${transcription.id}`,
        icon_url: 'https://cdn-icons-png.flaticon.com/512/2190/2190552.png'
      }
    };

    // Add confidence field for completed transcriptions
    if (isCompleted) {
      embed.fields.push({
        name: '📊 Confidence',
        value: `${confidence}%`,
        inline: true
      });
    }

    // Add transcription preview for completed transcriptions
    if (isCompleted && transcription.transcriptionText) {
      let previewText = transcription.transcriptionText;
      
      // Discord has a 1024 character limit for field values
      if (previewText.length > 900) {
        previewText = previewText.substring(0, 900) + '...';
      }

      embed.fields.push({
        name: '📝 Transcription Preview',
        value: `\`\`\`${previewText}\`\`\``,
        inline: false
      });
    }

    // Add error information for failed transcriptions
    if (!isCompleted && transcription.errorMessage) {
      embed.fields.push({
        name: '❗ Error',
        value: `\`\`\`${transcription.errorMessage}\`\`\``,
        inline: false
      });
    }

    // Add speaker information if available
    if (transcription.speakerLabels && transcription.speakerLabels.length > 0) {
      const speakerCount = new Set(transcription.speakerLabels.map(s => s.speaker)).size;
      embed.fields.push({
        name: '👥 Speakers',
        value: `${speakerCount} detected`,
        inline: true
      });
    }

    const message = {
      username: this.username,
      avatar_url: this.avatarUrl,
      embeds: [embed]
    };

    return message;
  }

  /**
   * Send custom message to Discord
   */
  async sendCustomMessage(content, options = {}) {
    if (!this.isReady()) {
      throw new Error('Discord integration is not ready');
    }

    const message = {
      content: content,
      username: options.username || this.username,
      avatar_url: options.avatarUrl || this.avatarUrl,
      embeds: options.embeds || [],
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
      logger.error(`Failed to send custom Discord message:`, error);
      throw error;
    }
  }

  /**
   * Send rich embed message to Discord
   */
  async sendEmbedMessage(embed, options = {}) {
    if (!this.isReady()) {
      throw new Error('Discord integration is not ready');
    }

    const message = {
      username: options.username || this.username,
      avatar_url: options.avatarUrl || this.avatarUrl,
      embeds: [embed]
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
      logger.error(`Failed to send Discord embed message:`, error);
      throw error;
    }
  }

  /**
   * Send batch processing notification
   */
  async sendBatchNotification(batchResults) {
    if (!this.isReady()) {
      throw new Error('Discord integration is not ready');
    }

    const { totalFiles, successCount, failureCount, processingTime } = batchResults;
    const successRate = Math.round((successCount / totalFiles) * 100);

    const embed = {
      title: '📊 Batch Processing Completed',
      color: successRate >= 80 ? 5025616 : (successRate >= 50 ? 16776960 : 15158332), // Green, yellow, or red
      fields: [
        {
          name: '📁 Total Files',
          value: totalFiles.toString(),
          inline: true
        },
        {
          name: '✅ Successful',
          value: successCount.toString(),
          inline: true
        },
        {
          name: '❌ Failed',
          value: failureCount.toString(),
          inline: true
        },
        {
          name: '📈 Success Rate',
          value: `${successRate}%`,
          inline: true
        },
        {
          name: '⏱️ Processing Time',
          value: this.formatDuration(processingTime),
          inline: true
        }
      ],
      timestamp: new Date().toISOString(),
      footer: {
        text: 'Hebrew Transcription Service - Batch Processing'
      }
    };

    const message = {
      username: this.username,
      avatar_url: this.avatarUrl,
      embeds: [embed]
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
      logger.error(`Failed to send Discord batch notification:`, error);
      throw error;
    }
  }

  /**
   * Send workflow notification
   */
  async sendWorkflowNotification(workflow, status, details = {}) {
    if (!this.isReady()) {
      throw new Error('Discord integration is not ready');
    }

    const statusEmoji = {
      started: '🔄',
      completed: '✅',
      failed: '❌',
      paused: '⏸️'
    };

    const statusColor = {
      started: 3447003, // Blue
      completed: 5025616, // Green
      failed: 15158332, // Red
      paused: 16776960 // Yellow
    };

    const embed = {
      title: `${statusEmoji[status]} Workflow ${status.charAt(0).toUpperCase() + status.slice(1)}`,
      description: `Workflow: **${workflow.name}**`,
      color: statusColor[status],
      fields: [
        {
          name: '🔗 Workflow ID',
          value: workflow.id,
          inline: true
        },
        {
          name: '📊 Status',
          value: status.charAt(0).toUpperCase() + status.slice(1),
          inline: true
        }
      ],
      timestamp: new Date().toISOString(),
      footer: {
        text: 'Hebrew Transcription Service - Workflow Engine'
      }
    };

    // Add additional details if provided
    if (details.filesProcessed !== undefined) {
      embed.fields.push({
        name: '📁 Files Processed',
        value: details.filesProcessed.toString(),
        inline: true
      });
    }

    if (details.duration !== undefined) {
      embed.fields.push({
        name: '⏱️ Duration',
        value: this.formatDuration(details.duration),
        inline: true
      });
    }

    if (details.errorMessage) {
      embed.fields.push({
        name: '❗ Error',
        value: `\`\`\`${details.errorMessage}\`\`\``
      });
    }

    const message = {
      username: this.username,
      avatar_url: this.avatarUrl,
      embeds: [embed]
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
      logger.error(`Failed to send Discord workflow notification:`, error);
      throw error;
    }
  }

  /**
   * Format duration in human-readable format
   */
  formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m ${remainingSeconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    } else {
      return `${remainingSeconds}s`;
    }
  }

  /**
   * Get Discord webhook templates
   */
  static getWebhookTemplates() {
    return {
      transcription_completed: {
        name: 'Discord - Transcription Completed',
        description: 'Send rich embed notification to Discord when transcription is completed',
        service: 'discord',
        events: ['transcription.completed'],
        template: {
          username: 'Hebrew Transcription Bot',
          embeds: [
            {
              title: '✅ Hebrew Transcription Completed',
              color: 5025616,
              fields: [
                {
                  name: '📁 File',
                  value: '{{originalFilename}}',
                  inline: true
                },
                {
                  name: '⏱️ Duration',
                  value: '{{duration}} seconds',
                  inline: true
                },
                {
                  name: '📊 Confidence',
                  value: '{{confidence}}%',
                  inline: true
                },
                {
                  name: '📝 Preview',
                  value: '```{{transcriptionText}}```',
                  inline: false
                }
              ],
              timestamp: '{{timestamp}}',
              footer: {
                text: 'Hebrew Transcription Service'
              }
            }
          ]
        }
      },
      transcription_failed: {
        name: 'Discord - Transcription Failed',
        description: 'Send notification to Discord when transcription fails',
        service: 'discord',
        events: ['transcription.failed'],
        template: {
          username: 'Hebrew Transcription Bot',
          embeds: [
            {
              title: '❌ Hebrew Transcription Failed',
              color: 15158332,
              fields: [
                {
                  name: '📁 File',
                  value: '{{originalFilename}}',
                  inline: true
                },
                {
                  name: '❗ Error',
                  value: '```{{errorMessage}}```',
                  inline: false
                }
              ],
              timestamp: '{{timestamp}}',
              footer: {
                text: 'Hebrew Transcription Service'
              }
            }
          ]
        }
      },
      batch_completed: {
        name: 'Discord - Batch Processing Completed',
        description: 'Send notification when batch processing is completed',
        service: 'discord',
        events: ['batch.completed'],
        template: {
          username: 'Hebrew Transcription Bot',
          embeds: [
            {
              title: '📊 Batch Processing Completed',
              color: 5025616,
              fields: [
                {
                  name: '📁 Total Files',
                  value: '{{totalFiles}}',
                  inline: true
                },
                {
                  name: '✅ Successful',
                  value: '{{successCount}}',
                  inline: true
                },
                {
                  name: '❌ Failed',
                  value: '{{failureCount}}',
                  inline: true
                },
                {
                  name: '⏱️ Processing Time',
                  value: '{{processingTime}}',
                  inline: true
                }
              ],
              timestamp: '{{timestamp}}',
              footer: {
                text: 'Hebrew Transcription Service - Batch Processing'
              }
            }
          ]
        }
      },
      workflow_completed: {
        name: 'Discord - Workflow Completed',
        description: 'Send notification when workflow is completed',
        service: 'discord',
        events: ['workflow.completed'],
        template: {
          username: 'Hebrew Transcription Bot',
          embeds: [
            {
              title: '✅ Workflow Completed',
              description: 'Workflow: **{{workflowName}}**',
              color: 5025616,
              fields: [
                {
                  name: '🔗 Workflow ID',
                  value: '{{workflowId}}',
                  inline: true
                },
                {
                  name: '📁 Files Processed',
                  value: '{{filesProcessed}}',
                  inline: true
                },
                {
                  name: '⏱️ Duration',
                  value: '{{duration}}',
                  inline: true
                }
              ],
              timestamp: '{{timestamp}}',
              footer: {
                text: 'Hebrew Transcription Service - Workflow Engine'
              }
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
      name: 'Discord',
      description: 'Send rich embed notifications to Discord channels via webhooks',
      credentials: [
        {
          name: 'webhookUrl',
          label: 'Webhook URL',
          type: 'url',
          required: true,
          description: 'Discord webhook URL from your server settings'
        }
      ],
      settings: {
        username: {
          label: 'Bot Username',
          type: 'text',
          default: 'Hebrew Transcription Bot',
          description: 'Display name for the bot'
        },
        avatarUrl: {
          label: 'Bot Avatar URL',
          type: 'url',
          required: false,
          description: 'URL to an image to use as the bot avatar'
        }
      }
    };
  }
}

module.exports = DiscordIntegration;