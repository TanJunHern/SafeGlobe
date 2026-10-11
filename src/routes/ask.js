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

// POST /api/ask/history: questions about past screenings ("how many have been screened?")
router.post('/history', require('../middleware/auth').authenticate, async (req, res) => {
  const { query } = req.body || {};
  if (!query || typeof query !== 'string') return res.status(400).json({ error: 'Field "query" is required' });
  const email = req.user.role === 'employee' && !req.user.anonymous ? req.user.email : null;
  const result = await require('../services/screeningHistoryService').answer(query, { email });
  if (result.records) delete result.records;
  res.json(Object.assign({ query }, result));
});

module.exports = router;
