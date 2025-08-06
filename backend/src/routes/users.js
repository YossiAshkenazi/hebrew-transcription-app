const express = require('express');
const { body, validationResult } = require('express-validator');
const router = express.Router();

const { User } = require('../models');
const { protect } = require('../middleware/auth');
const logger = require('../utils/logger');

/**
 * @swagger
 * /users/profile:
 *   get:
 *     summary: Get user profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile
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
 *                     user:
 *                       $ref: '#/components/schemas/User'
 */
router.get('/profile', protect, async (req, res) => {
  res.json({
    success: true,
    data: {
      user: req.user.toJSON()
    }
  });
});

/**
 * @swagger
 * /users/profile:
 *   put:
 *     summary: Update user profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName:
 *                 type: string
 *                 example: John
 *               lastName:
 *                 type: string
 *                 example: Doe
 *               email:
 *                 type: string
 *                 format: email
 *                 example: john@example.com
 */
router.put('/profile', protect, [
  body('firstName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters'),
  body('lastName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2 and 50 characters'),
  body('email')
    .optional()
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email')
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

    const { firstName, lastName, email } = req.body;
    const user = req.user;

    // Check if email is being changed and if it's already taken
    if (email && email !== user.email) {
      const existingUser = await User.findOne({ where: { email } });
      if (existingUser) {
        return res.status(409).json({
          success: false,
          error: 'Email already in use'
        });
      }
      user.email = email;
      user.emailVerified = false; // Require re-verification
    }

    if (firstName) {user.firstName = firstName;}
    if (lastName) {user.lastName = lastName;}

    await user.save();

    logger.info(`User profile updated: ${user.email}`);

    res.json({
      success: true,
      data: {
        user: user.toJSON()
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /users/settings:
 *   get:
 *     summary: Get user settings
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 */
router.get('/settings', protect, async (req, res) => {
  res.json({
    success: true,
    data: {
      settings: req.user.settings || {}
    }
  });
});

/**
 * @swagger
 * /users/settings:
 *   put:
 *     summary: Update user settings
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 */
router.put('/settings', protect, [
  body('settings')
    .isObject()
    .withMessage('Settings must be an object')
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

    const { settings } = req.body;
    const user = req.user;

    // Merge with existing settings
    user.settings = { ...user.settings, ...settings };
    await user.save();

    logger.info(`User settings updated: ${user.email}`);

    res.json({
      success: true,
      data: {
        settings: user.settings
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;