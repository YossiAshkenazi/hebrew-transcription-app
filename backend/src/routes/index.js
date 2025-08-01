const express = require('express');
const router = express.Router();

// Import route modules
const authRoutes = require('./auth');
const transcriptionRoutes = require('./transcriptions');
const userRoutes = require('./users');
const webhookRoutes = require('./webhooks');
const vocabularyRoutes = require('./vocabulary');
const adminRoutes = require('./admin');

/**
 * @swagger
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *   responses:
 *     UnauthorizedError:
 *       description: Access token is missing or invalid
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               success:
 *                 type: boolean
 *                 example: false
 *               error:
 *                 type: string
 *                 example: "Not authorized to access this route"
 *     ValidationError:
 *       description: Validation error
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               success:
 *                 type: boolean
 *                 example: false
 *               error:
 *                 type: string
 *                 example: "Validation failed"
 *               details:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     field:
 *                       type: string
 *                     message:
 *                       type: string
 *     ServerError:
 *       description: Internal server error
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               success:
 *                 type: boolean
 *                 example: false
 *               error:
 *                 type: string
 *                 example: "Server Error"
 */

/**
 * @swagger
 * /:
 *   get:
 *     summary: API health check and version info
 *     tags: [System]
 *     responses:
 *       200:
 *         description: API is running
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
 *                   example: "Hebrew Transcription API v1.0.0"
 *                 version:
 *                   type: string
 *                   example: "1.0.0"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 documentation:
 *                   type: string
 *                   example: "/api/docs"
 */
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Hebrew Transcription API v1.0.0',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    documentation: '/api/docs',
    endpoints: {
      auth: '/api/auth',
      transcriptions: '/api/transcriptions',
      users: '/api/users',
      webhooks: '/api/webhooks',
      vocabulary: '/api/vocabulary',
      admin: '/api/admin'
    }
  });
});

// Mount route modules
router.use('/auth', authRoutes);
router.use('/transcriptions', transcriptionRoutes);
router.use('/users', userRoutes);
router.use('/webhooks', webhookRoutes);
router.use('/vocabulary', vocabularyRoutes);
router.use('/admin', adminRoutes);

module.exports = router;