/**
 * Country risk views on the Globe (src/countryRisk).
 * Any signed-in account may see the views and switch between them. Only a compliance officer may change the
 * refresh setting, switch a view's refresh on or off, upload a file or start a refresh.
 *
 *   GET  /api/country-risk/views              the views, their status, the refresh setting, AI calls this month
 *   GET  /api/country-risk/views/:id          one view's validated data, for the map
 *   PUT  /api/country-risk/settings           { refresh: manual | daily | weekly | monthly }
 *   PUT  /api/country-risk/views/:id          { enabled: true | false }
 *   POST /api/country-risk/refresh            { viewId? }   "Refresh now": one view, or all that are switched on
 *   POST /api/country-risk/views/:id/upload   { filename, content }   the saved page of a source that refuses robots
 */
const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { requireRole } = require('../middleware/auth');
const { aiRateLimit } = require('../middleware/rateLimit');
const countryRisk = require('../countryRisk/countryRiskService');

const officer = requireRole('compliance_officer');
const fail = (res, err) => {
  if (!err.status) console.error('[Country risk]', err);
  res.status(err.status || 500).json({ error: err.status ? 'Not done' : 'Request failed', message: err.status ? err.message : 'Please try again.' });
};
const isOfficer = req => Boolean(req.user && req.user.role === 'compliance_officer');

router.get('/views', (req, res) => {
  const db = getDb();
  // The scheduled tick is the normal trigger; this is the fallback when it has not come
  const checking = countryRisk.checkIfOverdue(db);
  res.json(Object.assign(countryRisk.overview(db), { canEdit: isOfficer(req), checking }));
});

router.get('/views/:id', (req, res) => {
  const found = countryRisk.viewData(getDb(), req.params.id);
  if (!found) return res.status(404).json({ error: 'Unknown view' });
  res.json(found);
});

router.put('/settings', officer, (req, res) => {
  try {
    const db = getDb();
    countryRisk.setRefresh(db, String((req.body && req.body.refresh) || ''));
    res.json(Object.assign({ success: true }, countryRisk.overview(db), { canEdit: true }));
  } catch (err) { fail(res, err); }
});

router.put('/views/:id', officer, (req, res) => {
  try {
    const db = getDb();
    countryRisk.setEnabled(db, req.params.id, Boolean(req.body && req.body.enabled));
    res.json(Object.assign({ success: true }, countryRisk.overview(db), { canEdit: true }));
  } catch (err) { fail(res, err); }
});

router.post('/refresh', officer, aiRateLimit, async (req, res) => {
  try {
    const db = getDb();
    const viewId = req.body && req.body.viewId;
    // A person asked: the "half-read source" guard is lifted, the other checks stay
    const results = viewId
      ? [await countryRisk.refreshView(db, String(viewId), { trigger: 'manual', force: true })]
      : await countryRisk.checkViews(db, { trigger: 'manual', onlyDue: false, force: true });
    res.json(Object.assign({ success: true, results }, countryRisk.overview(db), { canEdit: true }));
  } catch (err) { fail(res, err); }
});

router.post('/views/:id/upload', officer, aiRateLimit, async (req, res) => {
  try {
    const db = getDb();
    const result = await countryRisk.refreshView(db, req.params.id, { trigger: 'upload', force: true, upload: { filename: String((req.body && req.body.filename) || ''), content: String((req.body && req.body.content) || '') } });
    res.json(Object.assign({ success: result.result === 'updated' || result.result === 'unchanged', result }, countryRisk.overview(db), { canEdit: true }));
  } catch (err) { fail(res, err); }
});

module.exports = router;
