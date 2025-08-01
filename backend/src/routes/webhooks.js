const express = require('express');
const { body, param, validationResult } = require('express-validator');
const router = express.Router();

const { WebhookConfig } = require('../models');
const { protect } = require('../middleware/auth');
const webhookService = require('../services/webhookService');
const logger = require('../utils/logger');

/**
 * @swagger
 * components:
 *   schemas:
 *     WebhookConfig:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         name:
 *           type: string
 *         url:
 *           type: string
 *           format: uri
 *         method:
 *           type: string
 *           enum: [POST, PUT, PATCH]
 *         headers:
 *           type: object
 *         isActive:
 *           type: boolean
 *         events:
 *           type: array
 *           items:
 *             type: string
 *         retryAttempts:
 *           type: integer
 *         timeout:
 *           type: integer
 *         totalTriggers:
 *           type: integer
 *         totalSuccesses:
 *           type: integer
 *         totalFailures:
 *           type: integer
 *         lastTriggeredAt:
 *           type: string
 *           format: date-time
 *         lastSuccessAt:
 *           type: string
 *           format: date-time
 *         lastFailureAt:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /webhooks:
 *   get:
 *     summary: Get user webhooks
 *     tags: [Webhooks]
 *     security:
 *       - bearerAuth: []
 */
router.get('/', protect, async (req, res, next) => {
  try {
    const webhooks = await WebhookConfig.findAll({
      where: { userId: req.user.id },
      order: [['createdAt', 'DESC']]
    });

    res.json({
      success: true,
      data: {
        webhooks
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /webhooks:
 *   post:
 *     summary: Create new webhook
 *     tags: [Webhooks]
 *     security:
 *       - bearerAuth: []
 */
router.post('/', protect, [
  body('name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Name must be between 1 and 100 characters'),
  body('url')
    .isURL()
    .withMessage('Please provide a valid URL'),
  body('method')
    .optional()
    .isIn(['POST', 'PUT', 'PATCH'])
    .withMessage('Method must be POST, PUT, or PATCH'),
  body('events')
    .optional()
    .isArray()
    .withMessage('Events must be an array'),
  body('headers')
    .optional()
    .isObject()
    .withMessage('Headers must be an object'),
  body('secret')
    .optional()
    .isString()
    .withMessage('Secret must be a string'),
  body('retryAttempts')
    .optional()
    .isInt({ min: 0, max: 10 })
    .withMessage('Retry attempts must be between 0 and 10'),
  body('timeout')
    .optional()
    .isInt({ min: 1000, max: 60000 })
    .withMessage('Timeout must be between 1000 and 60000 milliseconds')
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

    const webhook = await WebhookConfig.create({
      ...req.body,
      userId: req.user.id
    });

    logger.info(`Webhook created: ${webhook.id} by user: ${req.user.email}`);

    res.status(201).json({
      success: true,
      data: {
        webhook
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /webhooks/{id}:
 *   get:
 *     summary: Get webhook by ID
 *     tags: [Webhooks]
 *     security:
 *       - bearerAuth: []
 */
router.get('/:id', protect, [
  param('id').isUUID().withMessage('Invalid webhook ID')
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

    const webhook = await WebhookConfig.findOne({
      where: {
        id: req.params.id,
        userId: req.user.id
      }
    });

    if (!webhook) {
      return res.status(404).json({
        success: false,
        error: 'Webhook not found'
      });
    }

    res.json({
      success: true,
      data: {
        webhook
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /webhooks/{id}:
 *   put:
 *     summary: Update webhook
 *     tags: [Webhooks]
 *     security:
 *       - bearerAuth: []
 */
router.put('/:id', protect, [
  param('id').isUUID().withMessage('Invalid webhook ID'),
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Name must be between 1 and 100 characters'),
  body('url')
    .optional()
    .isURL()
    .withMessage('Please provide a valid URL'),
  body('method')
    .optional()
    .isIn(['POST', 'PUT', 'PATCH'])
    .withMessage('Method must be POST, PUT, or PATCH'),
  body('isActive')
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

    const webhook = await WebhookConfig.findOne({
      where: {
        id: req.params.id,
        userId: req.user.id
      }
    });

    if (!webhook) {
      return res.status(404).json({
        success: false,
        error: 'Webhook not found'
      });
    }

    await webhook.update(req.body);

    logger.info(`Webhook updated: ${webhook.id} by user: ${req.user.email}`);

    res.json({
      success: true,
      data: {
        webhook
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /webhooks/{id}:
 *   delete:
 *     summary: Delete webhook
 *     tags: [Webhooks]
 *     security:
 *       - bearerAuth: []
 */
router.delete('/:id', protect, [
  param('id').isUUID().withMessage('Invalid webhook ID')
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

    const webhook = await WebhookConfig.findOne({
      where: {
        id: req.params.id,
        userId: req.user.id
      }
    });

    if (!webhook) {
      return res.status(404).json({
        success: false,
        error: 'Webhook not found'
      });
    }

    await webhook.destroy();

    logger.info(`Webhook deleted: ${webhook.id} by user: ${req.user.email}`);

    res.json({
      success: true,
      message: 'Webhook deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /webhooks/{id}/test:
 *   post:
 *     summary: Test webhook
 *     tags: [Webhooks]
 *     security:
 *       - bearerAuth: []
 */
router.post('/:id/test', protect, [
  param('id').isUUID().withMessage('Invalid webhook ID')
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

    const webhook = await WebhookConfig.findOne({
      where: {
        id: req.params.id,
        userId: req.user.id
      }
    });

    if (!webhook) {
      return res.status(404).json({
        success: false,
        error: 'Webhook not found'
      });
    }

    const result = await webhookService.testWebhook(webhook);

    logger.info(`Webhook test: ${webhook.id} by user: ${req.user.email}, result: ${result.success}`);

    res.json({
      success: true,
      data: {
        testResult: result
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /webhooks/stats:
 *   get:
 *     summary: Get webhook statistics
 *     tags: [Webhooks]
 *     security:
 *       - bearerAuth: []
 */
router.get('/stats', protect, async (req, res, next) => {
  try {
    const stats = await webhookService.getWebhookStats(req.user.id);

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

module.exports = router;