/**
 * AI Routes for KYCP Screening and Counterparty Intelligence
 */

const express = require('express');
const router = express.Router();
const { runKycpCheck, KYCP_INSTRUCTIONS, tools } = require('../services/aiKycpService');

// POST /api/ai/kycp
router.post('/kycp', async (req, res) => {
  const { query, name, target, type = 'organisation', entity, jurisdiction } = req.body;
  const searchTerm = query || name || target;

  if (!searchTerm || typeof searchTerm !== 'string') {
    return res.status(400).json({
      error: 'Field "query" or "name" or "target" is required.'
    });
  }

  try {
    const report = await runKycpCheck({
      query: searchTerm,
      type: type || entity || 'organisation',
      jurisdiction
    });
    res.json(report);
  } catch (err) {
    console.error('AI KYCP check failed:', err);
    res.status(500).json({
      error: 'Failed to complete AI KYCP screening',
      message: err.message
    });
  }
});

// POST /api/ai/screen (Alias for seamless screening integration)
router.post('/screen', async (req, res) => {
  const { name, entity = 'organisation', jurisdiction } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Field "name" is required' });
  }

  try {
    const report = await runKycpCheck({
      query: name,
      type: entity,
      jurisdiction
    });
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ai/instructions
router.get('/instructions', (req, res) => {
  res.json({
    instructions: KYCP_INSTRUCTIONS
  });
});

// GET /api/ai/tools
router.get('/tools', (req, res) => {
  res.json({
    tools: [
      {
        name: 'searchKnowledgeBase',
        description: 'Searches converted records from datasets, documents, APIs, and public websites.',
        parameters: { term: 'string', kind: 'org | vessel | person | null' }
      },
      {
        name: 'searchEntities',
        description: 'Searches registered counterparties across the global graph.',
        parameters: { term: 'string' }
      },
      {
        name: 'getOwnershipGraph',
        description: 'Walks multi-hop corporate ownership to determine UBO and SOE percentages.',
        parameters: { entityId: 'string' }
      },
      {
        name: 'getCountryRisk',
        description: 'Retrieves Transparency International CPI 2025 score and corruption tier.',
        parameters: { jurisdiction: 'string (ISO3)' }
      },
      {
        name: 'getVesselSignals',
        description: 'Inspects AIS satellite telemetry for dark periods and ship-to-ship transfers.',
        parameters: { nameOrImo: 'string' }
      }
    ]
  });
});

module.exports = router;
