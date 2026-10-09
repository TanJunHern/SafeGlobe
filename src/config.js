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
  // gemini-3.5-flash is over quota and gemini-2.5-flash is retired for this key, so the lite model leads.
  // Every Gemini call goes through services/geminiClient.js, which walks this chain on 404 / 429 / 503.
  geminiModel: process.env.GEMINI_MODEL || 'gemini-flash-lite-latest',
  geminiFallbackModels: (process.env.GEMINI_FALLBACK_MODELS || 'gemini-flash-latest,gemini-3.1-flash-lite').split(',').map(m => m.trim()).filter(Boolean),
  // Supporting documents: 'local' disk for now; 'firebase' is a placeholder driver (services/documentStorage.js)
  documentStorage: process.env.DOCUMENT_STORAGE || 'local',
  // Google Document AI, for parsing PDF / Word questionnaire templates (placeholder: services/documentParserService.js)
  documentAi: {
    projectId: process.env.DOCUMENT_AI_PROJECT_ID || '',
    location: process.env.DOCUMENT_AI_LOCATION || '',
    processorId: process.env.DOCUMENT_AI_PROCESSOR_ID || ''
  },
  // Compliance Agent runtime: 'builtin' today; 'adk' and 'langchain' are reserved (agents/framework.js)
  agentRuntime: process.env.AGENT_RUNTIME || 'builtin',
  jwtSecret: process.env.JWT_SECRET || 'safeglobe-ddq-secure-hmac-key-2026',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
  complianceEmails: (process.env.COMPLIANCE_OFFICER_EMAILS || 'compliance@safeglobe.com,grace.teo@safeglobe.internal').split(',').map(s => s.trim().toLowerCase()),
  staticDir: path.join(__dirname, '..')
};

