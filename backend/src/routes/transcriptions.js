const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const { Transcription, User } = require('../models');
const { protect, optional } = require('../middleware/auth');
const { upload, handleUploadError } = require('../middleware/upload');
const transcriptionService = require('../services/transcriptionService');
const s3Service = require('../services/s3Service');
const { transcriptionQueue } = require('../queues');
const logger = require('../utils/logger');

// Rate limiting for upload endpoints
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit each IP to 10 uploads per hour
  message: {
    success: false,
    error: 'Upload limit exceeded. Maximum 10 uploads per hour.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * @swagger
 * components:
 *   schemas:
 *     Transcription:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         originalFilename:
 *           type: string
 *         fileSize:
 *           type: integer
 *         mimeType:
 *           type: string
 *         duration:
 *           type: number
 *         status:
 *           type: string
 *           enum: [pending, processing, completed, failed, cancelled]
 *         transcriptionText:
 *           type: string
 *         speakerLabels:
 *           type: array
 *           items:
 *             type: object
 *         confidence:
 *           type: number
 *           minimum: 0
 *           maximum: 1
 *         lowConfidenceWords:
 *           type: array
 *           items:
 *             type: object
 *         language:
 *           type: string
 *         processingTime:
 *           type: integer
 *         errorMessage:
 *           type: string
 *         metadata:
 *           type: object
 *         deliveryEmail:
 *           type: string
 *           format: email
 *         emailSent:
 *           type: boolean
 *         emailSentAt:
 *           type: string
 *           format: date-time
 *         webhookSent:
 *           type: boolean
 *         webhookSentAt:
 *           type: string
 *           format: date-time
 *         expiresAt:
 *           type: string
 *           format: date-time
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     TranscriptionQuote:
 *       type: object
 *       properties:
 *         estimatedCost:
 *           type: number
 *         estimatedTimeSeconds:
 *           type: integer
 *         durationMinutes:
 *           type: integer
 *         currency:
 *           type: string
 */

/**
 * @swagger
 * /transcriptions:
 *   get:
 *     summary: Get user's transcriptions
 *     tags: [Transcriptions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, processing, completed, failed, cancelled]
 *         description: Filter by status
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Number of items to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *         description: Number of items to skip
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [createdAt, updatedAt, originalFilename, status]
 *           default: createdAt
 *         description: Sort field
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [ASC, DESC]
 *           default: DESC
 *         description: Sort order
 *     responses:
 *       200:
 *         description: List of transcriptions
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
 *                     transcriptions:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Transcription'
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         total:
 *                           type: integer
 *                         limit:
 *                           type: integer
 *                         offset:
 *                           type: integer
 *                         hasMore:
 *                           type: boolean
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get('/', protect, [
  query('status')
    .optional()
    .isIn(['pending', 'processing', 'completed', 'failed', 'cancelled'])
    .withMessage('Invalid status filter'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('offset')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Offset must be a non-negative integer'),
  query('sortBy')
    .optional()
    .isIn(['createdAt', 'updatedAt', 'originalFilename', 'status'])
    .withMessage('Invalid sort field'),
  query('sortOrder')
    .optional()
    .isIn(['ASC', 'DESC'])
    .withMessage('Sort order must be ASC or DESC')
], async (req, res, next) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const {
      status,
      limit = 20,
      offset = 0,
      sortBy = 'createdAt',
      sortOrder = 'DESC'
    } = req.query;

    // Build where clause
    const where = { userId: req.user.id };
    if (status) {
      where.status = status;
    }

    // Get transcriptions with pagination
    const { count, rows: transcriptions } = await Transcription.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [[sortBy, sortOrder]],
      attributes: { exclude: ['s3Key'] } // Don't expose S3 key
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
 * /transcriptions/{id}:
 *   get:
 *     summary: Get transcription by ID
 *     tags: [Transcriptions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Transcription ID
 *     responses:
 *       200:
 *         description: Transcription details
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
 *                     transcription:
 *                       $ref: '#/components/schemas/Transcription'
 *       404:
 *         description: Transcription not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Transcription not found"
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get('/:id', protect, [
  param('id')
    .isUUID()
    .withMessage('Invalid transcription ID')
], async (req, res, next) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const transcription = await Transcription.findOne({
      where: {
        id: req.params.id,
        userId: req.user.id
      },
      attributes: { exclude: ['s3Key'] } // Don't expose S3 key
    });

    if (!transcription) {
      return res.status(404).json({
        success: false,
        error: 'Transcription not found'
      });
    }

    res.json({
      success: true,
      data: {
        transcription
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /transcriptions/upload:
 *   post:
 *     summary: Upload audio file for transcription
 *     tags: [Transcriptions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - audio
 *             properties:
 *               audio:
 *                 type: string
 *                 format: binary
 *                 description: Audio file (MP3, WAV, M4A, AAC, FLAC)
 *               deliveryEmail:
 *                 type: string
 *                 format: email
 *                 description: Email to send results (optional for authenticated users)
 *               language:
 *                 type: string
 *                 default: he-IL
 *                 description: Audio language
 *               enableSpeakerDetection:
 *                 type: boolean
 *                 default: true
 *                 description: Enable speaker detection
 *     responses:
 *       201:
 *         description: File uploaded successfully
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
 *                     transcription:
 *                       $ref: '#/components/schemas/Transcription'
 *                     quote:
 *                       $ref: '#/components/schemas/TranscriptionQuote'
 *       400:
 *         description: Invalid file or validation error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "File too large. Maximum size is 100MB"
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.post('/upload', uploadLimiter, protect, upload, handleUploadError, [
  body('deliveryEmail')
    .optional()
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('language')
    .optional()
    .isLength({ min: 2, max: 10 })
    .withMessage('Invalid language code'),
  body('enableSpeakerDetection')
    .optional()
    .isBoolean()
    .withMessage('EnableSpeakerDetection must be a boolean')
], async (req, res, next) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No audio file provided'
      });
    }

    const {
      deliveryEmail,
      language = 'he-IL',
      enableSpeakerDetection = true
    } = req.body;

    // Get audio duration for validation and pricing
    const duration = await transcriptionService.getAudioDuration(req.file.path);
    
    // Get processing quote
    const quote = await transcriptionService.getTranscriptionQuote(duration);

    // Upload file to S3
    const s3Key = await s3Service.uploadFile(req.file.path, req.file.filename);

    // Calculate expiration date (30 days from now, or user's setting)
    const userSettings = req.user.settings || {};
    const autoDeleteDays = userSettings.transcription?.autoDelete || 30;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + autoDeleteDays);

    // Create transcription record
    const transcription = await Transcription.create({
      userId: req.user.id,
      originalFilename: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      duration: duration,
      s3Key: s3Key,
      status: 'pending',
      language: language,
      deliveryEmail: deliveryEmail || req.user.email,
      expiresAt: expiresAt,
      metadata: {
        enableSpeakerDetection: enableSpeakerDetection,
        uploadedFrom: req.ip,
        userAgent: req.get('User-Agent')
      }
    });

    // Add job to transcription queue
    await transcriptionQueue.add('transcribe-audio', {
      transcriptionId: transcription.id,
      userId: req.user.id,
      s3Key: s3Key,
      options: {
        language: language,
        enableSpeakerDetection: enableSpeakerDetection
      }
    }, {
      delay: 1000, // Small delay to ensure database consistency
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      }
    });

    logger.info(`Transcription job queued: ${transcription.id} for user: ${req.user.email}`);

    // Clean up temporary file
    try {
      const fs = require('fs').promises;
      await fs.unlink(req.file.path);
    } catch (cleanupError) {
      logger.warn('Failed to cleanup temp file:', cleanupError);
    }

    res.status(201).json({
      success: true,
      data: {
        transcription: {
          ...transcription.toJSON(),
          s3Key: undefined // Don't expose S3 key
        },
        quote
      }
    });
  } catch (error) {
    // Clean up temp file on error
    if (req.file) {
      try {
        const fs = require('fs').promises;
        await fs.unlink(req.file.path);
      } catch (cleanupError) {
        logger.warn('Failed to cleanup temp file on error:', cleanupError);
      }
    }
    next(error);
  }
});

/**
 * @swagger
 * /transcriptions/upload/anonymous:
 *   post:
 *     summary: Upload audio file for transcription (anonymous)
 *     tags: [Transcriptions]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - audio
 *               - deliveryEmail
 *             properties:
 *               audio:
 *                 type: string
 *                 format: binary
 *                 description: Audio file (MP3, WAV, M4A, AAC, FLAC)
 *               deliveryEmail:
 *                 type: string
 *                 format: email
 *                 description: Email to send results
 *               language:
 *                 type: string
 *                 default: he-IL
 *                 description: Audio language
 *               enableSpeakerDetection:
 *                 type: boolean
 *                 default: true
 *                 description: Enable speaker detection
 *     responses:
 *       201:
 *         description: File uploaded successfully
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
 *                     transcriptionId:
 *                       type: string
 *                       format: uuid
 *                     quote:
 *                       $ref: '#/components/schemas/TranscriptionQuote'
 *                     message:
 *                       type: string
 *                       example: "Transcription started. Results will be sent to your email."
 *       400:
 *         description: Invalid file or validation error
 */
router.post('/upload/anonymous', uploadLimiter, upload, handleUploadError, [
  body('deliveryEmail')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('language')
    .optional()
    .isLength({ min: 2, max: 10 })
    .withMessage('Invalid language code'),
  body('enableSpeakerDetection')
    .optional()
    .isBoolean()
    .withMessage('EnableSpeakerDetection must be a boolean')
], async (req, res, next) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No audio file provided'
      });
    }

    const {
      deliveryEmail,
      language = 'he-IL',
      enableSpeakerDetection = true
    } = req.body;

    // Get audio duration for validation and pricing
    const duration = await transcriptionService.getAudioDuration(req.file.path);
    
    // Get processing quote
    const quote = await transcriptionService.getTranscriptionQuote(duration);

    // Upload file to S3
    const s3Key = await s3Service.uploadFile(req.file.path, req.file.filename);

    // Set expiration date (7 days for anonymous uploads)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // Create transcription record (without userId for anonymous)
    const transcription = await Transcription.create({
      userId: null,
      originalFilename: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      duration: duration,
      s3Key: s3Key,
      status: 'pending',
      language: language,
      deliveryEmail: deliveryEmail,
      expiresAt: expiresAt,
      metadata: {
        enableSpeakerDetection: enableSpeakerDetection,
        uploadedFrom: req.ip,
        userAgent: req.get('User-Agent'),
        anonymous: true
      }
    });

    // Add job to transcription queue
    await transcriptionQueue.add('transcribe-audio', {
      transcriptionId: transcription.id,
      userId: null,
      s3Key: s3Key,
      options: {
        language: language,
        enableSpeakerDetection: enableSpeakerDetection
      }
    }, {
      delay: 1000, // Small delay to ensure database consistency
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      }
    });

    logger.info(`Anonymous transcription job queued: ${transcription.id} for email: ${deliveryEmail}`);

    // Clean up temporary file
    try {
      const fs = require('fs').promises;
      await fs.unlink(req.file.path);
    } catch (cleanupError) {
      logger.warn('Failed to cleanup temp file:', cleanupError);
    }

    res.status(201).json({
      success: true,
      data: {
        transcriptionId: transcription.id,
        quote,
        message: 'Transcription started. Results will be sent to your email.'
      }
    });
  } catch (error) {
    // Clean up temp file on error
    if (req.file) {
      try {
        const fs = require('fs').promises;
        await fs.unlink(req.file.path);
      } catch (cleanupError) {
        logger.warn('Failed to cleanup temp file on error:', cleanupError);
      }
    }
    next(error);
  }
});

/**
 * @swagger
 * /transcriptions/{id}/cancel:
 *   post:
 *     summary: Cancel a pending transcription
 *     tags: [Transcriptions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Transcription ID
 *     responses:
 *       200:
 *         description: Transcription cancelled successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Transcription cancelled successfully"
 *       400:
 *         description: Cannot cancel transcription
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Cannot cancel transcription in current status"
 *       404:
 *         description: Transcription not found
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.post('/:id/cancel', protect, [
  param('id')
    .isUUID()
    .withMessage('Invalid transcription ID')
], async (req, res, next) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const transcription = await Transcription.findOne({
      where: {
        id: req.params.id,
        userId: req.user.id
      }
    });

    if (!transcription) {
      return res.status(404).json({
        success: false,
        error: 'Transcription not found'
      });
    }

    // Check if transcription can be cancelled
    if (!['pending', 'processing'].includes(transcription.status)) {
      return res.status(400).json({
        success: false,
        error: 'Cannot cancel transcription in current status'
      });
    }

    // Update status to cancelled
    transcription.status = 'cancelled';
    await transcription.save();

    // TODO: Cancel the job in the queue if it hasn't started processing

    logger.info(`Transcription cancelled: ${transcription.id} by user: ${req.user.email}`);

    res.json({
      success: true,
      message: 'Transcription cancelled successfully'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /transcriptions/{id}:
 *   delete:
 *     summary: Delete a completed transcription
 *     tags: [Transcriptions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Transcription ID
 *     responses:
 *       200:
 *         description: Transcription deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Transcription deleted successfully"
 *       400:
 *         description: Cannot delete transcription
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Cannot delete transcription in current status"
 *       404:
 *         description: Transcription not found
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.delete('/:id', protect, [
  param('id')
    .isUUID()
    .withMessage('Invalid transcription ID')
], async (req, res, next) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const transcription = await Transcription.findOne({
      where: {
        id: req.params.id,
        userId: req.user.id
      }
    });

    if (!transcription) {
      return res.status(404).json({
        success: false,
        error: 'Transcription not found'
      });
    }

    // Check if transcription can be deleted
    if (['processing'].includes(transcription.status)) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete transcription while processing'
      });
    }

    // Delete file from S3
    try {
      await s3Service.deleteFile(transcription.s3Key);
    } catch (s3Error) {
      logger.warn(`Failed to delete S3 file ${transcription.s3Key}:`, s3Error);
    }

    // Delete transcription record
    await transcription.destroy();

    logger.info(`Transcription deleted: ${transcription.id} by user: ${req.user.email}`);

    res.json({
      success: true,
      message: 'Transcription deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /transcriptions/quote:
 *   post:
 *     summary: Get transcription quote without uploading
 *     tags: [Transcriptions]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - duration
 *             properties:
 *               duration:
 *                 type: number
 *                 description: Audio duration in seconds
 *     responses:
 *       200:
 *         description: Transcription quote
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
 *                     quote:
 *                       $ref: '#/components/schemas/TranscriptionQuote'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 */
router.post('/quote', [
  body('duration')
    .isFloat({ min: 0.1 })
    .withMessage('Duration must be a positive number')
], async (req, res, next) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { duration } = req.body;

    // Get processing quote
    const quote = await transcriptionService.getTranscriptionQuote(duration);

    res.json({
      success: true,
      data: {
        quote
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;