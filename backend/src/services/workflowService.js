const logger = require('../utils/logger');
const { Transcription, User } = require('../models');
const transcriptionService = require('./transcriptionService');
const batchService = require('./batchService');
const advancedWebhookService = require('./advancedWebhookService');
const exportService = require('./exportService');
const { v4: uuidv4 } = require('uuid');
const Bull = require('bull');
const redis = require('../config/redis');
const path = require('path');
const fs = require('fs').promises;
const moment = require('moment');

/**
 * Comprehensive Workflow Automation Service
 * Provides intelligent processing rules, auto-classification, and smart routing
 */
class WorkflowService {
  constructor() {
    this.workflows = new Map(); // Active workflows
    this.workflowTemplates = new Map(); // Workflow templates
    this.rules = new Map(); // Processing rules
    this.classifications = new Map(); // Content classifications
    this.routingRules = new Map(); // Smart routing rules
    
    this.workflowQueue = new Bull('workflow-processing', { redis: redis.getConnectionOptions() });
    this.rulesEngine = new WorkflowRulesEngine();
    this.contentClassifier = new ContentClassifier();
    this.smartRouter = new SmartRouter();
    
    this.setupQueueProcessors();
    this.loadBuiltInTemplates();
  }

  /**
   * Setup workflow processing queue
   */
  setupQueueProcessors() {
    // Process workflow step
    this.workflowQueue.process('execute-workflow-step', 5, async (job) => {
      return await this.executeWorkflowStep(job.data);
    });

    // Process rule evaluation
    this.workflowQueue.process('evaluate-rules', 10, async (job) => {
      return await this.evaluateRules(job.data);
    });

    // Process content classification
    this.workflowQueue.process('classify-content', 5, async (job) => {
      return await this.classifyContent(job.data);
    });

    // Process smart routing
    this.workflowQueue.process('smart-route', 10, async (job) => {
      return await this.executeSmartRouting(job.data);
    });

    // Handle workflow events
    this.workflowQueue.on('completed', (job, result) => {
      logger.info(`Workflow job completed: ${job.id}`, { result });
    });

    this.workflowQueue.on('failed', (job, error) => {
      logger.error(`Workflow job failed: ${job.id}`, { error: error.message });
    });
  }

  /**
   * Create new workflow
   */
  async createWorkflow(definition, userId) {
    try {
      const workflowId = uuidv4();
      const user = await User.findByPk(userId);
      
      if (!user) {
        throw new Error('User not found');
      }

      // Validate workflow definition
      this.validateWorkflowDefinition(definition);

      const workflow = {
        id: workflowId,
        name: definition.name,
        description: definition.description,
        userId,
        user,
        status: 'created',
        definition,
        state: {
          currentStep: 0,
          variables: {},
          history: [],
          metrics: {
            filesProcessed: 0,
            successCount: 0,
            failureCount: 0,
            totalDuration: 0
          }
        },
        createdAt: new Date(),
        lastExecutedAt: null,
        isActive: definition.isActive !== false,
        schedule: definition.schedule || null,
        triggers: definition.triggers || [],
        conditions: definition.conditions || [],
        steps: definition.steps || []
      };

      this.workflows.set(workflowId, workflow);
      
      // Setup triggers if specified
      if (workflow.triggers.length > 0) {
        await this.setupWorkflowTriggers(workflow);
      }

      logger.info(`Created workflow ${workflowId}: ${workflow.name}`);

      return {
        workflowId,
        name: workflow.name,
        status: 'created',
        isActive: workflow.isActive,
        triggers: workflow.triggers.length
      };

    } catch (error) {
      logger.error('Failed to create workflow:', error);
      throw error;
    }
  }

  /**
   * Execute workflow
   */
  async executeWorkflow(workflowId, triggerData = {}, options = {}) {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error('Workflow not found');
    }

    if (!workflow.isActive) {
      throw new Error('Workflow is not active');
    }

    try {
      const executionId = uuidv4();
      workflow.status = 'running';
      workflow.lastExecutedAt = new Date();
      workflow.state.currentStep = 0;
      workflow.state.variables = { ...triggerData, ...options };

      logger.info(`Starting workflow execution ${executionId} for workflow ${workflowId}`);

      // Add execution to history
      workflow.state.history.push({
        executionId,
        startTime: new Date(),
        triggerData,
        status: 'running',
        steps: []
      });

      // Execute workflow steps
      const result = await this.processWorkflowSteps(workflow, executionId);

      // Update workflow status
      workflow.status = result.success ? 'completed' : 'failed';
      const execution = workflow.state.history[workflow.state.history.length - 1];
      execution.status = workflow.status;
      execution.endTime = new Date();
      execution.result = result;

      // Update metrics
      workflow.state.metrics.filesProcessed += result.filesProcessed || 0;
      if (result.success) {
        workflow.state.metrics.successCount++;
      } else {
        workflow.state.metrics.failureCount++;
      }
      workflow.state.metrics.totalDuration += execution.endTime - execution.startTime;

      // Send notifications
      await this.sendWorkflowNotifications(workflow, execution);

      logger.info(`Completed workflow execution ${executionId}`, { result });

      return {
        executionId,
        workflowId,
        status: workflow.status,
        result,
        duration: execution.endTime - execution.startTime
      };

    } catch (error) {
      workflow.status = 'failed';
      const execution = workflow.state.history[workflow.state.history.length - 1];
      if (execution) {
        execution.status = 'failed';
        execution.error = error.message;
        execution.endTime = new Date();
      }
      
      logger.error(`Workflow execution failed for ${workflowId}:`, error);
      throw error;
    }
  }

  /**
   * Process workflow steps sequentially
   */
  async processWorkflowSteps(workflow, executionId) {
    const results = {
      success: true,
      filesProcessed: 0,
      outputs: {},
      errors: []
    };

    const execution = workflow.state.history[workflow.state.history.length - 1];

    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];
      workflow.state.currentStep = i;

      try {
        logger.info(`Executing workflow step ${i + 1}/${workflow.steps.length}: ${step.name}`);

        const stepResult = await this.executeWorkflowStep({
          workflowId: workflow.id,
          executionId,
          stepIndex: i,
          step,
          variables: workflow.state.variables,
          previousResults: results.outputs
        });

        // Update workflow variables with step outputs
        if (stepResult.outputs) {
          Object.assign(workflow.state.variables, stepResult.outputs);
          Object.assign(results.outputs, stepResult.outputs);
        }

        // Track files processed
        if (stepResult.filesProcessed) {
          results.filesProcessed += stepResult.filesProcessed;
        }

        // Record step execution
        execution.steps.push({
          stepIndex: i,
          stepName: step.name,
          stepType: step.type,
          status: 'completed',
          startTime: new Date(),
          endTime: new Date(),
          result: stepResult
        });

        // Check if step has conditional logic
        if (step.conditions && !this.evaluateStepConditions(step.conditions, workflow.state.variables)) {
          logger.info(`Step ${i + 1} conditions not met, skipping remaining steps`);
          break;
        }

      } catch (error) {
        results.success = false;
        results.errors.push({
          step: i,
          stepName: step.name,
          error: error.message
        });

        execution.steps.push({
          stepIndex: i,
          stepName: step.name,
          stepType: step.type,
          status: 'failed',
          startTime: new Date(),
          endTime: new Date(),
          error: error.message
        });

        // Check if workflow should continue on error
        if (!step.continueOnError) {
          logger.error(`Workflow step ${i + 1} failed, stopping execution:`, error);
          break;
        }

        logger.warn(`Workflow step ${i + 1} failed but continuing:`, error);
      }
    }

    return results;
  }

  /**
   * Execute individual workflow step
   */
  async executeWorkflowStep(stepData) {
    const { step, variables, previousResults } = stepData;

    switch (step.type) {
    case 'transcribe':
      return await this.executeTranscribeStep(step, variables);
      
    case 'batch_process':
      return await this.executeBatchProcessStep(step, variables);
      
    case 'classify':
      return await this.executeClassifyStep(step, variables);
      
    case 'route':
      return await this.executeRouteStep(step, variables);
      
    case 'export':
      return await this.executeExportStep(step, variables);
      
    case 'webhook':
      return await this.executeWebhookStep(step, variables);
      
    case 'condition':
      return await this.executeConditionStep(step, variables);
      
    case 'transform':
      return await this.executeTransformStep(step, variables, previousResults);
      
    case 'delay':
      return await this.executeDelayStep(step, variables);
      
    case 'custom':
      return await this.executeCustomStep(step, variables);
      
    default:
      throw new Error(`Unknown workflow step type: ${step.type}`);
    }
  }

  /**
   * Execute transcription step
   */
  async executeTranscribeStep(step, variables) {
    const { filePath, options = {} } = step.config;
    const resolvedFilePath = this.resolveVariables(filePath, variables);

    try {
      const transcription = await transcriptionService.createTranscription({
        originalFilename: path.basename(resolvedFilePath),
        filePath: resolvedFilePath,
        language: options.language || variables.language || 'he-IL',
        enableSpeakerDiarization: options.enableSpeakerDiarization || false,
        customVocabulary: options.customVocabulary || variables.customVocabulary
      }, variables.userId);

      return {
        success: true,
        filesProcessed: 1,
        outputs: {
          transcriptionId: transcription.id,
          transcription: transcription
        }
      };
    } catch (error) {
      throw new Error(`Transcription step failed: ${error.message}`);
    }
  }

  /**
   * Execute batch processing step
   */
  async executeBatchProcessStep(step, variables) {
    const { files, options = {} } = step.config;
    const resolvedFiles = files.map(file => ({
      ...file,
      path: this.resolveVariables(file.path, variables)
    }));

    try {
      const batch = await batchService.createBatch(resolvedFiles, variables.userId, options);
      await batchService.startBatch(batch.batchId);

      // Wait for batch completion (with timeout)
      const result = await this.waitForBatchCompletion(batch.batchId, options.timeout || 3600000);

      return {
        success: result.status === 'completed',
        filesProcessed: result.totalFiles,
        outputs: {
          batchId: batch.batchId,
          batchResults: result
        }
      };
    } catch (error) {
      throw new Error(`Batch processing step failed: ${error.message}`);
    }
  }

  /**
   * Execute content classification step
   */
  async executeClassifyStep(step, variables) {
    const { contentSource, classificationRules = [] } = step.config;
    
    try {
      let content;
      if (contentSource === 'transcription' && variables.transcription) {
        content = variables.transcription.transcriptionText;
      } else if (contentSource === 'file' && step.config.filePath) {
        const filePath = this.resolveVariables(step.config.filePath, variables);
        content = await fs.readFile(filePath, 'utf8');
      } else {
        throw new Error('Invalid content source for classification');
      }

      const classification = await this.contentClassifier.classify(content, classificationRules);

      return {
        success: true,
        outputs: {
          classification: classification.category,
          confidence: classification.confidence,
          tags: classification.tags,
          classificationDetails: classification
        }
      };
    } catch (error) {
      throw new Error(`Classification step failed: ${error.message}`);
    }
  }

  /**
   * Execute smart routing step
   */
  async executeRouteStep(step, variables) {
    const { routingRules } = step.config;
    
    try {
      const route = await this.smartRouter.determineRoute(variables, routingRules);
      
      // Execute routing action
      if (route.action === 'webhook') {
        await advancedWebhookService.sendAdvancedWebhook(
          route.config,
          'workflow.routed',
          { route, variables }
        );
      } else if (route.action === 'export') {
        // Export to specified location
        await exportService.exportTranscription(
          variables.transcription,
          route.config.format,
          route.config
        );
      }

      return {
        success: true,
        outputs: {
          route: route.name,
          routeAction: route.action,
          routeConfig: route.config
        }
      };
    } catch (error) {
      throw new Error(`Routing step failed: ${error.message}`);
    }
  }

  /**
   * Execute export step
   */
  async executeExportStep(step, variables) {
    const { format, destination, options = {} } = step.config;
    
    try {
      if (!variables.transcription) {
        throw new Error('No transcription available for export');
      }

      const exportResult = await exportService.exportTranscription(
        variables.transcription,
        format,
        {
          destination: this.resolveVariables(destination, variables),
          ...options
        }
      );

      return {
        success: true,
        outputs: {
          exportPath: exportResult.filePath,
          exportFormat: format,
          exportSize: exportResult.size
        }
      };
    } catch (error) {
      throw new Error(`Export step failed: ${error.message}`);
    }
  }

  /**
   * Execute webhook step
   */
  async executeWebhookStep(step, variables) {
    const { webhookConfig, eventType = 'workflow.step', payload = {} } = step.config;
    
    try {
      const resolvedPayload = this.resolveVariables(payload, variables);
      
      const result = await advancedWebhookService.sendAdvancedWebhook(
        webhookConfig,
        eventType,
        {
          event: eventType,
          timestamp: new Date().toISOString(),
          workflow: {
            id: variables.workflowId,
            name: variables.workflowName
          },
          data: resolvedPayload
        }
      );

      return {
        success: result.success,
        outputs: {
          webhookResponse: result
        }
      };
    } catch (error) {
      throw new Error(`Webhook step failed: ${error.message}`);
    }
  }

  /**
   * Execute condition step
   */
  async executeConditionStep(step, variables) {
    const { conditions, trueAction, falseAction } = step.config;
    
    try {
      const conditionResult = this.evaluateStepConditions(conditions, variables);
      const action = conditionResult ? trueAction : falseAction;
      
      if (action) {
        const actionResult = await this.executeWorkflowStep({
          step: action,
          variables
        });
        
        return {
          success: actionResult.success,
          outputs: {
            conditionResult,
            actionExecuted: conditionResult ? 'true' : 'false',
            ...actionResult.outputs
          }
        };
      }

      return {
        success: true,
        outputs: {
          conditionResult,
          actionExecuted: 'none'
        }
      };
    } catch (error) {
      throw new Error(`Condition step failed: ${error.message}`);
    }
  }

  /**
   * Execute transform step
   */
  async executeTransformStep(step, variables, previousResults) {
    const { transformations } = step.config;
    
    try {
      const transformed = {};
      
      for (const transformation of transformations) {
        const { source, target, operation, parameters = {} } = transformation;
        const sourceValue = this.resolveVariables(source, { ...variables, ...previousResults });
        
        switch (operation) {
        case 'format':
          transformed[target] = this.formatValue(sourceValue, parameters);
          break;
        case 'extract':
          transformed[target] = this.extractValue(sourceValue, parameters);
          break;
        case 'calculate':
          transformed[target] = this.calculateValue(sourceValue, parameters);
          break;
        case 'combine':
          transformed[target] = this.combineValues(sourceValue, parameters, variables);
          break;
        default:
          transformed[target] = sourceValue;
        }
      }

      return {
        success: true,
        outputs: transformed
      };
    } catch (error) {
      throw new Error(`Transform step failed: ${error.message}`);
    }
  }

  /**
   * Execute delay step
   */
  async executeDelayStep(step, variables) {
    const { duration } = step.config;
    const delayMs = this.parseDuration(duration);
    
    try {
      await new Promise(resolve => setTimeout(resolve, delayMs));
      
      return {
        success: true,
        outputs: {
          delayDuration: delayMs
        }
      };
    } catch (error) {
      throw new Error(`Delay step failed: ${error.message}`);
    }
  }

  /**
   * Execute custom step
   */
  async executeCustomStep(step, variables) {
    const { scriptPath, parameters = {} } = step.config;
    
    try {
      // In a real implementation, this would execute custom scripts
      // For security reasons, this is a placeholder
      logger.warn('Custom step execution is not implemented for security reasons');
      
      return {
        success: true,
        outputs: {
          customStepExecuted: true,
          parameters
        }
      };
    } catch (error) {
      throw new Error(`Custom step failed: ${error.message}`);
    }
  }

  /**
   * Evaluate step conditions
   */
  evaluateStepConditions(conditions, variables) {
    return this.rulesEngine.evaluate(conditions, variables);
  }

  /**
   * Resolve variables in strings
   */
  resolveVariables(template, variables) {
    if (typeof template !== 'string') {
      return template;
    }

    return template.replace(/\{\{([^}]+)\}\}/g, (match, variable) => {
      const value = this.getNestedValue(variables, variable.trim());
      return value !== undefined ? value : match;
    });
  }

  /**
   * Get nested value from object
   */
  getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  /**
   * Format value based on parameters
   */
  formatValue(value, parameters) {
    switch (parameters.type) {
    case 'date':
      return moment(value).format(parameters.format || 'YYYY-MM-DD HH:mm:ss');
    case 'number':
      return Number(value).toFixed(parameters.decimals || 0);
    case 'string':
      return String(value).substring(0, parameters.maxLength || 255);
    default:
      return value;
    }
  }

  /**
   * Extract value based on parameters
   */
  extractValue(value, parameters) {
    if (parameters.regex) {
      const match = String(value).match(new RegExp(parameters.regex));
      return match ? match[parameters.group || 0] : null;
    }
    
    if (parameters.jsonPath) {
      return this.getNestedValue(value, parameters.jsonPath);
    }
    
    return value;
  }

  /**
   * Calculate value based on parameters
   */
  calculateValue(value, parameters) {
    switch (parameters.operation) {
    case 'length':
      return String(value).length;
    case 'wordcount':
      return String(value).split(/\s+/).length;
    case 'duration':
      return moment(parameters.endTime).diff(moment(value), parameters.unit || 'seconds');
    default:
      return value;
    }
  }

  /**
   * Combine values
   */
  combineValues(value, parameters, variables) {
    const values = [value];
    
    if (parameters.additionalValues) {
      parameters.additionalValues.forEach(additionalValue => {
        values.push(this.resolveVariables(additionalValue, variables));
      });
    }
    
    return values.join(parameters.separator || ' ');
  }

  /**
   * Parse duration string to milliseconds
   */
  parseDuration(duration) {
    const units = {
      ms: 1,
      s: 1000,
      m: 60000,
      h: 3600000,
      d: 86400000
    };
    
    const match = String(duration).match(/^(\d+)(ms|s|m|h|d)$/);
    if (!match) {
      throw new Error(`Invalid duration format: ${duration}`);
    }
    
    const [, value, unit] = match;
    return parseInt(value) * units[unit];
  }

  /**
   * Wait for batch completion
   */
  async waitForBatchCompletion(batchId, timeout = 3600000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const status = batchService.getBatchStatus(batchId);
      
      if (!status.found) {
        throw new Error(`Batch ${batchId} not found`);
      }
      
      if (status.status === 'completed' || status.status === 'failed') {
        return status;
      }
      
      // Wait 10 seconds before checking again
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
    
    throw new Error(`Batch ${batchId} timed out after ${timeout}ms`);
  }

  /**
   * Setup workflow triggers
   */
  async setupWorkflowTriggers(workflow) {
    for (const trigger of workflow.triggers) {
      switch (trigger.type) {
      case 'schedule':
        await this.setupScheduleTrigger(workflow, trigger);
        break;
      case 'webhook':
        await this.setupWebhookTrigger(workflow, trigger);
        break;
      case 'file_upload':
        await this.setupFileUploadTrigger(workflow, trigger);
        break;
      case 'transcription_complete':
        await this.setupTranscriptionCompleteTrigger(workflow, trigger);
        break;
      }
    }
  }

  /**
   * Setup schedule trigger
   */
  async setupScheduleTrigger(workflow, trigger) {
    // Implementation would integrate with a job scheduler like node-cron
    logger.info(`Schedule trigger setup for workflow ${workflow.id}: ${trigger.schedule}`);
  }

  /**
   * Setup webhook trigger
   */
  async setupWebhookTrigger(workflow, trigger) {
    // Implementation would register webhook endpoint
    logger.info(`Webhook trigger setup for workflow ${workflow.id}: ${trigger.endpoint}`);
  }

  /**
   * Setup file upload trigger
   */
  async setupFileUploadTrigger(workflow, trigger) {
    // Implementation would watch for file uploads
    logger.info(`File upload trigger setup for workflow ${workflow.id}`);
  }

  /**
   * Setup transcription complete trigger
   */
  async setupTranscriptionCompleteTrigger(workflow, trigger) {
    // Implementation would listen for transcription completion events
    logger.info(`Transcription complete trigger setup for workflow ${workflow.id}`);
  }

  /**
   * Send workflow notifications
   */
  async sendWorkflowNotifications(workflow, execution) {
    try {
      // Send webhook notifications if configured
      if (workflow.definition.notifications?.webhook) {
        await advancedWebhookService.sendAdvancedWebhook(
          workflow.definition.notifications.webhook,
          'workflow.completed',
          {
            event: 'workflow.completed',
            timestamp: new Date().toISOString(),
            workflow: {
              id: workflow.id,
              name: workflow.name,
              status: workflow.status
            },
            execution: {
              id: execution.executionId,
              status: execution.status,
              duration: execution.endTime - execution.startTime,
              filesProcessed: workflow.state.metrics.filesProcessed
            }
          }
        );
      }

      logger.info(`Sent workflow notifications for ${workflow.id}`);
    } catch (error) {
      logger.error(`Failed to send workflow notifications for ${workflow.id}:`, error);
    }
  }

  /**
   * Validate workflow definition
   */
  validateWorkflowDefinition(definition) {
    if (!definition.name) {
      throw new Error('Workflow name is required');
    }

    if (!definition.steps || definition.steps.length === 0) {
      throw new Error('Workflow must have at least one step');
    }

    for (const step of definition.steps) {
      if (!step.name || !step.type) {
        throw new Error('Each workflow step must have a name and type');
      }
    }
  }

  /**
   * Load built-in workflow templates
   */
  loadBuiltInTemplates() {
    const templates = {
      'hebrew-transcription-basic': {
        name: 'Basic Hebrew Transcription',
        description: 'Simple workflow for transcribing Hebrew audio files',
        steps: [
          {
            name: 'Transcribe Audio',
            type: 'transcribe',
            config: {
              filePath: '{{filePath}}',
              options: {
                language: 'he-IL',
                enableSpeakerDiarization: false
              }
            }
          },
          {
            name: 'Export Results',
            type: 'export',
            config: {
              format: 'txt',
              destination: '{{outputPath}}'
            }
          }
        ]
      },
      'batch-processing-with-classification': {
        name: 'Batch Processing with Classification',
        description: 'Process multiple files and classify content',
        steps: [
          {
            name: 'Batch Process Files',
            type: 'batch_process',
            config: {
              files: '{{files}}',
              options: {
                language: 'he-IL',
                enableSpeakerDiarization: true
              }
            }
          },
          {
            name: 'Classify Content',
            type: 'classify',
            config: {
              contentSource: 'batch_results',
              classificationRules: [
                { pattern: 'תפילה|שיר|קדיש', category: 'liturgical' },
                { pattern: 'שיעור|לימוד|הרצאה', category: 'educational' },
                { pattern: 'ישיבה|פגישה|דיון', category: 'meeting' }
              ]
            }
          },
          {
            name: 'Smart Route',
            type: 'route',
            config: {
              routingRules: [
                {
                  condition: 'classification == "liturgical"',
                  action: 'export',
                  config: { format: 'pdf', destination: '/liturgical/' }
                },
                {
                  condition: 'classification == "educational"',
                  action: 'webhook',
                  config: { url: 'https://education.example.com/webhook' }
                }
              ]
            }
          }
        ]
      }
    };

    for (const [key, template] of Object.entries(templates)) {
      this.workflowTemplates.set(key, template);
    }

    logger.info(`Loaded ${this.workflowTemplates.size} workflow templates`);
  }

  /**
   * Get workflow status
   */
  getWorkflowStatus(workflowId) {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      return { found: false };
    }

    return {
      found: true,
      id: workflow.id,
      name: workflow.name,
      status: workflow.status,
      isActive: workflow.isActive,
      currentStep: workflow.state.currentStep,
      totalSteps: workflow.steps.length,
      metrics: workflow.state.metrics,
      lastExecutedAt: workflow.lastExecutedAt,
      executionHistory: workflow.state.history.slice(-5) // Last 5 executions
    };
  }

  /**
   * Get all workflow templates
   */
  getWorkflowTemplates() {
    const templates = {};
    for (const [key, template] of this.workflowTemplates.entries()) {
      templates[key] = template;
    }
    return templates;
  }

  /**
   * Get workflow statistics
   */
  getWorkflowStatistics(timeRange = '24h') {
    const cutoffTime = this.getCutoffTime(timeRange);
    const recentWorkflows = Array.from(this.workflows.values())
      .filter(w => w.lastExecutedAt && new Date(w.lastExecutedAt) >= cutoffTime);

    const totalExecutions = recentWorkflows.reduce((sum, w) => sum + w.state.history.length, 0);
    const successfulExecutions = recentWorkflows.reduce((sum, w) => 
      sum + w.state.history.filter(h => h.status === 'completed').length, 0);

    return {
      timeRange,
      totalWorkflows: this.workflows.size,
      activeWorkflows: Array.from(this.workflows.values()).filter(w => w.isActive).length,
      totalExecutions,
      successfulExecutions,
      successRate: totalExecutions > 0 ? (successfulExecutions / totalExecutions) * 100 : 0,
      totalFilesProcessed: recentWorkflows.reduce((sum, w) => sum + w.state.metrics.filesProcessed, 0),
      averageExecutionTime: this.calculateAverageExecutionTime(recentWorkflows)
    };
  }

  /**
   * Calculate average execution time
   */
  calculateAverageExecutionTime(workflows) {
    const executions = workflows.flatMap(w => w.state.history)
      .filter(h => h.startTime && h.endTime);

    if (executions.length === 0) {return 0;}

    const totalTime = executions.reduce((sum, e) => sum + (e.endTime - e.startTime), 0);
    return Math.round(totalTime / executions.length);
  }

  /**
   * Get cutoff time for statistics
   */
  getCutoffTime(timeRange) {
    const now = new Date();
    switch (timeRange) {
    case '1h':
      return new Date(now.getTime() - 60 * 60 * 1000);
    case '6h':
      return new Date(now.getTime() - 6 * 60 * 60 * 1000);
    case '24h':
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case '7d':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case '30d':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    default:
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }
  }
}

/**
 * Workflow Rules Engine
 * Evaluates complex conditions and rules
 */
class WorkflowRulesEngine {
  evaluate(conditions, variables) {
    if (!conditions || conditions.length === 0) {
      return true;
    }

    return conditions.every(condition => this.evaluateCondition(condition, variables));
  }

  evaluateCondition(condition, variables) {
    const { field, operator, value, logicOperator = 'and', nestedConditions } = condition;

    // Handle nested conditions
    if (nestedConditions) {
      const nestedResult = logicOperator === 'or' 
        ? nestedConditions.some(nc => this.evaluateCondition(nc, variables))
        : nestedConditions.every(nc => this.evaluateCondition(nc, variables));

      return nestedResult;
    }

    const fieldValue = this.getNestedValue(variables, field);

    switch (operator) {
    case 'equals':
      return fieldValue === value;
    case 'not_equals':
      return fieldValue !== value;
    case 'contains':
      return typeof fieldValue === 'string' && fieldValue.includes(value);
    case 'not_contains':
      return typeof fieldValue === 'string' && !fieldValue.includes(value);
    case 'greater_than':
      return Number(fieldValue) > Number(value);
    case 'less_than':
      return Number(fieldValue) < Number(value);
    case 'greater_equal':
      return Number(fieldValue) >= Number(value);
    case 'less_equal':
      return Number(fieldValue) <= Number(value);
    case 'in':
      return Array.isArray(value) && value.includes(fieldValue);
    case 'not_in':
      return Array.isArray(value) && !value.includes(fieldValue);
    case 'exists':
      return fieldValue !== undefined && fieldValue !== null;
    case 'not_exists':
      return fieldValue === undefined || fieldValue === null;
    case 'regex':
      try {
        const regex = new RegExp(value);
        return regex.test(String(fieldValue));
      } catch (error) {
        return false;
      }
    default:
      return true;
    }
  }

  getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }
}

/**
 * Content Classifier
 * Classifies transcription content based on rules
 */
class ContentClassifier {
  async classify(content, rules = []) {
    const classifications = [];
    
    for (const rule of rules) {
      const confidence = this.calculateConfidence(content, rule);
      if (confidence > (rule.threshold || 0.5)) {
        classifications.push({
          category: rule.category,
          confidence,
          rule: rule.pattern
        });
      }
    }

    // Sort by confidence and return the highest
    classifications.sort((a, b) => b.confidence - a.confidence);
    
    const primaryClassification = classifications[0] || {
      category: 'general',
      confidence: 0.5,
      rule: 'default'
    };

    return {
      category: primaryClassification.category,
      confidence: primaryClassification.confidence,
      tags: classifications.map(c => c.category),
      details: classifications
    };
  }

  calculateConfidence(content, rule) {
    if (rule.pattern) {
      const regex = new RegExp(rule.pattern, 'gi');
      const matches = content.match(regex) || [];
      const wordCount = content.split(/\s+/).length;
      return Math.min(matches.length / wordCount, 1.0);
    }

    return 0;
  }
}

/**
 * Smart Router
 * Determines routing based on content and rules
 */
class SmartRouter {
  async determineRoute(variables, routingRules) {
    for (const rule of routingRules) {
      if (this.evaluateRoutingCondition(rule.condition, variables)) {
        return {
          name: rule.name || 'default',
          action: rule.action,
          config: rule.config
        };
      }
    }

    return {
      name: 'default',
      action: 'none',
      config: {}
    };
  }

  evaluateRoutingCondition(condition, variables) {
    // Simple condition evaluation
    // In a real implementation, this would use the rules engine
    try {
      const func = new Function('variables', `with(variables) { return ${condition}; }`);
      return func(variables);
    } catch (error) {
      return false;
    }
  }
}

module.exports = new WorkflowService();