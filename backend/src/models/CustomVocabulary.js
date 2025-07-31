const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const CustomVocabulary = sequelize.define('CustomVocabulary', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: true, // Allow global vocabulary
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  word: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'The word or phrase to add to vocabulary'
  },
  pronunciation: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Phonetic pronunciation guide'
  },
  category: {
    type: DataTypes.ENUM(
      'halachic',
      'chassidic', 
      'yiddish',
      'calendar',
      'names',
      'places',
      'general'
    ),
    defaultValue: 'general'
  },
  frequency: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
    comment: 'How often this word appears in transcriptions'
  },
  isGlobal: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Whether this word is available to all users'
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  addedBy: {
    type: DataTypes.UUID,
    allowNull: true,
    comment: 'User who added this word'
  },
  approvedBy: {
    type: DataTypes.UUID,
    allowNull: true,
    comment: 'Admin who approved this word for global use'
  },
  approvedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {},
    comment: 'Additional information about the word'
  }
}, {
  indexes: [
    {
      fields: ['word']
    },
    {
      fields: ['userId']
    },
    {
      fields: ['category']
    },
    {
      fields: ['isGlobal']
    },
    {
      unique: true,
      fields: ['word', 'userId']
    }
  ]
});

// Static methods
CustomVocabulary.getGlobalVocabulary = async function() {
  return this.findAll({
    where: {
      isGlobal: true,
      isActive: true
    },
    order: [['frequency', 'DESC']]
  });
};

CustomVocabulary.getUserVocabulary = async function(userId) {
  return this.findAll({
    where: {
      userId: userId,
      isActive: true
    },
    order: [['frequency', 'DESC']]
  });
};

CustomVocabulary.getCombinedVocabulary = async function(userId) {
  const [global, user] = await Promise.all([
    this.getGlobalVocabulary(),
    userId ? this.getUserVocabulary(userId) : []
  ]);
  
  return [...global, ...user];
};

module.exports = CustomVocabulary;
