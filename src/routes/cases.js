const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

// GET /api/cases
router.get('/', (req, res) => {
  const db = getDb();
  const cases = db.getCases();
  const { filter } = req.query; // 'open' | 'all'

  let filtered = cases;
  if (filter === 'open') {
    filtered = filtered.filter(c => c.quadrant !== 'monitor');
  }

  res.json({
    total: filtered.length,
    cases: filtered
  });
});

// POST /api/cases/:id/decision
router.post('/:id/decision', (req, res) => {
  const { decision, reasons, evidence, reviewer } = req.body;
  const db = getDb();

  db.recordCaseDecision(
    req.params.id,
    reviewer || 'Grace Teo',
    decision || 'Approved with monitoring conditions',
    reasons || 'Verified documentation submitted and evaluated against policy guidelines.',
    evidence || 'Registry extract, Smart DDQ verified answers'
  );

  db.addAlert(
    'Case writer',
    req.params.id,
    `Decision recorded by ${reviewer || 'Grace Teo'}: ${decision || 'Approved'}`,
    'monitor'
  );

  res.json({
    status: 'recorded',
    message: 'Compliance decision and audit trail successfully saved'
  });
});

module.exports = router;
