/**
 * Source crawler agents (feature 3) and self-healing extraction (feature 9).
 *
 * One crawler per website source. What a crawler must never do is decided here, in code, not in a prompt:
 *   - it obeys robots.txt, and needs the "I have checked this site's terms" tick on the source;
 *   - it never reads a page behind a sign-in, and never sends cookies or credentials;
 *   - it reads politely: one request at a time per site, a gap between requests, a time and size limit;
 *   - it only reaches public web addresses (never this server's own network).
 * Each page read is kept as a snapshot. An ADK agent then extracts organisations, people and vessels from the
 * page text; every record must quote the page, or it is dropped. Without the agents service the built-in pattern
 * extractor is used and the result is labelled "Offline sample".
 *
 * When a page is read but extraction breaks, the agent is asked for new extraction instructions. Its suggestion
 * is tested against the snapshot and saved for a compliance officer to approve or dismiss. It is never applied
 * automatically.
 */
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const config = require('../config');
const { currentWorkspaceId } = require('../db');
const agentsClient = require('./agentsClient');
const objectStorage = require('./objectStorage');
const demoFixtures = require('./demoFixtures');
const { stripHtml, extractEntitiesFromText, genRecordId } = require('./sourceHandlers');
const { takeDailyBudget } = require('../middleware/rateLimit');

const BOT_TOKEN = 'DueDillyBot';
const LIMITS = { gapMs: 5000, timeoutMs: 10000, maxBytes: 2 * 1024 * 1024, maxRedirects: 4, maxTextChars: 20000 };
const RESULTS = {
  read: 'Read',
  unchanged: 'Read, no change',
  changed: 'Read, the page changed',
  blocked: 'Blocked by robots.txt',
  needs_sign_in: 'Needs a sign-in: not read',
  terms_not_confirmed: "Not read: confirm that the site's terms allow automated reading",
  extraction_failed: 'Read, but extraction failed',
  failed: 'Could not be read'
};
const KINDS = { organisation: 'org', organization: 'org', org: 'org', company: 'org', person: 'person', individual: 'person', vessel: 'vessel', ship: 'vessel' };

const norm = s => String(s || '').toLowerCase().replace(/[“”"'‘’*_`]/g, '').replace(/\s+/g, ' ').trim();
const digits = s => String(s || '').replace(/[^0-9a-z]/gi, '').toLowerCase();
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const userAgent = () => `${BOT_TOKEN}/1.0 (+${config.publicBaseUrl || `http://localhost:${config.port}`}/about-bot)`;
const isWebSource = source => /web|page|site/i.test(source.type || '') && Boolean(source.config && source.config.url);

// ---------------------------------------------------------------------------------------------
// robots.txt (RFC 9309): the group for our own name if there is one, otherwise the group for "*".
// The longest matching rule wins; Allow wins a tie.
// ---------------------------------------------------------------------------------------------
function parseRobots(text) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === 'allow' || field === 'disallow') && current) {
      if (value) current.rules.push({ allow: field === 'allow', path: value });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

function robotsAllows(text, pathAndQuery, token = BOT_TOKEN) {
  const groups = parseRobots(text);
  const mine = groups.filter(g => g.agents.some(a => a !== '*' && token.toLowerCase().includes(a)));
  const rules = (mine.length ? mine : groups.filter(g => g.agents.includes('*'))).flatMap(g => g.rules);
  let best = null;
  for (const rule of rules) {
    const pattern = '^' + rule.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$');
    if (!new RegExp(pattern).test(pathAndQuery)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) best = rule;
  }
  return best ? best.allow : true;
}

// ---------------------------------------------------------------------------------------------
// Only public web addresses. A source URL comes from a user, so it must not reach this server's own network.
// ---------------------------------------------------------------------------------------------
function isPublicAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127));
  }
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicAddress(mapped[1]);
    return !(lower === '::1' || lower === '::' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower));
  }
  return false;
}

async function publicHost(url, lookup) {
  if (!/^https?:$/.test(url.protocol)) return 'Only http and https pages can be read.';
  if (url.username || url.password) return 'A link with a user name or password in it is not read.';
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return 'That address is not on the public web.';
  try {
    const found = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    if (!found.length || !found.every(a => isPublicAddress(a.address))) return 'That address is not on the public web.';
  } catch (err) {
    return 'The site could not be found.';
  }
  return null;
}

/** A page of this app itself (the demo fixture): read from memory, never over the network. */
function ownPage(url) {
  const own = [config.publicBaseUrl, `http://localhost:${config.port}`, `http://127.0.0.1:${config.port}`].filter(Boolean).map(u => { try { return new URL(u).origin; } catch (e) { return null; } });
  return own.includes(url.origin) ? url.pathname : null;
}

const lastRequestAt = new Map();
async function polite(host, gapMs) {
  const since = Date.now() - (lastRequestAt.get(host) || 0);
  if (since < gapMs) await wait(gapMs - since);
  lastRequestAt.set(host, Date.now());
}

async function readBody(res, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > maxBytes) break;
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

const looksLikeSignIn = pathname => /\/(login|log-in|signin|sign-in|sso|auth|oauth|account\/login)(\/|$|\?)/i.test(pathname);

/**
 * Reads one page, or says why it was not read.
 * Returns { status: 'read' | 'blocked' | 'needs_sign_in' | 'failed', reason, html, finalUrl, robots }.
 */
async function fetchPage(db, pageUrl, { fetchImpl = fetch, lookup = dns.lookup, gapMs = LIMITS.gapMs, demoPage = false } = {}) {
  let url;
  try { url = new URL(pageUrl); } catch (err) { return { status: 'failed', reason: 'That is not a web address.' }; }

  // The demo page is this app's own: it is read from memory, never over the network
  const ownPath = demoPage ? url.pathname : ownPage(url);
  if (ownPath !== null) {
    const html = demoFixtures.render(db, ownPath);
    return html ? { status: 'read', html, finalUrl: url.href, robots: 'own demo page' } : { status: 'failed', reason: 'DueDilly does not crawl its own pages, apart from the demo page.' };
  }

  const robotsCache = new Map();
  const headers = { 'User-Agent': userAgent(), Accept: 'text/html,text/plain;q=0.9' };
  for (let hop = 0; hop <= LIMITS.maxRedirects; hop++) {
    const refused = await publicHost(url, lookup);
    if (refused) return { status: 'failed', reason: refused };

    if (!robotsCache.has(url.origin)) {
      await polite(url.host, gapMs);
      let rules = '';
      try {
        const res = await fetchImpl(new URL('/robots.txt', url.origin).href, { headers, redirect: 'manual', signal: AbortSignal.timeout(LIMITS.timeoutMs) });
        // RFC 9309: a missing robots.txt (4xx) allows everything; a server error means "do not read"
        if (res.status >= 500) return { status: 'blocked', reason: 'robots.txt could not be read (the site answered an error), so the page was not read.' };
        if (res.ok) rules = await readBody(res, 500 * 1024);
      } catch (err) {
        return { status: 'blocked', reason: 'robots.txt could not be reached, so the page was not read.' };
      }
      robotsCache.set(url.origin, rules);
    }
    if (!robotsAllows(robotsCache.get(url.origin), url.pathname + url.search)) return { status: 'blocked', reason: `robots.txt on ${url.host} does not allow ${BOT_TOKEN} to read this page.` };

    await polite(url.host, gapMs);
    let res;
    try {
      // No cookies and no credentials are ever sent. Redirects are followed by hand so each hop is checked.
      res = await fetchImpl(url.href, { headers, redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(LIMITS.timeoutMs) });
    } catch (err) {
      return { status: 'failed', reason: err.name === 'TimeoutError' ? 'The site did not answer in time.' : 'The site could not be reached.' };
    }
    if ([401, 403, 407].includes(res.status)) return { status: 'needs_sign_in', reason: `The site answered ${res.status}: the page needs a sign-in or does not allow access.` };
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return { status: 'failed', reason: 'The site redirected without saying where.' };
      const next = new URL(location, url);
      if (looksLikeSignIn(next.pathname) && !looksLikeSignIn(url.pathname)) return { status: 'needs_sign_in', reason: 'The page redirects to a sign-in page.' };
      url = next;
      continue;
    }
    if (!res.ok) return { status: 'failed', reason: `The site answered ${res.status}.` };
    const type = (res.headers.get('content-type') || '').toLowerCase();
    if (type && !/text\/html|text\/plain|application\/xhtml/.test(type)) return { status: 'failed', reason: 'The page is not a web page or plain text.' };
    const html = await readBody(res, LIMITS.maxBytes);
    const text = stripHtml(html);
    if (/<input[^>]+type=["']?password/i.test(html) && text.length < 1500) return { status: 'needs_sign_in', reason: 'The page is a sign-in form.' };
    return { status: 'read', html, finalUrl: url.href, robots: 'allowed' };
  }
  return { status: 'failed', reason: 'Too many redirects.' };
}

// ---------------------------------------------------------------------------------------------
// Extraction: the ADK crawler agent, checked here; or the built-in pattern extractor (offline sample).
// ---------------------------------------------------------------------------------------------
function vetAgentRecords(source, text, output, { readAt, snapshotKey }) {
  const page = norm(text);
  const records = [];
  const rejected = [];
  for (const r of (output && output.records) || []) {
    const name = String(r.name || '').trim().slice(0, 200);
    const kind = KINDS[String(r.kind || '').toLowerCase()];
    const quote = String(r.quote || '').trim().slice(0, 300);
    if (!name) { rejected.push({ name: '(no name)', reason: 'The record has no name.' }); continue; }
    if (!kind) { rejected.push({ name, reason: `"${r.kind}" is not an organisation, a person or a vessel.` }); continue; }
    if (!quote || !page.includes(norm(quote))) { rejected.push({ name, reason: 'The quote is not on the page.' }); continue; }
    if (!page.includes(norm(name))) { rejected.push({ name, reason: 'The name is not on the page.' }); continue; }
    records.push({
      id: genRecordId('web'), source_id: source.id, source_label: source.label, source_type: 'website',
      entity_name: name, entity_kind: kind, jurisdiction: String(r.country || '').trim().slice(0, 3).toUpperCase() || 'GLB',
      reg_no: String(r.identifier || '').trim().slice(0, 60),
      // The page gives no rating and the agent must not invent one
      risk_level: 'Unrated', risk_score: 0,
      summary: String(r.summary || '').trim().slice(0, 400),
      details_json: JSON.stringify({ url: source.config.url, quote, readAt, snapshotKey, extractor: 'Crawler agent', modelId: output.model_id || '' }),
      raw_content: quote
    });
  }
  return { records, rejected };
}

/** The sentence of the page that names something: the offline extractor's quote. */
function sentenceWith(text, name) {
  const at = text.indexOf(name);
  if (at < 0) return '';
  const start = Math.max(text.lastIndexOf('. ', at) + 2, text.lastIndexOf(': ', at) + 2, 0);
  const stop = text.indexOf('. ', at + name.length);
  return text.slice(start, stop < 0 ? text.length : stop + 1).trim().slice(0, 300);
}

function offlineRecords(source, text, { readAt, snapshotKey }) {
  return extractEntitiesFromText(text).map(ent => {
    const quote = sentenceWith(text, ent.name) || ent.raw || String(ent.context || '').slice(0, 300);
    return {
      id: genRecordId('web'), source_id: source.id, source_label: source.label, source_type: 'website',
      entity_name: ent.name, entity_kind: ent.kind, jurisdiction: ent.jurisdiction || 'GLB', reg_no: ent.regNo || '',
      risk_level: ent.riskLevel || 'Medium', risk_score: ent.riskScore || 55,
      summary: ent.summary || `Named on ${source.config.url}`,
      details_json: JSON.stringify({ url: source.config.url, quote, readAt, snapshotKey, extractor: 'Offline sample (pattern rules)' }),
      raw_content: quote
    };
  });
}

/** Records from one page text. { records, rejected, extractor: 'agent' | 'offline', offlineReason, modelId } */
async function extract(db, source, text, meta, { instructions } = {}) {
  const useInstructions = instructions !== undefined ? instructions : (source.config.instructions || '');
  let offlineReason = '';
  if (!agentsClient.configured()) offlineReason = 'The agents service is not connected.';
  else if (!takeDailyBudget(db, 'crawler', config.crawlerDailyCap)) offlineReason = `Today's limit of ${config.crawlerDailyCap} live extractions is used up.`;
  if (!offlineReason) {
    try {
      const output = await agentsClient.crawlerExtract({ source_label: source.label, url: source.config.url, instructions: useInstructions, text });
      const vetted = vetAgentRecords(source, text, output, meta);
      return { ...vetted, extractor: 'agent', offlineReason: '', modelId: output.model_id || '', note: output.note || '' };
    } catch (err) {
      console.error(`[Crawler] ${source.label}: the agent could not extract, using the offline extractor:`, err.message);
      offlineReason = 'The agents service could not be reached.';
    }
  }
  return { records: offlineRecords(source, text, meta), rejected: [], extractor: 'offline', offlineReason, modelId: '', note: '' };
}

const recordKey = r => `${norm(r.entity_name)}|${digits(r.reg_no)}`;
const brief = r => ({ recordId: r.id, name: r.entity_name, kind: r.entity_kind, identifier: r.reg_no || '', country: r.jurisdiction || '', summary: r.summary || '', quote: r.raw_content || '' });

function saveState(db, source, patch) {
  const crawl = Object.assign({}, (source.config && source.config.crawl) || {}, patch, { resultLabel: RESULTS[patch.result] || patch.result });
  db.updateSourceConfig(source.id, { crawl });
  db.updateSourceHealth(source.id, ['read', 'unchanged', 'changed'].includes(patch.result) ? 'ok' : 'error');
  return crawl;
}

/**
 * Asks the crawler agent for new extraction instructions, tests them on the page text, and saves the suggestion
 * for a person to approve. Returns the proposal, or null when there is no agent to ask.
 */
async function proposeFix(db, source, text, problem, meta) {
  if (!agentsClient.configured()) return null;
  if (db.getSourceProposals({ sourceId: source.id, status: 'pending' }).length) return null;
  if (!takeDailyBudget(db, 'crawler', config.crawlerDailyCap)) return null;
  try {
    const old = source.config.instructions || '';
    const suggestion = await agentsClient.crawlerProposeFix({ source_label: source.label, url: source.config.url, instructions: old, problem, text });
    const proposed = String(suggestion.instructions || '').trim().slice(0, 2000);
    if (!proposed || proposed === old) return null;
    const before = db.getSourceRecordsBySource(source.id).length;
    const output = await agentsClient.crawlerExtract({ source_label: source.label, url: source.config.url, instructions: proposed, text });
    const tested = vetAgentRecords(source, text, output, meta);
    return db.addSourceProposal({
      id: `prop_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`, source_id: source.id, problem,
      old_instructions: old, new_instructions: proposed, proposed_by: `Crawler agent${suggestion.model_id ? ` (${suggestion.model_id})` : ''}`,
      test: { recordsBefore: before, recordsAfter: tested.records.length, rejected: tested.rejected.length, examples: tested.records.slice(0, 3).map(brief), reason: String(suggestion.reason || '').slice(0, 400), testedAt: new Date().toISOString(), snapshotKey: meta.snapshotKey }
    });
  } catch (err) {
    console.error(`[Crawler] ${source.label}: no fix could be suggested:`, err.message);
    return null;
  }
}

/**
 * Reads one website source. Returns { result, resultLabel, reason, recordsCount, added, removed, proposal, extractor }.
 * Publishes "source-changed" when the page differs from the last snapshot.
 */
async function crawlSource(db, source, options = {}) {
  if (!isWebSource(source)) throw Object.assign(new Error('Only website sources are read by a crawler agent'), { status: 400 });
  const cfg = source.config;
  const previous = cfg.crawl || {};
  const readAt = new Date().toISOString();
  const done = (patch, extra = {}) => Object.assign({ sourceId: source.id, label: source.label }, saveState(db, source, Object.assign({ lastTriedAt: readAt }, patch)), extra);

  const isOwn = source.id === demoFixtures.SOURCE_ID;
  if (!cfg.termsChecked && !isOwn) return done({ result: 'terms_not_confirmed', reason: "Tick \"I have checked that this site's terms allow automated reading\" on this source first." });

  const page = await fetchPage(db, cfg.url, Object.assign({}, options, { demoPage: isOwn }));
  if (page.status !== 'read') return done({ result: page.status, reason: page.reason });

  const text = stripHtml(page.html).slice(0, LIMITS.maxTextChars);
  const hash = sha(text);
  const workspace = currentWorkspaceId() || 'demo';
  const saved = await objectStorage.saveObject(`snapshots/${workspace}/${source.id}/${readAt.replace(/[:.]/g, '-')}.html`, Buffer.from(page.html, 'utf8'), 'text/html; charset=utf-8');
  const meta = { readAt, snapshotKey: saved.key };
  const snapshot = { lastReadAt: readAt, snapshotKey: saved.key, snapshotWhere: saved.where, robots: page.robots, reason: '' };

  if (previous.hash === hash && !options.force) return done(Object.assign({ result: 'unchanged' }, snapshot), { added: [], removed: [] });

  const extraction = await extract(db, source, text, meta);
  const hadRecords = (previous.recordsCount || 0) > 0;
  const broken = extraction.records.length === 0 && (hadRecords || extraction.rejected.length > 0);
  if (broken) {
    const problem = extraction.rejected.length
      ? `Every record the agent returned failed the check (${extraction.rejected[0].reason}).`
      : `The page was read but no records were found; the last read found ${previous.recordsCount}.`;
    const proposal = await proposeFix(db, source, text, problem, meta);
    // The records from the last good read stay in place until a person approves a fix
    return done(Object.assign({ result: 'extraction_failed' }, snapshot, { reason: problem, extractor: extraction.extractor, offlineReason: extraction.offlineReason, pendingHash: hash }), { proposal, added: [], removed: [] });
  }

  const before = new Map((previous.recordKeys || []).map(k => [k.key, k.name]));
  const after = new Map(extraction.records.map(r => [recordKey(r), r]));
  const added = [...after].filter(([key]) => !before.has(key)).map(([, r]) => brief(r));
  const removed = [...before].filter(([key]) => !after.has(key)).map(([, name]) => name);
  db.deleteSourceRecordsBySourceId(source.id);
  db.addSourceRecords(extraction.records);

  const isFirstRead = !previous.hash;
  const state = done(Object.assign({ result: isFirstRead ? 'read' : 'changed' }, snapshot, {
    hash, recordsCount: extraction.records.length, recordKeys: extraction.records.map(r => ({ key: recordKey(r), name: r.entity_name })),
    extractor: extraction.extractor, offlineReason: extraction.offlineReason, modelId: extraction.modelId, rejected: extraction.rejected.slice(0, 10), pendingHash: null
  }), { added: isFirstRead ? [] : added, removed: isFirstRead ? [] : removed });

  if (!isFirstRead) {
    require('../events/bus').publish('source-changed', { sourceId: source.id, label: source.label, url: cfg.url, readAt, added, removed, snapshotKey: saved.key, extractor: extraction.extractor });
  }
  return state;
}

/** Reads every website source of the workspace, one after the other. onlyRunOnScreening: just those ticked. */
async function crawlAll(db, { onlyRunOnScreening = false, olderThanMs = 0, ...options } = {}) {
  const { isLockedSource } = require('./vesselFinderService');
  const results = [];
  for (const source of db.getSources()) {
    if (!isWebSource(source) || isLockedSource(source.id)) continue;
    if (onlyRunOnScreening && !source.config.runOnScreening) continue;
    const last = source.config.crawl && source.config.crawl.lastTriedAt;
    if (olderThanMs && last && Date.now() - new Date(last).getTime() < olderThanMs) continue;
    try {
      results.push(await crawlSource(db, source, options));
    } catch (err) {
      console.error(`[Crawler] ${source.label}:`, err.message);
      results.push({ sourceId: source.id, label: source.label, result: 'failed', reason: 'The crawler stopped unexpectedly.' });
    }
  }
  return results;
}

/**
 * A compliance officer's decision on a suggested fix. Approve: the new instructions are saved and the stored
 * snapshot is read again with them. Dismiss: nothing changes.
 */
async function decideProposal(db, proposalId, approve, actor) {
  const proposal = db.getSourceProposal(proposalId);
  if (!proposal) throw Object.assign(new Error('Suggestion not found'), { status: 404 });
  if (proposal.status !== 'pending') throw Object.assign(new Error('This suggestion has already been decided'), { status: 409 });
  const decided = db.decideSourceProposal(proposalId, approve ? 'approved' : 'dismissed', actor);
  if (!approve) return { proposal: decided, recordsCount: null };

  db.updateSourceConfig(proposal.sourceId, { instructions: proposal.newInstructions });
  const source = db.getSourceById(proposal.sourceId);
  const crawl = source.config.crawl || {};
  const buffer = crawl.snapshotKey ? await objectStorage.readObject(crawl.snapshotKey, crawl.snapshotWhere) : null;
  if (!buffer) return { proposal: decided, recordsCount: null, note: 'The instructions are saved. The snapshot is no longer stored, so press Run now to read the page again.' };
  const text = stripHtml(buffer.toString('utf8')).slice(0, LIMITS.maxTextChars);
  const meta = { readAt: crawl.lastReadAt || new Date().toISOString(), snapshotKey: crawl.snapshotKey };
  const extraction = await extract(db, source, text, meta);
  if (extraction.records.length) {
    db.deleteSourceRecordsBySourceId(source.id);
    db.addSourceRecords(extraction.records);
    saveState(db, source, { result: 'read', reason: '', hash: sha(text), recordsCount: extraction.records.length, recordKeys: extraction.records.map(r => ({ key: recordKey(r), name: r.entity_name })), extractor: extraction.extractor, offlineReason: extraction.offlineReason, pendingHash: null });
  }
  return { proposal: decided, recordsCount: extraction.records.length };
}

/** The latest stored snapshot of a source, as page text, for the "View snapshot" link. */
async function readSnapshot(source) {
  const crawl = (source.config && source.config.crawl) || {};
  if (!crawl.snapshotKey) return null;
  const buffer = await objectStorage.readObject(crawl.snapshotKey, crawl.snapshotWhere);
  return buffer ? { readAt: crawl.lastReadAt, key: crawl.snapshotKey, where: crawl.snapshotWhere, html: buffer.toString('utf8') } : null;
}

const mode = db => (agentsClient.configured() ? { live: true, reason: '' } : { live: false, reason: 'The agents service is not connected (AGENTS_SERVICE_URL).' });

module.exports = { crawlSource, crawlAll, decideProposal, readSnapshot, fetchPage, robotsAllows, parseRobots, isPublicAddress, vetAgentRecords, isWebSource, userAgent, mode, RESULTS, LIMITS, BOT_TOKEN };
