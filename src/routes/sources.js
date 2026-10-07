const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

// GET /api/sources
router.get('/', (req, res) => {
  const db = getDb();
  res.json({
    sources: db.getSources()
  });
});

// POST /api/sources
router.post('/', (req, res) => {
  const { label, type = 'API', how, cover = 'Organisations, people', trust = 'Medium' } = req.body;
  if (!label) {
    return res.status(400).json({ error: 'Field "label" is required' });
  }

  const db = getDb();
  const id = 's_' + Date.now();
  const newSource = {
    id,
    label,
    type,
    how: how || (type === 'API' ? 'Queried live at each screen' : type === 'Web' ? 'Read every 12 hours' : 'SFTP, daily'),
    cover,
    trust,
    health: 'new',
    kv: [
      ['Added', 'Just now'],
      ['Status', 'Live on screening pipeline'],
      ['Re-screen', 'Queued for monitored counterparties']
    ]
  };

  db.addSource(newSource);
  res.status(201).json({
    status: 'created',
    source: newSource
  });
});

// POST /api/sources/test
router.post('/test', (req, res) => {
  const { type, url } = req.body;
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
  ] : [
    'Connecting to SFTP feed...',
    'Feed file found: restricted_parties.csv',
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

module.exports = router;
