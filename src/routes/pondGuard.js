/**
 * Pond-Guard screening (feature 1) and the read-only tool API the Ask Dilly agent calls (feature 8).
 */
const express = require('express');
const router = express.Router();
const config = require('../config');
const { getDb } = require('../db');
const { authenticate, officerOnly } = require('../middleware/auth');
const { aiRateLimit } = require('../middleware/rateLimit');
const pondGuard = require('../services/pondGuardService');
const agentsClient = require('../services/agentsClient');
const riskService = require('../risk/riskService');

// GET /api/pond-guard/status   live or offline, and why
router.get('/status', officerOnly, (req, res) => res.json(pondGuard.status(getDb())));

// POST /api/pond-guard/:entityId/screen   streams one JSON object per line: started, agent_started, agent_done, scored
router.post('/:entityId/screen', aiRateLimit, officerOnly, async (req, res) => {
  const db = getDb();
  if (!db.getEntityById(req.params.entityId)) return res.status(404).json({ error: 'Counterparty not found' });
  res.set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
  const emit = event => { if (!res.writableEnded) res.write(JSON.stringify(event) + '\n'); };
  try {
    await pondGuard.screenEntity(db, req.params.entityId, emit);
  } catch (err) {
    console.error('[Pond-Guard] screening failed:', err);
    emit({ type: 'error', message: 'Screening could not finish. Nothing was changed.' });
  }
  res.end();
});

// POST /api/pond-guard/ask   { question }   Ask Dilly through the ADK agent; { mode: 'offline' } when it is not connected
router.post('/ask', aiRateLimit, authenticate, async (req, res) => {
  const question = String((req.body && (req.body.question || req.body.query)) || '').trim().slice(0, 2000);
  if (!question) return res.status(400).json({ error: 'Field "question" is required' });
  if (!agentsClient.configured()) return res.json({ mode: 'offline', reason: 'The agents service is not connected.' });
  // The agent's lookup tools (/internal/ask-tools) read the Demo workspace only, so other workspaces use the built-in answers
  if (!req.user.workspace.isDemo) return res.json({ mode: 'offline', reason: 'The live Ask Dilly agent is connected to the Demo workspace only for now.' });
  try {
    const out = await agentsClient.ask({ question, user_role: req.user.role });
    const db = getDb();
    const links = (out.entity_ids || []).map(id => db.getEntityById(id)).filter(Boolean).map(e => ({ id: e.id, name: e.name, kind: e.kind }));
    res.json({ mode: 'live', answer: out.answer, links, toolsUsed: out.tools_used || [], modelId: out.model_id || '' });
  } catch (err) {
    console.error('[Ask Dilly] agent failed:', err.message);
    res.json({ mode: 'offline', reason: 'The agents service could not be reached.' });
  }
});

// ---------------------------------------------------------------------------------------------
// /internal/ask-tools: what the Ask Dilly agent can look up. Read-only, and only for the agents service.
// ---------------------------------------------------------------------------------------------
const tools = express.Router();
tools.use((req, res, next) => {
  const token = req.headers['x-internal-token'];
  if (!config.agentsInternalToken || token !== config.agentsInternalToken) return res.status(401).json({ error: 'Only the agents service may call this' });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Read-only' });
  next();
});

const brief = e => ({ id: e.id, name: e.name, kind: e.kind, role: e.role, country: e.a3 || e.flag || '', registration: e.reg || '', risk: e.risk, confidence: e.conf });

tools.get('/counterparties', (req, res) => {
  const q = String(req.query.q || '').toLowerCase().trim();
  const all = getDb().getAllEntities();
  const hits = q ? all.filter(e => [e.name, e.short, e.reg, e.role].some(v => String(v || '').toLowerCase().includes(q))) : all;
  res.json({ count: hits.length, counterparties: hits.slice(0, 25).map(brief) });
});

tools.get('/cases/:id', (req, res) => {
  const db = getDb();
  const e = db.getEntityById(req.params.id);
  if (!e) return res.status(404).json({ error: 'No counterparty with that id' });
  const c = db.getCases().find(x => x.id === e.id) || null;
  const b = riskService.assessEntity(db, e.id);
  res.json({
    counterparty: Object.assign(brief(e), { summary: e.summary || e.note || '', owner: e.owner, trigger: e.trigger }),
    case: c ? { caseId: c.caseId, status: c.status, reviewer: c.reviewer, decision: c.decisionText, decisionDate: c.decisionDate } : null,
    route: b ? b.routeLabel : null, level: b ? b.level.label : null
  });
});

tools.get('/alerts', (req, res) => {
  const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 10));
  res.json({ alerts: getDb().getAlerts(limit) });
});

tools.get('/breakdown/:id', (req, res) => {
  const b = riskService.assessEntity(getDb(), req.params.id);
  if (!b) return res.status(404).json({ error: 'That counterparty has not been scored from findings yet' });
  res.json({
    name: b.name, risk: b.risk, level: b.level.label, confidence: b.confidence, route: b.routeLabel, routeReason: b.routeReason,
    findings: b.lines.map(l => ({ finding: l.short, points: l.points, policy: l.policy, summary: l.summary, source: l.sourceName, read: l.readAt }))
  });
});

module.exports = router;
module.exports.internalTools = tools;
