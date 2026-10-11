/**
 * Ongoing monitoring API: schedules, cost and re-screen runs.
 * Employees see their own monitored requests and can price a schedule before submitting.
 * Only compliance officers change schedules, defaults, or trigger runs.
 */
const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const monitoring = require('../services/monitoringService');

router.use(authenticate);

const fail = (res, err) => res.status(400).json({ error: 'Monitoring request failed', message: err.message });
const scoped = req => (req.user.role === 'employee' && !req.user.anonymous ? req.user.email : null);

// GET /api/monitoring: monitored requests with schedule, next run and cost
router.get('/', (req, res) => {
  try { res.json(Object.assign({ success: true }, monitoring.listMonitoring({ email: scoped(req) }))); } catch (err) { fail(res, err); }
});

// POST /api/monitoring/estimate: price a schedule (used by the intake form before submitting)
router.post('/estimate', (req, res) => {
  try {
    const schedule = monitoring.normalizeSchedule(req.body || {});
    res.json({ success: true, schedule, cost: monitoring.costEstimate(schedule) });
  } catch (err) { fail(res, err); }
});

// PUT /api/monitoring/defaults: the schedule compliance wants for monitored counterparties
router.put('/defaults', requireRole('compliance_officer'), (req, res) => {
  try { res.json({ success: true, defaults: monitoring.setDefaults(req.body || {}, req.user) }); } catch (err) { fail(res, err); }
});

// POST /api/monitoring/apply-all: apply the defaults to every monitored request
router.post('/apply-all', requireRole('compliance_officer'), (req, res) => {
  try { res.json(Object.assign({ success: true }, monitoring.applyDefaultsToAll(req.user))); } catch (err) { fail(res, err); }
});

// POST /api/monitoring/run: re-screen what is due. Body: { force, ids }
router.post('/run', requireRole('compliance_officer'), (req, res) => {
  try {
    const { force = false, ids = null } = req.body || {};
    res.json(Object.assign({ success: true }, monitoring.runDue({ force: Boolean(force), ids: Array.isArray(ids) ? ids : null })));
  } catch (err) { fail(res, err); }
});

// PUT /api/monitoring/:id: change one request's schedule, or switch its monitoring off ({ enabled: false })
router.put('/:id', requireRole('compliance_officer'), (req, res) => {
  try { res.json({ success: true, item: monitoring.updateSchedule(req.params.id, req.body || {}, req.user) }); } catch (err) { fail(res, err); }
});

module.exports = router;
