const logger = require('../utils/logger');
const { Transcription, User } = require('../models');
const transcriptionService = require('./transcriptionService');
const advancedWebhookService = require('./advancedWebhookService');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const archiver = require('archiver');
const Bull = require('bull');
const redis = require('../config/redis');

/**
 * Comprehensive Batch Processing Service
 * Handles multiple file uploads, processing, and batch operations
 */
class BatchService {
  constructor() {
    this.batchJobs = new Map(); // Active batch jobs
    this.batchResults = new Map(); // Completed batch results (cached)
    this.processingQueue = new Bull('batch-processing', { redis: redis.getConnectionOptions() });
    this.maxConcurrentJobs = parseInt(process.env.MAX_CONCURRENT_BATCH_JOBS) || 5;
    this.maxFilesPerBatch = parseInt(process.env.MAX_FILES_PER_BATCH) || 50;
    this.maxBatchSizeBytes = parseInt(process.env.MAX_BATCH_SIZE_BYTES) || 500 * 1024 * 1024; // 500MB
    
    this.setupQueueProcessors();
  }

  /**
   * Setup batch processing queue processors
   */
  setupQueueProcessors() {
    // Process individual files in batch
    this.processingQueue.process('process-batch-file', this.maxConcurrentJobs, async (job) => {
      return await this.processBatchFile(job.data);
    });

    // Process batch completion
    this.processingQueue.process('complete-batch', 1, async (job) => {
      return await this.completeBatch(job.data);
    });

    // Handle job events
    this.processingQueue.on('completed', (job, result) => {
      logger.info(`Batch job completed: ${job.id}`, { result });
    });

    this.processingQueue.on('failed', (job, error) => {
      logger.error(`Batch job failed: ${job.id}`, { error: error.message });
    });
  }

  /**
   * Create new batch processing job
   */
  async createBatch(files, userId, options = {}) {
    try {
      // Validate batch request
      await this.validateBatchRequest(files, options);

      const batchId = uuidv4();
      const user = await User.findByPk(userId);
      
      if (!user) {
        throw new Error('User not found');
      }

      // Calculate total size
      const totalSize = files.reduce((sum, file) => sum + file.size, 0);
      
      // Create batch job metadata
      const batchJob = {
        id: batchId,
        userId,
        user,
        files: files.map(file => ({
          ...file,
          id: uuidv4(),
          status: 'pending',
          transcriptionId: null,
          error: null,
          startTime: null,
          endTime: null
        })),
        status: 'created',
        totalFiles: files.length,
        totalSize,
        processedFiles: 0,
        successCount: 0,
        failureCount: 0,
        createdAt: new Date(),
        startedAt: null,
        completedAt: null,
        options: {
          language: options.language || 'he-IL',
          enableSpeakerDiarization: options.enableSpeakerDiarization || false,
          customVocabulary: options.customVocabulary || null,
          processingPriority: options.processingPriority || 'normal',
          notifyOnCompletion: options.notifyOnCompletion !== false,
          exportFormat: options.exportFormat || 'json',
          createArchive: options.createArchive !== false,
          ...options
        }
      };

      this.batchJobs.set(batchId, batchJob);
      
      logger.info(`Created batch job ${batchId}`, {
        userId,
        totalFiles: files.length,
        totalSize
      });

      return {
        batchId,
        status: 'created',
        totalFiles: files.length,
        totalSize,
        estimatedDuration: this.estimateBatchDuration(files, options)
      };

    } catch (error) {
      logger.error('Failed to create batch job:', error);
      throw error;
    }
  }

  /**
   * Start batch processing
   */
  async startBatch(batchId) {
    const batchJob = this.batchJobs.get(batchId);
    if (!batchJob) {
      throw new Error('Batch job not found');
    }

    if (batchJob.status !== 'created') {
      throw new Error(`Cannot start batch in status: ${batchJob.status}`);
    }

    try {
      batchJob.status = 'processing';
      batchJob.startedAt = new Date();

      // Queue individual file processing jobs
      const jobPromises = batchJob.files.map(file => {
        return this.processingQueue.add('process-batch-file', {
          batchId,
          fileId: file.id,
          filePath: file.path,
          fileName: file.originalname,
          fileSize: file.size,
          userId: batchJob.userId,
          options: batchJob.options
        }, {
          priority: this.getPriorityLevel(batchJob.options.processingPriority),
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000
          }
        });
      });

      await Promise.all(jobPromises);

      // Queue batch completion job
      await this.processingQueue.add('complete-batch', {
        batchId
      }, {
        delay: batchJob.files.length * 1000, // Delay based on number of files
        priority: 10 // High priority for completion
      });

      logger.info(`Started batch processing ${batchId}`);
      
      return {
        batchId,
        status: 'processing',
        queuedJobs: batchJob.files.length
      };

    } catch (error) {
      batchJob.status = 'failed';
      batchJob.error = error.message;
      logger.error(`Failed to start batch ${batchId}:`, error);
      throw error;
    }
  }

  /**
   * Process individual file in batch
   */
  async processBatchFile(jobData) {
    const { batchId, fileId, filePath, fileName, fileSize, userId, options } = jobData;
    const batchJob = this.batchJobs.get(batchId);
    
    if (!batchJob) {
      throw new Error(`Batch job not found: ${batchId}`);
    }

    const file = batchJob.files.find(f => f.id === fileId);
    if (!file) {
      throw new Error(`File not found in batch: ${fileId}`);
    }

    try {
      file.status = 'processing';
      file.startTime = new Date();

      logger.info(`Processing batch file ${fileId} in batch ${batchId}`);

      // Create transcription using existing service
      const transcription = await transcriptionService.createTranscription({
        originalFilename: fileName,
        filePath: filePath,
        fileSize: fileSize,
        language: options.language,
        enableSpeakerDiarization: options.enableSpeakerDiarization,
        customVocabulary: options.customVocabulary
      }, userId);

      file.transcriptionId = transcription.id;
      file.status = 'completed';
      file.endTime = new Date();
      
      batchJob.processedFiles++;
      batchJob.successCount++;

      logger.info(`Completed batch file ${fileId} in batch ${batchId}`);

      return {
        fileId,
        transcriptionId: transcription.id,
        status: 'completed',
        duration: file.endTime - file.startTime
      };

    } catch (error) {
      file.status = 'failed';
      file.error = error.message;
      file.endTime = new Date();
      
      batchJob.processedFiles++;
      batchJob.failureCount++;

      logger.error(`Failed to process batch file ${fileId}:`, error);

      return {
        fileId,
        status: 'failed',
        error: error.message,
        duration: file.endTime - file.startTime
      };
    }
  }

  /**
   * Complete batch processing
   */
  async completeBatch(jobData) {
    const { batchId } = jobData;
    const batchJob = this.batchJobs.get(batchId);
    
    if (!batchJob) {
      throw new Error(`Batch job not found: ${batchId}`);
    }

    try {
      // Check if all files are processed
      const pendingFiles = batchJob.files.filter(f => f.status === 'pending' || f.status === 'processing');
      
      if (pendingFiles.length > 0) {
        logger.info(`Batch ${batchId} has ${pendingFiles.length} pending files, delaying completion`);
        
        // Re-queue completion check
        await this.processingQueue.add('complete-batch', { batchId }, {
          delay: 30000, // Check again in 30 seconds
          priority: 10
        });
        return;
      }

      batchJob.status = 'completed';
      batchJob.completedAt = new Date();

      // Create batch results summary
      const batchResults = await this.generateBatchResults(batchJob);
      
      // Store results for later retrieval
      this.batchResults.set(batchId, batchResults);

      // Create archive if requested
      if (batchJob.options.createArchive) {
        batchResults.archivePath = await this.createBatchArchive(batchJob, batchResults);
      }

      // Send notifications
      if (batchJob.options.notifyOnCompletion) {
        await this.sendBatchNotifications(batchJob, batchResults);
      }

      logger.info(`Completed batch processing ${batchId}`, {
        totalFiles: batchJob.totalFiles,
        successCount: batchJob.successCount,
        failureCount: batchJob.failureCount,
        processingTime: batchJob.completedAt - batchJob.startedAt
      });

      return batchResults;

    } catch (error) {
      batchJob.status = 'failed';
      batchJob.error = error.message;
      batchJob.completedAt = new Date();
      
      logger.error(`Failed to complete batch ${batchId}:`, error);
      throw error;
    }
  }

  /**
   * Generate comprehensive batch results
   */
  async generateBatchResults(batchJob) {
    const completedFiles = batchJob.files.filter(f => f.status === 'completed');
    const failedFiles = batchJob.files.filter(f => f.status === 'failed');
    
    // Get transcription data for completed files
    const transcriptions = [];
    if (completedFiles.length > 0) {
      const transcriptionIds = completedFiles.map(f => f.transcriptionId);
      const dbTranscriptions = await Transcription.findAll({
        where: { id: transcriptionIds }
      });
      transcriptions.push(...dbTranscriptions);
    }

    // Calculate statistics
    const totalDuration = transcriptions.reduce((sum, t) => sum + (t.duration || 0), 0);
    const totalConfidence = transcriptions.reduce((sum, t) => sum + (t.confidence || 0), 0);
    const avgConfidence = transcriptions.length > 0 ? totalDuration / transcriptions.length : 0;
    const processingTime = (batchJob.completedAt - batchJob.startedAt) / 1000; // in seconds

    const results = {
      batchId: batchJob.id,
      status: batchJob.status,
      createdAt: batchJob.createdAt,
      startedAt: batchJob.startedAt,
      completedAt: batchJob.completedAt,
      processingTime,
      totalFiles: batchJob.totalFiles,
      processedFiles: batchJob.processedFiles,
      successCount: batchJob.successCount,
      failureCount: batchJob.failureCount,
      successRate: (batchJob.successCount / batchJob.totalFiles) * 100,
      statistics: {
        totalAudioDuration: totalDuration,
        averageConfidence: avgConfidence,
        totalTranscriptionLength: transcriptions.reduce((sum, t) => sum + (t.transcriptionText?.length || 0), 0),
        languageDistribution: this.calculateLanguageDistribution(transcriptions),
        speakerDistribution: this.calculateSpeakerDistribution(transcriptions)
      },
      files: batchJob.files.map(file => ({
        id: file.id,
        originalName: file.originalname,
        status: file.status,
        transcriptionId: file.transcriptionId,
        error: file.error,
        processingTime: file.endTime && file.startTime ? 
          (file.endTime - file.startTime) / 1000 : null
      })),
      transcriptions: transcriptions.map(t => ({
        id: t.id,
        originalFilename: t.originalFilename,
        status: t.status,
        confidence: t.confidence,
        duration: t.duration,
        language: t.language,
        transcriptionText: t.transcriptionText?.substring(0, 200) + '...', // Preview only
        speakerCount: t.speakerLabels ? new Set(t.speakerLabels.map(s => s.speaker)).size : 0
      })),
      failedFiles: failedFiles.map(file => ({
        id: file.id,
        originalName: file.originalname,
        error: file.error,
        processingTime: file.endTime && file.startTime ? 
          (file.endTime - file.startTime) / 1000 : null
      })),
      options: batchJob.options
    };

    return results;
  }

  /**
   * Calculate language distribution from transcriptions
   */
  calculateLanguageDistribution(transcriptions) {
    const distribution = {};
    transcriptions.forEach(t => {
      const lang = t.language || 'unknown';
      distribution[lang] = (distribution[lang] || 0) + 1;
    });
    return distribution;
  }

  /**
   * Calculate speaker distribution from transcriptions
   */
  calculateSpeakerDistribution(transcriptions) {
    const distribution = {};
    transcriptions.forEach(t => {
      if (t.speakerLabels && t.speakerLabels.length > 0) {
        const speakerCount = new Set(t.speakerLabels.map(s => s.speaker)).size;
        const key = `${speakerCount} speakers`;
        distribution[key] = (distribution[key] || 0) + 1;
      } else {
        distribution['No speaker data'] = (distribution['No speaker data'] || 0) + 1;
      }
    });
    return distribution;
  }

  /**
   * Create batch archive with all results
   */
  async createBatchArchive(batchJob, batchResults) {
    const archivePath = path.join(
      process.env.TEMP_PATH || './temp',
      `batch_${batchJob.id}_${Date.now()}.zip`
    );

    return new Promise((resolve, reject) => {
      const output = require('fs').createWriteStream(archivePath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        logger.info(`Batch archive created: ${archivePath} (${archive.pointer()} bytes)`);
        resolve(archivePath);
      });

      archive.on('error', (err) => {
        logger.error('Archive creation failed:', err);
        reject(err);
      });

      archive.pipe(output);

      // Add batch results summary
      archive.append(JSON.stringify(batchResults, null, 2), { name: 'batch_results.json' });

      // Add individual transcription files
      batchResults.transcriptions.forEach((transcription, index) => {
        if (transcription.transcriptionText) {
          const fileName = `transcription_${index + 1}_${transcription.originalFilename}.txt`;
          archive.append(transcription.transcriptionText, { name: fileName });
        }
      });

      // Add failed files report
      if (batchResults.failedFiles.length > 0) {
        const failedReport = batchResults.failedFiles.map(file => 
          `File: ${file.originalName}\nError: ${file.error}\nProcessing Time: ${file.processingTime}s\n\n`
        ).join('');
        archive.append(failedReport, { name: 'failed_files_report.txt' });
      }

      archive.finalize();
    });
  }

  /**
   * Send batch completion notifications
   */
  async sendBatchNotifications(batchJob, batchResults) {
    try {
      // Send webhook notifications
      await advancedWebhookService.sendAdvancedWebhook(
        { url: process.env.BATCH_WEBHOOK_URL }, // This should be configurable
        'batch.completed',
        {
          event: 'batch.completed',
          timestamp: new Date().toISOString(),
          data: {
            batchId: batchJob.id,
            userId: batchJob.userId,
            totalFiles: batchResults.totalFiles,
            successCount: batchResults.successCount,
            failureCount: batchResults.failureCount,
            successRate: batchResults.successRate,
            processingTime: batchResults.processingTime,
            statistics: batchResults.statistics
          }
        }
      );

      logger.info(`Sent batch completion notifications for ${batchJob.id}`);
    } catch (error) {
      logger.error(`Failed to send batch notifications for ${batchJob.id}:`, error);
    }
  }

  /**
   * Get batch status and progress
   */
  getBatchStatus(batchId) {
    const batchJob = this.batchJobs.get(batchId);
    if (!batchJob) {
      const cachedResults = this.batchResults.get(batchId);
      if (cachedResults) {
        return {
          ...cachedResults,
          status: 'completed',
          found: true,
          fromCache: true
        };
      }
      return { found: false };
    }

    return {
      batchId: batchJob.id,
      status: batchJob.status,
      totalFiles: batchJob.totalFiles,
      processedFiles: batchJob.processedFiles,
      successCount: batchJob.successCount,
      failureCount: batchJob.failureCount,
      progress: batchJob.totalFiles > 0 ? (batchJob.processedFiles / batchJob.totalFiles) * 100 : 0,
      createdAt: batchJob.createdAt,
      startedAt: batchJob.startedAt,
      completedAt: batchJob.completedAt,
      estimatedTimeRemaining: this.estimateTimeRemaining(batchJob),
      files: batchJob.files.map(file => ({
        id: file.id,
        originalName: file.originalname,
        status: file.status,
        transcriptionId: file.transcriptionId,
        error: file.error
      })),
      found: true,
      fromCache: false
    };
  }

  /**
   * Estimate remaining processing time for batch
   */
  estimateTimeRemaining(batchJob) {
    if (batchJob.status !== 'processing' || batchJob.processedFiles === 0) {
      return null;
    }

    const elapsedTime = (new Date() - batchJob.startedAt) / 1000; // seconds
    const avgTimePerFile = elapsedTime / batchJob.processedFiles;
    const remainingFiles = batchJob.totalFiles - batchJob.processedFiles;
    
    return Math.round(remainingFiles * avgTimePerFile);
  }

  /**
   * Validate batch processing request
   */
  async validateBatchRequest(files, options) {
    if (!files || files.length === 0) {
      throw new Error('No files provided for batch processing');
    }

    if (files.length > this.maxFilesPerBatch) {
      throw new Error(`Too many files. Maximum ${this.maxFilesPerBatch} files per batch`);
    }

    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > this.maxBatchSizeBytes) {
      throw new Error(`Batch size too large. Maximum ${this.maxBatchSizeBytes} bytes`);
    }

    // Validate file types
    const allowedExtensions = ['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac'];
    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!allowedExtensions.includes(ext)) {
        throw new Error(`Unsupported file type: ${ext}`);
      }
    }
  }

  /**
   * Estimate batch processing duration
   */
  estimateBatchDuration(files, options) {
    // Base estimation: 1 minute of processing per 1 minute of audio
    // This is a rough estimate and should be refined based on actual performance data
    const avgFileDuration = 300; // 5 minutes average
    const totalEstimatedDuration = files.length * avgFileDuration;
    
    // Adjust for processing options
    let multiplier = 1;
    if (options.enableSpeakerDiarization) {
      multiplier *= 1.5; // Speaker diarization adds processing time
    }
    if (options.customVocabulary) {
      multiplier *= 1.2; // Custom vocabulary adds processing time
    }

    return Math.round(totalEstimatedDuration * multiplier);
  }

  /**
   * Get priority level for queue
   */
  getPriorityLevel(priorityString) {
    const priorities = {
      'low': 1,
      'normal': 5,
      'high': 8,
      'urgent': 10
    };
    return priorities[priorityString] || priorities['normal'];
  }

  /**
   * Cancel batch processing
   */
  async cancelBatch(batchId, userId) {
    const batchJob = this.batchJobs.get(batchId);
    if (!batchJob) {
      throw new Error('Batch job not found');
    }

    if (batchJob.userId !== userId) {
      throw new Error('Unauthorized to cancel this batch');
    }

    if (batchJob.status === 'completed' || batchJob.status === 'cancelled') {
      throw new Error(`Cannot cancel batch in status: ${batchJob.status}`);
    }

    try {
      // Cancel pending queue jobs
      const jobs = await this.processingQueue.getJobs(['waiting', 'active']);
      const batchJobs = jobs.filter(job => 
        job.data.batchId === batchId
      );

      for (const job of batchJobs) {
        await job.remove();
      }

      batchJob.status = 'cancelled';
      batchJob.completedAt = new Date();

      logger.info(`Cancelled batch processing ${batchId}`);

      return {
        batchId,
        status: 'cancelled',
        cancelledJobs: batchJobs.length
      };

    } catch (error) {
      logger.error(`Failed to cancel batch ${batchId}:`, error);
      throw error;
    }
  }

  /**
   * Get batch processing statistics
   */
  getBatchStatistics(timeRange = '24h') {
    const cutoffTime = this.getCutoffTime(timeRange);
    const recentBatches = Array.from(this.batchJobs.values())
      .concat(Array.from(this.batchResults.values()))
      .filter(batch => new Date(batch.createdAt) >= cutoffTime);

    const totalBatches = recentBatches.length;
    const completedBatches = recentBatches.filter(b => b.status === 'completed').length;
    const failedBatches = recentBatches.filter(b => b.status === 'failed').length;
    const totalFiles = recentBatches.reduce((sum, b) => sum + (b.totalFiles || 0), 0);
    const totalSuccessfulFiles = recentBatches.reduce((sum, b) => sum + (b.successCount || 0), 0);

    return {
      timeRange,
      totalBatches,
      completedBatches,
      failedBatches,
      successRate: totalBatches > 0 ? (completedBatches / totalBatches) * 100 : 0,
      totalFiles,
      totalSuccessfulFiles,
      fileSuccessRate: totalFiles > 0 ? (totalSuccessfulFiles / totalFiles) * 100 : 0,
      averageBatchSize: totalBatches > 0 ? totalFiles / totalBatches : 0,
      activeBatches: Array.from(this.batchJobs.values()).filter(b => 
        b.status === 'processing' || b.status === 'created'
      ).length
    };
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

  /**
   * Cleanup old batch data
   */
  cleanupOldBatches() {
    const cutoffTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days
    
    // Clean up completed batch jobs
    for (const [batchId, batchJob] of this.batchJobs.entries()) {
      if (batchJob.completedAt && new Date(batchJob.completedAt) < cutoffTime) {
        this.batchJobs.delete(batchId);
      }
    }

    // Clean up old results cache
    for (const [batchId, results] of this.batchResults.entries()) {
      if (new Date(results.completedAt) < cutoffTime) {
        this.batchResults.delete(batchId);
      }
    }

    logger.debug(`Batch cleanup completed. ${this.batchJobs.size} active jobs, ${this.batchResults.size} cached results`);
  }
}

module.exports = new BatchService();