'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Transcriptions', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      userId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      originalFilename: {
        type: Sequelize.STRING,
        allowNull: false
      },
      fileSize: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      mimeType: {
        type: Sequelize.STRING,
        allowNull: false
      },
      duration: {
        type: Sequelize.FLOAT,
        allowNull: true
      },
      s3Key: {
        type: Sequelize.STRING,
        allowNull: false
      },
      status: {
        type: Sequelize.ENUM('pending', 'processing', 'completed', 'failed', 'cancelled'),
        defaultValue: 'pending',
        allowNull: false
      },
      transcriptionText: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      speakerLabels: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      confidence: {
        type: Sequelize.FLOAT,
        allowNull: true,
        validate: {
          min: 0,
          max: 1
        }
      },
      lowConfidenceWords: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      language: {
        type: Sequelize.STRING,
        defaultValue: 'he-IL',
        allowNull: false
      },
      processingTime: {
        type: Sequelize.INTEGER,
        allowNull: true
      },
      errorMessage: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      metadata: {
        type: Sequelize.JSONB,
        defaultValue: {},
        allowNull: false
      },
      deliveryEmail: {
        type: Sequelize.STRING,
        allowNull: true,
        validate: {
          isEmail: true
        }
      },
      emailSent: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      },
      emailSentAt: {
        type: Sequelize.DATE,
        allowNull: true
      },
      webhookSent: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      },
      webhookSentAt: {
        type: Sequelize.DATE,
        allowNull: true
      },
      webhookAttempts: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      expiresAt: {
        type: Sequelize.DATE,
        allowNull: true
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false
      }
    });

    // Add indexes
    await queryInterface.addIndex('Transcriptions', ['userId']);
    await queryInterface.addIndex('Transcriptions', ['status']);
    await queryInterface.addIndex('Transcriptions', ['createdAt']);
    await queryInterface.addIndex('Transcriptions', ['expiresAt']);
    await queryInterface.addIndex('Transcriptions', ['deliveryEmail']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('Transcriptions');
  }
};