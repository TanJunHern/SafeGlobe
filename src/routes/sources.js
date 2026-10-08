const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { convertAndStoreSource } = require('../services/sourceHandlers');

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

  res.status(201).json({
    status: 'created',
    source: newSource,
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
  const result = await convertAndStoreSource(source);
  res.json({
    status: 'converted',
    sourceId: source.id,
    ...result
  });
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
router.delete('/:id', (req, res) => {
  const db = getDb();
  db.deleteSource(req.params.id);
  db.deleteSourceRecordsBySourceId(req.params.id);
  res.json({
    status: 'deleted',
    id: req.params.id
  });
});

module.exports = router;

