const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const MicrosoftStrategy = require('passport-microsoft').Strategy;
const JwtStrategy = require('passport-jwt').Strategy;
const ExtractJwt = require('passport-jwt').ExtractJwt;
const { User } = require('../models');
const securityService = require('./securityService');
const { tokenUtils } = require('../middleware/advancedAuth');
const securityConfig = require('../config/security');
const logger = require('../utils/logger');
const crypto = require('crypto');

class OAuthService {
  constructor() {
    this.initializeStrategies();
  }

  // Initialize Passport strategies
  initializeStrategies() {
    // JWT Strategy for API authentication
    passport.use(new JwtStrategy({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: securityConfig.jwt.secret,
      issuer: securityConfig.jwt.issuer,
      audience: securityConfig.jwt.audience
    }, async (payload, done) => {
      try {
        const user = await User.findByPk(payload.id);
        if (user && user.isActive) {
          return done(null, user);
        }
        return done(null, false);
      } catch (error) {
        return done(error, false);
      }
    }));

    // Google OAuth Strategy
    if (securityConfig.oauth.google.enabled) {
      passport.use(new GoogleStrategy({
        clientID: securityConfig.oauth.google.clientId,
        clientSecret: securityConfig.oauth.google.clientSecret,
        callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
        scope: securityConfig.oauth.google.scope
      }, async (accessToken, refreshToken, profile, done) => {
        try {
          const result = await this.handleOAuthCallback('google', profile, {
            accessToken,
            refreshToken
          });
          return done(null, result);
        } catch (error) {
          logger.error('Google OAuth error:', error);
          return done(error, false);
        }
      }));
    }

    // Microsoft OAuth Strategy
    if (securityConfig.oauth.microsoft.enabled) {
      passport.use(new MicrosoftStrategy({
        clientID: securityConfig.oauth.microsoft.clientId,
        clientSecret: securityConfig.oauth.microsoft.clientSecret,
        callbackURL: process.env.MICROSOFT_CALLBACK_URL || '/auth/microsoft/callback',
        scope: securityConfig.oauth.microsoft.scope
      }, async (accessToken, refreshToken, profile, done) => {
        try {
          const result = await this.handleOAuthCallback('microsoft', profile, {
            accessToken,
            refreshToken
          });
          return done(null, result);
        } catch (error) {
          logger.error('Microsoft OAuth error:', error);
          return done(error, false);
        }
      }));
    }

    // Passport serialization
    passport.serializeUser((user, done) => {
      done(null, user.id);
    });

    passport.deserializeUser(async (id, done) => {
      try {
        const user = await User.findByPk(id);
        done(null, user);
      } catch (error) {
        done(error, null);
      }
    });
  }

  // Handle OAuth callback for all providers
  async handleOAuthCallback(provider, profile, tokens) {
    try {
      const email = this.extractEmail(profile);
      const profileData = this.extractProfileData(provider, profile);

      if (!email) {
        throw new Error('No email provided by OAuth provider');
      }

      // Check if user exists
      let user = await User.findOne({ where: { email } });

      if (user) {
        // Existing user - link OAuth provider
        await this.linkOAuthProvider(user, provider, profileData, tokens);
      } else {
        // New user - create account
        user = await this.createUserFromOAuth(provider, profileData, tokens);
      }

      // Create session and tokens
      const sessionId = await tokenUtils.sessionManager.create(user.id, {
        provider,
        ipAddress: null, // Will be set by middleware
        userAgent: null  // Will be set by middleware
      });

      const tokenPair = tokenUtils.generateTokenPair(user, sessionId);

      // Log OAuth authentication
      await securityService.handleSecurityEvent('auth.oauth_login', {
        userId: user.id,
        email: user.email,
        provider,
        profileId: profileData.id,
        success: true
      });

      return {
        user,
        tokens: tokenPair,
        sessionId,
        provider
      };
    } catch (error) {
      logger.error(`OAuth callback error for ${provider}:`, error);
      
      // Log failed OAuth attempt
      await securityService.handleSecurityEvent('auth.oauth_login', {
        provider,
        success: false,
        error: error.message
      });
      
      throw error;
    }
  }

  // Extract email from OAuth profile
  extractEmail(profile) {
    if (profile.emails && profile.emails.length > 0) {
      return profile.emails[0].value;
    }
    
    if (profile._json?.email) {
      return profile._json.email;
    }
    
    if (profile.email) {
      return profile.email;
    }
    
    return null;
  }

  // Extract profile data from OAuth response
  extractProfileData(provider, profile) {
    const baseData = {
      id: profile.id,
      email: this.extractEmail(profile),
      provider
    };

    switch (provider) {
    case 'google':
      return {
        ...baseData,
        firstName: profile.name?.givenName || profile._json?.given_name || 'Unknown',
        lastName: profile.name?.familyName || profile._json?.family_name || 'User',
        picture: profile.photos?.[0]?.value || profile._json?.picture,
        emailVerified: profile._json?.email_verified || false,
        locale: profile._json?.locale
      };

    case 'microsoft':
      return {
        ...baseData,
        firstName: profile.name?.givenName || profile._json?.givenName || 'Unknown',
        lastName: profile.name?.familyName || profile._json?.surname || 'User',
        picture: profile.photos?.[0]?.value,
        emailVerified: true, // Microsoft emails are generally verified
        locale: profile._json?.preferredLanguage
      };

    default:
      return baseData;
    }
  }

  // Link OAuth provider to existing user
  async linkOAuthProvider(user, provider, profileData, tokens) {
    try {
      // Check if provider is already linked
      if (user.hasOAuthProvider(provider)) {
        // Update existing provider data
        await user.addOAuthProvider(provider, {
          ...profileData,
          lastLoginAt: new Date().toISOString(),
          accessToken: this.encryptToken(tokens.accessToken),
          refreshToken: tokens.refreshToken ? this.encryptToken(tokens.refreshToken) : null
        });
      } else {
        // Add new provider
        await user.addOAuthProvider(provider, {
          ...profileData,
          linkedAt: new Date().toISOString(),
          accessToken: this.encryptToken(tokens.accessToken),
          refreshToken: tokens.refreshToken ? this.encryptToken(tokens.refreshToken) : null
        });

        await securityService.handleSecurityEvent('oauth.provider_linked', {
          userId: user.id,
          email: user.email,
          provider,
          profileId: profileData.id
        });
      }

      // Update user's last login
      user.lastLoginAt = new Date();
      await user.save();

      return user;
    } catch (error) {
      logger.error('Error linking OAuth provider:', error);
      throw error;
    }
  }

  // Create new user from OAuth data
  async createUserFromOAuth(provider, profileData, tokens) {
    try {
      // Generate a random password (user can set their own later)
      const tempPassword = crypto.randomBytes(32).toString('hex');

      const user = await User.create({
        email: profileData.email,
        firstName: profileData.firstName,
        lastName: profileData.lastName,
        password: tempPassword, // This will be hashed by the model hook
        emailVerified: profileData.emailVerified || false,
        isActive: true,
        oauthProviders: [{
          provider,
          providerId: profileData.id,
          email: profileData.email,
          firstName: profileData.firstName,
          lastName: profileData.lastName,
          picture: profileData.picture,
          locale: profileData.locale,
          connectedAt: new Date().toISOString(),
          accessToken: this.encryptToken(tokens.accessToken),
          refreshToken: tokens.refreshToken ? this.encryptToken(tokens.refreshToken) : null
        }],
        settings: {
          ...User.rawAttributes.settings.defaultValue,
          oauthProvider: provider
        }
      });

      await securityService.handleSecurityEvent('auth.oauth_signup', {
        userId: user.id,
        email: user.email,
        provider,
        profileId: profileData.id
      });

      logger.info(`New user created via ${provider} OAuth: ${user.email}`);

      return user;
    } catch (error) {
      logger.error('Error creating user from OAuth:', error);
      throw error;
    }
  }

  // Unlink OAuth provider from user
  async unlinkOAuthProvider(userId, provider) {
    try {
      const user = await User.findByPk(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Check if user has a password or other OAuth providers
      if (!user.password && user.oauthProviders.length <= 1) {
        throw new Error('Cannot unlink the only authentication method. Please set a password first.');
      }

      await user.removeOAuthProvider(provider);

      await securityService.handleSecurityEvent('oauth.provider_unlinked', {
        userId: user.id,
        email: user.email,
        provider
      });

      logger.info(`OAuth provider ${provider} unlinked for user ${user.email}`);

      return {
        success: true,
        message: `${provider} account unlinked successfully`
      };
    } catch (error) {
      logger.error('Error unlinking OAuth provider:', error);
      throw error;
    }
  }

  // Get user's linked OAuth providers
  async getUserOAuthProviders(userId) {
    try {
      const user = await User.findByPk(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const providers = (user.oauthProviders || []).map(provider => ({
        provider: provider.provider,
        email: provider.email,
        connectedAt: provider.connectedAt,
        lastLoginAt: provider.lastLoginAt
      }));

      return providers;
    } catch (error) {
      logger.error('Error getting user OAuth providers:', error);
      throw error;
    }
  }

  // Refresh OAuth tokens
  async refreshOAuthTokens(userId, provider) {
    try {
      const user = await User.findByPk(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const oauthData = user.oauthProviders.find(p => p.provider === provider);
      if (!oauthData || !oauthData.refreshToken) {
        throw new Error('No refresh token available for this provider');
      }

      const refreshToken = this.decryptToken(oauthData.refreshToken);
      let newTokens;

      switch (provider) {
      case 'google':
        newTokens = await this.refreshGoogleTokens(refreshToken);
        break;
      case 'microsoft':
        newTokens = await this.refreshMicrosoftTokens(refreshToken);
        break;
      default:
        throw new Error('Unsupported OAuth provider');
      }

      // Update tokens in user record
      const updatedProviders = user.oauthProviders.map(p => {
        if (p.provider === provider) {
          return {
            ...p,
            accessToken: this.encryptToken(newTokens.accessToken),
            refreshToken: newTokens.refreshToken ? this.encryptToken(newTokens.refreshToken) : p.refreshToken,
            tokenRefreshedAt: new Date().toISOString()
          };
        }
        return p;
      });

      await user.update({ oauthProviders: updatedProviders });

      await securityService.handleSecurityEvent('oauth.tokens_refreshed', {
        userId: user.id,
        email: user.email,
        provider
      });

      return {
        success: true,
        accessToken: newTokens.accessToken,
        expiresIn: newTokens.expiresIn
      };
    } catch (error) {
      logger.error('Error refreshing OAuth tokens:', error);
      throw error;
    }
  }

  // Refresh Google tokens
  async refreshGoogleTokens(refreshToken) {
    const axios = require('axios');
    
    try {
      const response = await axios.post('https://oauth2.googleapis.com/token', {
        client_id: securityConfig.oauth.google.clientId,
        client_secret: securityConfig.oauth.google.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      });

      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token, // May be null if not provided
        expiresIn: response.data.expires_in
      };
    } catch (error) {
      logger.error('Error refreshing Google tokens:', error);
      throw new Error('Failed to refresh Google tokens');
    }
  }

  // Refresh Microsoft tokens
  async refreshMicrosoftTokens(refreshToken) {
    const axios = require('axios');
    
    try {
      const response = await axios.post('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        client_id: securityConfig.oauth.microsoft.clientId,
        client_secret: securityConfig.oauth.microsoft.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        scope: securityConfig.oauth.microsoft.scope.join(' ')
      });

      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresIn: response.data.expires_in
      };
    } catch (error) {
      logger.error('Error refreshing Microsoft tokens:', error);
      throw new Error('Failed to refresh Microsoft tokens');
    }
  }

  // Encrypt OAuth tokens for storage
  encryptToken(token) {
    try {
      if (!token) {return null;}
      
      const { encryptionService } = require('../utils/encryption');
      const encrypted = encryptionService.encrypt(token);
      return encrypted.encrypted;
    } catch (error) {
      logger.error('Error encrypting OAuth token:', error);
      return token; // Fallback to plain text (not recommended)
    }
  }

  // Decrypt OAuth tokens
  decryptToken(encryptedToken) {
    try {
      if (!encryptedToken) {return null;}
      
      const { encryptionService } = require('../utils/encryption');
      const decrypted = encryptionService.decrypt({ encrypted: encryptedToken });
      return decrypted.toString('utf8');
    } catch (error) {
      logger.error('Error decrypting OAuth token:', error);
      return encryptedToken; // Fallback assuming it's plain text
    }
  }

  // Validate OAuth configuration
  validateConfiguration() {
    const issues = [];

    if (securityConfig.oauth.google.enabled) {
      if (!securityConfig.oauth.google.clientId || !securityConfig.oauth.google.clientSecret) {
        issues.push('Google OAuth is enabled but missing client ID or secret');
      }
    }

    if (securityConfig.oauth.microsoft.enabled) {
      if (!securityConfig.oauth.microsoft.clientId || !securityConfig.oauth.microsoft.clientSecret) {
        issues.push('Microsoft OAuth is enabled but missing client ID or secret');
      }
    }

    if (!process.env.GOOGLE_CALLBACK_URL && securityConfig.oauth.google.enabled) {
      issues.push('Google OAuth callback URL not configured');
    }

    if (!process.env.MICROSOFT_CALLBACK_URL && securityConfig.oauth.microsoft.enabled) {
      issues.push('Microsoft OAuth callback URL not configured');
    }

    return {
      valid: issues.length === 0,
      issues
    };
  }

  // Get OAuth configuration for frontend
  getOAuthConfig() {
    return {
      google: {
        enabled: securityConfig.oauth.google.enabled,
        clientId: securityConfig.oauth.google.clientId // Safe to expose client ID
      },
      microsoft: {
        enabled: securityConfig.oauth.microsoft.enabled,
        clientId: securityConfig.oauth.microsoft.clientId
      }
    };
  }

  // Cleanup expired OAuth tokens
  async cleanupExpiredTokens() {
    try {
      let cleanedCount = 0;
      
      const users = await User.findAll({
        where: {
          oauthProviders: {
            [require('sequelize').Op.ne]: null
          }
        }
      });

      for (const user of users) {
        const providers = user.oauthProviders || [];
        let hasChanges = false;

        const updatedProviders = providers.map(provider => {
          // Check if tokens are older than 1 hour (typical OAuth token expiry)
          const tokenAge = provider.tokenRefreshedAt || provider.connectedAt;
          const hoursSinceRefresh = Math.floor((Date.now() - new Date(tokenAge).getTime()) / (1000 * 60 * 60));
          
          if (hoursSinceRefresh > 1 && provider.accessToken) {
            hasChanges = true;
            cleanedCount++;
            return {
              ...provider,
              accessToken: null, // Clear expired access token
              tokenExpiredAt: new Date().toISOString()
            };
          }
          
          return provider;
        });

        if (hasChanges) {
          await user.update({ oauthProviders: updatedProviders });
        }
      }

      logger.info(`Cleaned up ${cleanedCount} expired OAuth tokens`);
      return cleanedCount;
    } catch (error) {
      logger.error('Error cleaning up expired OAuth tokens:', error);
      return 0;
    }
  }

  // Generate OAuth state parameter for CSRF protection
  generateOAuthState() {
    return crypto.randomBytes(32).toString('hex');
  }

  // Validate OAuth state parameter
  validateOAuthState(storedState, receivedState) {
    return storedState === receivedState;
  }
}

// Export singleton instance
const oauthService = new OAuthService();
module.exports = oauthService;