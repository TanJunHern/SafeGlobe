/**
 * The scoring rules in force: the defaults in points.config.js with the user's edits merged over them.
 * Edits live in app_settings (key risk_rules) so they survive a restart and are wiped with the workspace.
 * Every change is validated here and written to a change log (key risk_rules_log).
 */
const cfg = require('./points.config');
const config = require('../config');

const SETTING = 'risk_rules';
const LOG_SETTING = 'risk_rules_log';
const LOG_LIMIT = 200;

class RulesError extends Error {
  constructor(problems) {
    super(problems.join(' '));
    this.problems = problems;
  }
}

const isInt = n => Number.isInteger(n);
const emptyOverrides = () => ({ points: {}, policy: {}, thresholds: {}, confidence: {}, customRows: [] });

function readOverrides(db) {
  const saved = db ? db.getSetting(SETTING, null) : null;
  return Object.assign(emptyOverrides(), saved && typeof saved === 'object' ? saved : {});
}

const fillLabel = (label, t) => label
  .replace(/\{cpiMidMax\}/g, String(t.cpiMid - 1))
  .replace(/\{contractValueSgd\}/g, Number(t.contractValueSgd).toLocaleString('en-SG'))
  .replace(/\{(\w+)\}/g, (m, k) => (k in t ? String(t[k]) : m));

/** Builds the rules object every reader uses. `overrides` is only passed by tests and previews. */
function buildRules(overrides = emptyOverrides()) {
  const o = Object.assign(emptyOverrides(), overrides);
  const thresholds = {};
  const thresholdMeta = {};
  for (const [key, meta] of Object.entries(cfg.THRESHOLDS)) {
    const value = key in o.thresholds ? o.thresholds[key] : meta.value;
    thresholds[key] = value;
    thresholdMeta[key] = Object.assign({}, meta, { value, defaultValue: meta.value, changed: value !== meta.value });
  }

  const defaultThreshold = Number.isFinite(config.confidenceThreshold) ? config.confidenceThreshold : cfg.CONFIDENCE.threshold;
  const oc = o.confidence || {};
  const confidence = {
    sourceTrust: Object.assign({}, cfg.CONFIDENCE.sourceTrust, oc.sourceTrust || {}),
    matchStrength: Object.assign({}, cfg.CONFIDENCE.matchStrength, oc.matchStrength || {}),
    freshness: Object.assign({}, cfg.CONFIDENCE.freshness, oc.freshness || {}),
    corroborationBonus: 'corroborationBonus' in oc ? oc.corroborationBonus : cfg.CONFIDENCE.corroborationBonus,
    threshold: 'threshold' in oc ? oc.threshold : defaultThreshold,
    thresholdMin: cfg.CONFIDENCE.thresholdMin,
    thresholdMax: cfg.CONFIDENCE.thresholdMax
  };
  const confidenceDefaults = Object.assign({}, cfg.CONFIDENCE, { threshold: defaultThreshold });

  const baseRows = cfg.ROWS.map(r => {
    const points = !r.locked && r.id in o.points ? o.points[r.id] : r.points;
    const policy = r.id in o.policy ? o.policy[r.id] : r.policy;
    return Object.assign({}, r, {
      label: fillLabel(r.label, thresholds), points, policy,
      defaultPoints: r.points, defaultPolicy: r.policy,
      changed: points !== r.points || policy !== r.policy, custom: false
    });
  });
  const customRows = (o.customRows || []).map(r => ({
    id: r.id, label: r.label, short: r.label, points: r.points, policy: r.policy || '', check: null,
    defaultPoints: null, defaultPolicy: null, changed: true, custom: true
  }));
  const rows = [...baseRows, ...customRows];

  const changes = rows.filter(r => r.changed).length
    + Object.values(thresholdMeta).filter(t => t.changed).length
    + (JSON.stringify(confidence) === JSON.stringify(Object.assign({}, confidenceDefaults, {
      sourceTrust: cfg.CONFIDENCE.sourceTrust, matchStrength: cfg.CONFIDENCE.matchStrength, freshness: cfg.CONFIDENCE.freshness
    })) ? 0 : 1);

  return {
    version: cfg.RULES_VERSION,
    rows,
    rowById: Object.fromEntries(rows.map(r => [r.id, r])),
    levels: cfg.LEVELS,
    thresholds,
    thresholdMeta,
    confidence,
    confidenceDefaults,
    routes: cfg.ROUTES,
    requiredChecks: cfg.REQUIRED_CHECKS,
    checkLabels: cfg.CHECK_LABELS,
    poses: cfg.POSES,
    guardrails: cfg.GUARDRAILS,
    pipeline: cfg.PIPELINE,
    matchBases: cfg.MATCH_BASES,
    sourceTrusts: cfg.SOURCE_TRUSTS,
    changes
  };
}

function getRules(db) {
  return buildRules(readOverrides(db));
}

/**
 * Checks a patch and returns the overrides that would be saved. Throws RulesError listing every problem.
 * patch = { points: {rowId: n}, policy: {rowId: text}, thresholds: {key: n}, confidence: {...}, addRows: [...], removeRows: [ids] }
 */
function applyPatch(current, patch = {}) {
  const problems = [];
  const next = JSON.parse(JSON.stringify(Object.assign(emptyOverrides(), current)));
  const base = Object.fromEntries(cfg.ROWS.map(r => [r.id, r]));
  const customIds = () => new Set(next.customRows.map(r => r.id));

  for (const id of patch.removeRows || []) {
    if (base[id]) problems.push(`"${base[id].short}" is a built-in row. Set its points to 0 instead of removing it.`);
    else if (!customIds().has(id)) problems.push(`There is no custom row "${id}".`);
    else next.customRows = next.customRows.filter(r => r.id !== id);
  }

  for (const row of patch.addRows || []) {
    const label = String((row && row.label) || '').trim();
    const points = Number(row && row.points);
    if (label.length < 3 || label.length > 160) { problems.push('A new row needs a description of 3 to 160 characters.'); continue; }
    if (!isInt(points) || points < 0 || points > 100) { problems.push(`Points for "${label}" must be a whole number from 0 to 100.`); continue; }
    const slug = 'custom_' + label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
    if (base[slug] || customIds().has(slug)) { problems.push(`A row called "${label}" already exists.`); continue; }
    next.customRows.push({ id: slug, label, points, policy: String(row.policy || '').trim().slice(0, 60) });
  }

  for (const [id, raw] of Object.entries(patch.points || {})) {
    const points = Number(raw);
    const custom = next.customRows.find(r => r.id === id);
    if (!base[id] && !custom) { problems.push(`There is no row "${id}".`); continue; }
    if (base[id] && base[id].locked) { problems.push(base[id].lockedReason); continue; }
    if (!isInt(points) || points < 0 || points > 100) { problems.push(`Points for "${(base[id] || custom).short || custom.label}" must be a whole number from 0 to 100.`); continue; }
    if (custom) custom.points = points;
    else if (points === base[id].points) delete next.points[id];
    else next.points[id] = points;
  }

  for (const [id, raw] of Object.entries(patch.policy || {})) {
    const text = String(raw == null ? '' : raw).trim().slice(0, 60);
    const custom = next.customRows.find(r => r.id === id);
    if (!base[id] && !custom) { problems.push(`There is no row "${id}".`); continue; }
    if (custom) custom.policy = text;
    else if (text === base[id].policy) delete next.policy[id];
    else next.policy[id] = text;
  }

  for (const [key, raw] of Object.entries(patch.thresholds || {})) {
    const meta = cfg.THRESHOLDS[key];
    const value = Number(raw);
    if (!meta) { problems.push(`There is no threshold "${key}".`); continue; }
    if (!isInt(value) || value < meta.min || value > meta.max) { problems.push(`${meta.label}: enter a whole number from ${meta.min} to ${meta.max}.`); continue; }
    if (value === meta.value) delete next.thresholds[key];
    else next.thresholds[key] = value;
  }
  const t = Object.assign(Object.fromEntries(Object.entries(cfg.THRESHOLDS).map(([k, m]) => [k, m.value])), next.thresholds);
  if (t.cpiLow >= t.cpiMid) problems.push('The high-risk CPI score must be lower than the medium-risk CPI score.');

  const pc = patch.confidence || {};
  for (const table of ['sourceTrust', 'matchStrength', 'freshness']) {
    for (const [key, raw] of Object.entries(pc[table] || {})) {
      const value = Number(raw);
      if (!(key in cfg.CONFIDENCE[table])) { problems.push(`There is no confidence weight "${table}.${key}".`); continue; }
      if (!Number.isFinite(value) || value < 0 || value > 1) { problems.push(`Confidence weight ${table}.${key} must be between 0 and 1.`); continue; }
      next.confidence[table] = next.confidence[table] || {};
      if (value === cfg.CONFIDENCE[table][key]) delete next.confidence[table][key];
      else next.confidence[table][key] = Math.round(value * 100) / 100;
      if (!Object.keys(next.confidence[table]).length) delete next.confidence[table];
    }
  }
  if ('corroborationBonus' in pc) {
    const value = Number(pc.corroborationBonus);
    if (!Number.isFinite(value) || value < 0 || value > 1) problems.push('The second-source bonus must be between 0 and 1.');
    else if (value === cfg.CONFIDENCE.corroborationBonus) delete next.confidence.corroborationBonus;
    else next.confidence.corroborationBonus = Math.round(value * 100) / 100;
  }
  if ('threshold' in pc) {
    const value = Number(pc.threshold);
    if (!isInt(value) || value < cfg.CONFIDENCE.thresholdMin || value > cfg.CONFIDENCE.thresholdMax) {
      problems.push(`The confidence needed to auto-clear or escalate must be a whole number from ${cfg.CONFIDENCE.thresholdMin} to ${cfg.CONFIDENCE.thresholdMax}.`);
    } else next.confidence.threshold = value;
  }

  for (const key of Object.keys(patch)) {
    if (!['points', 'policy', 'thresholds', 'confidence', 'addRows', 'removeRows'].includes(key)) problems.push(`"${key}" cannot be changed.`);
  }
  if (problems.length) throw new RulesError(problems);
  return next;
}

/** What differs between two rule sets, as plain lines for the change log and the UI. */
function describeChanges(before, after) {
  const out = [];
  const beforeRows = before.rowById;
  for (const r of after.rows) {
    const b = beforeRows[r.id];
    if (!b) { out.push(`Added row "${r.label}" (+${r.points})`); continue; }
    if (b.points !== r.points) out.push(`${r.short}: ${b.points} to ${r.points} points`);
    if (b.policy !== r.policy) out.push(`${r.short}: policy "${b.policy || 'none'}" to "${r.policy || 'none'}"`);
  }
  for (const b of before.rows) if (!after.rowById[b.id]) out.push(`Removed row "${b.label}"`);
  for (const key of Object.keys(after.thresholds)) {
    if (before.thresholds[key] !== after.thresholds[key]) out.push(`${after.thresholdMeta[key].label}: ${before.thresholds[key]} to ${after.thresholds[key]}`);
  }
  for (const table of ['sourceTrust', 'matchStrength', 'freshness']) {
    for (const key of Object.keys(after.confidence[table])) {
      if (before.confidence[table][key] !== after.confidence[table][key]) out.push(`Confidence weight ${table}.${key}: ${before.confidence[table][key]} to ${after.confidence[table][key]}`);
    }
  }
  if (before.confidence.corroborationBonus !== after.confidence.corroborationBonus) out.push(`Second-source bonus: ${before.confidence.corroborationBonus} to ${after.confidence.corroborationBonus}`);
  if (before.confidence.threshold !== after.confidence.threshold) out.push(`Confidence needed to auto-clear or escalate: ${before.confidence.threshold}% to ${after.confidence.threshold}%`);
  return out;
}

function logChange(db, entry) {
  const log = db.getSetting(LOG_SETTING, []) || [];
  log.unshift(Object.assign({ at: new Date().toISOString() }, entry));
  db.setSetting(LOG_SETTING, log.slice(0, LOG_LIMIT));
}

/** Saves an edit. Returns { rules, changes }. Nothing is saved when the patch has a problem or changes nothing. */
function updateRules(db, patch, { user = 'Compliance officer', reason = '' } = {}) {
  const current = readOverrides(db);
  const before = buildRules(current);
  const nextOverrides = applyPatch(current, patch);
  const after = buildRules(nextOverrides);
  const changes = describeChanges(before, after);
  if (changes.length) {
    db.setSetting(SETTING, nextOverrides);
    logChange(db, { user, reason: String(reason || '').slice(0, 300), changes });
  }
  return { rules: after, changes };
}

function resetRules(db, { user = 'Compliance officer' } = {}) {
  const before = getRules(db);
  db.setSetting(SETTING, emptyOverrides());
  const after = getRules(db);
  const changes = describeChanges(before, after);
  if (changes.length) logChange(db, { user, reason: 'Reset to defaults', changes });
  return { rules: after, changes };
}

const getChangeLog = db => db.getSetting(LOG_SETTING, []) || [];

module.exports = { getRules, buildRules, applyPatch, updateRules, resetRules, describeChanges, getChangeLog, readOverrides, RulesError };
