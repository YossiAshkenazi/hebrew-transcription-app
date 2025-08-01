'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Add security-related columns to Users table
    await queryInterface.addColumn('Users', 'failedLoginAttempts', {
      type: Sequelize.INTEGER,
      defaultValue: 0,
      allowNull: false
    });

    await queryInterface.addColumn('Users', 'lastFailedLoginAt', {
      type: Sequelize.DATE,
      allowNull: true
    });

    await queryInterface.addColumn('Users', 'lockedUntil', {
      type: Sequelize.DATE,
      allowNull: true
    });

    // MFA fields
    await queryInterface.addColumn('Users', 'mfaEnabled', {
      type: Sequelize.BOOLEAN,
      defaultValue: false,
      allowNull: false
    });

    await queryInterface.addColumn('Users', 'mfaSecret', {
      type: Sequelize.TEXT,
      allowNull: true
    });

    await queryInterface.addColumn('Users', 'mfaBackupCodes', {
      type: Sequelize.JSONB,
      defaultValue: [],
      allowNull: false
    });

    // API Keys
    await queryInterface.addColumn('Users', 'apiKeys', {
      type: Sequelize.JSONB,
      defaultValue: [],
      allowNull: false
    });

    // Security preferences
    await queryInterface.addColumn('Users', 'securitySettings', {
      type: Sequelize.JSONB,
      defaultValue: {
        loginNotifications: true,
        suspiciousActivityAlerts: true,
        sessionTimeout: 24 * 60 * 60 * 1000, // 24 hours
        requireMfaForSensitiveOps: false,
        allowedIPs: [],
        trustedDevices: []
      },
      allowNull: false
    });

    // GDPR and privacy
    await queryInterface.addColumn('Users', 'privacySettings', {
      type: Sequelize.JSONB,
      defaultValue: {
        dataRetentionDays: 365,
        allowDataProcessing: true,
        allowAnalytics: true,
        allowMarketing: false,
        consentDate: null,
        consentVersion: '1.0'
      },
      allowNull: false
    });

    // OAuth fields
    await queryInterface.addColumn('Users', 'oauthProviders', {
      type: Sequelize.JSONB,
      defaultValue: [],
      allowNull: false
    });

    // Password security
    await queryInterface.addColumn('Users', 'passwordHistory', {
      type: Sequelize.JSONB,
      defaultValue: [],
      allowNull: false
    });

    await queryInterface.addColumn('Users', 'passwordChangedAt', {
      type: Sequelize.DATE,
      allowNull: true
    });

    // Account verification and recovery
    await queryInterface.addColumn('Users', 'phoneNumber', {
      type: Sequelize.STRING,
      allowNull: true,
      validate: {
        is: /^[\+]?[1-9][\d]{0,15}$/
      }
    });

    await queryInterface.addColumn('Users', 'phoneVerified', {
      type: Sequelize.BOOLEAN,
      defaultValue: false,
      allowNull: false
    });

    // Session management
    await queryInterface.addColumn('Users', 'activeSessions', {
      type: Sequelize.JSONB,
      defaultValue: [],
      allowNull: false
    });

    // Audit trail
    await queryInterface.addColumn('Users', 'lastPasswordChange', {
      type: Sequelize.DATE,
      allowNull: true
    });

    await queryInterface.addColumn('Users', 'lastSecurityUpdate', {
      type: Sequelize.DATE,
      allowNull: true
    });

    // Risk scoring
    await queryInterface.addColumn('Users', 'riskScore', {
      type: Sequelize.INTEGER,
      defaultValue: 0,
      allowNull: false,
      validate: {
        min: 0,
        max: 100
      }
    });

    await queryInterface.addColumn('Users', 'riskFactors', {
      type: Sequelize.JSONB,
      defaultValue: [],
      allowNull: false
    });

    // Add indexes for performance
    await queryInterface.addIndex('Users', ['failedLoginAttempts']);
    await queryInterface.addIndex('Users', ['lockedUntil']);
    await queryInterface.addIndex('Users', ['mfaEnabled']);
    await queryInterface.addIndex('Users', ['lastLoginAt']);
    await queryInterface.addIndex('Users', ['riskScore']);

    // Add composite indexes
    await queryInterface.addIndex('Users', ['email', 'isActive']);
    await queryInterface.addIndex('Users', ['lastLoginAt', 'isActive']);
  },

  down: async (queryInterface, Sequelize) => {
    // Remove indexes first
    await queryInterface.removeIndex('Users', ['failedLoginAttempts']);
    await queryInterface.removeIndex('Users', ['lockedUntil']);
    await queryInterface.removeIndex('Users', ['mfaEnabled']);
    await queryInterface.removeIndex('Users', ['lastLoginAt']);
    await queryInterface.removeIndex('Users', ['riskScore']);
    await queryInterface.removeIndex('Users', ['email', 'isActive']);
    await queryInterface.removeIndex('Users', ['lastLoginAt', 'isActive']);

    // Remove columns
    const columnsToRemove = [
      'failedLoginAttempts',
      'lastFailedLoginAt',
      'lockedUntil',
      'mfaEnabled',
      'mfaSecret',
      'mfaBackupCodes',
      'apiKeys',
      'securitySettings',
      'privacySettings',
      'oauthProviders',
      'passwordHistory',
      'passwordChangedAt',
      'phoneNumber',
      'phoneVerified',
      'activeSessions',
      'lastPasswordChange',
      'lastSecurityUpdate',
      'riskScore',
      'riskFactors'
    ];

    for (const column of columnsToRemove) {
      await queryInterface.removeColumn('Users', column);
    }
  }
};