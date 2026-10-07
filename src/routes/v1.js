const express = require('express');
const router = express.Router();
const { screenCounterparty } = require('../services/screening');
const { getDb } = require('../db');

/**
 * Public Screening API (PRD Page 4, Section 1.8 & Sources View)
 * POST /v1/screen
 * Body: { entity: "organisation", name: "...", jurisdiction: "...", watch: true }
 */
router.post('/screen', (req, res) => {
  const { entity, name, jurisdiction, registration, watch } = req.body;

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Field "name" is required' });
  }

  const result = screenCounterparty({
    name,
    entity: entity || 'organisation',
    jurisdiction: jurisdiction || 'SGP',
    registration,
    watch: watch !== false
  });

  // If watch is true, persist or update in DB
  if (watch) {
    const db = getDb();
    const existing = db.getEntityById(result.name.toLowerCase().replace(/[^a-z0-9]/g, ''));
    if (!existing) {
      const id = 'org_' + Date.now();
      db.upsertEntity({
        id,
        kind: entity || 'org',
        name: result.name,
        short: result.name.split(/\s+/).slice(0, 2).join(' '),
        role: 'Screened Counterparty',
        jurisdiction: result.jurisdiction,
        city: result.jurisdiction,
        reg_no: result.registration,
        risk: result.risk,
        confidence: result.confidence,
        owner: 'Grace Teo',
        trigger: 'Screening API v1',
        since: '2026',
        claimed: false,
        factors: result.factors,
        findings: result.findings
      });

      db.addCase({
        caseId: 'RV-26-' + Math.floor(4000 + Math.random() * 900),
        entity_id: id,
        owner: 'Grace Teo',
        risk: result.risk,
        confidence: result.confidence,
        quadrant: result.quadrant
      });
    }
  }

  res.json(result);
});

module.exports = router;
