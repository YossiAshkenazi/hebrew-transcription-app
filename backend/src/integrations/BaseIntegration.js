const logger = require('../utils/logger');
const axios = require('axios');

/**
 * Base class for all third-party integrations
 * Provides common functionality and standardized interface
 */
class BaseIntegration {
  constructor(name, config = {}) {
    this.name = name;
    this.config = config;
    this.isEnabled = false;
    this.credentials = {};
    this.rateLimits = {
      requests: 100,
      window: 3600000, // 1 hour in milliseconds
      current: 0,
      resetTime: Date.now() + 3600000
    };
  }

  /**
   * Initialize the integration with credentials and configuration
   */
  async initialize(credentials = {}) {
    try {
      this.credentials = credentials;
      await this.validateCredentials();
      this.isEnabled = true;
      logger.info(`Integration ${this.name} initialized successfully`);
      return true;
    } catch (error) {
      logger.error(`Failed to initialize integration ${this.name}:`, error);
      this.isEnabled = false;
      throw error;
    }
  }

  /**
   * Validate credentials - to be implemented by subclasses
   */
  async validateCredentials() {
    throw new Error('validateCredentials method must be implemented by subclass');
  }

  /**
   * Check if integration is properly configured and enabled
   */
  isReady() {
    return this.isEnabled && this.hasValidCredentials();
  }

  /**
   * Check if credentials are valid - to be implemented by subclasses
   */
  hasValidCredentials() {
    return Object.keys(this.credentials).length > 0;
  }

  /**
   * Rate limiting check
   */
  checkRateLimit() {
    const now = Date.now();
    
    // Reset rate limit window if expired
    if (now > this.rateLimits.resetTime) {
      this.rateLimits.current = 0;
      this.rateLimits.resetTime = now + this.rateLimits.window;
    }

    if (this.rateLimits.current >= this.rateLimits.requests) {
      const waitTime = this.rateLimits.resetTime - now;
      throw new Error(`Rate limit exceeded for ${this.name}. Reset in ${Math.ceil(waitTime / 1000)} seconds`);
    }

    this.rateLimits.current++;
    return true;
  }

  /**
   * Make authenticated HTTP request with rate limiting
   */
  async makeRequest(options) {
    this.checkRateLimit();
    
    if (!this.isReady()) {
      throw new Error(`Integration ${this.name} is not ready`);
    }

    try {
      const response = await axios({
        ...options,
        timeout: this.config.timeout || 30000,
        headers: {
          'User-Agent': 'Hebrew-Transcription-App/1.0',
          ...this.getAuthHeaders(),
          ...options.headers
        }
      });

      logger.debug(`API request to ${this.name} successful`, {
        url: options.url,
        method: options.method,
        status: response.status
      });

      return response;
    } catch (error) {
      logger.error(`API request to ${this.name} failed:`, {
        url: options.url,
        method: options.method,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get authentication headers - to be implemented by subclasses
   */
  getAuthHeaders() {
    return {};
  }

  /**
   * Send notification about transcription completion
   */
  async sendTranscriptionNotification(transcription, user) {
    throw new Error('sendTranscriptionNotification method must be implemented by subclass');
  }

  /**
   * Upload file to integration service
   */
  async uploadFile(filePath, fileName, metadata = {}) {
    throw new Error('uploadFile method must be implemented by subclass');
  }

  /**
   * Get integration status and health information
   */
  async getStatus() {
    return {
      name: this.name,
      enabled: this.isEnabled,
      ready: this.isReady(),
      rateLimits: {
        current: this.rateLimits.current,
        limit: this.rateLimits.requests,
        resetTime: new Date(this.rateLimits.resetTime).toISOString()
      },
      lastActivity: this.lastActivity || null
    };
  }

  /**
   * Test the integration connection
   */
  async testConnection() {
    try {
      await this.validateCredentials();
      return {
        success: true,
        message: `Connection to ${this.name} successful`,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        success: false,
        message: `Connection to ${this.name} failed: ${error.message}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Update last activity timestamp
   */
  updateLastActivity() {
    this.lastActivity = new Date().toISOString();
  }

  /**
   * Get integration configuration template
   */
  getConfigTemplate() {
    return {
      name: this.name,
      description: 'Base integration configuration',
      credentials: [],
      settings: {}
    };
  }

  /**
   * Cleanup resources when integration is disabled
   */
  async cleanup() {
    this.isEnabled = false;
    this.credentials = {};
    logger.info(`Integration ${this.name} cleaned up`);
  }
}

module.exports = BaseIntegration;