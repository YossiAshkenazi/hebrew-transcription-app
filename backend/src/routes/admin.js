const express = require('express');
const { query, validationResult } = require('express-validator');
const router = express.Router();

const { User, Transcription, WebhookConfig, CustomVocabulary } = require('../models');
const { protect } = require('../middleware/auth');
const { transcriptionQueue, emailQueue, webhookQueue, cleanupQueue } = require('../queues');
const logger = require('../utils/logger');

// Middleware to check if user is admin (you'd implement proper admin checking)
const requireAdmin = async (req, res, next) => {
  // For now, just check if user exists and is active
  // In a real implementation, you'd check for admin role
  if (!req.user || !req.user.isActive) {
    return res.status(403).json({
      success: false,
      error: 'Admin access required'
    });
  }
  
  // TODO: Implement proper admin role checking
  // if (!req.user.isAdmin) {
  //   return res.status(403).json({
  //     success: false,
  //     error: 'Admin access required'
  //   });
  // }
  
  next();
};

/**
 * @swagger
 * /admin/stats:
 *   get:
 *     summary: Get system statistics
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: System statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     stats:
 *                       type: object
 */
router.get('/stats', protect, requireAdmin, async (req, res, next) => {
  try {
    // Get user statistics
    const userStats = await User.findAndCountAll({
      attributes: ['isActive', 'emailVerified'],
      group: ['isActive', 'emailVerified']
    });

    // Get transcription statistics
    const transcriptionStats = await Transcription.findAndCountAll({
      attributes: ['status'],
      group: ['status']
    });

    // Get webhook statistics
    const webhookStats = await WebhookConfig.findAndCountAll({
      attributes: ['isActive'],
      group: ['isActive']
    });

    // Get vocabulary statistics
    const vocabularyStats = await CustomVocabulary.findAndCountAll({
      attributes: ['category', 'isGlobal'],
      group: ['category', 'isGlobal']
    });

    // Get queue statistics
    const queueStats = {
      transcription: {
        waiting: await transcriptionQueue.getWaiting().then(jobs => jobs.length),
        active: await transcriptionQueue.getActive().then(jobs => jobs.length),
        completed: await transcriptionQueue.getCompleted().then(jobs => jobs.length),
        failed: await transcriptionQueue.getFailed().then(jobs => jobs.length)
      },
      email: {
        waiting: await emailQueue.getWaiting().then(jobs => jobs.length),
        active: await emailQueue.getActive().then(jobs => jobs.length),
        completed: await emailQueue.getCompleted().then(jobs => jobs.length),
        failed: await emailQueue.getFailed().then(jobs => jobs.length)
      },
      webhook: {
        waiting: await webhookQueue.getWaiting().then(jobs => jobs.length),
        active: await webhookQueue.getActive().then(jobs => jobs.length),
        completed: await webhookQueue.getCompleted().then(jobs => jobs.length),
        failed: await webhookQueue.getFailed().then(jobs => jobs.length)
      },
      cleanup: {
        waiting: await cleanupQueue.getWaiting().then(jobs => jobs.length),
        active: await cleanupQueue.getActive().then(jobs => jobs.length),
        completed: await cleanupQueue.getCompleted().then(jobs => jobs.length),
        failed: await cleanupQueue.getFailed().then(jobs => jobs.length)
      }
    };

    const stats = {
      users: {
        total: await User.count(),
        active: await User.count({ where: { isActive: true } }),
        verified: await User.count({ where: { emailVerified: true } })
      },
      transcriptions: {
        total: await Transcription.count(),
        pending: await Transcription.count({ where: { status: 'pending' } }),
        processing: await Transcription.count({ where: { status: 'processing' } }),
        completed: await Transcription.count({ where: { status: 'completed' } }),
        failed: await Transcription.count({ where: { status: 'failed' } })
      },
      webhooks: {
        total: await WebhookConfig.count(),
        active: await WebhookConfig.count({ where: { isActive: true } })
      },
      vocabulary: {
        total: await CustomVocabulary.count(),
        global: await CustomVocabulary.count({ where: { isGlobal: true } }),
        byCategory: vocabularyStats.count
      },
      queues: queueStats
    };

    res.json({
      success: true,
      data: {
        stats
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /admin/queues:
 *   get:
 *     summary: Get detailed queue information
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get('/queues', protect, requireAdmin, [
  query('queue')
    .optional()
    .isIn(['transcription', 'email', 'webhook', 'cleanup'])
    .withMessage('Invalid queue name'),
  query('status')
    .optional()
    .isIn(['waiting', 'active', 'completed', 'failed'])
    .withMessage('Invalid status'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100')
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { queue, status, limit = 20 } = req.query;
    
    const queues = {
      transcription: transcriptionQueue,
      email: emailQueue,
      webhook: webhookQueue,
      cleanup: cleanupQueue
    };

    const result = {};

    const queuesToCheck = queue ? [queue] : Object.keys(queues);

    for (const queueName of queuesToCheck) {
      const queueInstance = queues[queueName];
      
      if (status) {
        const jobs = await queueInstance[`get${status.charAt(0).toUpperCase() + status.slice(1)}`]();
        result[queueName] = {
          [status]: jobs.slice(0, parseInt(limit)).map(job => ({
            id: job.id,
            data: job.data,
            progress: job.progress,
            processedOn: job.processedOn,
            finishedOn: job.finishedOn,
            failedReason: job.failedReason,
            attempts: job.attemptsMade,
            opts: job.opts
          }))
        };
      } else {
        const [waiting, active, completed, failed] = await Promise.all([
          queueInstance.getWaiting(),
          queueInstance.getActive(),
          queueInstance.getCompleted(),
          queueInstance.getFailed()
        ]);

        result[queueName] = {
          waiting: waiting.slice(0, parseInt(limit)).map(job => ({
            id: job.id,
            data: job.data,
            opts: job.opts
          })),
          active: active.slice(0, parseInt(limit)).map(job => ({
            id: job.id,
            data: job.data,
            progress: job.progress,
            processedOn: job.processedOn
          })),
          completed: completed.slice(0, parseInt(limit)).map(job => ({
            id: job.id,
            data: job.data,
            finishedOn: job.finishedOn,
            returnvalue: job.returnvalue
          })),
          failed: failed.slice(0, parseInt(limit)).map(job => ({
            id: job.id,
            data: job.data,
            failedReason: job.failedReason,
            attempts: job.attemptsMade
          }))
        };
      }
    }

    res.json({
      success: true,
      data: {
        queues: result
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /admin/users:
 *   get:
 *     summary: Get users list for admin
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get('/users', protect, requireAdmin, [
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('offset')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Offset must be a non-negative integer'),
  query('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean')
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { limit = 20, offset = 0, isActive } = req.query;
    
    const where = {};
    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    }

    const { count, rows: users } = await User.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']],
      include: [
        {
          model: Transcription,
          attributes: ['id', 'status', 'createdAt'],
          limit: 5,
          order: [['createdAt', 'DESC']]
        }
      ]
    });

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          total: count,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: (parseInt(offset) + parseInt(limit)) < count
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /admin/transcriptions:
 *   get:
 *     summary: Get all transcriptions for admin
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get('/transcriptions', protect, requireAdmin, [
  query('status')
    .optional()
    .isIn(['pending', 'processing', 'completed', 'failed', 'cancelled'])
    .withMessage('Invalid status'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('offset')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Offset must be a non-negative integer')
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { status, limit = 20, offset = 0 } = req.query;
    
    const where = {};
    if (status) {
      where.status = status;
    }

    const { count, rows: transcriptions } = await Transcription.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']],
      include: [
        {
          model: User,
          attributes: ['id', 'email', 'firstName', 'lastName']
        }
      ],
      attributes: { exclude: ['s3Key'] } // Don't expose S3 keys to admin either
    });

    res.json({
      success: true,
      data: {
        transcriptions,
        pagination: {
          total: count,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: (parseInt(offset) + parseInt(limit)) < count
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /admin/cleanup:
 *   post:
 *     summary: Trigger cleanup job
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.post('/cleanup', protect, requireAdmin, async (req, res, next) => {
  try {
    // Add cleanup job to queue
    const job = await cleanupQueue.add('cleanup-expired-files', {
      triggeredBy: req.user.id,
      triggeredAt: new Date().toISOString()
    });

    logger.info(`Manual cleanup job triggered by admin: ${req.user.email}`);

    res.json({
      success: true,
      data: {
        jobId: job.id,
        message: 'Cleanup job queued successfully'
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /admin/health:
 *   get:
 *     summary: Get detailed system health
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get('/health', protect, requireAdmin, async (req, res, next) => {
  try {
    const health = {
      database: 'unknown',
      redis: 'unknown',
      queues: {},
      storage: 'unknown'
    };

    // Check database connection
    try {
      await User.findOne({ limit: 1 });
      health.database = 'healthy';
    } catch (error) {
      health.database = 'unhealthy';
      logger.error('Database health check failed:', error);
    }

    // Check Redis connection (through queues)
    try {
      await transcriptionQueue.isReady();
      health.redis = 'healthy';
    } catch (error) {
      health.redis = 'unhealthy';
      logger.error('Redis health check failed:', error);
    }

    // Check queue health
    const queues = { transcriptionQueue, emailQueue, webhookQueue, cleanupQueue };
    for (const [name, queue] of Object.entries(queues)) {
      try {
        await queue.isReady();
        health.queues[name] = 'healthy';
      } catch (error) {
        health.queues[name] = 'unhealthy';
        logger.error(`${name} health check failed:`, error);
      }
    }

    // Overall health status
    const allHealthy = health.database === 'healthy' && 
                      health.redis === 'healthy' && 
                      Object.values(health.queues).every(status => status === 'healthy');

    res.json({
      success: true,
      data: {
        status: allHealthy ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        components: health
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;