const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { getDb } = require('./db');

// Route modules
const v1Router = require('./routes/v1');
const entitiesRouter = require('./routes/entities');
const claimsRouter = require('./routes/claims');
const statementsRouter = require('./routes/statements');
const ddqRouter = require('./routes/ddq');
const alertsRouter = require('./routes/alerts');
const sourcesRouter = require('./routes/sources');
const policiesRouter = require('./routes/policies');
const casesRouter = require('./routes/cases');
const askRouter = require('./routes/ask');
const statsRouter = require('./routes/stats');
const uploadsRouter = require('./routes/uploads');
const placesRouter = require('./routes/places');
const aiRouter = require('./routes/ai');
const kycRouter = require('./routes/kyc');

const app = express();
// Cloud Run puts one proxy in front of the app; trusting it gives the rate limit the visitor's real address
app.set('trust proxy', 1);

// Initialize DB early
getDb();
// Events: every alert raises "alert-raised"; handlers for triage, changed sources and re-screens (src/events)
require('./events/handlers').register();

// Middlewares
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Which environment is running and which Gemini backend answers. No secrets.
const healthInfo = () => ({ env: config.appEnv || 'local', version: config.version, gemini: require('./services/geminiClient').backend() });
app.get('/healthz', (req, res) => res.json(healthInfo()));

// Container health check endpoint (Google Cloud Run & Kubernetes probes)
// Carries the /healthz fields too: Cloud Run reserves some paths ending in "z", so /healthz may not be reachable there
app.get('/api/health', (req, res) => {
  res.json({
    ...healthInfo(),
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'DueDilly Compliance Platform',
    dbType: config.dbType
  });
});

// Who may call what (docs/agent/implementation_plan.md, Accounts phase). Every role is checked here on the server.
// officerOnly: signed in and a compliance officer. authenticate: any signed-in account of the workspace.
const { authenticate, officerOnly, optionalAuth, googleConfigured } = require('./middleware/auth');

// Mount API routes
// /v1/screen stays open for the demo; a signed-in caller screens into their own workspace
app.use('/v1', optionalAuth, v1Router);
app.use('/api/entities', officerOnly, entitiesRouter);
app.use('/api/claim', officerOnly, claimsRouter);
app.use('/api/statements', officerOnly, statementsRouter);
// The DDQ router guards itself: counterparty routes by their signed link, staff routes by role
app.use('/api/ddq', ddqRouter);
app.use('/api/ddq-templates', require('./routes/ddqTemplates'));

// Compliance Agent: what it is, which mode it is in, and the tools it can call
app.get('/api/agent/compliance', (req, res) => {
  res.json(require('./agents/complianceAgent').describe());
});
app.use('/api/alerts', officerOnly, alertsRouter);
app.use('/api/sources', officerOnly, sourcesRouter);
app.use('/api/policies', officerOnly, policiesRouter);
app.use('/api/cases', officerOnly, casesRouter);
app.use('/api/ask', authenticate, askRouter);
app.use('/api/stats', officerOnly, statsRouter);
app.use('/api/uploads', officerOnly, uploadsRouter);
// Address lookup holds no workspace data and is also used by the counterparty DDQ page
app.use('/api/places', placesRouter);
app.use('/api/ai', officerOnly, aiRouter);
app.use('/api/kyc', kycRouter);
app.use('/api/monitoring', require('./routes/monitoring'));
// Risk scoring: rules, recommended changes and the "Why <score>?" breakdown (src/risk)
app.use('/api/risk', officerOnly, require('./routes/risk'));
app.get('/risk/source', require('./routes/auth').pageSession, require('./routes/risk').sourcePage);
// Pond-Guard screening and Ask Dilly through the ADK agents service, with the read-only tools that agent may call
app.use('/api/pond-guard', require('./routes/pondGuard'));
// Pub/Sub and Cloud Scheduler deliver events here. The route checks the caller's Google-signed token itself.
app.use('/events', require('./routes/events'));
// The fictional demo page a crawler agent reads, and the page the crawler's user agent points to
app.get(require('./services/demoFixtures').PATH, (req, res) => res.type('html').send(require('./services/demoFixtures').render(getDb(), req.path)));
app.get('/about-bot', (req, res) => res.type('text/plain').send(`DueDillyBot reads public web pages that a DueDilly user added as a compliance source.
It obeys robots.txt (user agent token: DueDillyBot), never signs in, sends no cookies, and waits at least 5 seconds between requests to one site.
To stop it reading your site, add to robots.txt:

User-agent: DueDillyBot
Disallow: /
`));
app.use('/internal/ask-tools', require('./routes/pondGuard').internalTools);
// Settings: the accounts of the workspace, the invitations and the account change log
app.use('/api/settings', officerOnly, require('./routes/settings'));

// Auth routes: demo accounts, Google sign-in, "Create an account", the current session
app.use('/api/auth', require('./routes/auth'));

// Public, non-secret client configuration (never includes the Gemini key)
app.get('/api/config/public', (req, res) => {
  // Placeholder / malformed keys fall back to the mock landmark map instead of a broken embed
  const mapsKey = /^AIza[\w-]{35}$/.test(config.googleMapsApiKey) ? config.googleMapsApiKey : '';
  res.json({
    googleClientId: config.googleClientId,
    googleMapsApiKey: mapsKey,
    mapsEnabled: Boolean(mapsKey),
    // Demo mode shows the persona picker. dataResets: the database lives on the container's disk and is lost on restart.
    demoMode: config.demoMode,
    // The demo accounts a visitor may pick with one click, and whether Google sign-in is set up
    demoAccounts: config.demoMode ? require('./accounts/accountsStore').DEMO_ACCOUNTS.map(a => ({ key: a.key, name: a.name, email: a.email, role: a.role, department: a.department })) : [],
    googleSignIn: googleConfigured(),
    dataResets: config.isCloudRun && config.dbType === 'sqlite',
    // Name of the company using DueDilly, shown in the top bar (WORKSPACE_NAME)
    workspaceName: config.workspaceName
  });
});

// Forward /api/intake to entities router
app.post('/api/intake', officerOnly, (req, res, next) => {
  req.url = '/intake';
  entitiesRouter(req, res, next);
});

// Serve frontend: safe-globe.html and portal routes
const htmlPath = path.join(config.staticDir, 'safe-globe.html');

// In a clean workspace (npm run demo:clean) the page is told to drop its built-in demo counterparties
function sendApp(req, res) {
  if (getDb().hasPlaceholderData()) return res.sendFile(htmlPath);
  const html = '<script>window.DUEDILLY_NO_PLACEHOLDERS=true</script>\n' + fs.readFileSync(htmlPath, 'utf8');
  res.type('html').send(html);
}

app.get(['/', '/portal/compliance', '/login'], sendApp);

// Standalone DDQ pages: counterparty wizard, compliance template manager, printable copy
const pageRoutes = {
  '/ddq/portal': 'ddq-portal.html',
  '/portal/ddq-manager': 'ddq-manager.html',
  '/ddq/print': 'ddq-print.html'
};
for (const [route, file] of Object.entries(pageRoutes)) {
  app.get(route, (req, res) => res.sendFile(path.join(config.staticDir, file)));
}

// Employees get a standalone page: KYC table only, no globe / reviews / sources / policies
const employeeHtmlPath = path.join(config.staticDir, 'employee-portal.html');
app.get(['/portal/employee', '/employee-portal.html'], (req, res) => {
  res.sendFile(employeeHtmlPath);
});

app.get('/safe-globe.html', sendApp);

app.get('/saf-globe.html', sendApp);

// Serve static directory for any static assets (PDFs, images, etc.)
// Only these files are public. The repo root is NOT served: it holds the database, uploaded
// counterparty documents, source code and config, none of which may be downloadable.
const PUBLIC_ASSETS = ['portal-shared.css', 'portal-shared.js', 'ddq-section-status.js', 'duck-tour.js', 'dilly-loader.js', 'monitoring-ui.js'];
for (const file of PUBLIC_ASSETS) {
  app.get(`/${file}`, (req, res) => res.sendFile(path.join(config.staticDir, file)));
}

// UI assets (images, icons, fonts). Only this folder is mounted, never the repo root.
app.use('/assets', express.static(path.join(config.staticDir, 'assets')));

// Fallback 404 for unmatched API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

let server = null;

function startServer(port = config.port) {
  try {
    require('./services/ddqTemplateService').ensureDefaultTemplate();
    require('./services/kycService').ensurePersonaSeed();
    require('./services/vesselFinderService').ensureSource(getDb());
    require('./services/kycService').syncAllMonitoredEntities();
  } catch (err) {
    console.error('[DueDilly] Persona seed skipped:', err.message);
  }
  return new Promise((resolve) => {
    server = app.listen(port, config.host, () => {
      console.log(`[DueDilly] Server running on http://${config.host}:${port}`);
      console.log(`[DueDilly] Serving UI: http://localhost:${port}/safe-globe.html`);
      console.log(`[DueDilly] Ready for local testing and Google Cloud Run deployment.`);
      resolve(server);
      // Monitored vessels that were never checked get their position and destination from VesselFinder
      require('./services/kycService').refreshUncheckedVessels().catch(err => console.error('[DueDilly] Vessel lookup skipped:', err.message));
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[DueDilly] Error: Port ${port} is already in use by another running instance of the server.`);
      } else {
        console.error('[DueDilly] Server startup error:', err);
      }
    });
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => {
        require('./db').closeAll();
        resolve();
      });
    } else {
      resolve();
    }
  });
}

if (require.main === module) {
  // Refuse to start on a broken environment, and say exactly what is wrong
  const problems = config.validateEnv();
  if (problems.length) {
    console.error(`[DueDilly] Cannot start${config.appEnv ? ` (APP_ENV=${config.appEnv})` : ''}. Fix these in ${config.envFile || 'the environment variables'}:`);
    problems.forEach(p => console.error(`  - ${p}`));
    process.exit(1);
  }
  console.log(`[DueDilly] Environment: ${config.appEnv || 'local'} · config from ${config.envFile || 'environment variables'} · Gemini: ${require('./services/geminiClient').backend()}`);
  startServer();

  // Cloud Run SIGTERM graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('[DueDilly] Received SIGTERM signal, shutting down gracefully...');
    await stopServer();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('[DueDilly] Received SIGINT signal, shutting down gracefully...');
    await stopServer();
    process.exit(0);
  });
}

module.exports = {
  app,
  startServer,
  stopServer
};
