const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { screenCounterparty } = require('../services/screening');

// GET /api/entities
router.get('/', (req, res) => {
  const db = getDb();
  const entities = db.getAllEntities();
  const { kind, q } = req.query;

  let filtered = entities;
  if (kind && kind !== 'all') {
    filtered = filtered.filter(e => e.kind === kind);
  }
  if (q) {
    const term = q.toLowerCase();
    filtered = filtered.filter(e =>
      (e.name + ' ' + (e.short || '') + ' ' + (e.reg || '')).toLowerCase().includes(term)
    );
  }

  res.json({
    total: filtered.length,
    entities: filtered
  });
});

// GET /api/entities/:id
router.get('/:id', (req, res) => {
  const db = getDb();
  const entity = db.getEntityById(req.params.id);
  if (!entity) {
    return res.status(404).json({ error: 'Entity not found' });
  }
  res.json(entity);
});

// POST /api/intake (PRD B.1 Baseline Counterparty Intake)
router.post('/intake', (req, res) => {
  const { name, type = 'org', country = 'SGP', reg = '', role = 'Supplier', watch = true } = req.body;

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Field "name" is required' });
  }

  const db = getDb();
  const screenResult = screenCounterparty({
    name,
    entity: type,
    jurisdiction: country,
    registration: reg,
    watch: Boolean(watch)
  });

  const id = 'org_' + Date.now();
  const cpiRow = db.getCpiByCode(country);

  const newEntity = {
    id,
    kind: type,
    name,
    short: name.split(/\s+/).slice(0, 2).join(' '),
    role,
    a3: country,
    jurisdiction: country,
    city: cpiRow ? cpiRow.name : country,
    reg: reg || 'REG-PENDING',
    risk: screenResult.risk,
    conf: screenResult.confidence,
    confidence: screenResult.confidence,
    owner: 'Grace Teo',
    trigger: 'Counterparty intake screen',
    since: '2026',
    claimed: false,
    factors: screenResult.factors,
    findings: screenResult.findings
  };

  db.upsertEntity(newEntity);

  const caseId = 'RV-26-' + String(4300 + Math.floor(Math.random() * 500));
  db.addCase({
    caseId,
    entity_id: id,
    owner: 'Grace Teo',
    reviewer: 'Sofia Lim',
    risk: screenResult.risk,
    confidence: screenResult.confidence,
    quadrant: screenResult.quadrant
  });

  db.addAlert(
    'Sentry',
    id,
    `New intake: “${name}” screened. Route: ${screenResult.route} (Risk ${screenResult.risk}, Confidence ${screenResult.confidence}%)`,
    screenResult.quadrant
  );

  res.status(201).json({
    entity: newEntity,
    caseId,
    screening: screenResult
  });
});

module.exports = router;
