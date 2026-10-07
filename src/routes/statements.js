const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { verifyStatement } = require('../services/truthCheck');

// GET /api/statements/:id
router.get('/:id', (req, res) => {
  const db = getDb();
  const stmt = db.getStatement(req.params.id);
  if (!stmt) {
    return res.status(404).json({ error: 'No statement on file for this organization' });
  }
  res.json(stmt);
});

// POST /api/statements
router.post('/', (req, res) => {
  const { id, text, remediation } = req.body;

  if (!id || !text) {
    return res.status(400).json({ error: 'Fields "id" and "text" are required' });
  }

  const db = getDb();
  const entity = db.getEntityById(id);
  if (!entity) {
    return res.status(404).json({ error: 'Organisation not found' });
  }

  // Run Truth check AI analysis
  const claims = verifyStatement(text, entity);

  const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const saved = db.saveStatement(id, dateStr, text, remediation || '', claims);

  // Send alert to watching screeners (PRD 2.5)
  db.addAlert(
    'Truth check',
    id,
    `${entity.short || entity.name} published a clarification statement. Truth check analyzed ${claims.length} claims`,
    'investigate'
  );

  res.status(201).json({
    status: 'published',
    statement: saved,
    claimsCount: claims.length,
    message: 'Clarification statement published and analyzed by Truth check'
  });
});

module.exports = router;
