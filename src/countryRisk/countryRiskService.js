/**
 * Country risk views on the Globe: reading each source, checking the result and keeping the last good version.
 *
 * One check of one view:
 *   1. The source is read with the crawler's rules (robots.txt, no sign-in, identifying user agent, polite gap).
 *      A site that refuses automated readers is not worked around: the view asks for an upload instead.
 *   2. The snapshot is hashed. Same hash as last time: nothing else happens, and no model is called.
 *   3. A data file is parsed in code. A web page (or an uploaded page) goes to the ADK country risk agent,
 *      which returns countries with a quote each.
 *   4. Every country is checked in code (src/countryRisk/validate.js). Only then is the view's JSON saved.
 *   5. Anything that fails keeps the last good version and marks the view stale with the reason.
 *
 * COUNTRY_RISK_FETCH=live switches reading on. Otherwise no website is contacted and the saved samples are shown.
 * These views are for display only: nothing here touches a risk score, a points row, a confidence or a route.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { currentWorkspaceId } = require('../db');
const registry = require('./views.config');
const { validateCountries, documentErrors } = require('./validate');
const crawler = require('../services/crawlerService');
const agentsClient = require('../services/agentsClient');
const objectStorage = require('../services/objectStorage');
const { stripHtml } = require('../services/sourceHandlers');
const { takeDailyBudget } = require('../middleware/rateLimit');

const SETTING = 'country_risk_refresh';
const MAX_AGENT_TEXT = 60000;
const SHARE_MS = 10 * 60 * 1000;
// The daily scheduled tick is the normal trigger. If it has not come this long after a view fell due, opening the Globe starts the check.
const FALLBACK_GRACE_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const reasoned = message => Object.assign(new Error(message), { reasoned: true });
const NAMED = { quot: '"', apos: "'", lt: '<', gt: '>', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—' };
/** The text of a page as a person reads it: tags gone, character references turned into their characters. */
const pageText = html => stripHtml(String(html || ''))
  .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z]+);/g, (m, name) => NAMED[name] || m)
  .replace(/\s+/g, ' ').trim();

const live = (deps = {}) => config.countryRiskFetch === 'live' || Boolean(deps.fetchImpl);

// ---------------------------------------------------------------------------------------------
// Samples: one saved result of a real read per view, shown when a workspace has no data of its own
// ---------------------------------------------------------------------------------------------
const samples = new Map();
function loadSample(viewId) {
  if (!samples.has(viewId)) {
    const file = path.join(__dirname, 'samples', `${viewId}.sample.json`);
    let doc = null;
    try { if (fs.existsSync(file)) doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { console.error(`[Country risk] sample ${viewId} could not be read:`, err.message); }
    samples.set(viewId, doc);
  }
  return samples.get(viewId);
}

// ---------------------------------------------------------------------------------------------
// The refresh setting, per workspace
// ---------------------------------------------------------------------------------------------
const option = id => registry.REFRESH.options.find(o => o.id === id) || null;
function getRefresh(db) {
  const saved = db.getSetting(SETTING, null);
  return option(saved) ? saved : registry.REFRESH.default;
}
function setRefresh(db, value) {
  if (!option(value)) throw Object.assign(new Error(`Refresh must be one of: ${registry.REFRESH.options.map(o => o.id).join(', ')}`), { status: 400 });
  return db.setSetting(SETTING, value);
}

function nextCheckAt(db, row) {
  const days = option(getRefresh(db)).days;
  if (!days || (row && row.enabled === false)) return null;
  if (!row || !row.lastCheckedAt) return new Date().toISOString();
  // A check that failed is tried again the next day, not a whole period later
  const failed = row.problem && row.problemKind !== 'needs_upload';
  return new Date(new Date(row.lastCheckedAt).getTime() + (failed ? 1 : days) * DAY_MS).toISOString();
}
const isDue = (db, row, graceMs = 0) => { const next = nextCheckAt(db, row); return Boolean(next) && new Date(next).getTime() + graceMs <= Date.now(); };

// ---------------------------------------------------------------------------------------------
// Reading a source. One read is shared by the workspaces checked in the same run, so a site is read once.
// ---------------------------------------------------------------------------------------------
const shared = new Map();
const agentAnswers = new Map();
const siteOf = host => host.split('.').slice(-2).join('.');

async function readPage(db, view, deps) {
  const page = await crawler.fetchPage(db, view.sourceUrl, deps);
  if (page.status !== 'read') return page;
  return { status: 'read', body: page.html, text: pageText(page.html), ext: 'html', url: page.finalUrl, contentType: 'text/html; charset=utf-8' };
}

/** A data portal's dataset record names the files. The newest file of the wanted format is read, from the same site only. */
async function readCatalogueFile(db, view, deps) {
  const f = view.fetch;
  const record = await crawler.fetchPage(db, f.catalogueUrl, Object.assign({}, deps, { file: { types: /json/, maxBytes: 5 * 1024 * 1024, accept: 'application/json' } }));
  if (record.status !== 'read') return record;
  let distributions;
  try { distributions = JSON.parse(record.html).result.distributions; } catch (err) { distributions = null; }
  if (!Array.isArray(distributions)) return { status: 'failed', reason: 'The dataset record could not be read: its layout has changed.' };
  const first = value => (Array.isArray(value) ? value[0] : value) || '';
  const title = d => String((d.title && (d.title.en || Object.values(d.title)[0])) || '');
  const files = distributions
    .filter(d => String((d.format && (d.format.id || d.format.label)) || '').toUpperCase() === f.format)
    .map(d => ({ title: title(d), url: first(d.download_url) || first(d.access_url), licence: d.license || null }))
    .filter(d => /^https:\/\//.test(d.url))
    .sort((a, b) => b.title.localeCompare(a.title, 'en', { numeric: true }));
  if (!files.length) return { status: 'failed', reason: `The dataset record names no ${f.format} file.` };
  const chosen = files[0];
  if (siteOf(new URL(chosen.url).hostname) !== siteOf(new URL(f.catalogueUrl).hostname)) return { status: 'failed', reason: 'The data file is on another site than the dataset record, so it was not read.' };
  const file = await crawler.fetchPage(db, chosen.url, Object.assign({}, deps, { file: { types: /text\/(plain|csv)|application\/(csv|octet-stream)/, maxBytes: f.maxBytes, timeoutMs: f.timeoutMs, accept: 'text/csv,text/plain;q=0.9,*/*;q=0.5' } }));
  if (file.status !== 'read') return file;
  const licence = chosen.licence ? [chosen.licence.label || chosen.licence.description, chosen.licence.resource].filter(Boolean).join(': ') : '';
  return { status: 'read', body: file.html, text: file.html, ext: f.format.toLowerCase(), url: file.finalUrl, contentType: 'text/csv; charset=utf-8', fileTitle: chosen.title, licence: licence ? `${licence} (as stated on the dataset record for "${chosen.title}")` : '' };
}

function readSource(db, view, deps) {
  const known = shared.get(view.id);
  if (known && Date.now() - known.at < SHARE_MS && !deps.fetchImpl) return known.promise;
  const promise = (view.fetch.type === 'catalogue_file' ? readCatalogueFile : readPage)(db, view, deps)
    .catch(err => ({ status: 'failed', reason: `The source could not be read (${String(err.message).slice(0, 120)}).` }));
  if (!deps.fetchImpl) shared.set(view.id, { at: Date.now(), promise });
  return promise;
}

// ---------------------------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------------------------
/** The ADK country risk agent reads the page text. Returns { countries, modelId, calls }. Throws with the reason. */
async function askAgent(db, view, text, hash) {
  const key = `${view.id}:${hash}`;
  if (agentAnswers.has(key)) return Object.assign({}, agentAnswers.get(key), { calls: 0 });
  if (!agentsClient.configured()) throw reasoned('The country risk agent is not connected (AGENTS_SERVICE_URL), so the page could not be read.');
  if (!takeDailyBudget(db, 'country_risk', config.countryRiskDailyCap)) throw reasoned(`Today's limit of ${config.countryRiskDailyCap} AI readings for country risk is used up.`);
  let output;
  try {
    output = await agentsClient.countryRiskExtract({
      view_id: view.id, source_name: view.sourceName, url: view.sourceUrl, instructions: view.instructions || '',
      categories: view.categories.map(c => ({ id: c.id, label: c.label, description: c.description || '' })),
      text: text.slice(0, MAX_AGENT_TEXT)
    });
  } catch (err) {
    console.error(`[Country risk] ${view.id}: the agent did not answer:`, err.message);
    throw Object.assign(reasoned('The country risk agent could not be reached.'), { calls: 1 });
  }
  const answer = { countries: Array.isArray(output && output.countries) ? output.countries : [], modelId: String((output && output.model_id) || '') };
  if (agentAnswers.size > 50) agentAnswers.clear();
  agentAnswers.set(key, answer);
  return Object.assign({}, answer, { calls: 1 });
}

const signature = countries => (countries || []).map(c => `${c.iso3}:${c.category || ''}:${c.score === null || c.score === undefined ? '' : c.score}`).sort().join('|');

/**
 * Checks one view. upload: { filename, content } from a compliance officer instead of a fetch.
 * Returns { viewId, result, reason, llmCalls }. result: updated | unchanged | failed | needs_upload | offline.
 */
async function refreshView(db, viewId, { trigger = 'manual', force = false, deps = {}, upload = null } = {}) {
  const view = registry.byId(viewId);
  if (!view) throw Object.assign(new Error('Unknown view'), { status: 404 });
  const at = new Date().toISOString();
  const row = db.getCountryRiskView(view.id) || {};
  const finish = (result, reason, patch, llmCalls = 0) => {
    db.saveCountryRiskView(view.id, Object.assign({ lastCheckedAt: at }, patch));
    db.addCountryRiskLog({ viewId: view.id, at, result, reason, llmCalls, trigger });
    if (reason) console.log(`[Country risk] ${view.id}: ${result}: ${reason}`);
    return { viewId: view.id, label: view.label, result, reason, llmCalls };
  };
  // The last good data is never touched by a failure
  const fail = (reason, kind = 'failed', llmCalls = 0) => finish(kind === 'needs_upload' ? 'needs_upload' : 'failed', reason, { problem: reason, problemKind: kind }, llmCalls);

  let source;
  if (upload) {
    if (!view.upload) throw Object.assign(new Error('This view does not take an upload'), { status: 400 });
    const ext = String(upload.filename || '').toLowerCase().split('.').pop();
    if (!view.upload.extensions.includes(ext)) throw Object.assign(new Error(`Upload one of: ${view.upload.extensions.map(e => '.' + e).join(', ')}`), { status: 400 });
    const body = String(upload.content || '');
    if (!body.trim()) throw Object.assign(new Error('The file is empty'), { status: 400 });
    source = { status: 'read', body, text: ext === 'txt' ? body.replace(/\s+/g, ' ').trim() : pageText(body), ext, url: view.sourceUrl, contentType: ext === 'txt' ? 'text/plain; charset=utf-8' : 'text/html; charset=utf-8' };
  } else {
    if (!live(deps)) return { viewId: view.id, label: view.label, result: 'offline', reason: 'Reading the sources is switched off (COUNTRY_RISK_FETCH): the saved sample is shown.', llmCalls: 0 };
    source = await readSource(db, view, deps);
    if (source.status !== 'read') {
      const refused = ['needs_sign_in', 'blocked'].includes(source.status);
      return refused && view.upload
        ? fail(`${source.reason} DueDilly does not get around that: upload the page instead.`, 'needs_upload')
        : fail(source.reason || 'The source could not be read.');
    }
  }

  const method = upload ? 'upload' : view.method;
  const usesAgent = upload || view.method === 'llm';
  const hash = sha(usesAgent ? source.text : source.body);
  if (row.data && row.contentHash === hash && !force) return finish('unchanged', '', { lastOkAt: at, problem: '', problemKind: '' });

  const workspace = currentWorkspaceId() || 'demo';
  const saved = await objectStorage.saveObject(`snapshots/${workspace}/country-risk/${view.id}/${at.replace(/[:.]/g, '-')}.${source.ext}`, Buffer.from(source.body, 'utf8'), source.contentType);

  let candidates;
  let parserRejected = [];
  let modelId = '';
  let llmCalls = 0;
  try {
    if (usesAgent) {
      const answer = await askAgent(db, view, source.text, hash);
      candidates = answer.countries; modelId = answer.modelId; llmCalls = answer.calls;
    } else {
      const parsed = require(`./parsers/${view.parser}`).parse(source.body, view);
      candidates = parsed.countries; parserRejected = parsed.rejected || [];
    }
  } catch (err) {
    if (!err.reasoned) console.error(`[Country risk] ${view.id}:`, err);
    return fail(err.reasoned || usesAgent === false ? err.message : 'The result could not be read.', 'failed', err.calls || 0);
  }

  const checked = validateCountries(view, candidates, usesAgent ? source.text : source.body);
  const rejected = [...parserRejected, ...checked.rejected];
  if (checked.rejected.length) console.log(`[Country risk] ${view.id}: rejected ${checked.rejected.map(r => `${r.name} (${r.reason})`).join('; ').slice(0, 600)}`);
  if (!checked.countries.length) return fail(candidates.length ? `No country passed the checks (${checked.rejected[0].reason})` : 'No country was found in the source.', 'failed', llmCalls);
  const before = row.data && Array.isArray(row.data.countries) ? row.data.countries.length : 0;
  if (!force && before && checked.countries.length < before * (1 - registry.MAX_DROP)) {
    return fail(`Only ${checked.countries.length} countries were found, against ${before} in the last good version. That looks like a half-read source, so it was not used. "Refresh now" accepts it if it is right.`, 'failed', llmCalls);
  }

  const doc = {
    view_id: view.id,
    source_name: view.sourceName,
    source_url: view.sourceUrl,
    fetched_at: at,
    content_hash: hash,
    method,
    licence_note: source.licence || view.licenceNote || (upload
      ? 'Uploaded by a compliance officer, who is responsible for the terms of the source. DueDilly did not read the site.'
      : 'No terms of use were read for this source by DueDilly. robots.txt allowed the page.'),
    countries: checked.countries,
    // Added fields: where exactly the data came from, and what was left out and why
    read_url: source.url,
    snapshot_key: saved.key,
    rejected: rejected.slice(0, 60)
  };
  if (modelId) doc.model_id = modelId;
  if (source.fileTitle) doc.file_title = source.fileTitle;
  const errors = documentErrors(doc, view);
  if (errors.length) return fail(`The result does not have the right shape (${errors[0]})`, 'failed', llmCalls);

  const changed = !row.data || signature(row.data.countries) !== signature(doc.countries);
  db.saveCountryRiskView(view.id, { data: doc, contentHash: hash, lastOkAt: at, lastChangedAt: changed ? at : (row.lastChangedAt || at), problem: '', problemKind: '' });
  try { await objectStorage.saveObject(`country-risk/${workspace}/${view.id}.json`, Buffer.from(JSON.stringify(doc, null, 2), 'utf8'), 'application/json'); } catch (err) { console.error(`[Country risk] ${view.id}: the JSON file was not written:`, err.message); }
  return finish('updated', '', {}, llmCalls);
}

/** Checks every view of this workspace that is switched on and due. onlyDue false: all that are switched on. */
async function checkViews(db, { trigger = 'schedule', onlyDue = true, force = false, graceMs = 0, deps = {} } = {}) {
  const results = [];
  if (!live(deps)) return results;
  for (const view of registry.VIEWS) {
    const row = db.getCountryRiskView(view.id);
    if (row && row.enabled === false) continue;
    if (onlyDue && !isDue(db, row, graceMs)) continue;
    try {
      results.push(await refreshView(db, view.id, { trigger, force, deps }));
    } catch (err) {
      console.error(`[Country risk] ${view.id}:`, err.message);
      results.push({ viewId: view.id, label: view.label, result: 'failed', reason: 'The check stopped unexpectedly.', llmCalls: 0 });
    }
  }
  return results;
}

// The fallback for a scheduled tick that did not come: one background check per workspace at a time
const running = new Set();
function checkIfOverdue(db, deps = {}) {
  const workspace = currentWorkspaceId() || 'demo';
  if (!live(deps) || running.has(workspace)) return running.has(workspace);
  const overdue = registry.VIEWS.some(view => { const row = db.getCountryRiskView(view.id); return !(row && row.enabled === false) && isDue(db, row, row && row.lastCheckedAt ? FALLBACK_GRACE_MS : 0); });
  if (!overdue) return false;
  running.add(workspace);
  checkViews(db, { trigger: 'fallback', graceMs: 0, deps }).catch(err => console.error('[Country risk] fallback check:', err.message)).finally(() => running.delete(workspace));
  return true;
}

// ---------------------------------------------------------------------------------------------
// What the Globe shows
// ---------------------------------------------------------------------------------------------
function describeView(db, view) {
  const row = db.getCountryRiskView(view.id) || { enabled: true };
  const sample = row.data ? null : loadSample(view.id);
  const data = row.data || sample;
  const needsUpload = row.problemKind === 'needs_upload';
  const stale = Boolean(row.data && row.problem && !(needsUpload && row.data.method === 'upload'));
  const status = stale ? 'stale' : row.data ? 'ok' : needsUpload ? 'needs_upload' : sample ? 'sample' : 'no_data';
  const method = data ? data.method : view.method;
  return {
    id: view.id, label: view.label, sourceName: view.sourceName, sourceUrl: view.sourceUrl, kind: view.kind,
    summary: view.summary, caveat: view.caveat || '', notListed: view.notListed || 'No data',
    categories: (view.categories || []).map(c => ({ id: c.id, label: c.label, level: c.level, description: c.description || '' })),
    scale: view.scale || null,
    status, enabled: row.enabled !== false,
    method, methodLabel: registry.METHOD_LABELS[method],
    modelId: (data && data.model_id) || '',
    fetchedAt: data ? data.fetched_at : null,
    lastCheckedAt: row.lastCheckedAt || null,
    nextCheckAt: live() ? nextCheckAt(db, row) : null,
    lastChangedAt: row.lastChangedAt || (data ? data.fetched_at : null),
    staleSince: stale ? (row.lastOkAt || row.data.fetched_at) : null,
    problem: row.problem || '',
    needsUpload, canUpload: Boolean(view.upload), uploadHint: view.upload ? view.upload.hint : '', uploadExtensions: view.upload ? view.upload.extensions : [],
    sample: Boolean(sample), sampleNote: sample ? `Sample data, may be out of date (${String(sample.fetched_at).slice(0, 10)})` : '',
    countryCount: data ? data.countries.length : 0,
    licenceNote: data ? data.licence_note : ''
  };
}

/** The agent's line for "How Dilly works": what it is and whether it is connected. */
function agentStatus() {
  const connected = agentsClient.configured() && live();
  return {
    name: 'Country risk agent', technology: 'Google ADK',
    does: 'Reads the FATF and OFAC pages and returns each country with a quote; code checks every quote and maps every name to its ISO code. The EU list is a data file parsed in code, with no model.',
    status: connected ? 'Connected' : 'Offline fallback',
    fallback: connected ? '' : (live() ? 'The agents service is not connected: the last good data is kept.' : 'Reading the sources is switched off: saved samples are shown.')
  };
}

function overview(db) {
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  return {
    views: registry.VIEWS.map(view => describeView(db, view)),
    refresh: { value: getRefresh(db), default: registry.REFRESH.default, options: registry.REFRESH.options.map(o => ({ id: o.id, label: o.label })) },
    llmCallsThisMonth: db.countCountryRiskLlmCalls(monthStart),
    live: live(),
    offlineNote: live() ? '' : 'Offline sample: the sources are not being read (COUNTRY_RISK_FETCH).',
    agent: agentStatus(),
    recent: db.getCountryRiskLog({ limit: 12 })
  };
}

/** The data of one view for the map: the workspace's last good version, or the sample. */
function viewData(db, viewId) {
  const view = registry.byId(viewId);
  if (!view) return null;
  const row = db.getCountryRiskView(view.id);
  const sample = row && row.data ? null : loadSample(view.id);
  const data = (row && row.data) || sample;
  return Object.assign({ view: describeView(db, view) }, data ? { data: Object.assign({}, data, sample ? { sample: true } : {}) } : { data: null });
}

function setEnabled(db, viewId, enabled) {
  if (!registry.byId(viewId)) throw Object.assign(new Error('Unknown view'), { status: 404 });
  return db.saveCountryRiskView(viewId, { enabled: Boolean(enabled) });
}

module.exports = {
  refreshView, checkViews, checkIfOverdue, overview, viewData, describeView, agentStatus,
  getRefresh, setRefresh, setEnabled, nextCheckAt, isDue, pageText, loadSample, live,
  _reset: () => { shared.clear(); agentAnswers.clear(); running.clear(); samples.clear(); }
};
