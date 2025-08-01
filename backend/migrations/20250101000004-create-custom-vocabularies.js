'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('CustomVocabularies', {
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
        onDelete: 'CASCADE'
      },
      word: {
        type: Sequelize.STRING,
        allowNull: false
      },
      pronunciation: {
        type: Sequelize.STRING,
        allowNull: true
      },
      category: {
        type: Sequelize.ENUM(
          'halachic',
          'chassidic', 
          'yiddish',
          'calendar',
          'names',
          'places',
          'general'
        ),
        defaultValue: 'general',
        allowNull: false
      },
      frequency: {
        type: Sequelize.INTEGER,
        defaultValue: 1,
        allowNull: false
      },
      isGlobal: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      },
      isActive: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false
      },
      addedBy: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      approvedBy: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      approvedAt: {
        type: Sequelize.DATE,
        allowNull: true
      },
      metadata: {
        type: Sequelize.JSONB,
        defaultValue: {},
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
    await queryInterface.addIndex('CustomVocabularies', ['word']);
    await queryInterface.addIndex('CustomVocabularies', ['userId']);
    await queryInterface.addIndex('CustomVocabularies', ['category']);
    await queryInterface.addIndex('CustomVocabularies', ['isGlobal']);
    await queryInterface.addIndex('CustomVocabularies', ['isActive']);
    await queryInterface.addIndex('CustomVocabularies', ['frequency']);
    
    // Add unique constraint for word per user
    await queryInterface.addConstraint('CustomVocabularies', {
      fields: ['word', 'userId'],
      type: 'unique',
      name: 'unique_word_per_user'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('CustomVocabularies');
  }
};