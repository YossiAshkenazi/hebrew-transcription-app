const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const router = express.Router();

const { CustomVocabulary } = require('../models');
const { protect } = require('../middleware/auth');
const logger = require('../utils/logger');

/**
 * @swagger
 * components:
 *   schemas:
 *     CustomVocabulary:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         word:
 *           type: string
 *         pronunciation:
 *           type: string
 *         category:
 *           type: string
 *           enum: [halachic, chassidic, yiddish, calendar, names, places, general]
 *         frequency:
 *           type: integer
 *         isGlobal:
 *           type: boolean
 *         isActive:
 *           type: boolean
 *         metadata:
 *           type: object
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /vocabulary:
 *   get:
 *     summary: Get user's custom vocabulary
 *     tags: [Vocabulary]
 *     security:
 *       - bearerAuth: []
 */
router.get('/', protect, [
  query('category')
    .optional()
    .isIn(['halachic', 'chassidic', 'yiddish', 'calendar', 'names', 'places', 'general'])
    .withMessage('Invalid category'),
  query('includeGlobal')
    .optional()
    .isBoolean()
    .withMessage('includeGlobal must be a boolean')
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

    const { category, includeGlobal = false } = req.query;
    
    let words;
    if (includeGlobal) {
      words = await CustomVocabulary.getCombinedVocabulary(req.user.id);
    } else {
      words = await CustomVocabulary.getUserVocabulary(req.user.id);
    }

    // Filter by category if specified
    if (category) {
      words = words.filter(word => word.category === category);
    }

    res.json({
      success: true,
      data: {
        vocabulary: words
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /vocabulary:
 *   post:
 *     summary: Add new vocabulary word
 *     tags: [Vocabulary]
 *     security:
 *       - bearerAuth: []
 */
router.post('/', protect, [
  body('word')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Word must be between 1 and 100 characters'),
  body('pronunciation')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Pronunciation must be less than 200 characters'),
  body('category')
    .optional()
    .isIn(['halachic', 'chassidic', 'yiddish', 'calendar', 'names', 'places', 'general'])
    .withMessage('Invalid category'),
  body('metadata')
    .optional()
    .isObject()
    .withMessage('Metadata must be an object')
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

    const { word, pronunciation, category = 'general', metadata = {} } = req.body;

    // Check if word already exists for this user
    const existingWord = await CustomVocabulary.findOne({
      where: {
        word: word,
        userId: req.user.id
      }
    });

    if (existingWord) {
      return res.status(409).json({
        success: false,
        error: 'Word already exists in your vocabulary'
      });
    }

    const vocabularyWord = await CustomVocabulary.create({
      word,
      pronunciation,
      category,
      metadata,
      userId: req.user.id,
      addedBy: req.user.id
    });

    logger.info(`Vocabulary word added: ${word} by user: ${req.user.email}`);

    res.status(201).json({
      success: true,
      data: {
        vocabularyWord
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /vocabulary/{id}:
 *   get:
 *     summary: Get vocabulary word by ID
 *     tags: [Vocabulary]
 *     security:
 *       - bearerAuth: []
 */
router.get('/:id', protect, [
  param('id').isUUID().withMessage('Invalid vocabulary ID')
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

    const vocabularyWord = await CustomVocabulary.findOne({
      where: {
        id: req.params.id,
        userId: req.user.id
      }
    });

    if (!vocabularyWord) {
      return res.status(404).json({
        success: false,
        error: 'Vocabulary word not found'
      });
    }

    res.json({
      success: true,
      data: {
        vocabularyWord
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /vocabulary/{id}:
 *   put:
 *     summary: Update vocabulary word
 *     tags: [Vocabulary]
 *     security:
 *       - bearerAuth: []
 */
router.put('/:id', protect, [
  param('id').isUUID().withMessage('Invalid vocabulary ID'),
  body('word')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Word must be between 1 and 100 characters'),
  body('pronunciation')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Pronunciation must be less than 200 characters'),
  body('category')
    .optional()
    .isIn(['halachic', 'chassidic', 'yiddish', 'calendar', 'names', 'places', 'general'])
    .withMessage('Invalid category')
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

    const vocabularyWord = await CustomVocabulary.findOne({
      where: {
        id: req.params.id,
        userId: req.user.id
      }
    });

    if (!vocabularyWord) {
      return res.status(404).json({
        success: false,
        error: 'Vocabulary word not found'
      });
    }

    await vocabularyWord.update(req.body);

    logger.info(`Vocabulary word updated: ${vocabularyWord.word} by user: ${req.user.email}`);

    res.json({
      success: true,
      data: {
        vocabularyWord
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /vocabulary/{id}:
 *   delete:
 *     summary: Delete vocabulary word
 *     tags: [Vocabulary]
 *     security:
 *       - bearerAuth: []
 */
router.delete('/:id', protect, [
  param('id').isUUID().withMessage('Invalid vocabulary ID')
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

    const vocabularyWord = await CustomVocabulary.findOne({
      where: {
        id: req.params.id,
        userId: req.user.id
      }
    });

    if (!vocabularyWord) {
      return res.status(404).json({
        success: false,
        error: 'Vocabulary word not found'
      });
    }

    await vocabularyWord.destroy();

    logger.info(`Vocabulary word deleted: ${vocabularyWord.word} by user: ${req.user.email}`);

    res.json({
      success: true,
      message: 'Vocabulary word deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /vocabulary/global:
 *   get:
 *     summary: Get global vocabulary
 *     tags: [Vocabulary]
 */
router.get('/global', async (req, res, next) => {
  try {
    const globalVocabulary = await CustomVocabulary.getGlobalVocabulary();

    res.json({
      success: true,
      data: {
        vocabulary: globalVocabulary
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /vocabulary/bulk:
 *   post:
 *     summary: Add multiple vocabulary words
 *     tags: [Vocabulary]
 *     security:
 *       - bearerAuth: []
 */
router.post('/bulk', protect, [
  body('words')
    .isArray({ min: 1, max: 100 })
    .withMessage('Words must be an array with 1-100 items'),
  body('words.*.word')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Each word must be between 1 and 100 characters'),
  body('words.*.category')
    .optional()
    .isIn(['halachic', 'chassidic', 'yiddish', 'calendar', 'names', 'places', 'general'])
    .withMessage('Invalid category')
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

    const { words } = req.body;
    const results = {
      added: [],
      skipped: [],
      errors: []
    };

    for (const wordData of words) {
      try {
        // Check if word already exists
        const existingWord = await CustomVocabulary.findOne({
          where: {
            word: wordData.word,
            userId: req.user.id
          }
        });

        if (existingWord) {
          results.skipped.push({
            word: wordData.word,
            reason: 'Already exists'
          });
          continue;
        }

        const vocabularyWord = await CustomVocabulary.create({
          ...wordData,
          category: wordData.category || 'general',
          userId: req.user.id,
          addedBy: req.user.id
        });

        results.added.push(vocabularyWord);
      } catch (error) {
        results.errors.push({
          word: wordData.word,
          error: error.message
        });
      }
    }

    logger.info(`Bulk vocabulary import: ${results.added.length} added, ${results.skipped.length} skipped, ${results.errors.length} errors by user: ${req.user.email}`);

    res.status(201).json({
      success: true,
      data: {
        results
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;