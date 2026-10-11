const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

/*
 * Environments (docs/CLOUD_PLAN.md):
 *   APP_ENV=dev   offline, port 8080, reads .env.dev
 *   APP_ENV=uat   online, port 8081 locally and Cloud Run, reads .env.uat when the file is there
 *   (unset)       the original behaviour: reads .env. The test command runs this way.
 * A variable that is already set (Cloud Run --set-env-vars, the test command) always wins over a file.
 */
const APP_ENVS = ['dev', 'uat'];
const GEMINI_BACKENDS = ['aistudio', 'vertex'];
const DEFAULT_JWT_SECRET = 'safeglobe-ddq-secure-hmac-key-2026';
const ROOT = path.join(__dirname, '..');

function loadEnvFile(env = process.env) {
  const appEnv = env.APP_ENV;
  if (!appEnv) { dotenv.config({ quiet: true }); return '.env'; }
  const file = `.env.${appEnv}`;
  if (fs.existsSync(path.join(ROOT, file))) { dotenv.config({ path: path.join(ROOT, file), quiet: true }); return file; }
  // dev may fall back to the existing .env so a first run works before .env.dev is created
  if (appEnv === 'dev' && fs.existsSync(path.join(ROOT, '.env'))) { dotenv.config({ quiet: true }); return '.env (no .env.dev found)'; }
  return null; // uat on Cloud Run: everything comes from the service's own variables and secrets
}

const usableKey = key => typeof key === 'string' && key.length > 20 && !/^YOUR_/i.test(key);

/** Problems with the environment, as plain sentences. Empty when it is fine to start. */
function validateEnv(env = process.env) {
  const problems = [];
  const appEnv = env.APP_ENV;
  if (appEnv && !APP_ENVS.includes(appEnv)) problems.push(`APP_ENV must be "dev" or "uat" (got "${appEnv}").`);
  if (env.PORT && !(Number.isInteger(Number(env.PORT)) && Number(env.PORT) > 0 && Number(env.PORT) < 65536)) problems.push(`PORT must be a port number (got "${env.PORT}").`);
  if (env.GEMINI_BACKEND && !GEMINI_BACKENDS.includes(env.GEMINI_BACKEND)) problems.push(`GEMINI_BACKEND must be "aistudio" or "vertex" (got "${env.GEMINI_BACKEND}").`);

  if (appEnv === 'uat') {
    if (!env.JWT_SECRET || env.JWT_SECRET === DEFAULT_JWT_SECRET) problems.push('JWT_SECRET must be set to your own value in uat: DDQ links are signed with it.');
    if (!env.GEMINI_BACKEND) problems.push('GEMINI_BACKEND must be set in uat: "aistudio" or "vertex".');
    if (env.GEMINI_BACKEND === 'vertex') {
      if (!env.GOOGLE_CLOUD_PROJECT) problems.push('GOOGLE_CLOUD_PROJECT is required when GEMINI_BACKEND=vertex.');
      if (!env.GOOGLE_CLOUD_LOCATION) problems.push('GOOGLE_CLOUD_LOCATION is required when GEMINI_BACKEND=vertex.');
    }
    if (env.GEMINI_BACKEND === 'aistudio' && !usableKey(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.GOOGLE_GENAI_API_KEY)) {
      problems.push('GEMINI_API_KEY is required when GEMINI_BACKEND=aistudio.');
    }
  }
  return problems;
}

const envFile = loadEnvFile();

module.exports = {
  appEnv: process.env.APP_ENV || null,
  envFile,
  version: require('../package.json').version,
  validateEnv,
  // Which Gemini backend the shared client should use (services/geminiClient.js)
  geminiBackend: process.env.GEMINI_BACKEND || 'aistudio',
  googleCloudProject: process.env.GOOGLE_CLOUD_PROJECT || '',
  googleCloudLocation: process.env.GOOGLE_CLOUD_LOCATION || '',
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
  jwtSecret: process.env.JWT_SECRET || DEFAULT_JWT_SECRET,
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
  complianceEmails: (process.env.COMPLIANCE_OFFICER_EMAILS || 'compliance@duedilly.com,grace.teo@duedilly.internal').split(',').map(s => s.trim().toLowerCase()),
  // Company name shown in the top bar of the compliance workspace
  workspaceName: process.env.WORKSPACE_NAME || 'Meridian Commodities',
  staticDir: path.join(__dirname, '..')
};

