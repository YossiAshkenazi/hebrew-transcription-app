const { Transcription } = require('../../models');
const s3Service = require('../../services/s3Service');
const logger = require('../../utils/logger');
const { Op } = require('sequelize');

class CleanupProcessor {
  async processCleanup(job) {
    try {
      logger.info('Starting cleanup process for expired files');
      
      const now = new Date();
      let cleanedCount = 0;
      let errorCount = 0;
      
      // Find transcriptions that have expired
      const expiredTranscriptions = await Transcription.findAll({
        where: {
          expiresAt: {
            [Op.lt]: now
          },
          status: {
            [Op.in]: ['completed', 'failed', 'cancelled']
          }
        },
        limit: 100 // Process in batches
      });
      
      logger.info(`Found ${expiredTranscriptions.length} expired transcriptions to clean up`);
      
      for (const transcription of expiredTranscriptions) {
        try {
          // Delete file from S3/storage
          if (transcription.s3Key) {
            await s3Service.deleteAudioFile(transcription.s3Key);
            logger.info(`Deleted audio file: ${transcription.s3Key}`);
          }
          
          // Update transcription record to mark as cleaned
          await transcription.update({
            s3Key: null,
            metadata: {
              ...transcription.metadata,
              cleanedAt: new Date().toISOString(),
              cleanupReason: 'expired'
            }
          });
          
          cleanedCount++;
          
        } catch (error) {
          logger.error(`Failed to cleanup transcription ${transcription.id}:`, error);
          errorCount++;
        }
      }
      
      // Also clean up old temporary files
      await this.cleanupTempFiles();
      
      logger.info(`Cleanup completed: ${cleanedCount} files cleaned, ${errorCount} errors`);
      
      return {
        cleanedCount: cleanedCount,
        errorCount: errorCount,
        processedCount: expiredTranscriptions.length
      };
      
    } catch (error) {
      logger.error('Cleanup job failed:', error);
      throw error;
    }
  }
  
  async cleanupTempFiles() {
    try {
      const fs = require('fs').promises;
      const path = require('path');
      
      const tempDir = process.env.TEMP_PATH || './temp';
      const uploadDir = process.env.UPLOAD_PATH || './uploads';
      
      // Clean temp directory of files older than 24 hours
      await this.cleanupDirectory(tempDir, 24 * 60 * 60 * 1000); // 24 hours
      
      // Clean upload directory of files older than 7 days (safety net)
      await this.cleanupDirectory(uploadDir, 7 * 24 * 60 * 60 * 1000); // 7 days
      
    } catch (error) {
      logger.error('Failed to cleanup temporary files:', error);
    }
  }
  
  async cleanupDirectory(dirPath, maxAge) {
    try {
      const fs = require('fs').promises;
      const path = require('path');
      
      const files = await fs.readdir(dirPath);
      const now = Date.now();
      let cleanedFiles = 0;
      
      for (const file of files) {
        try {
          const filePath = path.join(dirPath, file);
          const stats = await fs.stat(filePath);
          
          if (stats.isFile() && (now - stats.mtime.getTime()) > maxAge) {
            await fs.unlink(filePath);
            cleanedFiles++;
            logger.debug(`Deleted old temporary file: ${filePath}`);
          }
        } catch (error) {
          logger.warn(`Failed to cleanup file ${file}:`, error);
        }
      }
      
      if (cleanedFiles > 0) {
        logger.info(`Cleaned up ${cleanedFiles} old files from ${dirPath}`);
      }
      
    } catch (error) {
      logger.error(`Failed to cleanup directory ${dirPath}:`, error);
    }
  }
}

module.exports = new CleanupProcessor();
