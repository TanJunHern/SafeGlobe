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
    service: 'Safe Globe Compliance Platform',
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
app.use('/api/alerts', alertsRouter);
app.use('/api/sources', sourcesRouter);
app.use('/api/policies', policiesRouter);
app.use('/api/cases', casesRouter);
app.use('/api/ask', askRouter);
app.use('/api/stats', statsRouter);

// Forward /api/intake to entities router
app.post('/api/intake', (req, res, next) => {
  req.url = '/intake';
  entitiesRouter(req, res, next);
});

// Serve frontend: safe-globe.html and saf-globe.html
const htmlPath = path.join(config.staticDir, 'safe-globe.html');

app.get('/', (req, res) => {
  res.sendFile(htmlPath);
});

app.get('/safe-globe.html', (req, res) => {
  res.sendFile(htmlPath);
});

app.get('/saf-globe.html', (req, res) => {
  res.sendFile(htmlPath);
});

// Serve static directory for any static assets (PDFs, images, etc.)
app.use(express.static(config.staticDir));

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
  return new Promise((resolve) => {
    server = app.listen(port, config.host, () => {
      console.log(`[Safe Globe] Server running on http://${config.host}:${port}`);
      console.log(`[Safe Globe] Serving UI: http://localhost:${port}/safe-globe.html`);
      console.log(`[Safe Globe] Ready for local testing and Google Cloud Run deployment.`);
      resolve(server);
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
    console.log('[Safe Globe] Received SIGTERM signal, shutting down gracefully...');
    await stopServer();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('[Safe Globe] Received SIGINT signal, shutting down gracefully...');
    await stopServer();
    process.exit(0);
  });
}

module.exports = {
  app,
  startServer,
  stopServer
};
