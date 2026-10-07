const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

// GET /api/alerts
router.get('/', (req, res) => {
  const db = getDb();
  const limit = parseInt(req.query.limit || '50', 10);
  const alerts = db.getAlerts(limit);
  res.json({
    total: alerts.length,
    alerts
  });
});

// POST /api/alerts
router.post('/', (req, res) => {
  const { agent, entityId, text, quadrant, isCountry } = req.body;
  if (!agent || !entityId || !text) {
    return res.status(400).json({ error: 'agent, entityId, and text are required' });
  }

  const db = getDb();
  db.addAlert(agent, entityId, text, quadrant || 'investigate', Boolean(isCountry));
  res.status(201).json({ status: 'created' });
});

module.exports = router;
