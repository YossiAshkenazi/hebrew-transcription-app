const logger = require('../utils/logger');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const redis = require('../config/redis');
const transcriptionService = require('./transcriptionService');
const batchService = require('./batchService');
const workflowService = require('./workflowService');

/**
 * Real-time Service with WebSocket Integration
 * Provides live updates, progress streaming, and collaborative features
 */
class RealtimeService {
  constructor() {
    this.io = null;
    this.connectedUsers = new Map(); // userId -> socket connections
    this.activeStreams = new Map(); // streamId -> stream data
    this.liveTranscriptions = new Map(); // transcriptionId -> live data
    this.collaborationSessions = new Map(); // sessionId -> collaboration data
    this.progressTrackers = new Map(); // taskId -> progress data
    
    this.rooms = {
      TRANSCRIPTIONS: 'transcriptions',
      BATCH_PROCESSING: 'batch_processing',
      WORKFLOWS: 'workflows',
      ADMIN: 'admin',
      USER_PREFIX: 'user_'
    };
  }

  /**
   * Initialize WebSocket server
   */
  initialize(server) {
    this.io = new Server(server, {
      cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:3000",
        methods: ["GET", "POST"],
        credentials: true
      },
      transports: ['websocket', 'polling']
    });

    this.setupMiddleware();
    this.setupEventHandlers();
    this.startPeriodicUpdates();

    logger.info('Real-time service initialized with WebSocket support');
  }

  /**
   * Setup authentication middleware
   */
  setupMiddleware() {
    this.io.use((socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
          return next(new Error('Authentication token required'));
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.userId = decoded.userId;
        socket.userRole = decoded.role;
        
        logger.debug(`WebSocket authentication successful for user ${decoded.userId}`);
        next();
      } catch (error) {
        logger.error('WebSocket authentication failed:', error);
        next(new Error('Authentication failed'));
      }
    });
  }

  /**
   * Setup WebSocket event handlers
   */
  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      this.handleConnection(socket);
    });
  }

  /**
   * Handle new WebSocket connection
   */
  handleConnection(socket) {
    const userId = socket.userId;
    const userRole = socket.userRole;

    logger.info(`User ${userId} connected via WebSocket`);

    // Track user connection
    if (!this.connectedUsers.has(userId)) {
      this.connectedUsers.set(userId, new Set());
    }
    this.connectedUsers.get(userId).add(socket);

    // Join user-specific room
    socket.join(`${this.rooms.USER_PREFIX}${userId}`);
    
    // Join role-based rooms
    if (userRole === 'admin') {
      socket.join(this.rooms.ADMIN);
    }

    // Send initial connection data
    socket.emit('connected', {
      userId,
      timestamp: new Date().toISOString(),
      activeFeatures: this.getActiveFeatures()
    });

    // Setup event handlers for this socket
    this.setupSocketHandlers(socket);

    // Handle disconnection
    socket.on('disconnect', () => {
      this.handleDisconnection(socket);
    });
  }

  /**
   * Setup individual socket event handlers
   */
  setupSocketHandlers(socket) {
    const userId = socket.userId;

    // Transcription events
    socket.on('subscribe:transcription', (data) => {
      this.handleTranscriptionSubscription(socket, data);
    });

    socket.on('unsubscribe:transcription', (data) => {
      this.handleTranscriptionUnsubscription(socket, data);
    });

    // Batch processing events
    socket.on('subscribe:batch', (data) => {
      this.handleBatchSubscription(socket, data);
    });

    socket.on('unsubscribe:batch', (data) => {
      this.handleBatchUnsubscription(socket, data);
    });

    // Workflow events
    socket.on('subscribe:workflow', (data) => {
      this.handleWorkflowSubscription(socket, data);
    });

    // Live transcription events
    socket.on('start:live_transcription', (data) => {
      this.handleStartLiveTranscription(socket, data);
    });

    socket.on('stop:live_transcription', (data) => {
      this.handleStopLiveTranscription(socket, data);
    });

    socket.on('audio:chunk', (data) => {
      this.handleAudioChunk(socket, data);
    });

    // Collaboration events
    socket.on('join:collaboration', (data) => {
      this.handleJoinCollaboration(socket, data);
    });

    socket.on('leave:collaboration', (data) => {
      this.handleLeaveCollaboration(socket, data);
    });

    socket.on('collaboration:edit', (data) => {
      this.handleCollaborationEdit(socket, data);
    });

    socket.on('collaboration:cursor', (data) => {
      this.handleCollaborationCursor(socket, data);
    });

    // Progress tracking
    socket.on('subscribe:progress', (data) => {
      this.handleProgressSubscription(socket, data);
    });

    // Heartbeat
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: new Date().toISOString() });
    });
  }

  /**
   * Handle user disconnection
   */
  handleDisconnection(socket) {
    const userId = socket.userId;
    
    logger.info(`User ${userId} disconnected from WebSocket`);

    // Remove from connected users
    if (this.connectedUsers.has(userId)) {
      this.connectedUsers.get(userId).delete(socket);
      if (this.connectedUsers.get(userId).size === 0) {
        this.connectedUsers.delete(userId);
      }
    }

    // Clean up any active streams for this user
    this.cleanupUserStreams(userId);
    
    // Leave collaboration sessions
    this.leaveAllCollaborations(socket);
  }

  /**
   * Handle transcription subscription
   */
  handleTranscriptionSubscription(socket, data) {
    const { transcriptionId } = data;
    const roomName = `transcription:${transcriptionId}`;
    
    socket.join(roomName);
    
    // Send current status if available
    const currentStatus = this.getTranscriptionStatus(transcriptionId);
    if (currentStatus) {
      socket.emit('transcription:status', currentStatus);
    }

    logger.debug(`User ${socket.userId} subscribed to transcription ${transcriptionId}`);
  }

  /**
   * Handle batch subscription
   */
  handleBatchSubscription(socket, data) {
    const { batchId } = data;
    const roomName = `batch:${batchId}`;
    
    socket.join(roomName);
    
    // Send current status
    const currentStatus = batchService.getBatchStatus(batchId);
    if (currentStatus.found) {
      socket.emit('batch:status', currentStatus);
    }

    logger.debug(`User ${socket.userId} subscribed to batch ${batchId}`);
  }

  /**
   * Handle workflow subscription
   */
  handleWorkflowSubscription(socket, data) {
    const { workflowId } = data;
    const roomName = `workflow:${workflowId}`;
    
    socket.join(roomName);
    
    // Send current status
    const currentStatus = workflowService.getWorkflowStatus(workflowId);
    if (currentStatus.found) {
      socket.emit('workflow:status', currentStatus);
    }

    logger.debug(`User ${socket.userId} subscribed to workflow ${workflowId}`);
  }

  /**
   * Handle live transcription start
   */
  async handleStartLiveTranscription(socket, data) {
    try {
      const { language = 'he-IL', options = {} } = data;
      const streamId = uuidv4();
      const userId = socket.userId;

      const stream = {
        id: streamId,
        userId,
        language,
        options,
        status: 'active',
        startTime: new Date(),
        transcriptionBuffer: '',
        chunks: [],
        socketId: socket.id
      };

      this.activeStreams.set(streamId, stream);
      socket.streamId = streamId;

      // Join live transcription room
      socket.join(`live:${streamId}`);

      socket.emit('live_transcription:started', {
        streamId,
        status: 'active',
        timestamp: new Date().toISOString()
      });

      logger.info(`Started live transcription stream ${streamId} for user ${userId}`);

    } catch (error) {
      socket.emit('live_transcription:error', {
        error: error.message,
        timestamp: new Date().toISOString()
      });
      logger.error('Failed to start live transcription:', error);
    }
  }

  /**
   * Handle live transcription stop
   */
  async handleStopLiveTranscription(socket, data) {
    try {
      const streamId = socket.streamId || data.streamId;
      if (!streamId || !this.activeStreams.has(streamId)) {
        return;
      }

      const stream = this.activeStreams.get(streamId);
      stream.status = 'completed';
      stream.endTime = new Date();

      // Process final transcription if needed
      if (stream.transcriptionBuffer) {
        await this.processFinalLiveTranscription(stream);
      }

      this.activeStreams.delete(streamId);
      socket.leave(`live:${streamId}`);
      delete socket.streamId;

      socket.emit('live_transcription:stopped', {
        streamId,
        finalTranscription: stream.transcriptionBuffer,
        duration: stream.endTime - stream.startTime,
        timestamp: new Date().toISOString()
      });

      logger.info(`Stopped live transcription stream ${streamId}`);

    } catch (error) {
      socket.emit('live_transcription:error', {
        error: error.message,
        timestamp: new Date().toISOString()
      });
      logger.error('Failed to stop live transcription:', error);
    }
  }

  /**
   * Handle audio chunk for live transcription
   */
  async handleAudioChunk(socket, data) {
    try {
      const streamId = socket.streamId;
      if (!streamId || !this.activeStreams.has(streamId)) {
        return;
      }

      const stream = this.activeStreams.get(streamId);
      const { audioData, chunkIndex, isLast = false } = data;

      // Store audio chunk
      stream.chunks.push({
        index: chunkIndex,
        data: audioData,
        timestamp: new Date(),
        processed: false
      });

      // Process chunk for real-time transcription
      // This is a simplified implementation - in production, you'd integrate with a real-time STT service
      const transcriptionResult = await this.processAudioChunk(audioData, stream.language, stream.options);
      
      if (transcriptionResult.text) {
        stream.transcriptionBuffer += transcriptionResult.text + ' ';
        
        // Emit real-time transcription update
        socket.emit('live_transcription:update', {
          streamId,
          partialText: transcriptionResult.text,
          fullText: stream.transcriptionBuffer,
          confidence: transcriptionResult.confidence,
          timestamp: new Date().toISOString()
        });

        // Broadcast to collaboration room if in collaborative mode
        if (stream.options.collaborative) {
          socket.to(`live:${streamId}`).emit('live_transcription:collaborative_update', {
            streamId,
            partialText: transcriptionResult.text,
            userId: socket.userId,
            timestamp: new Date().toISOString()
          });
        }
      }

      if (isLast) {
        await this.handleStopLiveTranscription(socket, { streamId });
      }

    } catch (error) {
      socket.emit('live_transcription:error', {
        error: error.message,
        timestamp: new Date().toISOString()
      });
      logger.error('Failed to process audio chunk:', error);
    }
  }

  /**
   * Handle collaboration join
   */
  handleJoinCollaboration(socket, data) {
    const { sessionId, transcriptionId } = data;
    const userId = socket.userId;

    if (!this.collaborationSessions.has(sessionId)) {
      this.collaborationSessions.set(sessionId, {
        id: sessionId,
        transcriptionId,
        participants: new Map(),
        document: '',
        changes: [],
        createdAt: new Date()
      });
    }

    const session = this.collaborationSessions.get(sessionId);
    session.participants.set(userId, {
      userId,
      socketId: socket.id,
      joinedAt: new Date(),
      cursor: { line: 0, column: 0 }
    });

    socket.join(`collaboration:${sessionId}`);

    // Send current document state
    socket.emit('collaboration:joined', {
      sessionId,
      document: session.document,
      participants: Array.from(session.participants.values()).map(p => ({
        userId: p.userId,
        cursor: p.cursor
      })),
      timestamp: new Date().toISOString()
    });

    // Notify other participants
    socket.to(`collaboration:${sessionId}`).emit('collaboration:user_joined', {
      userId,
      timestamp: new Date().toISOString()
    });

    logger.debug(`User ${userId} joined collaboration session ${sessionId}`);
  }

  /**
   * Handle collaboration edit
   */
  handleCollaborationEdit(socket, data) {
    const { sessionId, operation, position, content } = data;
    const userId = socket.userId;

    if (!this.collaborationSessions.has(sessionId)) {
      return;
    }

    const session = this.collaborationSessions.get(sessionId);
    
    // Apply operation to document
    const change = {
      id: uuidv4(),
      userId,
      operation,
      position,
      content,
      timestamp: new Date()
    };

    session.changes.push(change);
    
    // Update document (simplified - in production, use operational transforms)
    switch (operation) {
      case 'insert':
        session.document = session.document.slice(0, position) + content + session.document.slice(position);
        break;
      case 'delete':
        session.document = session.document.slice(0, position) + session.document.slice(position + content.length);
        break;
      case 'replace':
        session.document = session.document.slice(0, position) + content + session.document.slice(position + data.length);
        break;
    }

    // Broadcast change to other participants
    socket.to(`collaboration:${sessionId}`).emit('collaboration:change', {
      change,
      document: session.document,
      timestamp: new Date().toISOString()
    });

    logger.debug(`Collaboration edit in session ${sessionId} by user ${userId}`);
  }

  /**
   * Update transcription progress
   */
  updateTranscriptionProgress(transcriptionId, progress) {
    const update = {
      transcriptionId,
      progress: Math.round(progress * 100),
      status: progress < 1 ? 'processing' : 'completed',
      timestamp: new Date().toISOString()
    };

    // Emit to transcription room
    this.io.to(`transcription:${transcriptionId}`).emit('transcription:progress', update);

    // Store progress for late subscribers
    this.progressTrackers.set(transcriptionId, update);

    logger.debug(`Transcription ${transcriptionId} progress: ${Math.round(progress * 100)}%`);
  }

  /**
   * Update batch processing progress
   */
  updateBatchProgress(batchId, batchStatus) {
    const update = {
      batchId,
      ...batchStatus,
      timestamp: new Date().toISOString()
    };

    this.io.to(`batch:${batchId}`).emit('batch:progress', update);
    logger.debug(`Batch ${batchId} progress: ${batchStatus.progress}%`);
  }

  /**
   * Update workflow progress
   */
  updateWorkflowProgress(workflowId, workflowStatus) {
    const update = {
      workflowId,
      ...workflowStatus,
      timestamp: new Date().toISOString()
    };

    this.io.to(`workflow:${workflowId}`).emit('workflow:progress', update);
    logger.debug(`Workflow ${workflowId} status: ${workflowStatus.status}`);
  }

  /**
   * Send notification to user
   */
  sendNotificationToUser(userId, notification) {
    const userRoom = `${this.rooms.USER_PREFIX}${userId}`;
    this.io.to(userRoom).emit('notification', {
      ...notification,
      timestamp: new Date().toISOString()
    });

    logger.debug(`Sent notification to user ${userId}: ${notification.type}`);
  }

  /**
   * Broadcast system announcement
   */
  broadcastSystemAnnouncement(announcement) {
    this.io.emit('system:announcement', {
      ...announcement,
      timestamp: new Date().toISOString()
    });

    logger.info('Broadcasted system announcement:', announcement.message);
  }

  /**
   * Send admin alert
   */
  sendAdminAlert(alert) {
    this.io.to(this.rooms.ADMIN).emit('admin:alert', {
      ...alert,
      timestamp: new Date().toISOString()
    });

    logger.warn('Sent admin alert:', alert.message);
  }

  /**
   * Get active features for user
   */
  getActiveFeatures() {
    return {
      liveTranscription: true,
      batchProcessing: true,
      workflowAutomation: true,
      collaboration: true,
      realTimeNotifications: true,
      progressTracking: true
    };
  }

  /**
   * Get transcription status
   */
  getTranscriptionStatus(transcriptionId) {
    // This would typically fetch from database or cache
    return this.progressTrackers.get(transcriptionId) || null;
  }

  /**
   * Process audio chunk for live transcription
   */
  async processAudioChunk(audioData, language, options) {
    // Simplified implementation - in production, integrate with real-time STT
    // This would send the audio chunk to a real-time transcription service
    
    try {
      // Simulate processing delay and response
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Mock transcription result
      const mockTexts = [
        'שלום',
        'איך שלומך',
        'מה נשמע',
        'בסדר גמור',
        'תודה רבה'
      ];
      
      const randomText = mockTexts[Math.floor(Math.random() * mockTexts.length)];
      
      return {
        text: randomText,
        confidence: 0.85 + Math.random() * 0.15,
        isPartial: Math.random() > 0.7
      };
      
    } catch (error) {
      logger.error('Audio chunk processing failed:', error);
      return { text: '', confidence: 0 };
    }
  }

  /**
   * Process final live transcription
   */
  async processFinalLiveTranscription(stream) {
    try {
      // Create permanent transcription record
      // This would integrate with the main transcription service
      logger.info(`Processing final live transcription for stream ${stream.id}`);
      
      // For now, just log the final result
      logger.debug('Final transcription:', stream.transcriptionBuffer);
      
    } catch (error) {
      logger.error('Failed to process final live transcription:', error);
    }
  }

  /**
   * Clean up user streams
   */
  cleanupUserStreams(userId) {
    const streamsToRemove = [];
    
    for (const [streamId, stream] of this.activeStreams.entries()) {
      if (stream.userId === userId) {
        streamsToRemove.push(streamId);
      }
    }
    
    streamsToRemove.forEach(streamId => {
      this.activeStreams.delete(streamId);
      logger.debug(`Cleaned up stream ${streamId} for disconnected user ${userId}`);
    });
  }

  /**
   * Leave all collaborations for socket
   */
  leaveAllCollaborations(socket) {
    const userId = socket.userId;
    
    for (const [sessionId, session] of this.collaborationSessions.entries()) {
      if (session.participants.has(userId)) {
        session.participants.delete(userId);
        
        // Notify other participants
        socket.to(`collaboration:${sessionId}`).emit('collaboration:user_left', {
          userId,
          timestamp: new Date().toISOString()
        });
        
        // Clean up empty sessions
        if (session.participants.size === 0) {
          this.collaborationSessions.delete(sessionId);
          logger.debug(`Removed empty collaboration session ${sessionId}`);
        }
      }
    }
  }

  /**
   * Start periodic updates
   */
  startPeriodicUpdates() {
    // Send system status every 30 seconds
    setInterval(() => {
      this.broadcastSystemStatus();
    }, 30000);

    // Cleanup expired sessions every 5 minutes
    setInterval(() => {
      this.cleanupExpiredSessions();
    }, 300000);

    // Send heartbeat every minute
    setInterval(() => {
      this.sendHeartbeat();
    }, 60000);
  }

  /**
   * Broadcast system status
   */
  broadcastSystemStatus() {
    const status = {
      connectedUsers: this.connectedUsers.size,
      activeStreams: this.activeStreams.size,
      collaborationSessions: this.collaborationSessions.size,
      timestamp: new Date().toISOString()
    };

    this.io.to(this.rooms.ADMIN).emit('system:status', status);
  }

  /**
   * Cleanup expired sessions
   */
  cleanupExpiredSessions() {
    const now = new Date();
    const expirationTime = 24 * 60 * 60 * 1000; // 24 hours

    // Clean up old collaboration sessions
    for (const [sessionId, session] of this.collaborationSessions.entries()) {
      if (now - session.createdAt > expirationTime) {
        this.collaborationSessions.delete(sessionId);
        logger.debug(`Cleaned up expired collaboration session ${sessionId}`);
      }
    }

    // Clean up old progress trackers
    for (const [trackerId, tracker] of this.progressTrackers.entries()) {
      if (now - new Date(tracker.timestamp) > expirationTime) {
        this.progressTrackers.delete(trackerId);
      }
    }
  }

  /**
   * Send heartbeat to all connected clients
   */
  sendHeartbeat() {
    this.io.emit('heartbeat', {
      timestamp: new Date().toISOString(),
      serverTime: Date.now()
    });
  }

  /**
   * Get real-time statistics
   */
  getRealTimeStatistics() {
    return {
      connectedUsers: this.connectedUsers.size,
      activeStreams: this.activeStreams.size,
      collaborationSessions: this.collaborationSessions.size,
      progressTrackers: this.progressTrackers.size,
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Handle graceful shutdown
   */
  shutdown() {
    if (this.io) {
      // Notify all clients about shutdown
      this.io.emit('system:shutdown', {
        message: 'Server is shutting down',
        timestamp: new Date().toISOString()
      });

      // Close all connections after a brief delay
      setTimeout(() => {
        this.io.close();
        logger.info('Real-time service shut down gracefully');
      }, 1000);
    }
  }
}

module.exports = new RealtimeService();