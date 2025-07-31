const webhookService = require('../../services/webhookService');
const logger = require('../../utils/logger');

class WebhookProcessor {
  async processWebhook(job) {
    const { userId, event, data } = job.data;
    
    try {
      logger.info(`Processing webhook job for user ${userId}, event: ${event}`);
      
      const results = await webhookService.triggerWebhook(userId, event, data);
      
      const successCount = results.filter(r => r.status === 'fulfilled').length;
      const failureCount = results.filter(r => r.status === 'rejected').length;
      
      logger.info(`Webhook job completed: ${successCount} succeeded, ${failureCount} failed`);
      
      return {
        userId: userId,
        event: event,
        totalWebhooks: results.length,
        successCount: successCount,
        failureCount: failureCount,
        results: results
      };
      
    } catch (error) {
      logger.error(`Webhook job failed for user ${userId}, event ${event}:`, error);
      throw error;
    }
  }
}

module.exports = new WebhookProcessor();
