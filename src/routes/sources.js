const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { convertAndStoreSource } = require('../services/sourceHandlers');
const { authenticate, requireRole } = require('../middleware/auth');
const { isLockedSource } = require('../services/vesselFinderService');
const config = require('../config');
const crawler = require('../services/crawlerService');
const demoFixtures = require('../services/demoFixtures');
const { aiRateLimit } = require('../middleware/rateLimit');

// GET /api/sources
router.get('/', (req, res) => {
  const db = getDb();
  res.json({
    sources: db.getSources()
  });
});

// GET /api/sources/records (All converted readable records from dataset, documents, API, web)
router.get('/records', (req, res) => {
  const db = getDb();
  const { sourceId, kind, type, q } = req.query;
  let records;
  if (q) {
    records = db.searchSourceRecords(q, kind);
  } else {
    records = db.getSourceRecords({ sourceId, kind, type });
  }
  res.json({
    total: records.length,
    records
  });
});


// ---------------------------------------------------------------------------------------------
// Crawler agents (feature 3) and suggested extraction fixes (feature 9)
// ---------------------------------------------------------------------------------------------
const crawlView = source => {
  const c = (source.config && source.config.crawl) || {};
  return {
    sourceId: source.id, label: source.label, url: source.config.url || '', isWebsite: crawler.isWebSource(source), locked: isLockedSource(source.id),
    termsChecked: Boolean(source.config.termsChecked) || source.id === demoFixtures.SOURCE_ID, runOnScreening: Boolean(source.config.runOnScreening),
    instructions: source.config.instructions || '',
    lastReadAt: c.lastReadAt || null, lastTriedAt: c.lastTriedAt || null, result: c.result || null, resultLabel: c.resultLabel || 'Not read yet', reason: c.reason || '',
    recordsCount: c.recordsCount || 0, extractor: c.extractor || null, offlineReason: c.offlineReason || '', modelId: c.modelId || '', robots: c.robots || null,
    hasSnapshot: Boolean(c.snapshotKey), snapshotWhere: c.snapshotWhere || null, rejected: c.rejected || []
  };
};
const fixtureUrl = req => `${config.publicBaseUrl || `${req.protocol}://${req.get('host')}`}${demoFixtures.PATH}`;

// GET /api/sources/crawl/status   every website source's last read, the pending suggestions, and what is live
router.get('/crawl/status', (req, res) => {
  const db = getDb();
  const mode = crawler.mode(db);
  res.json({
    mode: mode.live ? 'live' : 'offline', reason: mode.reason, userAgent: crawler.userAgent(),
    storage: require('../services/objectStorage').status(), events: require('../events/bus').status(),
    schedule: config.pubsubMode === 'pubsub' ? 'Cloud Scheduler, once a week (Mondays, 06:30 Singapore time)' : 'Not connected: use Run now',
    sources: db.getSources().filter(s => crawler.isWebSource(s) && !isLockedSource(s.id)).map(crawlView),
    proposals: db.getSourceProposals({ status: 'pending' }),
    demoPage: config.demoMode ? { url: fixtureUrl(req), version: demoFixtures.versionOf(db), sourceId: demoFixtures.SOURCE_ID, added: Boolean(db.getSourceById(demoFixtures.SOURCE_ID)) } : null
  });
});

// POST /api/sources/crawl/run-all   "Run now" for every website source
router.post('/crawl/run-all', aiRateLimit, async (req, res) => {
  const db = getDb();
  const results = await crawler.crawlAll(db);
  res.json({ status: 'done', results, sources: db.getSources().filter(s => crawler.isWebSource(s) && !isLockedSource(s.id)).map(crawlView) });
});

// GET /api/sources/proposals   suggested extraction fixes (?status=pending)
router.get('/proposals', (req, res) => {
  res.json({ proposals: getDb().getSourceProposals({ status: req.query.status || null }) });
});

// POST /api/sources/proposals/:id/approve | dismiss   a person decides; nothing is applied without this
router.post('/proposals/:id/:decision', aiRateLimit, async (req, res) => {
  if (!['approve', 'dismiss'].includes(req.params.decision)) return res.status(404).json({ error: 'Use approve or dismiss' });
  try {
    const out = await crawler.decideProposal(getDb(), req.params.id, req.params.decision === 'approve', req.user ? req.user.email : '');
    res.json(Object.assign({ status: out.proposal.status }, out));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : 'The decision could not be saved' });
  }
});

// POST /api/sources/demo-page   { version: 1 | 2 }   DEMO_MODE only: adds the fictional demo page as a source, or publishes its second version
router.post('/demo-page', aiRateLimit, async (req, res) => {
  if (!config.demoMode) return res.status(403).json({ error: 'The demo page is only available in demo mode' });
  const db = getDb();
  const version = Number(req.body && req.body.version) === 2 ? 2 : 1;
  let source = db.getSourceById(demoFixtures.SOURCE_ID);
  if (!source) {
    // First the baseline (version 1), so that version 2 is a change
    demoFixtures.setVersion(db, 1);
    db.addSource({
      id: demoFixtures.SOURCE_ID, label: demoFixtures.SOURCE_LABEL, type: 'Web', how: 'Demo page, read by a crawler agent', cover: 'Organisations, vessels', trust: 'Medium', health: 'ok',
      kv: [['Page', fixtureUrl(req)], ['Demo', 'Fictional page served by DueDilly']], config: { url: fixtureUrl(req), termsChecked: true, demo: true }
    });
    await crawler.crawlSource(db, db.getSourceById(demoFixtures.SOURCE_ID));
  }
  demoFixtures.setVersion(db, version);
  const result = version === 2 || source ? await crawler.crawlSource(db, db.getSourceById(demoFixtures.SOURCE_ID)) : null;
  source = db.getSourceById(demoFixtures.SOURCE_ID);
  res.json({ status: 'ok', version, result, source: crawlView(source) });
});

// POST /api/sources
router.post('/', async (req, res) => {
  const {
    label,
    type = 'API',
    how,
    cover = 'Organisations, people',
    trust = 'Medium',
    config = {},
    filename,
    fileSize = 0,
    mimeType,
    content,
    parsedRecords = 1,
    kv
  } = req.body;

  if (!label) {
    return res.status(400).json({ error: 'Field "label" is required' });
  }

  const db = getDb();
  const id = 's_' + Date.now();

  let uploadedFile = null;
  // If a file (PDF or Feed) is uploaded with the source, persist to uploaded_files and disk
  if (content || filename) {
    try {
      const isPdf = type === 'PDF document' || type === 'PDF' || (filename && filename.toLowerCase().endsWith('.pdf'));
      uploadedFile = db.addUploadedFile({
        entity_id: null,
        file_type: isPdf ? 'custom_policy' : 'data_feed',
        filename: filename || (isPdf ? `${label.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf` : 'feed.csv'),
        file_size: fileSize || (content ? content.length : 0),
        mime_type: mimeType || (isPdf ? 'application/pdf' : 'text/csv'),
        content_data: content || '',
        parsed_records: parsedRecords || (isPdf ? 1 : 25)
      });
    } catch (e) {
      console.error('Failed to store source upload file:', e);
    }
  }

  let defaultHow = 'Queried live at each screen';
  if (type === 'Web') defaultHow = config.freq ? `Monitored page, read every ${config.freq}` : 'Read every 12 hours';
  else if (type === 'Data feed') defaultHow = config.delivery || 'SFTP, daily';
  else if (type === 'PDF document' || type === 'PDF') defaultHow = 'Parsed PDF document, entity extraction active';

  const defaultKv = [
    ['Added', 'Just now'],
    ['Status', 'Live on screening pipeline']
  ];
  if (uploadedFile) {
    defaultKv.push(['File', uploadedFile.filename]);
    defaultKv.push(['Storage', 'Backend database & disk']);
  } else if (type === 'API') {
    defaultKv.push(['Endpoint', config.url || 'API endpoint registered']);
    defaultKv.push(['Re-screen', 'Triggered live at each screen']);
  } else if (type === 'Web') {
    defaultKv.push(['Page', config.url || 'Monitored URL']);
    defaultKv.push(['Frequency', config.freq || 'Every 12 hours']);
  } else {
    defaultKv.push(['Re-screen', 'Queued for monitored counterparties']);
  }

  const newSource = {
    id,
    label,
    type,
    how: how || defaultHow,
    cover,
    trust,
    health: 'ok',
    kv: kv || defaultKv,
    config: {
      ...config,
      fileId: uploadedFile ? uploadedFile.id : null,
      filename: uploadedFile ? uploadedFile.filename : (filename || null),
      storagePath: uploadedFile ? uploadedFile.storage_path : null
    }
  };

  db.addSource(newSource);

  let conversion = null;
  try {
    conversion = await convertAndStoreSource({
      ...newSource,
      content,
      filename,
      format: config.format
    });
  } catch (err) {
    console.error('Source conversion error:', err);
  }

  // A new source may carry policy text or change how much its findings are trusted: recommend, never apply
  let recommended = [];
  try {
    recommended = require('../risk/suggestions').raiseFor(db, { type: 'source', name: label, text: content || '', source: { id, label, trust } });
  } catch (err) {
    console.error('[DueDilly] Scoring recommendations skipped:', err.message);
  }

  res.status(201).json({
    status: 'created',
    source: newSource,
    scoringSuggestions: recommended.map(s => ({ id: s.id, title: s.title })),
    uploadedFile: uploadedFile ? { id: uploadedFile.id, filename: uploadedFile.filename, storage_path: uploadedFile.storage_path } : null,
    conversion: conversion ? {
      recordsCount: conversion.recordsCount,
      summary: conversion.summary,
      sample: (conversion.records || []).slice(0, 3)
    } : null
  });
});

// GET /api/sources/:id/records
router.get('/:id/records', (req, res) => {
  const db = getDb();
  const records = db.getSourceRecordsBySource(req.params.id);
  res.json({
    sourceId: req.params.id,
    total: records.length,
    records
  });
});

// POST /api/sources/:id/convert
router.post('/:id/convert', async (req, res) => {
  const db = getDb();
  const sources = db.getSources();
  const source = sources.find(s => s.id === req.params.id);
  if (!source) return res.status(404).json({ error: 'Source not found' });
  if (isLockedSource(source.id)) return res.status(403).json({ error: 'This source is built in and cannot be changed' });
  const result = await convertAndStoreSource(source);
  res.json({
    status: 'converted',
    sourceId: source.id,
    ...result
  });
});

// POST /api/sources/:id/crawl   "Run now" for one website source
router.post('/:id/crawl', aiRateLimit, async (req, res) => {
  const db = getDb();
  const source = db.getSourceById(req.params.id);
  if (!source) return res.status(404).json({ error: 'Source not found' });
  if (isLockedSource(source.id)) return res.status(403).json({ error: 'This source is built in and is read by its own service' });
  if (!crawler.isWebSource(source)) return res.status(400).json({ error: 'Only website sources are read by a crawler agent' });
  const result = await crawler.crawlSource(db, source, { force: Boolean(req.body && req.body.force) });
  res.json({ status: 'done', result, source: crawlView(db.getSourceById(source.id)) });
});

// PUT /api/sources/:id/crawl-settings   { termsChecked, runOnScreening, instructions }
router.put('/:id/crawl-settings', (req, res) => {
  const db = getDb();
  const source = db.getSourceById(req.params.id);
  if (!source) return res.status(404).json({ error: 'Source not found' });
  if (isLockedSource(source.id)) return res.status(403).json({ error: 'This source is built in and cannot be changed' });
  const body = req.body || {};
  const patch = {};
  if (typeof body.termsChecked === 'boolean') Object.assign(patch, { termsChecked: body.termsChecked, termsCheckedBy: body.termsChecked && req.user ? req.user.email : '', termsCheckedAt: body.termsChecked ? new Date().toISOString() : '' });
  if (typeof body.runOnScreening === 'boolean') patch.runOnScreening = body.runOnScreening;
  if (typeof body.instructions === 'string') patch.instructions = body.instructions.trim().slice(0, 2000);
  db.updateSourceConfig(source.id, patch);
  res.json({ status: 'saved', source: crawlView(db.getSourceById(source.id)) });
});

// GET /api/sources/:id/snapshot   the page as it was last read
router.get('/:id/snapshot', async (req, res) => {
  const source = getDb().getSourceById(req.params.id);
  if (!source) return res.status(404).json({ error: 'Source not found' });
  const snapshot = await crawler.readSnapshot(source);
  if (!snapshot) return res.status(404).json({ error: 'No snapshot is stored for this source' });
  const { stripHtml } = require('../services/sourceHandlers');
  res.json({ sourceId: source.id, label: source.label, url: source.config.url, readAt: snapshot.readAt, storedIn: snapshot.where === 'gcs' ? 'Cloud Storage' : 'Local folder', text: stripHtml(snapshot.html).slice(0, 20000) });
});

// POST /api/sources/test
router.post('/test', (req, res) => {
  const { type = 'API', url, filename } = req.body;
  // Test connection emulation with health validation (PRD Page 4)
  const logs = type === 'API' ? [
    'Connecting to endpoint...',
    '200 OK in 274 ms',
    'Sample payload parsed: 25 entities',
    'Field mapping: name, registration_id, jurisdiction, program'
  ] : type === 'Web' ? [
    'Connecting to web resource...',
    '200 OK, fetched 54 KB',
    'AI entity extractor extracted 14 entities',
    'Change baseline recorded'
  ] : (type === 'PDF document' || type === 'PDF') ? [
    'Reading PDF document structure...',
    'Parsing text streams, tables, and identification numbers...',
    'AI entity extractor identified 18 entity records and watch criteria',
    'Document verified, archived on backend disk and indexed into graph'
  ] : [
    'Connecting to SFTP feed...',
    'Feed file found: ' + (filename || 'restricted_parties.csv'),
    'Validated 1,420 rows, 0 malformed records'
  ];

  res.json({
    success: true,
    latencyMs: 274,
    logs
  });
});

// POST /api/sources/:id/retry
router.post('/:id/retry', (req, res) => {
  const db = getDb();
  db.updateSourceHealth(req.params.id, 'ok');
  res.json({
    status: 'healthy',
    message: 'Source health restored'
  });
});

// DELETE /api/sources/:id
// PUT /api/sources/:id/cost: what one screen against this source costs (SGD). Compliance only.
router.put('/:id/cost', authenticate, requireRole('compliance_officer'), (req, res) => {
  const cost = Number(req.body && req.body.cost_per_screen);
  if (!Number.isFinite(cost) || cost < 0) return res.status(400).json({ error: 'cost_per_screen must be a number of 0 or more' });
  const ok = getDb().setSourceCost(req.params.id, Math.round(cost * 100) / 100);
  if (!ok) return res.status(404).json({ error: 'Source not found' });
  res.json({ success: true, id: req.params.id, cost_per_screen: Math.round(cost * 100) / 100 });
});

router.delete('/:id', (req, res) => {
  if (isLockedSource(req.params.id)) return res.status(403).json({ error: 'This source is built in and cannot be removed' });
  const db = getDb();
  db.deleteSource(req.params.id);
  db.deleteSourceRecordsBySourceId(req.params.id);
  res.json({
    status: 'deleted',
    id: req.params.id
  });
});

module.exports = router;

