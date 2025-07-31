const { sequelize } = require('../config/database');
const User = require('./User');
const Transcription = require('./Transcription');
const WebhookConfig = require('./WebhookConfig');
const CustomVocabulary = require('./CustomVocabulary');

// Define associations
User.hasMany(Transcription, { foreignKey: 'userId' });
Transcription.belongsTo(User, { foreignKey: 'userId' });

User.hasMany(WebhookConfig, { foreignKey: 'userId' });
WebhookConfig.belongsTo(User, { foreignKey: 'userId' });

User.hasMany(CustomVocabulary, { foreignKey: 'userId' });
CustomVocabulary.belongsTo(User, { foreignKey: 'userId' });

module.exports = {
  sequelize,
  User,
  Transcription,
  WebhookConfig,
  CustomVocabulary
};
