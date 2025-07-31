const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Transcription = sequelize.define('Transcription', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: true, // Allow anonymous uploads
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  originalFilename: {
    type: DataTypes.STRING,
    allowNull: false
  },
  fileSize: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  mimeType: {
    type: DataTypes.STRING,
    allowNull: false
  },
  duration: {
    type: DataTypes.FLOAT, // Duration in seconds
    allowNull: true
  },
  s3Key: {
    type: DataTypes.STRING,
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('pending', 'processing', 'completed', 'failed', 'cancelled'),
    defaultValue: 'pending'
  },
  transcriptionText: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  speakerLabels: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'Array of speaker segments with timestamps'
  },
  confidence: {
    type: DataTypes.FLOAT,
    allowNull: true,
    validate: {
      min: 0,
      max: 1
    }
  },
  lowConfidenceWords: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'Array of words with low confidence scores'
  },
  language: {
    type: DataTypes.STRING,
    defaultValue: 'he-IL'
  },
  processingTime: {
    type: DataTypes.INTEGER, // Time in milliseconds
    allowNull: true
  },
  errorMessage: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {},
    comment: 'Additional metadata from transcription service'
  },
  deliveryEmail: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      isEmail: true
    }
  },
  emailSent: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  emailSentAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  webhookSent: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  webhookSentAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  webhookAttempts: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'When the audio file should be automatically deleted'
  }
}, {
  indexes: [
    {
      fields: ['userId']
    },
    {
      fields: ['status']
    },
    {
      fields: ['createdAt']
    },
    {
      fields: ['expiresAt']
    }
  ]
});

// Instance methods
Transcription.prototype.getPublicData = function() {
  const data = this.toJSON();
  delete data.s3Key;
  delete data.userId;
  return data;
};

Transcription.prototype.isExpired = function() {
  return this.expiresAt && new Date() > this.expiresAt;
};

Transcription.prototype.canBeDeleted = function() {
  const completedStates = ['completed', 'failed', 'cancelled'];
  return completedStates.includes(this.status) && this.isExpired();
};

module.exports = Transcription;
