/**
 * Risk scoring API: the rules in force, edits to them, recommended changes, and the "Why <score>?" breakdown.
 * Reading is open like the rest of the workspace; changing a rule needs the compliance officer role.
 */
const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const rulesStore = require('../risk/rulesStore');
const riskService = require('../risk/riskService');
const suggestions = require('../risk/suggestions');

const officer = [authenticate, requireRole('compliance_officer')];

const rulesPayload = db => ({
  rules: rulesStore.getRules(db),
  log: rulesStore.getChangeLog(db).slice(0, 20),
  suggestions: suggestions.openSuggestions(db)
});

function sendRulesError(res, err) {
  if (err instanceof rulesStore.RulesError) return res.status(400).json({ error: 'The change was not saved', problems: err.problems });
  throw err;
}

// GET /api/risk/rules
router.get('/rules', (req, res) => res.json(rulesPayload(getDb())));

// POST /api/risk/rules/preview   { patch }   what an edit would do to the scored cases; saves nothing
router.post('/rules/preview', (req, res) => {
  try {
    res.json(riskService.previewRules(getDb(), (req.body && req.body.patch) || {}));
  } catch (err) { sendRulesError(res, err); }
});

// PUT /api/risk/rules   { patch, reason }
router.put('/rules', ...officer, (req, res) => {
  const db = getDb();
  try {
    const { changes } = rulesStore.updateRules(db, (req.body && req.body.patch) || {}, { user: req.user.name || req.user.email, reason: req.body && req.body.reason });
    const rescored = changes.length ? riskService.rescoreAll(db) : [];
    res.json(Object.assign({ status: changes.length ? 'saved' : 'unchanged', changes, rescored }, rulesPayload(db)));
  } catch (err) { sendRulesError(res, err); }
});

// POST /api/risk/rules/reset
router.post('/rules/reset', ...officer, (req, res) => {
  const db = getDb();
  const { changes } = rulesStore.resetRules(db, { user: req.user.name || req.user.email });
  const rescored = riskService.rescoreAll(db);
  res.json(Object.assign({ status: 'reset', changes, rescored }, rulesPayload(db)));
});

// GET /api/risk/rules/suggestions
router.get('/rules/suggestions', (req, res) => {
  const db = getDb();
  const all = suggestions.list(db);
  res.json({ open: all.filter(s => s.status === 'open'), decided: all.filter(s => s.status !== 'open').slice(0, 20) });
});

// POST /api/risk/rules/suggestions/:id/accept   a person applies the recommended change
router.post('/rules/suggestions/:id/accept', ...officer, (req, res) => {
  const db = getDb();
  const s = suggestions.list(db).find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Suggestion not found' });
  if (s.status !== 'open') return res.status(409).json({ error: `This suggestion was already ${s.status}` });
  try {
    const user = req.user.name || req.user.email;
    const { changes } = s.patch ? rulesStore.updateRules(db, s.patch, { user, reason: `Accepted recommendation: ${s.title}` }) : { changes: [] };
    suggestions.setStatus(db, s.id, 'accepted', user);
    const rescored = changes.length ? riskService.rescoreAll(db) : [];
    res.json(Object.assign({ status: 'accepted', changes, rescored }, rulesPayload(db)));
  } catch (err) { sendRulesError(res, err); }
});

// POST /api/risk/rules/suggestions/:id/dismiss
router.post('/rules/suggestions/:id/dismiss', ...officer, (req, res) => {
  const db = getDb();
  const s = suggestions.setStatus(db, req.params.id, 'dismissed', req.user.name || req.user.email);
  if (!s) return res.status(404).json({ error: 'Suggestion not found' });
  res.json(Object.assign({ status: 'dismissed' }, rulesPayload(db)));
});

// GET /api/risk/scores   one line per scored case
router.get('/scores', (req, res) => {
  const db = getDb();
  res.json({ scores: riskService.scores(db), threshold: rulesStore.getRules(db).confidence.threshold });
});

// GET /api/risk/breakdown/:entityId   the "Why <score>?" panel
router.get('/breakdown/:entityId', (req, res) => {
  const breakdown = riskService.assessEntity(getDb(), req.params.entityId);
  if (!breakdown) return res.status(404).json({ error: 'This case has not been scored from findings yet' });
  res.json({ breakdown });
});

// GET /api/risk/findings/:entityId   every finding read for a case, accepted and rejected (audit)
router.get('/findings/:entityId', (req, res) => {
  res.json({ findings: getDb().getFindingRecords(req.params.entityId) });
});

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * GET /risk/source?name=...&finding=...
 * Where a finding's source link lands when the source is held inside DueDilly (built-in lists, feeds, intake forms).
 */
function sourcePage(req, res) {
  const db = getDb();
  const name = String(req.query.name || '').slice(0, 200);
  const record = req.query.finding ? db.getFindingRecordById(String(req.query.finding)) : null;
  const f = record && record.finding.source_name === name ? record.finding : null;
  const listed = db.getSources().find(s => s.label === name);
  const when = f ? new Date(f.read_at).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Singapore' }) + ' SGT' : '';
  res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Source: ${esc(name)}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:680px;margin:40px auto;padding:0 16px;color:#1b1f24}h1{font-size:20px;margin:0 0 4px}
dl{display:grid;grid-template-columns:150px 1fr;gap:8px 16px;margin:20px 0}dt{color:#5b6672}dd{margin:0}
blockquote{margin:0;padding:10px 14px;border-left:3px solid #c8a100;background:#fbf7e6}.demo{display:inline-block;padding:2px 8px;border-radius:10px;background:#fbf7e6;border:1px solid #e3d28a;font-size:12px}
a{color:#0b5cad}</style></head><body>
<p><a href="/">DueDilly</a> · Source</p>
<h1>${esc(name || 'Unknown source')}</h1>
${f && f.demo ? '<p><span class="demo">Demo data: fictional</span></p>' : ''}
<dl>
<dt>Held in</dt><dd>${listed ? `Sources tab (${esc(listed.type)}, ${esc(listed.how)})` : 'DueDilly built-in or case data'}</dd>
${listed ? `<dt>Trust</dt><dd>${esc(listed.trust)}</dd>` : f ? `<dt>Trust</dt><dd>${esc(f.source_trust)}</dd>` : ''}
${f ? `<dt>Finding</dt><dd>${esc(f.id)} · ${esc(f.summary)}</dd>
<dt>About</dt><dd>${esc(f.subject)}</dd>
<dt>Read</dt><dd>${esc(when)}</dd>
<dt>Read by</dt><dd>${esc(f.agent)}</dd>
<dt>Quote</dt><dd><blockquote>${esc(f.evidence_quote)}</blockquote></dd>` : ''}
</dl>
${f ? '' : '<p>No finding was given, so only the source is shown.</p>'}
</body></html>`);
}

module.exports = router;
module.exports.sourcePage = sourcePage;
