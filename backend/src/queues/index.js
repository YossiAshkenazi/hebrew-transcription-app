const Queue = require('bull');
const { getRedisClient } = require('../config/redis');
const logger = require('../utils/logger');

// Import job processors
const transcriptionProcessor = require('./processors/transcriptionProcessor');
const emailProcessor = require('./processors/emailProcessor');
const webhookProcessor = require('./processors/webhookProcessor');
const cleanupProcessor = require('./processors/cleanupProcessor');

let transcriptionQueue;
let emailQueue;
let webhookQueue;
let cleanupQueue;

const initializeQueues = async () => {
  try {
    const redisConfig = {
      redis: {
        port: 6379,
        host: process.env.REDIS_URL ? new URL(process.env.REDIS_URL).hostname : 'localhost',
        password: process.env.REDIS_URL ? new URL(process.env.REDIS_URL).password : undefined
      }
    };

    // Initialize queues
    transcriptionQueue = new Queue('transcription processing', redisConfig);
    emailQueue = new Queue('email delivery', redisConfig);
    webhookQueue = new Queue('webhook delivery', redisConfig);
    cleanupQueue = new Queue('file cleanup', redisConfig);

    // Configure queue processors
    transcriptionQueue.process('transcribe-audio', 5, transcriptionProcessor.processTranscription);
    emailQueue.process('send-email', 10, emailProcessor.processEmail);
    webhookQueue.process('send-webhook', 10, webhookProcessor.processWebhook);
    cleanupQueue.process('cleanup-files', 1, cleanupProcessor.processCleanup);

    // Queue event handlers
    setupQueueEventHandlers(transcriptionQueue, 'Transcription');
    setupQueueEventHandlers(emailQueue, 'Email');
    setupQueueEventHandlers(webhookQueue, 'Webhook');
    setupQueueEventHandlers(cleanupQueue, 'Cleanup');

    // Schedule recurring cleanup job
    await cleanupQueue.add('cleanup-files', {}, {
      repeat: { cron: '0 2 * * *' }, // Run daily at 2 AM
      removeOnComplete: 5,
      removeOnFail: 10
    });

    logger.info('Job queues initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize queues:', error);
    throw error;
  }
};

const setupQueueEventHandlers = (queue, queueName) => {
  queue.on('completed', (job, result) => {
    logger.info(`${queueName} job ${job.id} completed:`, result);
  });

  queue.on('failed', (job, err) => {
    logger.error(`${queueName} job ${job.id} failed:`, err);
  });

  queue.on('stalled', (job) => {
    logger.warn(`${queueName} job ${job.id} stalled`);
  });

  queue.on('progress', (job, progress) => {
    logger.debug(`${queueName} job ${job.id} progress: ${progress}%`);
  });
};

// Job creation helpers
const addTranscriptionJob = async (transcriptionId, filePath, options = {}) => {
  try {
    const job = await transcriptionQueue.add('transcribe-audio', {
      transcriptionId,
      filePath,
      ...options
    }, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 10000 // Start with 10 second delay
      },
      removeOnComplete: 10,
      removeOnFail: 10,
      timeout: parseInt(process.env.TRANSCRIPTION_TIMEOUT_MS) || 600000 // 10 minutes
    });

    logger.info(`Transcription job ${job.id} added for transcription ${transcriptionId}`);
    return job;
  } catch (error) {
    logger.error('Failed to add transcription job:', error);
    throw error;
  }
};

const addEmailJob = async (type, data, options = {}) => {
  try {
    const job = await emailQueue.add('send-email', {
      type,
      data,
      ...options
    }, {
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 5000
      },
      removeOnComplete: 20,
      removeOnFail: 50
    });

    logger.info(`Email job ${job.id} added for type ${type}`);
    return job;
  } catch (error) {
    logger.error('Failed to add email job:', error);
    throw error;
  }
};

const addWebhookJob = async (userId, event, data, options = {}) => {
  try {
    const job = await webhookQueue.add('send-webhook', {
      userId,
      event,
      data,
      ...options
    }, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      },
      removeOnComplete: 50,
      removeOnFail: 100
    });

    logger.info(`Webhook job ${job.id} added for user ${userId} and event ${event}`);
    return job;
  } catch (error) {
    logger.error('Failed to add webhook job:', error);
    throw error;
  }
};

const getQueueStats = async () => {
  try {
    const stats = {
      transcription: await getQueueStatus(transcriptionQueue),
      email: await getQueueStatus(emailQueue),
      webhook: await getQueueStatus(webhookQueue),
      cleanup: await getQueueStatus(cleanupQueue)
    };

    return stats;
  } catch (error) {
    logger.error('Error getting queue stats:', error);
    throw error;
  }
};

const getQueueStatus = async (queue) => {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaiting(),
    queue.getActive(),
    queue.getCompleted(),
    queue.getFailed(),
    queue.getDelayed()
  ]);

  return {
    waiting: waiting.length,
    active: active.length,
    completed: completed.length,
    failed: failed.length,
    delayed: delayed.length
  };
};

module.exports = {
  initializeQueues,
  addTranscriptionJob,
  addEmailJob,
  addWebhookJob,
  getQueueStats,
  // Export queue instances for direct access if needed
  getTranscriptionQueue: () => transcriptionQueue,
  getEmailQueue: () => emailQueue,
  getWebhookQueue: () => webhookQueue,
  getCleanupQueue: () => cleanupQueue
};
