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

// POST /api/agent/orchestrator/screen-kyc - Screen KYC form against Orchestrator PDF sanctions
router.post('/orchestrator/screen-kyc', async (req, res) => {
  try {
    const { kycForm, entityId, pdfPath, useModel } = req.body || {};
    const db = require('../db').getDb();
    let finalKycForm = kycForm;
    if (!finalKycForm && entityId) {
      const allKyc = db.getAllKycRequests ? db.getAllKycRequests() : [];
      finalKycForm = allKyc.find(k => k.id.toLowerCase() === entityId.toLowerCase() || (entityId.startsWith('kyc-') && k.id.toLowerCase() === entityId.replace('kyc-', '').toLowerCase()));
      if (!finalKycForm) {
        finalKycForm = allKyc.find(k => k.counterparty_name && k.counterparty_name.toLowerCase().trim() === entityId.toLowerCase().trim());
      }
      if (!finalKycForm) {
        const ent = db.getEntityById(entityId);
        if (ent) {
          finalKycForm = {
            id: `KYC-${ent.id.toUpperCase()}`,
            counterparty_name: ent.name,
            entity_type: ent.kind === 'vessel' ? 'Vessel' : ent.kind === 'person' ? 'Person' : 'Organisation',
            country: ent.a3 || ent.flag || 'SGP',
            relationship_type: ent.role || 'Vendor/Supplier',
            contract_value: (ent.request && ent.request.contract_value) || 250000,
            attributes: {
              reg_no: ent.reg || '',
              imo: ent.imo || '',
              directors_ubo: (ent.factors && ent.factors.map(f => f[1]).join('; ')) || ent.controllers || '',
              vessel_flag: ent.flag || '',
              vessel_type: ent.type || ''
            },
            location: { address: `${ent.city || ''}, ${ent.a3 || ''}` },
            remarks: ent.summary || ''
          };
        }
      }
    }
    const result = await orchestrator.screenKycAgainstSanctions(finalKycForm || {}, { pdfPath, useModel: useModel !== false });
    res.json(result);
  } catch (err) {
    console.error('[Orchestrator] screen-kyc error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
