const express = require('express');
const router = express.Router();
const { solveQuery } = require('../services/askService');

// POST /api/ask
router.post('/', (req, res) => {
  const { query } = req.body;
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Field "query" is required' });
  }

  const result = solveQuery(query);
  if (!result) {
    return res.json({
      found: false,
      message: 'No exact graph match. Ask about Russian SOE links, vessels going dark, CPI scores, or ultimate beneficial owners.'
    });
  }

  res.json({
    found: true,
    query,
    ...result
  });
});

module.exports = router;
