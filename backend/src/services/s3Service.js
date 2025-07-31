const AWS = require('aws-sdk');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

class S3Service {
  constructor() {
    this.s3 = new AWS.S3({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION || 'us-east-1'
    });
    
    this.bucketName = process.env.S3_BUCKET_NAME;
    
    if (!this.bucketName) {
      logger.warn('S3_BUCKET_NAME not configured. File storage will use local filesystem.');
    }
  }

  async uploadAudioFile(filePath, originalFilename, userId = null) {
    try {
      if (!this.bucketName) {
        // Fallback to local storage
        return this.moveToLocalStorage(filePath, originalFilename, userId);
      }

      const fileContent = await fs.readFile(filePath);
      const fileExtension = path.extname(originalFilename);
      const key = this.generateS3Key(originalFilename, userId, fileExtension);
      
      const uploadParams = {
        Bucket: this.bucketName,
        Key: key,
        Body: fileContent,
        ContentType: this.getContentType(fileExtension),
        ServerSideEncryption: 'AES256',
        Metadata: {
          originalFilename: originalFilename,
          uploadedAt: new Date().toISOString(),
          userId: userId || 'anonymous'
        }
      };

      const result = await this.s3.upload(uploadParams).promise();
      
      logger.info(`File uploaded to S3: ${key}`);
      
      return {
        key: key,
        location: result.Location,
        bucket: this.bucketName,
        size: fileContent.length
      };
    } catch (error) {
      logger.error('S3 upload failed:', error);
      throw new Error(`Failed to upload file: ${error.message}`);
    }
  }

  async downloadAudioFile(s3Key, downloadPath) {
    try {
      if (!this.bucketName) {
        throw new Error('S3 not configured');
      }

      const downloadParams = {
        Bucket: this.bucketName,
        Key: s3Key
      };

      const data = await this.s3.getObject(downloadParams).promise();
      await fs.writeFile(downloadPath, data.Body);
      
      logger.info(`File downloaded from S3: ${s3Key}`);
      return downloadPath;
    } catch (error) {
      logger.error('S3 download failed:', error);
      throw new Error(`Failed to download file: ${error.message}`);
    }
  }

  async deleteAudioFile(s3Key) {
    try {
      if (!this.bucketName) {
        return this.deleteFromLocalStorage(s3Key);
      }

      const deleteParams = {
        Bucket: this.bucketName,
        Key: s3Key
      };

      await this.s3.deleteObject(deleteParams).promise();
      logger.info(`File deleted from S3: ${s3Key}`);
      
      return true;
    } catch (error) {
      logger.error('S3 delete failed:', error);
      throw new Error(`Failed to delete file: ${error.message}`);
    }
  }

  async getFileMetadata(s3Key) {
    try {
      if (!this.bucketName) {
        throw new Error('S3 not configured');
      }

      const headParams = {
        Bucket: this.bucketName,
        Key: s3Key
      };

      const data = await this.s3.headObject(headParams).promise();
      
      return {
        size: data.ContentLength,
        lastModified: data.LastModified,
        contentType: data.ContentType,
        metadata: data.Metadata
      };
    } catch (error) {
      logger.error('Failed to get S3 metadata:', error);
      throw new Error(`Failed to get file metadata: ${error.message}`);
    }
  }

  async generatePresignedUrl(s3Key, expiresIn = 3600) {
    try {
      if (!this.bucketName) {
        throw new Error('S3 not configured');
      }

      const params = {
        Bucket: this.bucketName,
        Key: s3Key,
        Expires: expiresIn
      };

      const url = await this.s3.getSignedUrlPromise('getObject', params);
      return url;
    } catch (error) {
      logger.error('Failed to generate presigned URL:', error);
      throw new Error(`Failed to generate download URL: ${error.message}`);
    }
  }

  async moveToLocalStorage(filePath, originalFilename, userId) {
    try {
      const uploadDir = process.env.UPLOAD_PATH || './uploads';
      const fileExtension = path.extname(originalFilename);
      const localKey = this.generateS3Key(originalFilename, userId, fileExtension);
      const localPath = path.join(uploadDir, localKey);
      
      // Ensure directory exists
      await fs.mkdir(path.dirname(localPath), { recursive: true });
      
      // Move file
      await fs.rename(filePath, localPath);
      
      const stats = await fs.stat(localPath);
      
      logger.info(`File stored locally: ${localKey}`);
      
      return {
        key: localKey,
        location: localPath,
        bucket: 'local',
        size: stats.size
      };
    } catch (error) {
      logger.error('Local storage failed:', error);
      throw new Error(`Failed to store file locally: ${error.message}`);
    }
  }

  async deleteFromLocalStorage(localKey) {
    try {
      const uploadDir = process.env.UPLOAD_PATH || './uploads';
      const localPath = path.join(uploadDir, localKey);
      
      await fs.unlink(localPath);
      logger.info(`File deleted locally: ${localKey}`);
      
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.warn(`File not found for deletion: ${localKey}`);
        return true; // File already doesn't exist
      }
      
      logger.error('Local file delete failed:', error);
      throw new Error(`Failed to delete local file: ${error.message}`);
    }
  }

  generateS3Key(originalFilename, userId, fileExtension) {
    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const uuid = uuidv4();
    const userPrefix = userId ? `users/${userId}` : 'anonymous';
    
    return `audio/${userPrefix}/${timestamp}/${uuid}${fileExtension}`;
  }

  getContentType(fileExtension) {
    const contentTypes = {
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.flac': 'audio/flac'
    };
    
    return contentTypes[fileExtension.toLowerCase()] || 'application/octet-stream';
  }

  async cleanupExpiredFiles() {
    try {
      // This would typically be run as a scheduled job
      // For now, it's a placeholder for cleanup logic
      logger.info('Cleanup of expired files started');
      
      // Implementation would:
      // 1. Query database for expired transcriptions
      // 2. Delete associated S3 files
      // 3. Update database records
      
      logger.info('Cleanup of expired files completed');
    } catch (error) {
      logger.error('File cleanup failed:', error);
    }
  }
}

module.exports = new S3Service();
