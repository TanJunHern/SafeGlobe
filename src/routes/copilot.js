/**
 * Reviewer copilot (feature 5). Compliance officers only; mounted behind officerOnly.
 *
 *   GET  /api/copilot/:entityId            the latest draft for a case, with its final text if it was confirmed
 *   POST /api/copilot/:entityId/draft      writes a new "AI draft" (summary and decision reason)
 *   POST /api/copilot/drafts/:id/confirm   { summary, decision_reason }   the reviewer's own final text
 */
const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { aiRateLimit } = require('../middleware/rateLimit');
const copilot = require('../services/copilotService');

const fail = (res, err) => {
  if (!err.status) console.error('[Copilot]', err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'The draft could not be written', message: err.status ? err.message : 'Please try again.' });
};

router.post('/drafts/:id/confirm', (req, res) => {
  try { res.json(copilot.confirm(getDb(), req.params.id, req.body || {}, req.user || {})); } catch (err) { fail(res, err); }
});

router.post('/:entityId/draft', aiRateLimit, async (req, res) => {
  try { res.status(201).json(await copilot.draft(getDb(), req.params.entityId, req.user || {})); } catch (err) { fail(res, err); }
});

router.get('/:entityId', (req, res) => {
  const d = getDb().getLatestCopilotDraft(req.params.entityId);
  if (!d) return res.status(404).json({ error: 'No draft yet for this case' });
  res.json(d);
});

module.exports = router;
