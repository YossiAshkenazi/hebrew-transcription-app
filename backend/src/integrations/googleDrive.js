const BaseIntegration = require('./BaseIntegration');
const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

/**
 * Google Drive Integration Service
 * Provides file upload, sharing, and management capabilities
 */
class GoogleDriveIntegration extends BaseIntegration {
  constructor(config = {}) {
    super('google-drive', config);
    this.auth = null;
    this.drive = null;
    this.folderId = config.folderId || null;
    this.credentials = {};
  }

  /**
   * Initialize Google Drive integration with OAuth2 credentials
   */
  async initialize(credentials = {}) {
    try {
      this.credentials = credentials;
      
      if (!credentials.clientId || !credentials.clientSecret) {
        throw new Error('Google Drive client ID and secret are required');
      }

      // Create OAuth2 client
      this.auth = new google.auth.OAuth2(
        credentials.clientId,
        credentials.clientSecret,
        credentials.redirectUri || 'urn:ietf:wg:oauth:2.0:oob'
      );

      // Set credentials if refresh token is available
      if (credentials.refreshToken) {
        this.auth.setCredentials({
          refresh_token: credentials.refreshToken,
          access_token: credentials.accessToken
        });
      }

      // Initialize Drive API
      this.drive = google.drive({ version: 'v3', auth: this.auth });
      
      await super.initialize(credentials);
      return true;
    } catch (error) {
      logger.error('Failed to initialize Google Drive integration:', error);
      throw error;
    }
  }

  /**
   * Validate credentials by testing API access
   */
  async validateCredentials() {
    if (!this.auth || !this.drive) {
      throw new Error('Google Drive authentication not initialized');
    }

    try {
      // Test API access by getting user info
      const response = await this.drive.about.get({
        fields: 'user'
      });

      logger.info(`Google Drive validated for user: ${response.data.user.emailAddress}`);
      return true;
    } catch (error) {
      throw new Error(`Google Drive validation failed: ${error.message}`);
    }
  }

  /**
   * Check if credentials are valid
   */
  hasValidCredentials() {
    return Boolean(this.credentials.clientId && this.credentials.clientSecret);
  }

  /**
   * Generate OAuth2 authorization URL
   */
  getAuthUrl(scopes = ['https://www.googleapis.com/auth/drive.file']) {
    if (!this.auth) {
      throw new Error('OAuth2 client not initialized');
    }

    return this.auth.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent'
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  async getTokens(code) {
    if (!this.auth) {
      throw new Error('OAuth2 client not initialized');
    }

    try {
      const { tokens } = await this.auth.getToken(code);
      this.auth.setCredentials(tokens);
      
      return tokens;
    } catch (error) {
      throw new Error(`Failed to exchange code for tokens: ${error.message}`);
    }
  }

  /**
   * Upload file to Google Drive
   */
  async uploadFile(filePath, fileName, metadata = {}) {
    if (!this.isReady()) {
      throw new Error('Google Drive integration is not ready');
    }

    try {
      const fileStats = await fs.stat(filePath);
      const fileContent = await fs.readFile(filePath);

      const fileMetadata = {
        name: fileName,
        parents: this.folderId ? [this.folderId] : undefined,
        description: metadata.description || 'Hebrew transcription file',
        ...metadata
      };

      const media = {
        mimeType: metadata.mimeType || 'application/octet-stream',
        body: fileContent
      };

      const response = await this.drive.files.create({
        resource: fileMetadata,
        media: media,
        fields: 'id,name,webViewLink,webContentLink,size,createdTime'
      });

      this.updateLastActivity();
      logger.info(`File uploaded to Google Drive: ${response.data.name} (${response.data.id})`);

      return {
        id: response.data.id,
        name: response.data.name,
        webViewLink: response.data.webViewLink,
        webContentLink: response.data.webContentLink,
        size: response.data.size,
        createdTime: response.data.createdTime
      };
    } catch (error) {
      logger.error('Failed to upload file to Google Drive:', error);
      throw error;
    }
  }

  /**
   * Upload transcription results to Google Drive
   */
  async uploadTranscription(transcription, user) {
    if (!this.isReady()) {
      throw new Error('Google Drive integration is not ready');
    }

    try {
      const fileName = `${path.parse(transcription.originalFilename).name}_transcription.txt`;
      const content = this.formatTranscriptionContent(transcription);
      
      // Create temporary file
      const tempPath = path.join(process.env.TEMP_PATH || './temp', `temp_${Date.now()}.txt`);
      await fs.writeFile(tempPath, content, 'utf8');

      const result = await this.uploadFile(tempPath, fileName, {
        description: `Hebrew transcription for ${transcription.originalFilename}`,
        mimeType: 'text/plain'
      });

      // Clean up temporary file
      try {
        await fs.unlink(tempPath);
      } catch (cleanupError) {
        logger.warn('Failed to cleanup temporary file:', cleanupError);
      }

      return result;
    } catch (error) {
      logger.error('Failed to upload transcription to Google Drive:', error);
      throw error;
    }
  }

  /**
   * Format transcription content for file export
   */
  formatTranscriptionContent(transcription) {
    let content = 'Hebrew Transcription Results\n';
    content += `${'='.repeat(40)}\n\n`;
    content += `File: ${transcription.originalFilename}\n`;
    content += `Duration: ${transcription.duration ? Math.round(transcription.duration / 60) : 'Unknown'} minutes\n`;
    content += 'Language: Hebrew\n';
    content += `Confidence: ${transcription.confidence ? Math.round(transcription.confidence * 100) : 'N/A'}%\n`;
    content += `Processed: ${new Date(transcription.createdAt).toLocaleString()}\n\n`;
    
    content += 'Transcription:\n';
    content += `${'-'.repeat(20)}\n`;
    content += `${transcription.transcriptionText || 'No transcription available'}\n\n`;

    if (transcription.speakerLabels && transcription.speakerLabels.length > 0) {
      content += 'Speaker Labels:\n';
      content += `${'-'.repeat(20)}\n`;
      transcription.speakerLabels.forEach(speaker => {
        const startTime = this.formatTime(speaker.start);
        const endTime = this.formatTime(speaker.end);
        content += `[${startTime} - ${endTime}] ${speaker.speaker}: ${speaker.text}\n`;
      });
      content += '\n';
    }

    if (transcription.lowConfidenceWords && transcription.lowConfidenceWords.length > 0) {
      content += 'Low Confidence Words:\n';
      content += `${'-'.repeat(20)}\n`;
      transcription.lowConfidenceWords.forEach(word => {
        const confidence = Math.round(word.confidence * 100);
        content += `${word.word} (${confidence}%)\n`;
      });
    }

    return content;
  }

  /**
   * Format time in MM:SS format
   */
  formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  /**
   * Create or get transcription folder
   */
  async ensureTranscriptionFolder(folderName = 'Hebrew Transcriptions') {
    if (!this.isReady()) {
      throw new Error('Google Drive integration is not ready');
    }

    try {
      // Search for existing folder
      const response = await this.drive.files.list({
        q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id, name)'
      });

      if (response.data.files.length > 0) {
        this.folderId = response.data.files[0].id;
        return this.folderId;
      }

      // Create new folder
      const folderMetadata = {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder'
      };

      const folderResponse = await this.drive.files.create({
        resource: folderMetadata,
        fields: 'id'
      });

      this.folderId = folderResponse.data.id;
      logger.info(`Created Google Drive folder: ${folderName} (${this.folderId})`);
      
      return this.folderId;
    } catch (error) {
      logger.error('Failed to create/get Google Drive folder:', error);
      throw error;
    }
  }

  /**
   * Share file with specific users
   */
  async shareFile(fileId, emailAddresses, role = 'reader') {
    if (!this.isReady()) {
      throw new Error('Google Drive integration is not ready');
    }

    try {
      const results = [];
      
      for (const email of emailAddresses) {
        const permission = {
          type: 'user',
          role: role,
          emailAddress: email
        };

        const response = await this.drive.permissions.create({
          fileId: fileId,
          resource: permission,
          sendNotificationEmail: true
        });

        results.push({
          email: email,
          permissionId: response.data.id,
          role: role
        });
      }

      this.updateLastActivity();
      return results;
    } catch (error) {
      logger.error('Failed to share Google Drive file:', error);
      throw error;
    }
  }

  /**
   * List files in the transcription folder
   */
  async listTranscriptionFiles(limit = 50) {
    if (!this.isReady()) {
      throw new Error('Google Drive integration is not ready');
    }

    try {
      const query = this.folderId 
        ? `'${this.folderId}' in parents and trashed=false`
        : 'name contains \'transcription\' and trashed=false';

      const response = await this.drive.files.list({
        q: query,
        pageSize: limit,
        fields: 'files(id, name, size, createdTime, modifiedTime, webViewLink)',
        orderBy: 'createdTime desc'
      });

      this.updateLastActivity();
      return response.data.files;
    } catch (error) {
      logger.error('Failed to list Google Drive files:', error);
      throw error;
    }
  }

  /**
   * Send transcription notification (uploads file to Drive)
   */
  async sendTranscriptionNotification(transcription, user) {
    try {
      await this.ensureTranscriptionFolder();
      const result = await this.uploadTranscription(transcription, user);
      
      return {
        success: true,
        fileId: result.id,
        fileName: result.name,
        webViewLink: result.webViewLink
      };
    } catch (error) {
      logger.error('Failed to send Google Drive notification:', error);
      throw error;
    }
  }

  /**
   * Get integration configuration template
   */
  getConfigTemplate() {
    return {
      name: 'Google Drive',
      description: 'Upload transcription files to Google Drive and share with team members',
      credentials: [
        {
          name: 'clientId',
          label: 'Client ID',
          type: 'text',
          required: true,
          description: 'Google OAuth2 Client ID from Google Cloud Console'
        },
        {
          name: 'clientSecret',
          label: 'Client Secret',
          type: 'password',
          required: true,
          description: 'Google OAuth2 Client Secret from Google Cloud Console'
        },
        {
          name: 'refreshToken',
          label: 'Refresh Token',
          type: 'password',
          required: false,
          description: 'OAuth2 refresh token (obtained during authorization)'
        }
      ],
      settings: {
        folderId: {
          label: 'Folder ID',
          type: 'text',
          required: false,
          description: 'Specific Google Drive folder ID to upload files (optional)'
        },
        autoShare: {
          label: 'Auto Share',
          type: 'boolean',
          default: false,
          description: 'Automatically share uploaded files with specified users'
        },
        shareEmails: {
          label: 'Share with Emails',
          type: 'textarea',
          required: false,
          description: 'Comma-separated list of email addresses to share files with'
        }
      }
    };
  }
}

module.exports = GoogleDriveIntegration;