const path = require('path');
require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT || '8080', 10),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  dbType: process.env.DATABASE_TYPE || 'sqlite', // 'sqlite' | 'firestore'
  dbPath: process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'safe_globe.db'),
  gcpProjectId: process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || 'safe-globe-compliance',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  confidenceThreshold: parseInt(process.env.CONFIDENCE_THRESHOLD || '80', 10),
  geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENAI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  jwtSecret: process.env.JWT_SECRET || 'safeglobe-ddq-secure-hmac-key-2026',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
  complianceEmails: (process.env.COMPLIANCE_OFFICER_EMAILS || 'compliance@safeglobe.com,grace.teo@safeglobe.internal').split(',').map(s => s.trim().toLowerCase()),
  staticDir: path.join(__dirname, '..')
};

