const crypto = require('crypto');

const securityConfig = {
  // JWT Configuration
  jwt: {
    secret: process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex'),
    accessTokenExpiry: process.env.JWT_EXPIRES_IN || '15m',
    refreshTokenExpiry: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    algorithm: 'HS256',
    issuer: process.env.JWT_ISSUER || 'hebrew-transcription-app',
    audience: process.env.JWT_AUDIENCE || 'hebrew-transcription-users'
  },

  // Session Configuration
  session: {
    secret: process.env.SESSION_SECRET || crypto.randomBytes(64).toString('hex'),
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'strict',
    resave: false,
    saveUninitialized: false
  },

  // Password Policy
  password: {
    minLength: 8,
    maxLength: 128,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialChars: true,
    preventCommonPasswords: true,
    maxAge: 90 * 24 * 60 * 60 * 1000, // 90 days
    historyCount: 5 // Remember last 5 passwords
  },

  // Account Lockout Configuration
  accountLockout: {
    maxFailedAttempts: 5,
    lockoutDuration: 30 * 60 * 1000, // 30 minutes
    progressiveLockout: true,
    notifyOnLockout: true,
    whitelist: process.env.SECURITY_IP_WHITELIST ? process.env.SECURITY_IP_WHITELIST.split(',') : []
  },

  // Rate Limiting Configuration
  rateLimit: {
    // General API rate limiting
    general: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // requests per window
      message: 'Too many requests from this IP, please try again later.'
    },
    // Authentication endpoints
    auth: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 5, // attempts per window
      message: 'Too many authentication attempts, please try again later.'
    },
    // Password reset
    passwordReset: {
      windowMs: 60 * 60 * 1000, // 1 hour
      max: 3, // attempts per window
      message: 'Too many password reset attempts, please try again later.'
    },
    // File upload
    upload: {
      windowMs: 60 * 60 * 1000, // 1 hour
      max: 20, // uploads per window
      message: 'Too many file uploads, please try again later.'
    }
  },

  // MFA Configuration
  mfa: {
    enabled: process.env.MFA_ENABLED === 'true',
    window: 2, // Allow 2 time steps before/after current
    tokenLength: 6,
    issuer: 'Hebrew Transcription App',
    algorithm: 'sha1',
    step: 30, // 30 seconds
    backupCodes: {
      count: 10,
      length: 8
    }
  },

  // API Key Configuration
  apiKey: {
    defaultExpiry: 365 * 24 * 60 * 60 * 1000, // 1 year
    maxKeysPerUser: 5,
    keyLength: 32,
    prefix: 'hta_', // Hebrew Transcription App
    rateLimit: {
      windowMs: 60 * 60 * 1000, // 1 hour
      max: 1000 // requests per hour
    }
  },

  // Encryption Configuration
  encryption: {
    algorithm: 'aes-256-gcm',
    keyDerivation: 'pbkdf2',
    iterations: 100000,
    saltLength: 32,
    ivLength: 12,
    tagLength: 16
  },

  // File Security
  fileUpload: {
    maxSize: 100 * 1024 * 1024, // 100MB
    allowedMimeTypes: [
      'audio/mpeg',
      'audio/wav',
      'audio/mp4',
      'audio/webm',
      'audio/ogg',
      'video/mp4',
      'video/webm'
    ],
    virusScanEnabled: process.env.VIRUS_SCAN_ENABLED === 'true',
    encryptFiles: process.env.ENCRYPT_FILES === 'true',
    quarantinePath: process.env.QUARANTINE_PATH || '/tmp/quarantine'
  },

  // Security Headers
  headers: {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ['\'self\''],
        styleSrc: ['\'self\'', '\'unsafe-inline\'', 'https://fonts.googleapis.com'],
        fontSrc: ['\'self\'', 'https://fonts.gstatic.com'],
        imgSrc: ['\'self\'', 'data:', 'https:'],
        scriptSrc: ['\'self\''],
        connectSrc: ['\'self\'', 'https://api.openai.com'],
        mediaSrc: ['\'self\'', 'blob:'],
        objectSrc: ['\'none\''],
        baseUri: ['\'self\''],
        frameAncestors: ['\'none\''],
        formAction: ['\'self\'']
      }
    },
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true
    },
    referrerPolicy: 'strict-origin-when-cross-origin',
    crossOriginEmbedderPolicy: 'require-corp',
    crossOriginOpenerPolicy: 'same-origin',
    crossOriginResourcePolicy: 'cross-origin'
  },

  // CORS Configuration
  cors: {
    origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['http://localhost:3000'],
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Requested-With']
  },

  // Audit Log Configuration
  audit: {
    enabled: process.env.AUDIT_ENABLED !== 'false',
    logLevel: process.env.AUDIT_LOG_LEVEL || 'info',
    sensitiveFields: ['password', 'token', 'apiKey', 'resetToken'],
    retentionDays: parseInt(process.env.AUDIT_RETENTION_DAYS) || 365,
    events: {
      authentication: true,
      authorization: true,
      dataAccess: true,
      dataModification: true,
      adminActions: true,
      securityEvents: true
    }
  },

  // Threat Detection
  threatDetection: {
    enabled: process.env.THREAT_DETECTION_ENABLED === 'true',
    suspiciousPatterns: {
      rapidRequests: { threshold: 50, window: 60000 }, // 50 requests in 1 minute
      failedLogins: { threshold: 10, window: 300000 }, // 10 failed logins in 5 minutes
      unusualLocations: true,
      sqlInjection: true,
      xssAttempts: true,
      pathTraversal: true
    },
    responseActions: {
      block: true,
      alert: true,
      quarantine: false
    }
  },

  // Data Protection (GDPR)
  dataProtection: {
    enabled: process.env.GDPR_ENABLED !== 'false',
    dataRetentionDays: parseInt(process.env.DATA_RETENTION_DAYS) || 365,
    anonymizationEnabled: true,
    exportFormats: ['json', 'csv'],
    deletionGracePeriod: 30 * 24 * 60 * 60 * 1000, // 30 days
    consentTracking: true,
    minorAge: 16 // GDPR minimum age
  },

  // OAuth Configuration
  oauth: {
    google: {
      enabled: process.env.GOOGLE_OAUTH_ENABLED === 'true',
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      scope: ['profile', 'email']
    },
    microsoft: {
      enabled: process.env.MICROSOFT_OAUTH_ENABLED === 'true',
      clientId: process.env.MICROSOFT_CLIENT_ID,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
      scope: ['profile', 'email']
    }
  },

  // Security Monitoring
  monitoring: {
    enabled: process.env.SECURITY_MONITORING_ENABLED !== 'false',
    alertThresholds: {
      failedLogins: 100, // per hour
      rateLimitHits: 1000, // per hour
      errorRate: 0.05, // 5% error rate
      responseTime: 5000 // 5 seconds
    },
    notifications: {
      email: process.env.SECURITY_ALERT_EMAIL,
      webhook: process.env.SECURITY_ALERT_WEBHOOK,
      slack: process.env.SECURITY_ALERT_SLACK
    }
  },

  // Environment-specific overrides
  environments: {
    development: {
      jwt: {
        accessTokenExpiry: '24h'
      },
      session: {
        secure: false
      },
      headers: {
        contentSecurityPolicy: false // Disable CSP in development
      },
      cors: {
        origin: true // Allow all origins in development
      }
    },
    test: {
      jwt: {
        accessTokenExpiry: '1h'
      },
      rateLimit: {
        general: { max: 1000 },
        auth: { max: 100 }
      }
    },
    production: {
      session: {
        secure: true
      },
      headers: {
        hsts: {
          maxAge: 63072000, // 2 years
          includeSubDomains: true,
          preload: true
        }
      },
      threatDetection: {
        enabled: true
      }
    }
  }
};

// Apply environment-specific overrides
const env = process.env.NODE_ENV || 'development';
if (securityConfig.environments[env]) {
  const envConfig = securityConfig.environments[env];
  
  // Deep merge environment configuration
  function deepMerge(target, source) {
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        if (!target[key]) {target[key] = {};}
        deepMerge(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
  }
  
  deepMerge(securityConfig, envConfig);
}

module.exports = securityConfig;