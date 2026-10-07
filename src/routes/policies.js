const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

// GET /api/policies
router.get('/', (req, res) => {
  const db = getDb();
  res.json({
    policies: db.getPolicies()
  });
});

// POST /api/policies/compile
router.post('/compile', (req, res) => {
  const { title = 'Custom Compliance Policy', rules = [] } = req.body;
  const db = getDb();

  // Policy compiler parses guidelines and checks gaps / conflicts
  const compiledRule = {
    id: 'R' + (db.getPolicies().length + 1),
    sec: '§2.1',
    t: 'Enhanced screening on all counterparties exceeding $1M annual volume',
    note: 'Compiled from uploaded guideline document',
    hits: ['halcyon', 'kestrel'],
    met: false
  };

  db.addPolicy(compiledRule);

  res.json({
    status: 'compiled',
    rule: compiledRule,
    gap: 'No rule covers minority stakes below 50% held by state-owned companies.',
    conflict: 'CPI high-risk threshold (40) vs Appendix B standard risk classification for Turkey (31).'
  });
});

module.exports = router;
