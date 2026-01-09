module.exports = {
  // Discord Configuration
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,

  
  // Firebase Configuration
  FIREBASE_CONFIG: {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    measurementId: process.env.FIREBASE_MEASUREMENT_ID
  },
  
  // Bot Settings
  BOT_SETTINGS: {
    verificationTimeout: parseInt(process.env.VERIFICATION_TIMEOUT_HOURS) || 2,
    autoCheckInterval: parseInt(process.env.AUTO_CHECK_INTERVAL_MINUTES) || 30,
    prefix: process.env.BOT_PREFIX || '!'
  },
  
  // Colors for Embeds
  COLORS: {
    PRIMARY: 0x1E90FF,
    SUCCESS: 0x00FF00,
    ERROR: 0xFF0000,
    WARNING: 0xFFA500,
    INFO: 0x3498DB
  },
  
  // Emojis
  EMOJIS: {
    CHECK: '✅',
    CROSS: '❌',
    WARNING: '⚠️',
    INFO: 'ℹ️',
    LOADING: '🔄',
    MEMBER: '👤',
    EMAIL: '📧',
    VERIFIED: '🔐',
    TIME: '⏰',
    BAN: '🏛️'
  }
};