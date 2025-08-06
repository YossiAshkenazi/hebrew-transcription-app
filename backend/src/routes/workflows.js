const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const logger = require('../utils/logger');

// Import services
const workflowService = require('../services/workflowService');

/**
 * Workflow Management Routes
 * Provides comprehensive API for workflow automation and management
 */

/**
 * GET /api/workflows
 * Get all workflows for the user
 */
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, limit = 50, offset = 0 } = req.query;

    // In production, this would fetch workflows from database
    // For now, return mock data showing workflow capabilities
    const workflows = [
      {
        id: 'workflow-1',
        name: 'Hebrew Transcription Processing',
        description: 'Automated processing pipeline for Hebrew audio files',
        status: 'active',
        userId,
        createdAt: new Date().toISOString(),
        lastExecutedAt: new Date().toISOString(),
        totalExecutions: 15,
        successRate: 93.3
      },
      {
        id: 'workflow-2',
        name: 'Batch Processing with Classification',
        description: 'Batch process multiple files and classify content',
        status: 'active',
        userId,
        createdAt: new Date().toISOString(),
        lastExecutedAt: null,
        totalExecutions: 0,
        successRate: 0
      }
    ];

    let filteredWorkflows = workflows;
    if (status) {
      filteredWorkflows = workflows.filter(w => w.status === status);
    }

    const paginatedWorkflows = filteredWorkflows.slice(offset, offset + limit);

    res.json({
      success: true,
      data: {
        workflows: paginatedWorkflows,
        pagination: {
          total: filteredWorkflows.length,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: offset + limit < filteredWorkflows.length
        },
        statistics: {
          totalWorkflows: workflows.length,
          activeWorkflows: workflows.filter(w => w.status === 'active').length,
          totalExecutions: workflows.reduce((sum, w) => sum + w.totalExecutions, 0)
        }
      }
    });

  } catch (error) {
    logger.error('Failed to get workflows:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve workflows'
    });
  }
});

/**
 * GET /api/workflows/templates
 * Get available workflow templates
 */
router.get('/templates', auth, async (req, res) => {
  try {
    const templates = workflowService.getWorkflowTemplates();

    res.json({
      success: true,
      data: {
        templates,
        totalTemplates: Object.keys(templates).length,
        categories: Object.keys(templates).map(key => templates[key].category || 'general')
      }
    });

  } catch (error) {
    logger.error('Failed to get workflow templates:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve workflow templates'
    });
  }
});

/**
 * POST /api/workflows
 * Create new workflow
 */
router.post('/',
  auth,
  body('name').notEmpty().withMessage('Workflow name is required'),
  body('description').optional().isString(),
  body('steps').isArray({ min: 1 }).withMessage('At least one workflow step is required'),
  body('steps.*.name').notEmpty().withMessage('Step name is required'),
  body('steps.*.type').notEmpty().withMessage('Step type is required'),
  body('steps.*.config').optional().isObject(),
  body('triggers').optional().isArray(),
  body('conditions').optional().isArray(),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const userId = req.user.id;
      const workflowDefinition = req.body;

      const result = await workflowService.createWorkflow(workflowDefinition, userId);

      res.status(201).json({
        success: true,
        message: 'Workflow created successfully',
        data: result
      });

    } catch (error) {
      logger.error('Failed to create workflow:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to create workflow'
      });
    }
  }
);

/**
 * GET /api/workflows/:workflowId
 * Get specific workflow details
 */
router.get('/:workflowId',
  auth,
  param('workflowId').isUUID().withMessage('Valid workflow ID is required'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { workflowId } = req.params;
      const workflowStatus = workflowService.getWorkflowStatus(workflowId);

      if (!workflowStatus.found) {
        return res.status(404).json({
          success: false,
          error: 'Workflow not found'
        });
      }

      res.json({
        success: true,
        data: workflowStatus
      });

    } catch (error) {
      logger.error(`Failed to get workflow ${req.params.workflowId}:`, error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve workflow'
      });
    }
  }
);

/**
 * POST /api/workflows/:workflowId/execute
 * Execute workflow manually
 */
router.post('/:workflowId/execute',
  auth,
  param('workflowId').isUUID().withMessage('Valid workflow ID is required'),
  body('triggerData').optional().isObject(),
  body('options').optional().isObject(),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { workflowId } = req.params;
      const { triggerData = {}, options = {} } = req.body;
      const userId = req.user.id;

      // Add user context to trigger data
      const enhancedTriggerData = {
        ...triggerData,
        userId,
        executedBy: 'manual',
        executedAt: new Date().toISOString()
      };

      const result = await workflowService.executeWorkflow(workflowId, enhancedTriggerData, options);

      res.json({
        success: true,
        message: 'Workflow execution initiated',
        data: result
      });

    } catch (error) {
      logger.error(`Failed to execute workflow ${req.params.workflowId}:`, error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to execute workflow'
      });
    }
  }
);

/**
 * PUT /api/workflows/:workflowId
 * Update workflow configuration
 */
router.put('/:workflowId',
  auth,
  param('workflowId').isUUID().withMessage('Valid workflow ID is required'),
  body('name').optional().notEmpty().withMessage('Workflow name cannot be empty'),
  body('description').optional().isString(),
  body('steps').optional().isArray({ min: 1 }).withMessage('At least one workflow step is required'),
  body('isActive').optional().isBoolean(),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { workflowId } = req.params;
      const updates = req.body;

      // In production, this would update the workflow in database
      logger.info(`Workflow ${workflowId} update requested`, { updates });

      res.json({
        success: true,
        message: 'Workflow updated successfully',
        data: {
          workflowId,
          updatedFields: Object.keys(updates),
          updatedAt: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error(`Failed to update workflow ${req.params.workflowId}:`, error);
      res.status(500).json({
        success: false,
        error: 'Failed to update workflow'
      });
    }
  }
);

/**
 * DELETE /api/workflows/:workflowId
 * Delete workflow
 */
router.delete('/:workflowId',
  auth,
  param('workflowId').isUUID().withMessage('Valid workflow ID is required'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { workflowId } = req.params;
      const userId = req.user.id;

      // In production, this would delete the workflow from database
      logger.info(`Workflow ${workflowId} deletion requested by user ${userId}`);

      res.json({
        success: true,
        message: 'Workflow deleted successfully',
        data: {
          workflowId,
          deletedAt: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error(`Failed to delete workflow ${req.params.workflowId}:`, error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete workflow'
      });
    }
  }
);

/**
 * GET /api/workflows/:workflowId/executions
 * Get workflow execution history
 */
router.get('/:workflowId/executions',
  auth,
  param('workflowId').isUUID().withMessage('Valid workflow ID is required'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be non-negative'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { workflowId } = req.params;
      const { limit = 20, offset = 0 } = req.query;

      const workflowStatus = workflowService.getWorkflowStatus(workflowId);

      if (!workflowStatus.found) {
        return res.status(404).json({
          success: false,
          error: 'Workflow not found'
        });
      }

      const executions = workflowStatus.executionHistory || [];
      const paginatedExecutions = executions.slice(offset, offset + limit);

      res.json({
        success: true,
        data: {
          workflowId,
          executions: paginatedExecutions,
          pagination: {
            total: executions.length,
            limit: parseInt(limit),
            offset: parseInt(offset),
            hasMore: offset + limit < executions.length
          },
          statistics: {
            totalExecutions: executions.length,
            successfulExecutions: executions.filter(e => e.status === 'completed').length,
            failedExecutions: executions.filter(e => e.status === 'failed').length,
            averageDuration: executions.length > 0 ? 
              executions.reduce((sum, e) => sum + (e.endTime - e.startTime || 0), 0) / executions.length : 0
          }
        }
      });

    } catch (error) {
      logger.error(`Failed to get workflow executions for ${req.params.workflowId}:`, error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve workflow executions'
      });
    }
  }
);

/**
 * POST /api/workflows/:workflowId/pause
 * Pause workflow execution
 */
router.post('/:workflowId/pause',
  auth,
  param('workflowId').isUUID().withMessage('Valid workflow ID is required'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { workflowId } = req.params;

      // In production, this would pause the workflow
      logger.info(`Workflow ${workflowId} pause requested`);

      res.json({
        success: true,
        message: 'Workflow paused successfully',
        data: {
          workflowId,
          status: 'paused',
          pausedAt: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error(`Failed to pause workflow ${req.params.workflowId}:`, error);
      res.status(500).json({
        success: false,
        error: 'Failed to pause workflow'
      });
    }
  }
);

/**
 * POST /api/workflows/:workflowId/resume
 * Resume paused workflow
 */
router.post('/:workflowId/resume',
  auth,
  param('workflowId').isUUID().withMessage('Valid workflow ID is required'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { workflowId } = req.params;

      // In production, this would resume the workflow
      logger.info(`Workflow ${workflowId} resume requested`);

      res.json({
        success: true,
        message: 'Workflow resumed successfully',
        data: {
          workflowId,
          status: 'active',
          resumedAt: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error(`Failed to resume workflow ${req.params.workflowId}:`, error);
      res.status(500).json({
        success: false,
        error: 'Failed to resume workflow'
      });
    }
  }
);

/**
 * GET /api/workflows/statistics
 * Get workflow system statistics
 */
router.get('/statistics',
  auth,
  query('timeRange').optional().isIn(['1h', '6h', '24h', '7d', '30d']).withMessage('Invalid time range'),
  async (req, res) => {
    try {
      const { timeRange = '24h' } = req.query;
      const statistics = workflowService.getWorkflowStatistics(timeRange);

      res.json({
        success: true,
        data: {
          statistics,
          timeRange,
          generatedAt: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error('Failed to get workflow statistics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve workflow statistics'
      });
    }
  }
);

/**
 * POST /api/workflows/validate
 * Validate workflow definition
 */
router.post('/validate',
  auth,
  body('definition').isObject().withMessage('Workflow definition is required'),
  body('definition.name').notEmpty().withMessage('Workflow name is required'),
  body('definition.steps').isArray({ min: 1 }).withMessage('At least one workflow step is required'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { definition } = req.body;

      // Validate workflow definition
      const validationResult = {
        isValid: true,
        errors: [],
        warnings: [],
        suggestions: []
      };

      // Basic validation
      if (!definition.steps || definition.steps.length === 0) {
        validationResult.isValid = false;
        validationResult.errors.push('Workflow must have at least one step');
      }

      // Validate each step
      definition.steps.forEach((step, index) => {
        if (!step.name) {
          validationResult.errors.push(`Step ${index + 1}: Name is required`);
          validationResult.isValid = false;
        }

        if (!step.type) {
          validationResult.errors.push(`Step ${index + 1}: Type is required`);
          validationResult.isValid = false;
        }

        // Step-specific validation
        switch (step.type) {
        case 'transcribe':
          if (!step.config?.filePath) {
            validationResult.warnings.push(`Step ${index + 1}: File path not specified`);
          }
          break;
        case 'webhook':
          if (!step.config?.webhookConfig?.url) {
            validationResult.errors.push(`Step ${index + 1}: Webhook URL is required`);
            validationResult.isValid = false;
          }
          break;
        case 'export':
          if (!step.config?.format) {
            validationResult.warnings.push(`Step ${index + 1}: Export format not specified`);
          }
          break;
        }
      });

      // Generate suggestions
      if (definition.steps.length > 10) {
        validationResult.suggestions.push('Consider breaking down complex workflows into smaller, more manageable workflows');
      }

      if (!definition.description) {
        validationResult.suggestions.push('Adding a description will help you and your team understand the workflow purpose');
      }

      res.json({
        success: true,
        data: {
          validation: validationResult,
          workflowComplexity: this.calculateWorkflowComplexity(definition),
          estimatedExecutionTime: this.estimateExecutionTime(definition),
          validatedAt: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error('Workflow validation failed:', error);
      res.status(500).json({
        success: false,
        error: 'Workflow validation failed'
      });
    }
  }
);

/**
 * POST /api/workflows/import
 * Import workflow from template or file
 */
router.post('/import',
  auth,
  body('source').isIn(['template', 'file', 'json']).withMessage('Invalid import source'),
  body('data').notEmpty().withMessage('Import data is required'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { source, data, name } = req.body;
      const userId = req.user.id;

      let workflowDefinition;

      switch (source) {
      case 'template':
        const templates = workflowService.getWorkflowTemplates();
        if (!templates[data]) {
          return res.status(400).json({
            success: false,
            error: 'Template not found'
          });
        }
        workflowDefinition = { ...templates[data] };
        break;

      case 'json':
        try {
          workflowDefinition = typeof data === 'string' ? JSON.parse(data) : data;
        } catch (parseError) {
          return res.status(400).json({
            success: false,
            error: 'Invalid JSON format'
          });
        }
        break;

      case 'file':
        // In production, this would handle file upload and parsing
        return res.status(501).json({
          success: false,
          error: 'File import not yet implemented'
        });

      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid import source'
        });
      }

      // Customize name if provided
      if (name) {
        workflowDefinition.name = name;
      }

      // Add import metadata
      workflowDefinition.imported = {
        source,
        importedAt: new Date().toISOString(),
        importedBy: userId
      };

      const result = await workflowService.createWorkflow(workflowDefinition, userId);

      res.json({
        success: true,
        message: 'Workflow imported successfully',
        data: {
          ...result,
          importSource: source,
          importedAt: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error('Workflow import failed:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Workflow import failed'
      });
    }
  }
);

/**
 * Helper function to calculate workflow complexity
 */
function calculateWorkflowComplexity(definition) {
  let complexity = 'simple';
  
  if (definition.steps.length > 5) {
    complexity = 'medium';
  }
  
  if (definition.steps.length > 10 || 
      definition.conditions?.length > 3 || 
      definition.triggers?.length > 2) {
    complexity = 'complex';
  }

  return complexity;
}

/**
 * Helper function to estimate execution time
 */
function estimateExecutionTime(definition) {
  const baseTimePerStep = 30; // seconds
  let totalEstimate = definition.steps.length * baseTimePerStep;

  // Add time for specific step types
  definition.steps.forEach(step => {
    switch (step.type) {
    case 'transcribe':
      totalEstimate += 120; // 2 minutes for transcription
      break;
    case 'batch_process':
      totalEstimate += 300; // 5 minutes for batch processing
      break;
    case 'export':
      totalEstimate += 15; // 15 seconds for export
      break;
    }
  });

  return `${Math.round(totalEstimate / 60)} minutes`;
}

module.exports = router;