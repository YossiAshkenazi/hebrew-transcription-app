const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const WebhookConfig = sequelize.define('WebhookConfig', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'Human-readable name for this webhook'
  },
  url: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      isUrl: true
    }
  },
  method: {
    type: DataTypes.ENUM('POST', 'PUT', 'PATCH'),
    defaultValue: 'POST'
  },
  headers: {
    type: DataTypes.JSONB,
    defaultValue: {},
    comment: 'Custom headers to send with the webhook'
  },
  secret: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Secret for webhook signature verification'
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  events: {
    type: DataTypes.ARRAY(DataTypes.STRING),
    defaultValue: ['transcription.completed'],
    comment: 'Events that trigger this webhook'
  },
  retryAttempts: {
    type: DataTypes.INTEGER,
    defaultValue: 3,
    validate: {
      min: 0,
      max: 10
    }
  },
  timeout: {
    type: DataTypes.INTEGER,
    defaultValue: 30000, // 30 seconds
    comment: 'Timeout in milliseconds'
  },
  lastTriggeredAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  lastSuccessAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  lastFailureAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  lastFailureReason: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  totalTriggers: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  totalSuccesses: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  totalFailures: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  }
}, {
  indexes: [
    {
      fields: ['userId']
    },
    {
      fields: ['isActive']
    }
  ]
});

// Instance methods
WebhookConfig.prototype.getSuccessRate = function() {
  if (this.totalTriggers === 0) return 0;
  return (this.totalSuccesses / this.totalTriggers) * 100;
};

WebhookConfig.prototype.incrementTrigger = function() {
  this.totalTriggers += 1;
  this.lastTriggeredAt = new Date();
};

WebhookConfig.prototype.recordSuccess = function() {
  this.totalSuccesses += 1;
  this.lastSuccessAt = new Date();
};

WebhookConfig.prototype.recordFailure = function(reason) {
  this.totalFailures += 1;
  this.lastFailureAt = new Date();
  this.lastFailureReason = reason;
};

module.exports = WebhookConfig;
