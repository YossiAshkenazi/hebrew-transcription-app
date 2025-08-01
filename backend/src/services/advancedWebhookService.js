const logger = require('../utils/logger');
const axios = require('axios');
const { WebhookConfig } = require('../models');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');

/**
 * Advanced Webhook Service
 * Provides enhanced webhook functionality with analytics, testing, and conditional logic
 */
class AdvancedWebhookService {
  constructor() {
    this.analytics = new Map(); // In-memory analytics (should be moved to Redis in production)
    this.testResults = new Map(); // Test result cache
    this.templates = new Map(); // Webhook templates cache
    this.retryQueue = new Map(); // Retry queue for failed webhooks
  }

  /**
   * Initialize the advanced webhook service
   */
  async initialize() {
    try {
      await this.loadWebhookTemplates();
      this.startAnalyticsCleanup();
      logger.info('Advanced Webhook Service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Advanced Webhook Service:', error);
      throw error;
    }
  }

  /**
   * Load webhook templates from database or file system
   */
  async loadWebhookTemplates() {
    // Load built-in templates
    const builtInTemplates = this.getBuiltInTemplates();
    for (const [key, template] of Object.entries(builtInTemplates)) {
      this.templates.set(key, template);
    }

    // Load custom templates from database (if implemented)
    try {
      // const customTemplates = await this.loadCustomTemplates();
      // Add custom templates to cache...
      logger.info(`Loaded ${this.templates.size} webhook templates`);
    } catch (error) {
      logger.warn('Failed to load custom templates:', error);
    }
  }

  /**
   * Send webhook with advanced features
   */
  async sendAdvancedWebhook(webhookConfig, eventType, payload, options = {}) {
    const webhookId = uuidv4();
    const startTime = Date.now();

    try {
      // Check if webhook should be triggered based on conditions
      if (!this.shouldTriggerWebhook(webhookConfig, eventType, payload)) {
        logger.debug(`Webhook ${webhookConfig.id} skipped due to conditions`);
        return { skipped: true, reason: 'conditions_not_met' };
      }

      // Apply template if specified
      const processedPayload = await this.applyTemplate(webhookConfig, payload);
      
      // Record webhook attempt
      this.recordWebhookAttempt(webhookConfig.id, webhookId, eventType);

      // Send webhook
      const response = await this.executeWebhook(webhookConfig, processedPayload, options);
      
      // Record success metrics
      const duration = Date.now() - startTime;
      this.recordWebhookSuccess(webhookConfig.id, webhookId, duration, response);

      return {
        success: true,
        webhookId,
        duration,
        response: {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        }
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Record failure metrics
      this.recordWebhookFailure(webhookConfig.id, webhookId, duration, error);
      
      // Handle retry logic
      if (options.enableRetry !== false) {
        await this.scheduleRetry(webhookConfig, eventType, payload, options);
      }

      throw error;
    }
  }

  /**
   * Execute webhook HTTP request
   */
  async executeWebhook(webhookConfig, payload, options = {}) {
    const requestConfig = {
      method: webhookConfig.method || 'POST',
      url: webhookConfig.url,
      data: payload,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Hebrew-Transcription-Webhook/1.0',
        ...webhookConfig.headers,
        ...options.headers
      },
      timeout: options.timeout || 30000,
      maxRedirects: 5
    };

    // Add authentication if configured
    if (webhookConfig.authType) {
      this.addAuthentication(requestConfig, webhookConfig);
    }

    return await axios(requestConfig);
  }

  /**
   * Add authentication to webhook request
   */
  addAuthentication(requestConfig, webhookConfig) {
    switch (webhookConfig.authType) {
      case 'bearer':
        requestConfig.headers.Authorization = `Bearer ${webhookConfig.authToken}`;
        break;
      case 'basic':
        const credentials = Buffer.from(`${webhookConfig.authUsername}:${webhookConfig.authPassword}`).toString('base64');
        requestConfig.headers.Authorization = `Basic ${credentials}`;
        break;
      case 'api_key':
        if (webhookConfig.authHeaderName) {
          requestConfig.headers[webhookConfig.authHeaderName] = webhookConfig.authToken;
        } else {
          requestConfig.headers['X-API-Key'] = webhookConfig.authToken;
        }
        break;
      case 'custom':
        if (webhookConfig.customHeaders) {
          Object.assign(requestConfig.headers, webhookConfig.customHeaders);
        }
        break;
    }
  }

  /**
   * Check if webhook should be triggered based on conditions
   */
  shouldTriggerWebhook(webhookConfig, eventType, payload) {
    // Check if event type matches
    if (webhookConfig.events && !webhookConfig.events.includes(eventType)) {
      return false;
    }

    // Check custom conditions
    if (webhookConfig.conditions && webhookConfig.conditions.length > 0) {
      return this.evaluateConditions(webhookConfig.conditions, payload);
    }

    // Check time-based conditions
    if (webhookConfig.schedule) {
      return this.checkScheduleConditions(webhookConfig.schedule);
    }

    return true;
  }

  /**
   * Evaluate custom webhook conditions
   */
  evaluateConditions(conditions, payload) {
    for (const condition of conditions) {
      if (!this.evaluateCondition(condition, payload)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Evaluate single condition
   */
  evaluateCondition(condition, payload) {
    const { field, operator, value } = condition;
    const fieldValue = this.getNestedValue(payload, field);

    switch (operator) {
      case 'equals':
        return fieldValue === value;
      case 'not_equals':
        return fieldValue !== value;
      case 'contains':
        return typeof fieldValue === 'string' && fieldValue.includes(value);
      case 'not_contains':
        return typeof fieldValue === 'string' && !fieldValue.includes(value);
      case 'greater_than':
        return Number(fieldValue) > Number(value);
      case 'less_than':
        return Number(fieldValue) < Number(value);
      case 'exists':
        return fieldValue !== undefined && fieldValue !== null;
      case 'not_exists':
        return fieldValue === undefined || fieldValue === null;
      case 'regex':
        try {
          const regex = new RegExp(value);
          return regex.test(String(fieldValue));
        } catch (error) {
          logger.warn(`Invalid regex in webhook condition: ${value}`);
          return false;
        }
      default:
        logger.warn(`Unknown condition operator: ${operator}`);
        return true;
    }
  }

  /**
   * Get nested value from object using dot notation
   */
  getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  /**
   * Check schedule-based conditions
   */
  checkScheduleConditions(schedule) {
    const now = moment();
    
    // Check time range
    if (schedule.timeRange) {
      const startTime = moment(schedule.timeRange.start, 'HH:mm');
      const endTime = moment(schedule.timeRange.end, 'HH:mm');
      const currentTime = moment(now.format('HH:mm'), 'HH:mm');
      
      if (!currentTime.isBetween(startTime, endTime, null, '[]')) {
        return false;
      }
    }

    // Check days of week
    if (schedule.daysOfWeek && schedule.daysOfWeek.length > 0) {
      const currentDay = now.day(); // 0 = Sunday, 1 = Monday, etc.
      if (!schedule.daysOfWeek.includes(currentDay)) {
        return false;
      }
    }

    // Check date range
    if (schedule.dateRange) {
      const startDate = moment(schedule.dateRange.start);
      const endDate = moment(schedule.dateRange.end);
      
      if (!now.isBetween(startDate, endDate, 'day', '[]')) {
        return false;
      }
    }

    return true;
  }

  /**
   * Apply webhook template to payload
   */
  async applyTemplate(webhookConfig, payload) {
    if (!webhookConfig.templateId) {
      return payload;
    }

    const template = this.templates.get(webhookConfig.templateId);
    if (!template) {
      logger.warn(`Template not found: ${webhookConfig.templateId}`);
      return payload;
    }

    return this.processTemplate(template.template, payload);
  }

  /**
   * Process template with payload data
   */
  processTemplate(template, payload) {
    // Simple template processing with {{variable}} syntax
    let processed = JSON.stringify(template);
    
    // Replace template variables
    processed = processed.replace(/\{\{([^}]+)\}\}/g, (match, variable) => {
      const value = this.getNestedValue(payload, variable.trim());
      return value !== undefined ? JSON.stringify(value).slice(1, -1) : match;
    });

    try {
      return JSON.parse(processed);
    } catch (error) {
      logger.error('Failed to parse processed template:', error);
      return payload;
    }
  }

  /**
   * Test webhook configuration
   */
  async testWebhook(webhookConfig, testPayload = null) {
    const testId = uuidv4();
    const startTime = Date.now();

    try {
      const payload = testPayload || this.generateTestPayload();
      
      const result = await this.executeWebhook(webhookConfig, payload, {
        timeout: 10000 // Shorter timeout for tests
      });

      const duration = Date.now() - startTime;
      const testResult = {
        testId,
        success: true,
        duration,
        status: result.status,
        statusText: result.statusText,
        headers: result.headers,
        timestamp: new Date().toISOString()
      };

      this.testResults.set(testId, testResult);
      return testResult;

    } catch (error) {
      const duration = Date.now() - startTime;
      const testResult = {
        testId,
        success: false,
        duration,
        error: error.message,
        code: error.code,
        status: error.response?.status,
        timestamp: new Date().toISOString()
      };

      this.testResults.set(testId, testResult);
      return testResult;
    }
  }

  /**
   * Generate test payload for webhook testing
   */
  generateTestPayload() {
    return {
      event: 'transcription.completed',
      timestamp: new Date().toISOString(),
      data: {
        transcription: {
          id: 'test-123',
          originalFilename: 'test-audio.mp3',
          status: 'completed',
          transcriptionText: 'זה טקסט בדיקה בעברית',
          confidence: 0.95,
          duration: 120,
          language: 'he-IL',
          createdAt: new Date().toISOString()
        },
        user: {
          id: 'user-123',
          email: 'test@example.com'
        }
      }
    };
  }

  /**
   * Get webhook analytics
   */
  getWebhookAnalytics(webhookId, timeRange = '24h') {
    const analytics = this.analytics.get(webhookId);
    if (!analytics) {
      return this.createEmptyAnalytics();
    }

    const cutoffTime = this.getCutoffTime(timeRange);
    const filteredAttempts = analytics.attempts.filter(attempt => 
      new Date(attempt.timestamp) >= cutoffTime
    );

    const successCount = filteredAttempts.filter(a => a.success).length;
    const failureCount = filteredAttempts.length - successCount;
    const totalDuration = filteredAttempts.reduce((sum, a) => sum + (a.duration || 0), 0);
    const avgDuration = filteredAttempts.length > 0 ? totalDuration / filteredAttempts.length : 0;

    return {
      webhookId,
      timeRange,
      totalAttempts: filteredAttempts.length,
      successCount,
      failureCount,
      successRate: filteredAttempts.length > 0 ? (successCount / filteredAttempts.length) * 100 : 0,
      averageDuration: Math.round(avgDuration),
      lastAttempt: filteredAttempts.length > 0 ? filteredAttempts[filteredAttempts.length - 1] : null,
      recentFailures: filteredAttempts.filter(a => !a.success).slice(-5),
      performanceMetrics: this.calculatePerformanceMetrics(filteredAttempts)
    };
  }

  /**
   * Create empty analytics object
   */
  createEmptyAnalytics() {
    return {
      totalAttempts: 0,
      successCount: 0,
      failureCount: 0,
      successRate: 0,
      averageDuration: 0,
      lastAttempt: null,
      recentFailures: [],
      performanceMetrics: {
        p95Duration: 0,
        p99Duration: 0,
        medianDuration: 0
      }
    };
  }

  /**
   * Calculate performance metrics
   */
  calculatePerformanceMetrics(attempts) {
    if (attempts.length === 0) {
      return { p95Duration: 0, p99Duration: 0, medianDuration: 0 };
    }

    const durations = attempts.map(a => a.duration || 0).sort((a, b) => a - b);
    const len = durations.length;

    return {
      p95Duration: durations[Math.floor(len * 0.95)] || 0,
      p99Duration: durations[Math.floor(len * 0.99)] || 0,
      medianDuration: durations[Math.floor(len * 0.5)] || 0
    };
  }

  /**
   * Get cutoff time for analytics filtering
   */
  getCutoffTime(timeRange) {
    const now = new Date();
    switch (timeRange) {
      case '1h':
        return new Date(now.getTime() - 60 * 60 * 1000);
      case '6h':
        return new Date(now.getTime() - 6 * 60 * 60 * 1000);
      case '24h':
        return new Date(now.getTime() - 24 * 60 * 60 * 1000);
      case '7d':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case '30d':
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      default:
        return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }
  }

  /**
   * Record webhook attempt
   */
  recordWebhookAttempt(webhookId, attemptId, eventType) {
    if (!this.analytics.has(webhookId)) {
      this.analytics.set(webhookId, { attempts: [], created: new Date() });
    }

    const analytics = this.analytics.get(webhookId);
    analytics.attempts.push({
      id: attemptId,
      eventType,
      timestamp: new Date().toISOString(),
      success: null, // Will be updated later
      duration: null
    });
  }

  /**
   * Record webhook success
   */
  recordWebhookSuccess(webhookId, attemptId, duration, response) {
    const analytics = this.analytics.get(webhookId);
    if (analytics) {
      const attempt = analytics.attempts.find(a => a.id === attemptId);
      if (attempt) {
        attempt.success = true;
        attempt.duration = duration;
        attempt.statusCode = response.status;
      }
    }
  }

  /**
   * Record webhook failure
   */
  recordWebhookFailure(webhookId, attemptId, duration, error) {
    const analytics = this.analytics.get(webhookId);
    if (analytics) {
      const attempt = analytics.attempts.find(a => a.id === attemptId);
      if (attempt) {
        attempt.success = false;
        attempt.duration = duration;
        attempt.error = error.message;
        attempt.statusCode = error.response?.status;
      }
    }
  }

  /**
   * Schedule webhook retry
   */
  async scheduleRetry(webhookConfig, eventType, payload, options = {}) {
    const retryKey = `${webhookConfig.id}-${Date.now()}`;
    const retryCount = options.retryCount || 0;
    const maxRetries = webhookConfig.maxRetries || 3;

    if (retryCount >= maxRetries) {
      logger.warn(`Max retries reached for webhook ${webhookConfig.id}`);
      return;
    }

    const retryDelay = this.calculateRetryDelay(retryCount);
    
    this.retryQueue.set(retryKey, {
      webhookConfig,
      eventType,
      payload,
      options: { ...options, retryCount: retryCount + 1 },
      scheduleTime: Date.now() + retryDelay
    });

    setTimeout(() => {
      this.processRetry(retryKey);
    }, retryDelay);

    logger.info(`Scheduled webhook retry ${retryCount + 1}/${maxRetries} for ${webhookConfig.id} in ${retryDelay}ms`);
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  calculateRetryDelay(retryCount) {
    const baseDelay = 1000; // 1 second
    const maxDelay = 300000; // 5 minutes
    const delay = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
    
    // Add jitter to prevent thundering herd
    const jitter = Math.random() * 0.1 * delay;
    return delay + jitter;
  }

  /**
   * Process scheduled retry
   */
  async processRetry(retryKey) {
    const retryItem = this.retryQueue.get(retryKey);
    if (!retryItem) {
      return;
    }

    this.retryQueue.delete(retryKey);

    try {
      await this.sendAdvancedWebhook(
        retryItem.webhookConfig,
        retryItem.eventType,
        retryItem.payload,
        retryItem.options
      );
      logger.info(`Webhook retry successful: ${retryItem.webhookConfig.id}`);
    } catch (error) {
      logger.error(`Webhook retry failed: ${retryItem.webhookConfig.id}`, error);
    }
  }

  /**
   * Get built-in webhook templates
   */
  getBuiltInTemplates() {
    return {
      'slack-transcription-completed': {
        name: 'Slack - Transcription Completed',
        description: 'Send rich notification to Slack when transcription completes',
        service: 'slack',
        events: ['transcription.completed'],
        template: {
          channel: '#transcriptions',
          username: 'Hebrew Transcription Bot',
          icon_emoji: ':speech_balloon:',
          blocks: [
            {
              type: 'header',
              text: {
                type: 'plain_text',
                text: '✅ Hebrew Transcription Completed'
              }
            },
            {
              type: 'section',
              fields: [
                {
                  type: 'mrkdwn',
                  text: '*File:* {{data.transcription.originalFilename}}'
                },
                {
                  type: 'mrkdwn',
                  text: '*Duration:* {{data.transcription.duration}} seconds'
                },
                {
                  type: 'mrkdwn',
                  text: '*Confidence:* {{data.transcription.confidence}}%'
                },
                {
                  type: 'mrkdwn',
                  text: '*Language:* Hebrew'
                }
              ]
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '*Preview:*\n```{{data.transcription.transcriptionText}}```'
              }
            }
          ]
        }
      },
      'teams-transcription-completed': {
        name: 'Teams - Transcription Completed',
        description: 'Send notification to Microsoft Teams when transcription completes',
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
              activitySubtitle: 'File: {{data.transcription.originalFilename}}',
              facts: [
                {
                  name: 'Duration',
                  value: '{{data.transcription.duration}} seconds'
                },
                {
                  name: 'Confidence',
                  value: '{{data.transcription.confidence}}%'
                },
                {
                  name: 'Language',
                  value: 'Hebrew'
                }
              ],
              text: '{{data.transcription.transcriptionText}}'
            }
          ]
        }
      },
      'discord-transcription-completed': {
        name: 'Discord - Transcription Completed',
        description: 'Send rich embed to Discord when transcription completes',
        service: 'discord',
        events: ['transcription.completed'],
        template: {
          embeds: [
            {
              title: '✅ Hebrew Transcription Completed',
              color: 5025616, // Green color
              fields: [
                {
                  name: 'File',
                  value: '{{data.transcription.originalFilename}}',
                  inline: true
                },
                {
                  name: 'Duration',
                  value: '{{data.transcription.duration}} seconds',
                  inline: true
                },
                {
                  name: 'Confidence',
                  value: '{{data.transcription.confidence}}%',
                  inline: true
                },
                {
                  name: 'Transcription Preview',
                  value: '```{{data.transcription.transcriptionText}}```',
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
      }
    };
  }

  /**
   * Start analytics cleanup routine
   */
  startAnalyticsCleanup() {
    // Clean up old analytics data every hour
    setInterval(() => {
      this.cleanupAnalytics();
    }, 60 * 60 * 1000);
  }

  /**
   * Clean up old analytics data
   */
  cleanupAnalytics() {
    const cutoffTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days
    
    for (const [webhookId, analytics] of this.analytics.entries()) {
      analytics.attempts = analytics.attempts.filter(attempt => 
        new Date(attempt.timestamp) >= cutoffTime
      );
      
      // Remove empty analytics
      if (analytics.attempts.length === 0) {
        this.analytics.delete(webhookId);
      }
    }

    // Clean up old test results
    for (const [testId, result] of this.testResults.entries()) {
      if (new Date(result.timestamp) < cutoffTime) {
        this.testResults.delete(testId);
      }
    }

    logger.debug(`Analytics cleanup completed. ${this.analytics.size} webhook analytics, ${this.testResults.size} test results`);
  }

  /**
   * Get all available webhook templates
   */
  getAllTemplates() {
    const templates = {};
    for (const [key, template] of this.templates.entries()) {
      templates[key] = template;
    }
    return templates;
  }

  /**
   * Get test result by ID
   */
  getTestResult(testId) {
    return this.testResults.get(testId);
  }

  /**
   * Get all webhook analytics summary
   */
  getAllAnalyticsSummary(timeRange = '24h') {
    const summary = {};
    for (const webhookId of this.analytics.keys()) {
      summary[webhookId] = this.getWebhookAnalytics(webhookId, timeRange);
    }
    return summary;
  }
}

module.exports = new AdvancedWebhookService();