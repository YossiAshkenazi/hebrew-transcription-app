const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const bcrypt = require('bcryptjs');

const User = sequelize.define('User', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true
    }
  },
  password: {
    type: DataTypes.STRING,
    allowNull: true // Allow null for OAuth users
  },
  firstName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  lastName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  emailVerified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  emailVerificationToken: {
    type: DataTypes.STRING,
    allowNull: true
  },
  resetPasswordToken: {
    type: DataTypes.STRING,
    allowNull: true
  },
  resetPasswordExpires: {
    type: DataTypes.DATE,
    allowNull: true
  },
  lastLoginAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  settings: {
    type: DataTypes.JSONB,
    defaultValue: {
      notifications: {
        email: true,
        webhooks: false
      },
      transcription: {
        autoDelete: 30, // days
        language: 'he-IL',
        speakerDetection: true
      }
    }
  },
  // Security fields
  failedLoginAttempts: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  lastFailedLoginAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  lockedUntil: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // MFA fields
  mfaEnabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  mfaSecret: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  mfaBackupCodes: {
    type: DataTypes.JSONB,
    defaultValue: []
  },
  // API Keys
  apiKeys: {
    type: DataTypes.JSONB,
    defaultValue: []
  },
  // Security preferences
  securitySettings: {
    type: DataTypes.JSONB,
    defaultValue: {
      loginNotifications: true,
      suspiciousActivityAlerts: true,
      sessionTimeout: 24 * 60 * 60 * 1000, // 24 hours
      requireMfaForSensitiveOps: false,
      allowedIPs: [], // IP whitelist
      trustedDevices: []
    }
  },
  // GDPR and privacy
  privacySettings: {
    type: DataTypes.JSONB,
    defaultValue: {
      dataRetentionDays: 365,
      allowDataProcessing: true,
      allowAnalytics: true,
      allowMarketing: false,
      consentDate: null,
      consentVersion: '1.0'
    }
  },
  // OAuth fields
  oauthProviders: {
    type: DataTypes.JSONB,
    defaultValue: []
  },
  // Password security
  passwordHistory: {
    type: DataTypes.JSONB,
    defaultValue: []
  },
  passwordChangedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // Account verification and recovery
  phoneNumber: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      is: /^[\+]?[1-9][\d]{0,15}$/
    }
  },
  phoneVerified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  // Session management
  activeSessions: {
    type: DataTypes.JSONB,
    defaultValue: []
  },
  // Audit trail
  lastPasswordChange: {
    type: DataTypes.DATE,
    allowNull: true
  },
  lastSecurityUpdate: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // Risk scoring
  riskScore: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    validate: {
      min: 0,
      max: 100
    }
  },
  riskFactors: {
    type: DataTypes.JSONB,
    defaultValue: []
  }
}, {
  hooks: {
    beforeCreate: async (user) => {
      if (user.password) {
        const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12;
        user.password = await bcrypt.hash(user.password, saltRounds);
      }
    },
    beforeUpdate: async (user) => {
      if (user.changed('password') && user.password) {
        const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12;
        user.password = await bcrypt.hash(user.password, saltRounds);
      }
    }
  }
});

// Instance methods
User.prototype.validatePassword = async function(password) {
  if (!this.password) return false;
  return bcrypt.compare(password, this.password);
};

User.prototype.getFullName = function() {
  return `${this.firstName} ${this.lastName}`;
};

User.prototype.toJSON = function() {
  const values = { ...this.get() };
  delete values.password;
  delete values.emailVerificationToken;
  delete values.resetPasswordToken;
  delete values.mfaSecret;
  delete values.mfaBackupCodes;
  delete values.passwordHistory;
  return values;
};

// Security methods
User.prototype.isAccountLocked = function() {
  return this.lockedUntil && this.lockedUntil > new Date();
};

User.prototype.incrementFailedLogin = async function() {
  this.failedLoginAttempts = (this.failedLoginAttempts || 0) + 1;
  this.lastFailedLoginAt = new Date();
  
  // Lock account after max failed attempts
  const maxAttempts = parseInt(process.env.MAX_FAILED_LOGIN_ATTEMPTS) || 5;
  const lockoutDuration = parseInt(process.env.LOCKOUT_DURATION) || 30 * 60 * 1000; // 30 minutes
  
  if (this.failedLoginAttempts >= maxAttempts) {
    this.lockedUntil = new Date(Date.now() + lockoutDuration);
  }
  
  await this.save();
};

User.prototype.resetFailedLogin = async function() {
  this.failedLoginAttempts = 0;
  this.lastFailedLoginAt = null;
  this.lockedUntil = null;
  await this.save();
};

User.prototype.addPasswordToHistory = async function(hashedPassword) {
  const maxHistory = parseInt(process.env.PASSWORD_HISTORY_COUNT) || 5;
  const history = this.passwordHistory || [];
  
  history.unshift({
    password: hashedPassword,
    changedAt: new Date().toISOString()
  });
  
  // Keep only the last N passwords
  this.passwordHistory = history.slice(0, maxHistory);
  this.lastPasswordChange = new Date();
  await this.save();
};

User.prototype.isPasswordInHistory = function(password) {
  const history = this.passwordHistory || [];
  
  for (const entry of history) {
    if (bcrypt.compareSync(password, entry.password)) {
      return true;
    }
  }
  
  return false;
};

User.prototype.addOAuthProvider = async function(provider, providerData) {
  const providers = this.oauthProviders || [];
  
  // Remove existing provider data if it exists
  const filteredProviders = providers.filter(p => p.provider !== provider);
  
  // Add new provider data
  filteredProviders.push({
    provider,
    providerId: providerData.id,
    email: providerData.email,
    connectedAt: new Date().toISOString(),
    ...providerData
  });
  
  this.oauthProviders = filteredProviders;
  await this.save();
};

User.prototype.removeOAuthProvider = async function(provider) {
  const providers = this.oauthProviders || [];
  this.oauthProviders = providers.filter(p => p.provider !== provider);
  await this.save();
};

User.prototype.hasOAuthProvider = function(provider) {
  const providers = this.oauthProviders || [];
  return providers.some(p => p.provider === provider);
};

User.prototype.updateRiskScore = async function(factors = []) {
  const baseScore = 0;
  let score = baseScore;
  
  // Calculate risk based on various factors
  factors.forEach(factor => {
    switch (factor.type) {
      case 'failed_login':
        score += Math.min(factor.count * 5, 25);
        break;
      case 'unusual_location':
        score += 15;
        break;
      case 'suspicious_activity':
        score += 20;
        break;
      case 'weak_password':
        score += 10;
        break;
      case 'no_mfa':
        score += 10;
        break;
      default:
        score += factor.score || 0;
    }
  });
  
  // Cap the score at 100
  this.riskScore = Math.min(score, 100);
  this.riskFactors = factors;
  await this.save();
  
  return this.riskScore;
};

User.prototype.addTrustedDevice = async function(deviceInfo) {
  const settings = this.securitySettings || {};
  const trustedDevices = settings.trustedDevices || [];
  
  const deviceFingerprint = require('crypto')
    .createHash('sha256')
    .update(JSON.stringify(deviceInfo))
    .digest('hex');
  
  // Remove existing device if it exists
  const filteredDevices = trustedDevices.filter(d => d.fingerprint !== deviceFingerprint);
  
  // Add new device
  filteredDevices.push({
    fingerprint: deviceFingerprint,
    name: deviceInfo.name || 'Unknown Device',
    userAgent: deviceInfo.userAgent,
    ip: deviceInfo.ip,
    addedAt: new Date().toISOString(),
    lastUsed: new Date().toISOString()
  });
  
  // Keep only last 10 devices
  settings.trustedDevices = filteredDevices.slice(-10);
  this.securitySettings = settings;
  await this.save();
  
  return deviceFingerprint;
};

User.prototype.isTrustedDevice = function(deviceInfo) {
  const settings = this.securitySettings || {};
  const trustedDevices = settings.trustedDevices || [];
  
  const deviceFingerprint = require('crypto')
    .createHash('sha256')
    .update(JSON.stringify(deviceInfo))
    .digest('hex');
  
  return trustedDevices.some(d => d.fingerprint === deviceFingerprint);
};

User.prototype.updateConsent = async function(consentData) {
  const privacy = this.privacySettings || {};
  
  privacy.consentDate = new Date().toISOString();
  privacy.consentVersion = consentData.version || '1.0';
  privacy.allowDataProcessing = consentData.allowDataProcessing || false;
  privacy.allowAnalytics = consentData.allowAnalytics || false;
  privacy.allowMarketing = consentData.allowMarketing || false;
  
  this.privacySettings = privacy;
  await this.save();
};

User.prototype.hasConsent = function(type) {
  const privacy = this.privacySettings || {};
  
  switch (type) {
    case 'data_processing':
      return privacy.allowDataProcessing === true;
    case 'analytics':
      return privacy.allowAnalytics === true;
    case 'marketing':
      return privacy.allowMarketing === true;
    default:
      return false;
  }
};

User.prototype.shouldDeleteData = function() {
  const privacy = this.privacySettings || {};
  const retentionDays = privacy.dataRetentionDays || 365;
  const lastLogin = this.lastLoginAt || this.createdAt;
  
  const daysSinceLastLogin = Math.floor((Date.now() - new Date(lastLogin).getTime()) / (1000 * 60 * 60 * 24));
  
  return daysSinceLastLogin >= retentionDays;
};

module.exports = User;
