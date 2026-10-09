const express = require('express');
const cors = require('cors');
const path = require('path');
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

// Initialize DB early
getDb();

// Middlewares
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Container health check endpoint (Google Cloud Run & Kubernetes probes)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'DueDilly Compliance Platform',
    version: '1.0.0',
    dbType: config.dbType
  });
});

// Mount API routes
app.use('/v1', v1Router);
app.use('/api/entities', entitiesRouter);
app.use('/api/claim', claimsRouter);
app.use('/api/statements', statementsRouter);
app.use('/api/ddq', ddqRouter);
app.use('/api/ddq-templates', require('./routes/ddqTemplates'));

// Compliance Agent: what it is, which mode it is in, and the tools it can call
app.get('/api/agent/compliance', (req, res) => {
  res.json(require('./agents/complianceAgent').describe());
});
app.use('/api/alerts', alertsRouter);
app.use('/api/sources', sourcesRouter);
app.use('/api/policies', policiesRouter);
app.use('/api/cases', casesRouter);
app.use('/api/ask', askRouter);
app.use('/api/stats', statsRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api/places', placesRouter);
app.use('/api/ai', aiRouter);
app.use('/api/kyc', kycRouter);


// Auth routes
const { authenticate, getRoleForEmail } = require('./middleware/auth');

app.get('/api/auth/session', authenticate, (req, res) => {
  res.json({
    authenticated: true,
    user: req.user,
    googleClientId: config.googleClientId
  });
});

// Public, non-secret client configuration (never includes the Gemini key)
app.get('/api/config/public', (req, res) => {
  // Placeholder / malformed keys fall back to the mock landmark map instead of a broken embed
  const mapsKey = /^AIza[\w-]{35}$/.test(config.googleMapsApiKey) ? config.googleMapsApiKey : '';
  res.json({
    googleClientId: config.googleClientId,
    googleMapsApiKey: mapsKey,
    mapsEnabled: Boolean(mapsKey)
  });
});

app.post('/api/auth/switch-persona', (req, res) => {
  const { email, role, name, department } = req.body;
  const targetEmail = (email || 'john.doe@duedilly.com').toLowerCase().trim();
  const targetRole = role || getRoleForEmail(targetEmail);
  res.json({
    success: true,
    user: {
      email: targetEmail,
      role: targetRole,
      name: name || (targetRole === 'compliance_officer' ? 'Grace Teo' : 'John Doe'),
      department: department || (targetRole === 'compliance_officer' ? 'Compliance & Risk Governance' : 'Procurement & Logistics')
    }
  });
});

// Forward /api/intake to entities router
app.post('/api/intake', (req, res, next) => {
  req.url = '/intake';
  entitiesRouter(req, res, next);
});

// Serve frontend: safe-globe.html and portal routes
const htmlPath = path.join(config.staticDir, 'safe-globe.html');

app.get(['/', '/portal/compliance', '/login'], (req, res) => {
  res.sendFile(htmlPath);
});

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

app.get('/safe-globe.html', (req, res) => {
  res.sendFile(htmlPath);
});

app.get('/saf-globe.html', (req, res) => {
  res.sendFile(htmlPath);
});

// Serve static directory for any static assets (PDFs, images, etc.)
// Only these files are public. The repo root is NOT served: it holds the database, uploaded
// counterparty documents, source code and config, none of which may be downloadable.
const PUBLIC_ASSETS = ['portal-shared.css', 'portal-shared.js', 'ddq-section-status.js', 'duck-tour.js'];
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
  } catch (err) {
    console.error('[DueDilly] Persona seed skipped:', err.message);
  }
  return new Promise((resolve) => {
    server = app.listen(port, config.host, () => {
      console.log(`[DueDilly] Server running on http://${config.host}:${port}`);
      console.log(`[DueDilly] Serving UI: http://localhost:${port}/safe-globe.html`);
      console.log(`[DueDilly] Ready for local testing and Google Cloud Run deployment.`);
      resolve(server);
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
        const db = getDb();
        if (db && typeof db.close === 'function') db.close();
        resolve();
      });
    } else {
      resolve();
    }
  });
}

if (require.main === module) {
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
