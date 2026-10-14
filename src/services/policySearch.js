/**
 * Policy search (feature 12).
 *
 * With Agent Search connected (AGENT_SEARCH_DATA_STORE), policy questions and clause lookups are answered from the
 * data store that indexes one file per policy clause, the CDDQ template and the demo policy PDF.
 * Otherwise, or when the daily cap is reached or the call fails, the built-in policy text in policyRagService.js
 * answers, and the result is labelled "Offline fallback".
 *
 * Only snippets are requested, which need no Enterprise edition feature. The full clause text shown beside a
 * score is the text of the file Agent Search matched, which is the same text the app carries.
 */
const config = require('../config');
const { CORPORATE_POLICY_DOCUMENT } = require('./policyRagService');
const { takeDailyBudget } = require('../middleware/rateLimit');

const VIA = { live: 'Agent Search', offline: 'Offline fallback' };
const CACHE_MS = 6 * 60 * 60 * 1000;
const fileFor = number => `policy-clause-${number.replace('.', '-')}.txt`;

/** The clauses of the built-in policy text: [{ id: '§5.4', number: '5.4', section, title, text, file }] */
function localClauses() {
  const clauses = [];
  let section = '';
  for (const raw of CORPORATE_POLICY_DOCUMENT.split('\n')) {
    const line = raw.trim();
    const s = line.match(/^Section \d+: (.+)$/);
    if (s) { section = s[1]; continue; }
    const c = line.match(/^Clause (\d+\.\d+)(?: \(([^)]+)\))?: (.+)$/);
    if (c) clauses.push({ id: `§${c[1]}`, number: c[1], section, title: c[2] || section, text: c[3], file: fileFor(c[1]) });
  }
  return clauses;
}

const live = () => Boolean(config.agentSearch.dataStore && (config.googleCloudProject || config.gcpProjectId));
let lastError = null;
let authClient = null;
async function accessToken() {
  if (!authClient) {
    const { GoogleAuth } = require('google-auth-library');
    authClient = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
  }
  const token = await authClient.getAccessToken();
  return token.token || token;
}

/** POST v1/{servingConfig}:search on the data store's default serving config. Returns [{ title, snippet, link, file }]. */
async function agentSearch(query, pageSize = 5) {
  const project = config.googleCloudProject || config.gcpProjectId;
  const { location, dataStore } = config.agentSearch;
  const host = location === 'global' ? 'discoveryengine.googleapis.com' : `${location}-discoveryengine.googleapis.com`;
  const url = `https://${host}/v1/projects/${project}/locations/${location}/collections/default_collection/dataStores/${dataStore}/servingConfigs/default_serving_config:search`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json', 'X-Goog-User-Project': project },
    body: JSON.stringify({ query, pageSize, contentSearchSpec: { snippetSpec: { returnSnippet: true } } }),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`Agent Search answered ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const body = await res.json();
  return (body.results || []).map(r => {
    const d = (r.document && r.document.derivedStructData) || {};
    const link = d.link || '';
    const snippet = ((d.snippets || []).find(s => s.snippet && s.snippet_status !== 'NO_SNIPPET_AVAILABLE') || {}).snippet || '';
    return { title: d.title || link.split('/').pop() || (r.document && r.document.id) || 'Policy file', snippet: snippet.replace(/<\/?b>/g, '').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim(), link, file: link.split('/').pop() || '' };
  });
}

function localSearch(question, limit = 5) {
  const words = [...new Set(String(question || '').toLowerCase().match(/[a-z0-9.§]{3,}/g) || [])];
  return localClauses()
    .map(c => {
      const hay = `${c.id} clause ${c.number} ${c.section} ${c.title} ${c.text}`.toLowerCase();
      return { clause: c, score: words.filter(w => hay.includes(w.replace('§', ''))).length };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ clause }) => ({ title: `${clause.id} ${clause.title}`, snippet: clause.text, link: '', file: clause.file, clauseId: clause.id }));
}

/** Searches the policies. { via, reason, results: [{ title, snippet, link, file, clauseId }] } */
async function search(db, question) {
  const q = String(question || '').trim().slice(0, 300);
  if (!q) return { via: VIA.offline, reason: '', results: [] };
  let reason = '';
  if (!live()) reason = 'Agent Search is not connected (AGENT_SEARCH_DATA_STORE).';
  else if (!takeDailyBudget(db, 'agent_search', config.agentSearch.dailyCap)) reason = `Today's limit of ${config.agentSearch.dailyCap} policy searches is used up.`;
  if (!reason) {
    try {
      const clauses = localClauses();
      const results = (await agentSearch(q)).map(r => Object.assign(r, { clauseId: (clauses.find(c => c.file === r.file) || {}).id || null }));
      lastError = null;
      return { via: VIA.live, reason: '', results };
    } catch (err) {
      lastError = err.message;
      console.error('[Policy search] Agent Search failed, using the built-in policy text:', err.message);
      reason = 'Agent Search could not be reached.';
    }
  }
  return { via: VIA.offline, reason, results: localSearch(q) };
}

const clauseCache = new Map();

/**
 * One clause by its id ("§5.4"): its text, and where it was found.
 * { id, number, title, section, text, file, via, link, reason } or null for an id that is not a clause.
 */
async function clauseFor(db, clauseId) {
  const number = (String(clauseId || '').match(/(\d+\.\d+)/) || [])[1];
  const clause = localClauses().find(c => c.number === number);
  if (!clause) return null;
  const cached = clauseCache.get(clause.id);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  let value = Object.assign({}, clause, { via: VIA.offline, link: '', reason: live() ? '' : 'Agent Search is not connected (AGENT_SEARCH_DATA_STORE).' });
  if (live()) {
    if (!takeDailyBudget(db, 'agent_search', config.agentSearch.dailyCap)) {
      value.reason = `Today's limit of ${config.agentSearch.dailyCap} policy searches is used up.`;
    } else {
      try {
        const hit = (await agentSearch(`Clause ${clause.number} ${clause.title}`, 5)).find(r => r.file === clause.file);
        lastError = null;
        if (hit) value = Object.assign({}, clause, { via: VIA.live, link: hit.link, snippet: hit.snippet, reason: '' });
        else value.reason = 'Agent Search did not return the file for this clause.';
        clauseCache.set(clause.id, { at: Date.now(), value });
      } catch (err) {
        lastError = err.message;
        value.reason = 'Agent Search could not be reached.';
      }
    }
  }
  return value;
}

/** Every clause, for the "Why <score>?" panel and the Policies tab. */
async function allClauses(db) {
  const out = [];
  for (const c of localClauses()) out.push(await clauseFor(db, c.id));
  return out;
}

const status = () => ({ mode: live() ? 'live' : 'offline', dataStore: config.agentSearch.dataStore || null, location: config.agentSearch.location, dailyCap: config.agentSearch.dailyCap, lastError });

module.exports = { search, clauseFor, allClauses, localClauses, localSearch, status, fileFor, VIA, _clearCache: () => clauseCache.clear() };
