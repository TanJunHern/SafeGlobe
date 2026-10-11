/**
 * Ongoing monitoring: how often an approved counterparty is re-screened, against which
 * sources, between which dates, and what that costs.
 *
 * - Each KYC request with Ongoing Monitoring carries its own schedule (kyc_requests.monitoring_json).
 * - Compliance sets a default schedule and can apply it to every monitored request.
 * - Cost = (sum of cost_per_screen of the chosen sources) x number of runs.
 *
 * There is no background scheduler: runDue() is called from POST /api/monitoring/run
 * (the "Run due re-screens" button, scripts/monitoring_api_test.py, or an external cron).
 */

const { getDb } = require('../db');
const { screenCounterparty } = require('./screening');

const FREQUENCIES = { daily: 365, weekly: 52, monthly: 12, yearly: 1 };
const DEFAULTS_KEY = 'monitoring_defaults';
const DAY_MS = 24 * 60 * 60 * 1000;

const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const today = (now = new Date()) => new Date(now).toISOString().slice(0, 10);
const toDate = d => new Date(`${d}T00:00:00Z`);

// Moves a date forward by one period of the given frequency
function step(date, frequency) {
  const d = new Date(date);
  if (frequency === 'daily') d.setUTCDate(d.getUTCDate() + 1);
  else if (frequency === 'weekly') d.setUTCDate(d.getUTCDate() + 7);
  else if (frequency === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d;
}

/** Validates and cleans a schedule. Throws with a plain message when it does not make sense. */
function normalizeSchedule(input = {}, sources = null, now = new Date()) {
  const frequency = String(input.frequency || 'monthly').toLowerCase();
  if (!FREQUENCIES[frequency]) throw new Error('Frequency must be daily, weekly, monthly or yearly');
  const start_date = input.start_date || today(now);
  if (!isDate(start_date)) throw new Error('Start date must be a date in YYYY-MM-DD format');
  const end_date = input.end_date || null;
  if (end_date && !isDate(end_date)) throw new Error('End date must be a date in YYYY-MM-DD format');
  if (end_date && end_date < start_date) throw new Error('End date cannot be before the start date');

  const known = sources || getDb().getSources();
  const ids = Array.isArray(input.source_ids) ? [...new Set(input.source_ids.map(String))] : [];
  const unknown = ids.filter(id => !known.some(s => s.id === id));
  if (unknown.length) throw new Error(`Unknown source: ${unknown.join(', ')}`);
  return { frequency, start_date, end_date, source_ids: ids };
}

/** Number of runs from start to end inclusive; null when the schedule has no end date. */
function runsInWindow(schedule) {
  if (!schedule.end_date) return null;
  const end = toDate(schedule.end_date);
  let n = 0;
  for (let d = toDate(schedule.start_date); d <= end && n < 100000; d = step(d, schedule.frequency)) n++;
  return n;
}

/** Cost of a schedule from the per-screen cost of its sources. Amounts are in SGD. */
function costEstimate(schedule, sources = null) {
  const known = sources || getDb().getSources();
  const chosen = known.filter(s => (schedule.source_ids || []).includes(s.id));
  const per_run = Math.round(chosen.reduce((sum, s) => sum + (Number(s.cost_per_screen) || 0), 0) * 100) / 100;
  const runs_per_year = FREQUENCIES[schedule.frequency] || 0;
  const runs_total = runsInWindow(schedule);
  return {
    currency: 'SGD',
    per_run,
    runs_per_year,
    per_year: Math.round(per_run * runs_per_year * 100) / 100,
    runs_total,
    total: runs_total === null ? null : Math.round(per_run * runs_total * 100) / 100,
    sources: chosen.map(s => ({ id: s.id, label: s.label, type: s.type, cost_per_screen: Number(s.cost_per_screen) || 0 })),
    unpriced_sources: chosen.filter(s => !(Number(s.cost_per_screen) > 0)).map(s => s.label)
  };
}

/** Next date a run is due (YYYY-MM-DD), or null when the schedule has ended. */
function nextRunDate(schedule, now = new Date()) {
  let d = toDate(schedule.start_date);
  if (schedule.last_run_at) {
    // First slot after the last run
    const last = toDate(String(schedule.last_run_at).slice(0, 10));
    for (let n = 0; d <= last && n < 100000; n++) d = step(d, schedule.frequency);
  }
  const next = d.toISOString().slice(0, 10);
  if (schedule.end_date && next > schedule.end_date) return null;
  return next;
}

function getDefaults() {
  const saved = getDb().getSetting(DEFAULTS_KEY, null);
  return saved || { frequency: 'monthly', start_date: null, end_date: null, source_ids: [] };
}

function setDefaults(input, actor = {}) {
  const base = normalizeSchedule(Object.assign({}, input, { start_date: input.start_date || today() }));
  const value = Object.assign(base, { start_date: input.start_date || null, updated_by: actor.email || null, updated_at: new Date().toISOString() });
  return getDb().setSetting(DEFAULTS_KEY, value);
}

// A request's schedule, falling back to the compliance default when it has none of its own
function scheduleOf(request) {
  const d = getDefaults();
  const m = request.monitoring || {};
  return {
    frequency: m.frequency || d.frequency || 'monthly',
    start_date: m.start_date || d.start_date || String(request.created_at || request.submission_date || today()).slice(0, 10),
    end_date: m.end_date !== undefined ? m.end_date : (d.end_date || null),
    source_ids: Array.isArray(m.source_ids) ? m.source_ids : (d.source_ids || []),
    last_run_at: m.last_run_at || null,
    last_result: m.last_result || null,
    run_count: m.run_count || 0,
    updated_by: m.updated_by || null,
    updated_at: m.updated_at || null
  };
}

function describe(request, sources, now = new Date()) {
  const schedule = scheduleOf(request);
  const next = nextRunDate(schedule, now);
  // Re-screening only runs once compliance has approved the counterparty
  const active = request.request_status === 'Approved';
  return {
    id: request.id,
    counterparty_name: request.counterparty_name,
    entity_type: request.entity_type,
    country: request.country,
    request_status: request.request_status,
    screening_result: request.screening_result,
    created_by_email: request.created_by_email,
    active,
    schedule,
    next_run_date: next,
    due: Boolean(active && next && next <= today(now)),
    ended: next === null,
    cost: costEstimate(schedule, sources)
  };
}

/** Monitored requests. `email` limits the list to one employee's own requests. */
function listMonitoring({ email = null, now = new Date() } = {}) {
  const db = getDb();
  const sources = db.getSources();
  const filter = email ? { created_by_email: email } : {};
  const items = db.getAllKycRequests(filter).filter(r => r.ongoing_monitoring).map(r => describe(r, sources, now));
  const active = items.filter(i => i.active && !i.ended);
  return {
    items,
    totals: {
      monitored: items.length,
      active: active.length,
      due: items.filter(i => i.due).length,
      per_year: Math.round(active.reduce((sum, i) => sum + i.cost.per_year, 0) * 100) / 100,
      currency: 'SGD'
    },
    defaults: getDefaults(),
    sources: sources.map(s => ({ id: s.id, label: s.label, type: s.type, cost_per_screen: s.cost_per_screen }))
  };
}

/** Saves the schedule of one request. `enabled: false` turns ongoing monitoring off. */
function updateSchedule(id, input = {}, actor = {}) {
  const db = getDb();
  const request = db.getKycRequestById(id);
  if (!request) throw new Error('KYC request not found');
  const enabled = input.enabled !== undefined ? Boolean(input.enabled) : true;
  const previous = request.monitoring || {};
  const schedule = normalizeSchedule(Object.assign({}, scheduleOf(request), input));
  const saved = Object.assign({}, previous, schedule, { updated_by: actor.email || null, updated_at: new Date().toISOString() });
  const updated = db.setKycMonitoring(id, saved, enabled);
  require('./kycService').syncMonitoredEntity(updated);
  return describe(updated, db.getSources());
}

/** Applies the compliance default to every monitored request. Run history is kept. */
function applyDefaultsToAll(actor = {}) {
  const db = getDb();
  const d = getDefaults();
  const monitored = db.getAllKycRequests({}).filter(r => r.ongoing_monitoring);
  monitored.forEach(r => {
    const previous = r.monitoring || {};
    const schedule = normalizeSchedule({
      frequency: d.frequency,
      start_date: d.start_date || previous.start_date || String(r.created_at || today()).slice(0, 10),
      end_date: d.end_date || null,
      source_ids: d.source_ids || []
    });
    db.setKycMonitoring(r.id, Object.assign({}, previous, schedule, { updated_by: actor.email || null, updated_at: new Date().toISOString() }), true);
  });
  return { updated: monitored.length };
}

/**
 * Re-screens every approved, monitored request whose next run is due.
 * options: { force: run all active ones now, ids: only these requests, now }
 */
function runDue({ force = false, ids = null, now = new Date() } = {}) {
  const db = getDb();
  const sources = db.getSources();
  const results = [];
  db.getAllKycRequests({}).filter(r => r.ongoing_monitoring).forEach(r => {
    if (ids && !ids.includes(r.id)) return;
    const info = describe(r, sources, now);
    if (!info.active || info.ended) return;
    if (!force && !info.due) return;

    const hit = screenCounterparty({ name: r.counterparty_name, entity: String(r.entity_type || 'organisation').toLowerCase(), jurisdiction: r.country });
    const result = hit.screeningResult || 'Clear';
    const changed = result !== r.screening_result;
    const stamp = new Date(now).toISOString();
    const labels = info.cost.sources.map(s => s.label).join(', ') || 'built-in lists only';
    db.setKycRescreenResult(r.id, `Re-screened ${stamp.slice(0, 10)} (${info.schedule.frequency}; ${labels}): ${result}${changed ? `, changed from ${r.screening_result}` : ', no change'}`);
    const monitoring = Object.assign({}, r.monitoring || {}, info.schedule, { last_run_at: stamp, last_result: result, run_count: (info.schedule.run_count || 0) + 1 });
    db.setKycMonitoring(r.id, monitoring, true);
    if (changed) db.addAlert('Ripples', r.id, `${r.counterparty_name}: re-screening result changed from ${r.screening_result} to ${result}`, 'investigate');
    results.push({ id: r.id, counterparty_name: r.counterparty_name, result, changed, cost: info.cost.per_run, next_run_date: nextRunDate(monitoring, now) });
  });
  return { ran: results.length, cost: Math.round(results.reduce((s, x) => s + x.cost, 0) * 100) / 100, currency: 'SGD', results };
}

module.exports = {
  FREQUENCIES, normalizeSchedule, runsInWindow, costEstimate, nextRunDate,
  getDefaults, setDefaults, scheduleOf, listMonitoring, updateSchedule, applyDefaultsToAll, runDue
};
