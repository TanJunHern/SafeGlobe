/**
 * AGENT & ORCHESTRATOR API ROUTES
 *
 * Exposes metadata, capabilities, and execution endpoints for SafeGlobe AI agents:
 *   - /api/agent/orchestrator: Central multi-agent coordinator description & report analysis
 *   - /api/agent/sanctions: Sanctions Agent description & PDF document report inference
 *   - /api/agent/compliance: Compliance Agent description & stages
 */
const express = require('express');
const router = express.Router();
const complianceAgent = require('../agents/complianceAgent');
const sanctionsAgent = require('../agents/sanctionsAgent');
const orchestrator = require('../agents/orchestrator');

// GET /api/agent/compliance - Compliance Agent description
router.get('/compliance', (req, res) => {
  res.json(complianceAgent.describe());
});

// GET /api/agent/sanctions - Sanctions Agent description
router.get('/sanctions', (req, res) => {
  res.json(sanctionsAgent.describe());
});

// GET /api/agent/orchestrator - Orchestrator description
router.get('/orchestrator', (req, res) => {
  res.json(orchestrator.describe());
});

// POST /api/agent/sanctions/analyze - Ingest & infer sanctioned countries from PDF
router.post('/sanctions/analyze', async (req, res) => {
  try {
    const input = req.body || {};
    const useModel = input.useModel !== false;
    const result = await sanctionsAgent.analyzePdf(input, { useModel });
    res.json(result);
  } catch (err) {
    console.error('[Sanctions Agent] analysis error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/agent/orchestrator/analyze - Orchestrated report analysis
router.post('/orchestrator/analyze', async (req, res) => {
  try {
    const input = req.body || {};
    const useModel = input.useModel !== false;
    const result = await orchestrator.analyzeReport(input, { useModel });
    res.json(result);
  } catch (err) {
    console.error('[Orchestrator] analysis error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
