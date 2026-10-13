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
      if (!env.VERTEX_GEMINI_MODEL) problems.push('VERTEX_GEMINI_MODEL is required when GEMINI_BACKEND=vertex: choose it from the models your project can use (DEPLOY_GUIDE.md step 4).');
    }
    if (env.GEMINI_BACKEND === 'aistudio' && !usableKey(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.GOOGLE_GENAI_API_KEY)) {
      problems.push('GEMINI_API_KEY is required when GEMINI_BACKEND=aistudio.');
    }
    // Without the persona picker the only way in is Google sign-in, which needs a client ID
    if (env.DEMO_MODE !== 'true' && !env.GOOGLE_CLIENT_ID) problems.push('GOOGLE_CLIENT_ID is required in uat unless DEMO_MODE=true: without one of them nobody can sign in.');
  }
  return problems;
}

const envFile = loadEnvFile();

// The persona picker and the x-user-* headers only work in demo mode. On by default locally; in uat it must be asked for.
const demoMode = process.env.DEMO_MODE ? process.env.DEMO_MODE === 'true' : process.env.APP_ENV !== 'uat';
const wholeNumber = (value, fallback) => (Number.isInteger(Number(value)) && String(value || '').trim() !== '' ? Number(value) : fallback);
const list = value => String(value || '').split(',').map(m => m.trim()).filter(Boolean);

module.exports = {
  appEnv: process.env.APP_ENV || null,
  envFile,
  version: require('../package.json').version,
  validateEnv,
  // Which Gemini backend the shared client should use (services/geminiClient.js)
  geminiBackend: process.env.GEMINI_BACKEND || 'aistudio',
  googleCloudProject: process.env.GOOGLE_CLOUD_PROJECT || '',
  googleCloudLocation: process.env.GOOGLE_CLOUD_LOCATION || '',
  // Gemini on Vertex AI: the model chain is chosen from the models the project can use, so there is no default
  vertexModel: process.env.VERTEX_GEMINI_MODEL || '',
  vertexFallbackModels: list(process.env.VERTEX_GEMINI_FALLBACK_MODELS),
  demoMode,
  // True on Cloud Run, where the container's disk (and so the SQLite database) is lost on restart
  isCloudRun: Boolean(process.env.K_SERVICE),
  // Per-IP limit on every endpoint that calls Gemini or the agents. max 0 switches it off (the test command does).
  aiRateLimit: { max: wholeNumber(process.env.AI_RATE_LIMIT_MAX, 20), windowMinutes: wholeNumber(process.env.AI_RATE_LIMIT_WINDOW_MINUTES, 10) },
  // Pond-Guard screenings allowed per day across all users; when reached, the offline fallback runs. 0 = no cap.
  pondGuardDailyCap: wholeNumber(process.env.POND_GUARD_DAILY_CAP, 30),
  // The ADK agents service (agents/). Empty: Pond-Guard and Ask Dilly run on the in-process fallback.
  agentsServiceUrl: (process.env.AGENTS_SERVICE_URL || '').replace(/\/+$/, ''),
  // Shared secret between this app and the agents service (both directions). Cloud Run also checks IAM.
  agentsInternalToken: process.env.AGENTS_INTERNAL_TOKEN || '',
  // Where the agents service reaches this app's read-only tool API (Ask Dilly). Defaults to this server.
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
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
  // Events (src/events). inline: handled inside the app. pubsub: published to <env>-<event>, handled when Pub/Sub pushes them back.
  pubsubMode: (process.env.PUBSUB_MODE || 'inline').toLowerCase() === 'pubsub' ? 'pubsub' : 'inline',
  // What a push from Pub/Sub or Cloud Scheduler must prove: the audience its token was made for and who signed it
  pubsubPushAudience: (process.env.PUBSUB_PUSH_AUDIENCE || '').replace(/\/+$/, ''),
  pubsubPushServiceAccount: (process.env.PUBSUB_PUSH_SERVICE_ACCOUNT || '').trim().toLowerCase(),
  // Crawler agents (feature 3): live page extractions per day, and Ripples triage calls per day. 0 = no cap.
  crawlerDailyCap: wholeNumber(process.env.CRAWLER_DAILY_CAP, 50),
  triageDailyCap: wholeNumber(process.env.TRIAGE_DAILY_CAP, 200),
  // Country risk views on the Globe (src/countryRisk). live: the sources are read on the refresh schedule.
  // Anything else: the saved samples only, and no website is contacted. The cap counts Gemini calls per day; 0 = no cap.
  countryRiskFetch: (process.env.COUNTRY_RISK_FETCH || 'off').toLowerCase() === 'live' ? 'live' : 'off',
  countryRiskDailyCap: wholeNumber(process.env.COUNTRY_RISK_DAILY_CAP, 20),
  // Agent Search (formerly Vertex AI Search) for policy search. Empty data store: the built-in policy text is used.
  agentSearch: {
    dataStore: (process.env.AGENT_SEARCH_DATA_STORE || '').trim(),
    location: (process.env.AGENT_SEARCH_LOCATION || 'global').trim(),
    dailyCap: wholeNumber(process.env.AGENT_SEARCH_DAILY_CAP, 200)
  },
  // The review model (src/learning). local: boosted trees trained inside the app. bigquery: BigQuery ML boosted trees.
  bigquery: {
    mode: (process.env.BIGQUERY || 'local').toLowerCase() === 'bigquery' ? 'bigquery' : 'local',
    dataset: (process.env.BIGQUERY_DATASET || '').trim(),
    location: (process.env.BIGQUERY_LOCATION || process.env.GCP_REGION || 'asia-southeast1').trim(),
    // No ordinary query may bill more than this; a mistake fails instead of costing money
    maxBytesBilled: wholeNumber(process.env.BIGQUERY_MAX_BYTES_BILLED, 100 * 1024 * 1024)
  },
  // Training runs allowed per day across all users, and how many settings the tuning tries. 0 = no cap.
  mlTrainDailyCap: wholeNumber(process.env.ML_TRAIN_DAILY_CAP, 6),
  mlTuningTrials: Math.max(1, Math.min(20, wholeNumber(process.env.ML_TUNING_TRIALS, 6))),
  // Cloud Storage bucket for page snapshots when DOCUMENT_STORAGE=gcs. Empty: a local folder.
  gcsBucket: (process.env.GCS_BUCKET || '').trim(),
  // Supporting documents: 'local' disk for now; 'firebase' is a placeholder driver (services/documentStorage.js)
  documentStorage: process.env.DOCUMENT_STORAGE || 'local',
  // Google Document AI, for parsing PDF / Word questionnaire templates (placeholder: services/documentParserService.js)
  documentAi: {
    projectId: process.env.DOCUMENT_AI_PROJECT_ID || '',
    location: process.env.DOCUMENT_AI_LOCATION || '',
    processorId: process.env.DOCUMENT_AI_PROCESSOR_ID || ''
  },
  // Duck-Scanner: documents sent to Document AI per day across all users (Form Parser bills per page). 0 = no cap.
  documentAiDailyCap: wholeNumber(process.env.DOCUMENT_AI_DAILY_CAP, 20),
  // Reviewer copilot drafts written by Gemini per day. 0 = no cap.
  copilotDailyCap: wholeNumber(process.env.COPILOT_DAILY_CAP, 100),
  // Compliance Agent runtime: 'builtin' today; 'adk' and 'langchain' are reserved (agents/framework.js)
  agentRuntime: process.env.AGENT_RUNTIME || 'builtin',
  jwtSecret: process.env.JWT_SECRET || DEFAULT_JWT_SECRET,
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
  // Vessel lookup by IMO (services/vesselFinderService.js): the official API when a key is set, the public page otherwise
  vesselFinderApiKey: process.env.VESSELFINDER_API_KEY || '',
  // No longer grants access (Accounts phase): a compliance officer is an account. Kept so old settings files still load.
  complianceEmails: (process.env.COMPLIANCE_OFFICER_EMAILS || 'compliance@duedilly.com,grace.teo@duedilly.internal').split(',').map(s => s.trim().toLowerCase()),
  // Company name shown in the top bar of the compliance workspace
  workspaceName: process.env.WORKSPACE_NAME || 'Meridian Commodities',
  staticDir: path.join(__dirname, '..')
};

