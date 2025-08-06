const { Transcription } = require('../../models');
const transcriptionService = require('../../services/transcriptionService');
const s3Service = require('../../services/s3Service');
const { addEmailJob, addWebhookJob } = require('../index');
const logger = require('../../utils/logger');
const path = require('path');
const fs = require('fs').promises;

class TranscriptionProcessor {
  async processTranscription(job) {
    const { transcriptionId, filePath } = job.data;
    let tempDownloadPath = null;
    
    try {
      logger.info(`Starting transcription job for ID: ${transcriptionId}`);
      
      // Update job progress
      await job.progress(10);
      
      // Get transcription record
      const transcription = await Transcription.findByPk(transcriptionId);
      if (!transcription) {
        throw new Error(`Transcription record not found: ${transcriptionId}`);
      }
      
      // Update status to processing
      await transcription.update({ status: 'processing' });
      await job.progress(20);
      
      // Download file from S3 if needed
      let audioFilePath = filePath;
      if (transcription.s3Key && !filePath) {
        const tempDir = process.env.TEMP_PATH || './temp';
        tempDownloadPath = path.join(tempDir, `download_${transcriptionId}_${Date.now()}.audio`);
        audioFilePath = await s3Service.downloadAudioFile(transcription.s3Key, tempDownloadPath);
        logger.info(`Downloaded audio file from S3: ${transcription.s3Key}`);
      }
      
      await job.progress(30);
      
      // Check if file exists
      try {
        await fs.access(audioFilePath);
      } catch (error) {
        throw new Error(`Audio file not found: ${audioFilePath}`);
      }
      
      // Perform transcription
      logger.info(`Starting transcription for file: ${audioFilePath}`);
      const result = await transcriptionService.transcribeAudio(audioFilePath, {
        userId: transcription.userId,
        language: transcription.language
      });
      
      await job.progress(80);
      
      // Update transcription record with results
      await transcription.update({
        status: 'completed',
        transcriptionText: result.text,
        speakerLabels: result.speakerLabels,
        confidence: result.confidence,
        lowConfidenceWords: result.lowConfidenceWords,
        duration: result.duration,
        processingTime: result.processingTime,
        metadata: result.metadata
      });
      
      await job.progress(90);
      
      // Send email notification if email is provided
      if (transcription.deliveryEmail) {
        await addEmailJob('transcription-complete', {
          to: transcription.deliveryEmail,
          transcription: transcription.toJSON()
        });
        
        await transcription.update({ emailSent: true, emailSentAt: new Date() });
      }
      
      // Send webhook notification if user has webhooks configured
      if (transcription.userId) {
        await addWebhookJob(transcription.userId, 'transcription.completed', {
          transcriptionId: transcription.id,
          result: {
            text: result.text,
            confidence: result.confidence,
            duration: result.duration,
            speakerLabels: result.speakerLabels
          }
        });
        
        await transcription.update({ webhookSent: true, webhookSentAt: new Date() });
      }
      
      await job.progress(100);
      
      logger.info(`Transcription completed successfully for ID: ${transcriptionId}`);
      
      return {
        transcriptionId: transcriptionId,
        status: 'completed',
        duration: result.duration,
        confidence: result.confidence,
        processingTime: result.processingTime
      };
      
    } catch (error) {
      logger.error(`Transcription job failed for ID: ${transcriptionId}`, error);
      
      try {
        // Update transcription record with error
        const transcription = await Transcription.findByPk(transcriptionId);
        if (transcription) {
          await transcription.update({
            status: 'failed',
            errorMessage: error.message
          });
          
          // Send error email notification if email is provided
          if (transcription.deliveryEmail) {
            await addEmailJob('transcription-error', {
              to: transcription.deliveryEmail,
              transcription: transcription.toJSON(),
              errorMessage: error.message
            });
          }
          
          // Send webhook notification for failure
          if (transcription.userId) {
            await addWebhookJob(transcription.userId, 'transcription.failed', {
              transcriptionId: transcription.id,
              error: {
                message: error.message,
                timestamp: new Date().toISOString()
              }
            });
          }
        }
      } catch (updateError) {
        logger.error('Failed to update transcription record after error:', updateError);
      }
      
      throw error;
    } finally {
      // Cleanup temporary files
      if (tempDownloadPath) {
        try {
          await fs.unlink(tempDownloadPath);
          logger.info(`Cleaned up temporary file: ${tempDownloadPath}`);
        } catch (cleanupError) {
          logger.warn(`Failed to cleanup temporary file: ${tempDownloadPath}`, cleanupError);
        }
      }
    }
  }
}

module.exports = new TranscriptionProcessor();
