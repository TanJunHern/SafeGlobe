/**
 * What happens when an event arrives. Registered once at startup (src/server.js).
 *
 *   alert-raised         Ripples triage rates the alert; a High one asks for a re-screen
 *   source-changed       each counterparty a changed page newly names gets a ripple
 *   screening-requested  Pond-Guard screens the counterparty again (inside the daily cap), else its score is re-computed
 *   rescreen-due         the monitored requests that are due are re-screened
 *   ddq-submitted        the returned answers are compared with the findings (answer verification)
 *   screening-completed  published; nothing listens yet
 */
const bus = require('./bus');
const { getDb } = require('../db');
const SqliteDatabase = require('../db/sqlite');

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const digits = s => String(s || '').replace(/[^0-9a-z]/gi, '').toLowerCase();

/** The counterparty a source record names: the same name, or the same registration or IMO number. */
function matchEntity(entities, record) {
  const name = norm(record.name);
  const id = digits(record.identifier);
  return entities.find(e => norm(e.name) === name || (e.short && norm(e.short) === name))
    || (id.length >= 5 ? entities.find(e => [e.reg, e.imo].map(digits).some(v => v.length >= 5 && (v === id || v.endsWith(id) || id.endsWith(v)))) : null)
    || null;
}

async function onSourceChanged(payload) {
  const db = getDb();
  const entities = db.getAllEntities();
  const raised = [];
  for (const record of payload.added || []) {
    const entity = matchEntity(entities, record);
    if (!entity || raised.includes(entity.id)) continue;
    raised.push(entity.id);
    // The ripple quotes the page's own words, not a paraphrase
    db.addAlert('Ripples', entity.id, `${payload.label} now names ${entity.name}: ${String(record.quote || record.summary || 'new notice').replace(/\s+/g, ' ').trim().slice(0, 220)}`, 'investigate');
  }
  return raised;
}

async function onScreeningRequested(payload) {
  const db = getDb();
  const pondGuard = require('../services/pondGuardService');
  const riskService = require('../risk/riskService');
  if (!db.getEntityById(payload.entityId)) return;
  let scored = null;
  await pondGuard.screenEntity(db, payload.entityId, event => { if (event.type === 'scored') scored = event; });
  if (scored && scored.offline) {
    // No live agents: the stored findings are added up again under the rules in force
    riskService.rescoreEntity(db, payload.entityId);
    const b = riskService.assessEntity(db, payload.entityId);
    if (b) bus.publish('screening-completed', { entityId: payload.entityId, risk: b.risk, confidence: b.confidence, route: b.route, offline: true, trigger: 'alert' });
  }
  if (payload.alertId) {
    const b = scored && scored.breakdown;
    db.setAlertRescreen(payload.alertId, b ? `done: ${b.risk} of ${b.cap}, ${b.routeLabel}${scored.offline ? ' (offline sample)' : ''}` : 'done');
  }
}

async function onRescreenDue() {
  const result = await require('../services/monitoringService').runDue();
  // The same daily tick checks which country risk views are due (the app never creates or edits a scheduler job)
  try { await require('../countryRisk/countryRiskService').checkViews(getDb(), { trigger: 'schedule' }); } catch (err) { console.error('[Country risk] scheduled check:', err.message); }
  return result;
}

let registered = false;
function register() {
  if (registered) return;
  registered = true;
  // Every alert, wherever it is added, raises "alert-raised"
  SqliteDatabase.onAlertAdded = alert => bus.publish('alert-raised', alert);
  bus.on('alert-raised', payload => require('../services/triageService').triageAlert(getDb(), payload.alertId));
  bus.on('source-changed', onSourceChanged);
  bus.on('screening-requested', onScreeningRequested);
  bus.on('rescreen-due', onRescreenDue);
  // A returned questionnaire is compared with the findings of its case (answer verification)
  bus.on('ddq-submitted', async payload => {
    if (!payload.kycId) return;
    try { await require('../services/answerVerificationService').verify(getDb(), payload.kycId); } catch (err) { if (err.status !== 404) throw err; }
  });
}

module.exports = { register, matchEntity, onSourceChanged, onScreeningRequested };
