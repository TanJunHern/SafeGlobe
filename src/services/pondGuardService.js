/**
 * Pond-Guard: screens one counterparty with the ADK agents and turns what they return into scored findings.
 *
 * The app gathers the evidence (its lists and records) and hands each agent its brief. The agents return
 * findings that cite that evidence. Here every finding is checked before it counts: it must cite evidence the
 * agent was given, quote it exactly, and use a category the agent is allowed. The source link, trust and read
 * time are filled in from the evidence, never taken from the model. The score and the route then come from
 * the scorer (src/risk). The agents never return a number.
 *
 * Without the agents service (not configured, down, or the daily cap reached) the stored findings are shown
 * again as an offline sample, and nothing is changed.
 */
const config = require('../config');
const agentsClient = require('./agentsClient');
const { getRules } = require('../risk/rulesStore');
const riskService = require('../risk/riskService');
const { takeDailyBudget, dailyBudgetLeft } = require('../middleware/rateLimit');

const AGENTS = {
  sanctions: { label: 'Sanctions', check: 'sanctions', categories: ['sanctions_confirmed', 'sanctions_possible'] },
  pep: { label: 'PEP', check: 'pep', categories: ['pep_owner', 'pep_associate'] },
  adverse_media: { label: 'Adverse media', check: 'adverse_media', categories: ['adverse_media_severe', 'adverse_media_other'] },
  ownership: { label: 'Ownership', check: 'ownership', categories: ['ownership_unclear'] },
  vessel_behaviour: { label: 'Vessel behaviour', check: 'vessel_behaviour', categories: ['vessel_ais_dark', 'vessel_sts_transfer', 'vessel_flag_changes'] }
};
const BUILT_IN_LISTS = 'Built-in sanctions and PEP data';
const norm = s => String(s || '').toLowerCase().replace(/[“”"'‘’]/g, '').replace(/\s+/g, ' ').trim();
const digits = s => String(s || '').replace(/[^0-9a-z]/gi, '').toLowerCase();

/** High / Medium / Low for a source name: the Sources tab when it is listed there, else by what kind of source it is. */
function trustFor(db, sourceName) {
  const listed = db.getSources().find(s => s.label === sourceName);
  if (listed && ['High', 'Medium', 'Low'].includes(listed.trust)) return listed.trust;
  if (/news|press|media|web search|inference/i.test(sourceName)) return 'Low';
  if (/demo\)|extract|filing/i.test(sourceName)) return /registry extract, |^company registry|^russian registry/i.test(sourceName) ? 'High' : 'Medium';
  return 'High'; // built-in lists, AIS feed, IMO registry
}

/** What the app knows about the counterparty, split into one brief per agent. Each item gets a ref the agent must cite. */
function gatherEvidence(db, entity, rules) {
  const readAt = new Date().toISOString();
  const items = new Map();
  const briefs = {};
  let n = 0;
  const add = (agent, sourceName, text, extra = {}) => {
    const ref = `E${++n}`;
    const item = Object.assign({ ref, agent, source_name: sourceName, text: String(text).slice(0, 1200), read_at: readAt, second_identifier_match: false }, extra);
    items.set(ref, item);
    (briefs[agent] = briefs[agent] || []).push(item);
  };
  const kinds = entity.kind === 'vessel' ? ['sanctions', 'pep', 'adverse_media', 'ownership', 'vessel_behaviour'] : ['sanctions', 'pep', 'adverse_media', 'ownership'];
  for (const k of kinds) briefs[k] = [];

  // Sanctions and PEP: the app's own lists and source records, never the open web
  const ownIds = [entity.reg, entity.imo, entity.idDoc, entity.dob].map(digits).filter(v => v.length >= 5);
  for (const l of entity.lists || []) {
    // A list entry held on the person's own record: the match description says which identifiers agreed
    const second = /date of birth|dob|registration|passport|imo|identifier/i.test(l.match || '');
    add('sanctions', l.list || BUILT_IN_LISTS, `${l.list}: ${entity.name}. Matched on ${String(l.match || 'name').toLowerCase()}.`, { second_identifier_match: second });
  }
  for (const r of db.searchSourceRecords(entity.name).slice(0, 8)) {
    const second = ownIds.length > 0 && ownIds.some(id => digits(r.reg_no).includes(id) || digits(r.raw_content).includes(id));
    const text = `${r.entity_name}${r.reg_no ? ` (${r.reg_no})` : ''}, ${r.jurisdiction || 'no country'}: ${r.summary || ''} Risk level in source: ${r.risk_level}.`;
    const agent = /pep|politically exposed/i.test(`${r.summary} ${r.raw_content}`) ? 'pep' : /ais|vessel|imo|sts/i.test(`${r.summary} ${r.reg_no}`) && entity.kind === 'vessel' ? 'vessel_behaviour' : 'sanctions';
    add(agent, r.source_label, text, { second_identifier_match: second, source_record_id: r.id });
  }
  for (const f of entity.findings || []) {
    const text = `${f.title}. ${f.detail}`;
    if (/pep|politically exposed/i.test(text)) add('pep', f.src || BUILT_IN_LISTS, text);
    else if (/owner|ownership|holding|controlled|shareholder|nominee|state/i.test(text)) { add('ownership', f.src || 'Registry filings', text); if (/sanction|designated|restrict/i.test(text)) add('sanctions', f.src || BUILT_IN_LISTS, text); }
    else if (/sanction|designated|list match/i.test(text)) add('sanctions', f.src || BUILT_IN_LISTS, text);
    else if (/ais|ship-to-ship|sts|dark/i.test(text) && entity.kind === 'vessel') add('vessel_behaviour', f.src || 'AIS position feed', text);
  }
  if (entity.pep) add('pep', BUILT_IN_LISTS, `${entity.name} is recorded as a politically exposed person.`);

  // Ownership: the ownership graph and what the registry notes say
  for (const [sourceId, targetId, label, provenance, confidence] of db.getOwnershipEdges()) {
    if (sourceId !== entity.id && targetId !== entity.id) continue;
    const from = db.getEntityById(sourceId);
    const to = db.getEntityById(targetId);
    add('ownership', provenance === 'news' ? 'News report (demo)' : 'Registry filings',
      `${from ? from.name : sourceId} ${label} ${to ? to.name : targetId}. Provenance: ${provenance}${confidence ? `, confidence ${confidence}` : ''}.`);
  }
  for (const [sign, text] of entity.factors || []) {
    if (/owner|ownership|nominee|beneficial|shareholder/i.test(text)) add('ownership', entity.kind === 'vessel' ? 'Vessel registry extract (demo)' : 'Company registry extract', `${sign === '-' ? 'Concern' : 'Confirmed'}: ${text}`);
  }

  // Vessel behaviour: AIS signals and the flag history
  if (entity.kind === 'vessel') {
    for (const s of entity.signals || []) add('vessel_behaviour', /flag/i.test(s.x) ? 'IMO and MMSI registry' : 'AIS position feed', `${s.t}: ${s.x}`);
    if ((entity.flags || []).length) add('vessel_behaviour', 'IMO and MMSI registry', `Flag history: ${entity.flags.map(f => `${f[0]} ${f[1]}`).join('; ')}.`);
  }

  const categories = ids => ids.map(id => rules.rowById[id]).filter(Boolean).map(r => ({ id: r.id, label: r.label }));
  const payload = {};
  for (const [agent, list] of Object.entries(briefs)) {
    payload[agent] = { evidence: list.map(i => ({ ref: i.ref, source_name: i.source_name, text: i.text, second_identifier_match: i.second_identifier_match })), categories: categories(AGENTS[agent].categories) };
  }
  return { items, briefs: payload, kinds };
}

/**
 * Turns one agent's raw findings into findings in the stored format, or says why not.
 * Returns [{ raw: finding-to-record }] : every entry goes through the schema check in riskService.recordFindings,
 * so a rejected one is stored with its reason.
 */
function vetAgentFindings(db, agent, event, evidence, { idPrefix, promptVersion }) {
  const spec = AGENTS[agent];
  const grounded = new Map((event.grounded_sources || []).map(g => [g.url, g]));
  const out = [];
  (event.findings || []).forEach((f, i) => {
    const base = {
      id: `${idPrefix}-${agent}-${i + 1}`, category: f.category, subject: f.subject, summary: f.summary,
      evidence_quote: String(f.evidence_quote || '').slice(0, 300), match_basis: f.match_basis, corroborating_sources: [],
      agent: `Pond-Guard · ${spec.label}`, model_id: event.model_id || 'unknown', prompt_version: promptVersion || 'unknown'
    };
    // Kept, and stored as rejected with this reason, so the reviewer can see what was left out
    const reject = why => out.push(Object.assign(base, { source_name: '', source_url: '', _reason: why }));
    if (!spec.categories.includes(f.category)) return reject(`The ${spec.label} agent may not report "${f.category}".`);

    if (agent === 'adverse_media') {
      // The link must be one Google Search actually returned for this run, not one the model wrote
      const hit = grounded.get(f.evidence_ref);
      if (!hit) return reject('The article link was not among the pages Google Search returned.');
      return out.push(Object.assign(base, { source_name: hit.title || hit.domain || 'Web page', source_url: hit.url, source_trust: trustFor(db, hit.domain || 'news'), read_at: new Date().toISOString() }));
    }

    const item = evidence.items.get(f.evidence_ref);
    if (!item || item.agent !== agent) return reject('It cites evidence the agent was not given.');
    if (!norm(item.text).includes(norm(base.evidence_quote))) return reject('The quote is not in the cited evidence.');
    // Only a second identifier confirms a sanctions match. A name alone is a possible match at most.
    if (base.category === 'sanctions_confirmed' && !item.second_identifier_match) {
      base.category = 'sanctions_possible';
      base.match_basis = 'strong_name';
      base.summary += ' (Recorded as a possible match: no second identifier was confirmed.)';
    }
    if (base.category === 'sanctions_confirmed') base.match_basis = 'second_identifier';
    out.push(Object.assign(base, {
      source_name: item.source_name, source_url: riskService.sourceLink(item.source_name, base.id),
      source_trust: trustFor(db, item.source_name), read_at: item.read_at
    }));
  });
  return out;
}

const mode = db => {
  if (!agentsClient.configured()) return { live: false, reason: 'The agents service is not connected (AGENTS_SERVICE_URL).' };
  if (dailyBudgetLeft(db, 'pond_guard', config.pondGuardDailyCap) === 0) return { live: false, reason: `Today's limit of ${config.pondGuardDailyCap} live screenings is used up.` };
  return { live: true, reason: '' };
};

/** Shows the stored findings again, grouped by agent, as an offline sample. Changes nothing. */
function offlineRun(db, entity, kinds, emit, reason) {
  const breakdown = riskService.assessEntity(db, entity.id);
  for (const agent of kinds) emit({ type: 'agent_started', agent, label: AGENTS[agent].label });
  for (const agent of kinds) {
    const lines = breakdown ? breakdown.lines.filter(l => AGENTS[agent].categories.includes(l.category)) : [];
    const check = breakdown ? breakdown.coverage.list.find(c => c.id === AGENTS[agent].check) : null;
    emit({
      type: 'agent_done', agent, label: AGENTS[agent].label, ok: true, offline: true,
      note: check && !check.ran ? 'Not run in the offline sample.' : '',
      findings: lines.map(l => ({ id: l.findingId, category: l.category, short: l.short, summary: l.summary, quote: l.quote, sourceName: l.sourceName, sourceUrl: l.sourceUrl, accepted: true }))
    });
  }
  emit({ type: 'scored', offline: true, reason, breakdown });
}

/**
 * Screens a counterparty. emit(event) is called for every step so the drawer can show progress:
 * started, agent_started, agent_done, scored, or error.
 */
async function screenEntity(db, entityId, emit) {
  const entity = db.getEntityById(entityId);
  if (!entity) throw Object.assign(new Error('Counterparty not found'), { status: 404 });
  const rules = getRules(db);
  const evidence = gatherEvidence(db, entity, rules);
  const m = mode(db);
  emit({ type: 'started', entityId, name: entity.name, mode: m.live ? 'live' : 'offline', reason: m.reason, agents: evidence.kinds.map(k => ({ id: k, label: AGENTS[k].label })) });
  if (!m.live || !takeDailyBudget(db, 'pond_guard', config.pondGuardDailyCap)) return offlineRun(db, entity, evidence.kinds, emit, m.reason || 'Daily limit reached.');

  const idPrefix = `PG-${entityId}-${Date.now().toString(36)}`;
  const raw = [];
  const ran = {};
  let meta = {};
  try {
    await agentsClient.screen({
      subject: { entity_id: entity.id, name: entity.name, kind: entity.kind, country: entity.a3 || entity.flag || '', registration: entity.reg || '' },
      briefs: evidence.briefs
    }, event => {
      if (event.type === 'agent_started') return emit(Object.assign({ label: (AGENTS[event.agent] || {}).label || event.agent }, event));
      if (event.type === 'agent_done' && AGENTS[event.agent]) {
        const vetted = event.ok ? vetAgentFindings(db, event.agent, event, evidence, { idPrefix, promptVersion: meta.prompt_version }) : [];
        raw.push(...vetted);
        ran[event.agent] = { ok: Boolean(event.ok), sources: [...new Set((evidence.briefs[event.agent].evidence || []).map(e => e.source_name))], grounded: (event.grounded_sources || []).length };
        const rules2 = rules.rowById;
        return emit({
          type: 'agent_done', agent: event.agent, label: AGENTS[event.agent].label, ok: Boolean(event.ok), error: event.error || '', note: event.note || '',
          findings: vetted.map(v => ({ id: v.id, category: v._reason ? '' : v.category, short: v._reason ? 'Not counted' : (rules2[v.category] || {}).short, summary: v.summary, quote: v.evidence_quote, sourceName: v.source_name, sourceUrl: v.source_url, accepted: !v._reason, reason: v._reason || '' }))
        });
      }
      if (event.type === 'done') meta = event;
      if (event.type === 'error') throw new Error(event.message || 'The agents stopped');
    });
  } catch (err) {
    console.error('[Pond-Guard] live run failed, using the offline sample:', err.message);
    emit({ type: 'error', message: 'The live agents could not finish, so the offline sample is shown.' });
    return offlineRun(db, entity, evidence.kinds, emit, 'The agents service could not be reached.');
  }
  if (!Object.values(ran).some(r => r.ok)) return offlineRun(db, entity, evidence.kinds, emit, 'No agent returned an answer.');

  // Store what was read (accepted and rejected), record which checks ran, and score
  const readAt = new Date().toISOString();
  for (const f of raw) if (meta.prompt_version && f.prompt_version === 'unknown') f.prompt_version = meta.prompt_version;
  const place = riskService.countryFinding(db, rules, [
    { value: entity.kind === 'vessel' ? entity.flag || entity.a3 : entity.a3, role: entity.kind === 'vessel' ? 'flag state' : 'country of incorporation' },
    { value: entity.nationality, role: 'country of residence' }
  ], { idPrefix, readAt });
  riskService.recordFindings(db, entityId, [...raw, place.finding].filter(Boolean), { replace: true });
  const checks = { _kind: entity.kind, country: place.check };
  for (const [agent, r] of Object.entries(ran)) {
    if (!r.ok) continue;
    const source = agent === 'adverse_media' ? 'Google Search (Grounding with Google Search)' : r.sources[0] || BUILT_IN_LISTS;
    checks[AGENTS[agent].check] = { ran: true, source_name: source, source_url: agent === 'adverse_media' ? 'https://www.google.com/search?q=' + encodeURIComponent(`"${entity.name}"`) : riskService.sourceLink(source), read_at: readAt, result: `${raw.filter(f => !f._reason && AGENTS[agent].categories.includes(f.category)).length} finding(s)` };
  }
  db.setRiskChecks(entityId, checks);
  const scored = riskService.rescoreEntity(db, entityId);
  const breakdown = riskService.assessEntity(db, entityId);
  db.addAlert('Pond-Guard', entityId, `${entity.name} screened by Pond-Guard: ${breakdown.risk} of ${breakdown.cap}, ${breakdown.routeLabel}`, breakdown.route);
  emit({ type: 'scored', offline: false, breakdown, before: scored ? scored.before : null, modelId: meta.model_id || '' });
}

function status(db) {
  const m = mode(db);
  return { mode: m.live ? 'live' : 'offline', reason: m.reason, dailyCap: config.pondGuardDailyCap, left: dailyBudgetLeft(db, 'pond_guard', config.pondGuardDailyCap), agents: Object.entries(AGENTS).map(([id, a]) => ({ id, label: a.label })) };
}

module.exports = { screenEntity, gatherEvidence, vetAgentFindings, trustFor, status, AGENTS };
