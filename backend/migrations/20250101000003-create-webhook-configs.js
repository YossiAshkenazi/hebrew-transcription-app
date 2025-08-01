'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('WebhookConfigs', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false
      },
      url: {
        type: Sequelize.STRING,
        allowNull: false,
        validate: {
          isUrl: true
        }
      },
      method: {
        type: Sequelize.ENUM('POST', 'PUT', 'PATCH'),
        defaultValue: 'POST',
        allowNull: false
      },
      headers: {
        type: Sequelize.JSONB,
        defaultValue: {},
        allowNull: false
      },
      secret: {
        type: Sequelize.STRING,
        allowNull: true
      },
      isActive: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false
      },
      events: {
        type: Sequelize.ARRAY(Sequelize.STRING),
        defaultValue: ['transcription.completed'],
        allowNull: false
      },
      retryAttempts: {
        type: Sequelize.INTEGER,
        defaultValue: 3,
        allowNull: false,
        validate: {
          min: 0,
          max: 10
        }
      },
      timeout: {
        type: Sequelize.INTEGER,
        defaultValue: 30000,
        allowNull: false
      },
      lastTriggeredAt: {
        type: Sequelize.DATE,
        allowNull: true
      },
      lastSuccessAt: {
        type: Sequelize.DATE,
        allowNull: true
      },
      lastFailureAt: {
        type: Sequelize.DATE,
        allowNull: true
      },
      lastFailureReason: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      totalTriggers: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      totalSuccesses: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      totalFailures: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false
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
    await queryInterface.addIndex('WebhookConfigs', ['userId']);
    await queryInterface.addIndex('WebhookConfigs', ['isActive']);
    await queryInterface.addIndex('WebhookConfigs', ['events'], {
      using: 'gin'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('WebhookConfigs');
  }
};