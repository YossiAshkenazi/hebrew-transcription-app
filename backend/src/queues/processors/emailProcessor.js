const emailService = require('../../services/emailService');
const logger = require('../../utils/logger');

class EmailProcessor {
  async processEmail(job) {
    const { type, data } = job.data;
    
    try {
      logger.info(`Processing email job: ${type}`);
      
      let result;
      
      switch (type) {
        case 'transcription-complete':
          result = await emailService.sendTranscriptionComplete(
            data.to,
            data.transcription,
            data.attachments
          );
          break;
          
        case 'transcription-error':
          result = await emailService.sendTranscriptionError(
            data.to,
            data.transcription,
            data.errorMessage
          );
          break;
          
        default:
          throw new Error(`Unknown email type: ${type}`);
      }
      
      logger.info(`Email sent successfully: ${result.messageId}`);
      
      return {
        messageId: result.messageId,
        type: type,
        recipient: data.to
      };
      
    } catch (error) {
      logger.error(`Email job failed for type ${type}:`, error);
      throw error;
    }
  }
}

module.exports = new EmailProcessor();
