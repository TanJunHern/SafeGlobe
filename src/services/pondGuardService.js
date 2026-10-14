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
 *
 * Every counterparty gets five sub-agents: Sanctions, PEP, Adverse media, Ownership, Country and contract.
 * A vessel gets a sixth, Vessel behaviour. Each is handed the policy clauses for its subject and may cite one,
 * with a quote that is checked against the clause. After the app has checked the findings and added up the
 * points from the user's table, Dilly (the orchestrator) is given the result and writes a summary and next
 * steps. Dilly cannot change the score or the route: its answer has no field for either.
 * What was suggested at each run is stored, so it can be compared with the officer's decision later.
 */
const config = require('../config');
const agentsClient = require('./agentsClient');
const { getRules } = require('../risk/rulesStore');
const riskService = require('../risk/riskService');
const policySearch = require('./policySearch');
const { takeDailyBudget, dailyBudgetLeft } = require('../middleware/rateLimit');

const AGENTS = {
  sanctions: { label: 'Sanctions', check: 'sanctions', categories: ['sanctions_confirmed', 'sanctions_possible'] },
  pep: { label: 'PEP', check: 'pep', categories: ['pep_owner', 'pep_associate'] },
  adverse_media: { label: 'Adverse media', check: 'adverse_media', categories: ['adverse_media_severe', 'adverse_media_other'] },
  ownership: { label: 'Ownership', check: 'ownership', categories: ['ownership_unclear'] },
  country_contract: { label: 'Country and contract', check: 'country', categories: ['country_cpi_low', 'country_cpi_mid', 'contract_value_high', 'broker_intermediary'] },
  vessel_behaviour: { label: 'Vessel behaviour', check: 'vessel_behaviour', categories: ['vessel_ais_dark', 'vessel_sts_transfer', 'vessel_flag_changes'] }
};
const BUILT_IN_LISTS = 'Built-in sanctions and PEP data';
const INTAKE = 'KYC intake form';
const BROKER_RELATIONSHIP = '3rd Party Reps & Brokers';
const kindsFor = entity => ['sanctions', 'pep', 'adverse_media', 'ownership', 'country_contract', ...(entity.kind === 'vessel' ? ['vessel_behaviour'] : [])];
const clauseId = value => { const m = String(value || '').match(/(\d+\.\d+)/); return m ? `§${m[1]}` : ''; };
/** The policy clauses an agent maps against: those its points rows name in the rules in force. */
const clauseIdsFor = (rules, agent) => [...new Set(AGENTS[agent].categories.map(id => clauseId((rules.rowById[id] || {}).policy)).filter(Boolean))];
// Evidence is about sanctions only when it, or the source it comes from, says so
const SANCTIONS_WORDS = /sanction|designat|\bsdn\b|ofac|ofsi|embargo|blocklist|block list|watchlist|watch list|restricted part|denied part|list match/i;
const norm = s => String(s || '').toLowerCase().replace(/[“”"'‘’*_`]/g, '').replace(/\s+/g, ' ').trim();
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
  const kinds = kindsFor(entity);
  for (const k of kinds) briefs[k] = [];
  // A new request may be about a counterparty already on the watchlist: that record's evidence is read too
  const ownerOf = new Set([entity.id, ...(entity.evidenceIds || [])]);

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
    // Each record goes to the one agent it is about. A record that is about none of them (a routine notice) is
    // handed to no agent: it stays in Readable Source Intelligence and adds nothing to the score.
    const about = `${r.summary} ${r.raw_content}`;
    const agent = /pep|politically exposed/i.test(about) ? 'pep'
      : entity.kind === 'vessel' && /\bais\b|ship-to-ship|\bsts\b|dark period|without an ais|flag change/i.test(about) ? 'vessel_behaviour'
      : SANCTIONS_WORDS.test(`${about} ${r.source_label}`) ? 'sanctions'
      : /owner|shareholder|nominee|bearer share|holding|controlled by|ship manager|managed by/i.test(about) ? 'ownership'
      : null;
    if (!agent) continue;
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
    if (!ownerOf.has(sourceId) && !ownerOf.has(targetId)) continue;
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

  // Country and contract: the CPI figure of each country on file, and the contract details of the request
  const t = rules.thresholds;
  const places = countryPlaces(entity).map(p => Object.assign({ role: p.role }, db.getCpiByCodeOrName(p.value) || null)).filter(p => p.score !== undefined);
  const seen = new Set();
  const known = places.filter(p => (seen.has(p.a3) ? false : seen.add(p.a3)));
  const worst = known.length ? known.reduce((a, b) => (b.score < a.score ? b : a)) : null;
  for (const p of known) {
    add('country_contract', riskService.CPI_SOURCE.name, `${p.name} (${p.role}): Corruption Perceptions Index 2025 score ${p.score}/100, rank ${p.rank}. On this index a low score is bad.`,
      { meta: { cpi: p.score, worst: p === worst, country: p.name } });
  }
  const request = entity.request || null;
  if (request) {
    const value = Number(request.contract_value || 0);
    add('country_contract', INTAKE, `Anticipated contract value: SGD ${value.toLocaleString('en-SG')}`, { meta: { contract: value } });
    if (request.relationship_type) add('country_contract', INTAKE, `Relationship type: ${request.relationship_type}`, { meta: { broker: request.relationship_type === BROKER_RELATIONSHIP } });
  } else if (entity.role) {
    add('country_contract', 'Counterparty record', `Role on file: ${entity.role}`, { meta: { broker: /\bbroker|\bintermediar/i.test(entity.role) } });
  }

  const describe = r => String(r.label).replace(/\{(\w+)\}/g, (m, key) => (t[key] !== undefined ? Number(t[key]).toLocaleString('en-SG') : m));
  const categories = ids => ids.map(id => rules.rowById[id]).filter(Boolean).map(r => ({ id: r.id, label: describe(r) }));
  const payload = {};
  for (const [agent, list] of Object.entries(briefs)) {
    payload[agent] = { evidence: list.map(i => ({ ref: i.ref, source_name: i.source_name, text: i.text, second_identifier_match: i.second_identifier_match })), categories: categories(AGENTS[agent].categories) };
  }
  return { items, briefs: payload, kinds, worstCountry: worst };
}

/** The countries on file for a counterparty, with what each one is to it. */
function countryPlaces(entity) {
  return [
    { value: entity.kind === 'vessel' ? entity.flag || entity.a3 : entity.a3, role: entity.kind === 'vessel' ? 'flag state' : 'country of incorporation' },
    { value: entity.nationality, role: 'country of residence' },
    { value: entity.request && entity.request.country, role: 'country on the request' }
  ].filter(p => p.value);
}

/** The clauses each agent is given, as text: Agent Search when connected, the built-in policy text otherwise. */
async function policyFor(db, rules, kinds) {
  const out = {};
  for (const agent of kinds) {
    out[agent] = [];
    for (const id of clauseIdsFor(rules, agent)) {
      const c = await policySearch.clauseFor(db, id);
      if (c) out[agent].push({ id: c.id, title: c.title || '', text: c.text });
    }
  }
  return out;
}

/**
 * The policy part of a finding, checked: the clause must be one the agent was given, and the quote must be in it.
 * Returns the three fields as they may be stored, plus a note when something was dropped.
 */
function vetPolicy(f, clauses) {
  const given = new Map((clauses || []).map(c => [c.id, c]));
  const out = { suggested_action: String(f.suggested_action || '').replace(/\s+/g, ' ').trim().slice(0, 240), policy_clause: '', policy_quote: '', policy_note: '' };
  const cited = clauseId(f.policy_clause);
  if (!given.size) { out.policy_note = 'The policy has no clause for this.'; return out; }
  if (!cited || !given.has(cited)) { out.policy_note = cited ? `The agent cited ${cited}, which it was not given.` : 'The agent cited no policy clause.'; return out; }
  out.policy_clause = cited;
  const quote = String(f.policy_quote || '').trim().slice(0, 300);
  if (quote && norm(given.get(cited).text).includes(norm(quote))) out.policy_quote = quote;
  else if (quote) out.policy_note = 'The policy quote was not in the clause word for word, so it is not shown.';
  return out;
}

/**
 * Turns one agent's raw findings into findings in the stored format, or says why not.
 * Returns [{ raw: finding-to-record }] : every entry goes through the schema check in riskService.recordFindings,
 * so a rejected one is stored with its reason.
 */
function vetAgentFindings(db, agent, event, evidence, { idPrefix, promptVersion, subject, policy = {}, rules = getRules(db) }) {
  const spec = AGENTS[agent];
  const grounded = new Map((event.grounded_sources || []).flatMap(g => [[g.ref, g], [g.url, g]]).filter(([k]) => k));
  const out = [];
  (event.findings || []).forEach((f, i) => {
    const base = {
      id: `${idPrefix}-${agent}-${i + 1}`, category: f.category, subject: f.subject, summary: f.summary,
      evidence_quote: String(f.evidence_quote || '').slice(0, 300), match_basis: f.match_basis, corroborating_sources: [],
      agent: `Pond-Guard · ${spec.label}`, model_id: event.model_id || 'unknown', prompt_version: promptVersion || 'unknown'
    };
    Object.assign(base, vetPolicy(f, policy[agent]));
    // Kept, and stored as rejected with this reason, so the reviewer can see what was left out
    const reject = why => out.push(Object.assign(base, { source_name: '', source_url: '', _reason: why }));
    if (!spec.categories.includes(f.category)) return reject(`The ${spec.label} agent may not report "${f.category}".`);

    if (agent === 'adverse_media') {
      // The page must be one Google Search actually returned for this run, cited by its ref (G1, G2, ...), not a link the model wrote
      const hit = grounded.get(f.evidence_ref);
      if (!hit) return reject('The article link was not among the pages Google Search returned.');
      const said = norm(`${(hit.segments || []).join(' ')} ${event.search_notes || ''}`);
      if (said && !said.includes(norm(base.evidence_quote))) return reject('The quote is not in what Google Search returned.');
      // Namesakes: the page must name this counterparty, and a vessel article must carry the same IMO number
      const about = norm(`${base.evidence_quote} ${(hit.segments || []).join(' ')} ${hit.title || ''}`);
      if (subject && subject.name && !about.includes(norm(subject.name))) return reject(`The article does not name ${subject.name}.`);
      const imos = [...`${base.evidence_quote} ${base.summary}`.matchAll(/IMO[\s:#.]*(\d{7})/gi)].map(m => m[1]);
      if (subject && subject.kind === 'vessel' && imos.length && !imos.includes(digits(subject.imo || subject.reg))) return reject(`The article is about a different vessel (IMO ${imos[0]}).`);
      return out.push(Object.assign(base, { source_name: hit.title || hit.domain || 'Web page', source_url: hit.url, source_trust: trustFor(db, hit.domain || 'news'), read_at: new Date().toISOString() }));
    }

    const item = evidence.items.get(f.evidence_ref);
    if (!item || item.agent !== agent) return reject('It cites evidence the agent was not given.');
    if (!norm(item.text).includes(norm(base.evidence_quote))) return reject('The quote is not in the cited evidence.');
    // Country and contract: the figure in the cited evidence must really meet the rule in force. The agent reads; the number is checked here.
    if (agent === 'country_contract') {
      const m = item.meta || {};
      const th = rules.thresholds;
      const cpi = typeof m.cpi === 'number';
      const meets = base.category === 'country_cpi_low' ? cpi && m.cpi < th.cpiLow
        : base.category === 'country_cpi_mid' ? cpi && m.cpi >= th.cpiLow && m.cpi < th.cpiMid
        : base.category === 'contract_value_high' ? typeof m.contract === 'number' && m.contract > th.contractValueSgd
        : m.broker === true;
      if (!meets) return reject('The cited figure does not meet this rule.');
      // The country counts once, for the riskiest country on file
      if (cpi && !m.worst) return reject('A riskier country is on file for this counterparty; the country counts once.');
      base.match_basis = 'not_name';
      return out.push(Object.assign(base, {
        source_name: item.source_name, source_url: cpi ? riskService.CPI_SOURCE.url : riskService.sourceLink(item.source_name, base.id),
        source_trust: cpi ? riskService.CPI_SOURCE.trust : 'High', read_at: item.read_at
      }));
    }
    // A sanctions finding must rest on evidence about sanctions: a notice that merely names the counterparty is not a match
    if (agent === 'sanctions' && !SANCTIONS_WORDS.test(`${item.text} ${item.source_name}`)) return reject('The cited evidence does not mention sanctions or a sanctions list.');
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
  if (!agentsClient.configured()) return { live: false, kind: 'offline', reason: 'The agents service is not connected (AGENTS_SERVICE_URL).' };
  if (dailyBudgetLeft(db, 'pond_guard', config.pondGuardDailyCap) === 0) return { live: false, kind: 'limit', reason: `Today's limit of ${config.pondGuardDailyCap} live screenings is used up.` };
  return { live: true, kind: 'live', reason: '' };
};

/**
 * The points rows that are plain arithmetic on figures the app holds: the riskiest country's CPI, the contract
 * value and the broker relationship. The Country and contract agent reports them; this is the check behind it.
 * Returns findings for the rows that apply and that `have` does not already hold, so a row the agent missed is
 * not lost. Each says that it was added by the rule check.
 */
function ruleFindings(db, rules, entity, have, { idPrefix, readAt }) {
  const agent = `Pond-Guard · ${AGENTS.country_contract.label} (rule check)`;
  const out = [];
  const place = riskService.countryFinding(db, rules, countryPlaces(entity), { idPrefix, agent, readAt });
  if (place.finding && !have.has('country_cpi_low') && !have.has('country_cpi_mid')) out.push(place.finding);
  const base = (key, f) => Object.assign({
    id: `${idPrefix}-rule-${key}`, subject: entity.name, source_trust: 'High', read_at: readAt, match_basis: 'not_name',
    corroborating_sources: [], agent, model_id: 'none', prompt_version: 'none'
  }, f, { source_url: riskService.sourceLink(f.source_name, `${idPrefix}-rule-${key}`) });
  const request = entity.request || null;
  const value = request ? Number(request.contract_value || 0) : 0;
  if (value > rules.thresholds.contractValueSgd && !have.has('contract_value_high')) {
    out.push(base('contract', { category: 'contract_value_high', source_name: INTAKE,
      summary: `The anticipated contract value is above SGD ${rules.thresholds.contractValueSgd.toLocaleString('en-SG')}.`,
      evidence_quote: `Anticipated contract value: SGD ${value.toLocaleString('en-SG')}` }));
  }
  if (request && request.relationship_type === BROKER_RELATIONSHIP && !have.has('broker_intermediary')) {
    out.push(base('broker', { category: 'broker_intermediary', source_name: INTAKE,
      summary: 'The counterparty acts as a broker or intermediary.', evidence_quote: `Relationship type: ${request.relationship_type}` }));
  }
  return { findings: out, countryCheck: place.check };
}

/**
 * Dilly's answer, checked. Only what rests on a finding of this run or a clause that was given is kept.
 * There is nothing here that could move the score or the route: the answer has no such field, and any other
 * field is ignored. The note is kept only for the two reasons it is allowed, and "a check did not run" must be true.
 */
function vetDilly(output, { findingIds, clauseIds, checksNotRun }) {
  const text = (v, max) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const steps = [];
  let dropped = 0;
  for (const step of Array.isArray(output && output.next_steps) ? output.next_steps : []) {
    const ids = (Array.isArray(step.finding_ids) ? step.finding_ids : []).filter(id => findingIds.has(id));
    const clauses = [...new Set((Array.isArray(step.policy_clauses) ? step.policy_clauses : []).map(clauseId).filter(id => clauseIds.has(id)))];
    const action = text(step.action, 300);
    if (!action || (!ids.length && !clauses.length)) { dropped++; continue; }
    if (steps.length < 6) steps.push({ action, findingIds: ids, policyClauses: clauses });
  }
  const reason = output && output.note_reason;
  const allowed = reason === 'agents_disagree' || (reason === 'check_not_run' && checksNotRun > 0);
  return {
    label: 'AI suggestion',
    summary: text(output && output.summary, 900),
    nextSteps: steps,
    note: allowed ? text(output.note, 280) : '',
    noteReason: allowed && text(output.note, 280) ? reason : 'none',
    droppedSteps: dropped
  };
}

/** Asks Dilly for a summary and next steps. Returns the checked answer, or { ok: false, reason } when there is none. */
async function askDilly(db, entity, breakdown, accepted, policy, rules) {
  const clauses = [...new Map(Object.values(policy).flat().map(c => [c.id, c])).values()];
  const points = new Map(breakdown.lines.map(l => [l.findingId, l.points]));
  const checks = breakdown.coverage.list.map(c => ({ agent: c.label, ran: Boolean(c.ran), note: c.ran ? '' : 'This check did not run or returned no sourced result.' }));
  try {
    const output = await agentsClient.dilly({
      subject: { entity_id: entity.id, name: entity.name, kind: entity.kind, country: entity.a3 || entity.flag || '', registration: entity.reg || '' },
      findings: accepted.map(f => ({ id: f.id, agent: f.agent, rule: (rules.rowById[f.category] || {}).short || f.category, summary: f.summary, points: points.get(f.id) || 0, policy_clause: f.policy_clause || '', suggested_action: f.suggested_action || '' })),
      not_counted: (breakdown.notCounted || []).length + (breakdown.rejected || []).length,
      checks, clauses,
      risk: breakdown.risk, risk_cap: breakdown.cap, level: breakdown.level.label, confidence: breakdown.confidence, route: breakdown.routeLabel
    });
    const vetted = vetDilly(output, { findingIds: new Set(accepted.map(f => f.id)), clauseIds: new Set(clauses.map(c => c.id)), checksNotRun: checks.filter(c => !c.ran).length });
    return Object.assign({ ok: true, modelId: output.model_id || '' }, vetted);
  } catch (err) {
    console.error('[Pond-Guard] Dilly did not answer:', err.message);
    return { ok: false, label: 'AI suggestion', reason: 'Dilly could not sum up this screening. The findings, the score and the route stand without it.' };
  }
}

/** What Dilly suggests, as stored and shown: the numbers are the scorer's, computed from the user's points table. */
const suggestionOf = (id, entityId, breakdown, rules, extra = {}) => Object.assign({
  id, entityId, at: new Date().toISOString(), risk: breakdown.risk, confidence: breakdown.confidence, route: breakdown.route,
  level: breakdown.level.label, riskLine: rules.routes.riskLine
}, extra);

/** Shows the stored findings again, grouped by agent, as an offline sample. Changes nothing. */
function offlineRun(db, entity, kinds, emit, reason, kind = 'offline', orchAssessment = null) {
  const breakdown = riskService.assessEntity(db, entity.id);
  for (const agent of kinds) emit({ type: 'agent_started', agent, label: AGENTS[agent].label });
  for (const agent of kinds) {
    let lines = breakdown ? breakdown.lines.filter(l => AGENTS[agent].categories.includes(l.category)) : [];
    const check = breakdown ? breakdown.coverage.list.find(c => c.id === AGENTS[agent].check) : null;
    let agentFindings = lines.map(l => ({ id: l.findingId, category: l.category, short: l.short, summary: l.summary, quote: l.quote, sourceName: l.sourceName, sourceUrl: l.sourceUrl, accepted: true, policyClause: l.policyClause || '', policyQuote: l.policyQuote || '', suggestedAction: l.suggestedAction || '' }));

    // Inject Orchestrator PDF Sanctions findings for Sanctions agent
    if (agent === 'sanctions' && orchAssessment) {
      if (!orchAssessment.is_safe && orchAssessment.sanctions_exposures && orchAssessment.sanctions_exposures.length > 0) {
        agentFindings = [
          {
            id: `PG-${entity.id}-sanctions-orch`,
            category: 'sanctions_confirmed',
            short: 'Sanctions Violation',
            summary: orchAssessment.summary,
            quote: orchAssessment.sanctions_exposures[0]?.evidence_excerpt || orchAssessment.why.slice(0, 220),
            sourceName: `Orchestrator PDF (${orchAssessment.document_name})`,
            sourceUrl: '',
            accepted: true,
            policyClause: '§4.1',
            policyQuote: 'Counterparties incorporated in, operating from, or flagged under jurisdictions listed on sanctions or increased monitoring trigger mandatory action.',
            suggestedAction: orchAssessment.recommended_action
          },
          ...agentFindings.filter(f => f.category !== 'sanctions_confirmed')
        ];
      }
    }

    emit({
      type: 'agent_done', agent, label: AGENTS[agent].label, ok: true, offline: true,
      note: check && !check.ran ? 'Not run in the offline sample.' : '',
      findings: agentFindings
    });
  }

  // Record suggestion with orchestrator assessment
  db.addSuggestion(suggestionOf(`PG-${entity.id}-offline-${Date.now()}`, entity.id, breakdown, getRules(db), {
    mode: 'offline',
    detail: { orchestrator: orchAssessment, dilly: { ok: true, verdict: orchAssessment ? orchAssessment.verdict : 'Review' } }
  }));

  emit({ type: 'scored', offline: true, reason, breakdown, suggestion: latestSuggestion(db, entity.id) });
  return { live: false, kind, reason, breakdown, orchestrator: orchAssessment };
}

/** The suggestion last stored for a case, in the shape the pages show. */
function latestSuggestion(db, entityId) {
  const s = db.getLatestSuggestion(entityId);
  if (!s) return null;
  return { id: s.id, at: s.at, mode: s.mode, risk: s.risk, confidence: s.confidence, route: s.route, level: s.level, dilly: s.detail.dilly || null, orchestrator: s.detail.orchestrator || null, reusedFrom: s.detail.reusedFrom || null };
}

/**
 * Screens a counterparty. emit(event) is called for every step so the drawer can show progress:
 * started, agent_started, agent_done, scored, dilly, or error.
 * subject: a counterparty that has no record of its own yet (a new KYC request), in the shape of one.
 * Returns { live, kind, reason, breakdown, suggestion }.
 */
async function screenEntity(db, entityId, emit, { subject = null, kycId = null, entityKey = '' } = {}) {
  const entity = subject || db.getEntityById(entityId);
  if (!entity) throw Object.assign(new Error('Counterparty not found'), { status: 404 });
  const rules = getRules(db);
  const m = mode(db);

  // Website sources ticked "Run on every screening" are read first, so the agents see today's page (live runs only)
  if (m.live) {
    try { await require('./crawlerService').crawlAll(db, { onlyRunOnScreening: true, olderThanMs: 10 * 60 * 1000 }); } catch (err) { console.error('[Pond-Guard] sources not refreshed:', err.message); }
  }
  const evidence = gatherEvidence(db, entity, rules);
  emit({ type: 'started', entityId, name: entity.name, mode: m.live ? 'live' : 'offline', reason: m.reason, agents: evidence.kinds.map(k => ({ id: k, label: AGENTS[k].label })) });

  // 1. Resolve KYC Form for this counterparty
  const allKyc = db.getAllKycRequests ? db.getAllKycRequests() : [];
  let kycRequest = allKyc.find(k => k.id.toLowerCase() === entityId.toLowerCase() || (entityId.startsWith('kyc-') && k.id.toLowerCase() === entityId.replace('kyc-', '').toLowerCase()));
  if (!kycRequest) {
    kycRequest = allKyc.find(k => k.counterparty_name && entity.name && k.counterparty_name.toLowerCase().trim() === entity.name.toLowerCase().trim());
  }
  if (!kycRequest && entity.reg) {
    kycRequest = allKyc.find(k => k.attributes && (k.attributes.reg_no === entity.reg || k.attributes.imo === entity.reg));
  }
  const kycForm = kycRequest || {
    id: `KYC-${entity.id.toUpperCase()}`,
    counterparty_name: entity.name,
    entity_type: entity.kind === 'vessel' ? 'Vessel' : entity.kind === 'person' ? 'Person' : 'Organisation',
    country: entity.a3 || entity.flag || 'SGP',
    relationship_type: entity.role || 'Vendor/Supplier',
    contract_value: (entity.request && entity.request.contract_value) || 250000,
    attributes: {
      reg_no: entity.reg || '',
      imo: entity.imo || '',
      directors_ubo: (entity.factors && entity.factors.map(f => f[1]).join('; ')) || entity.controllers || '',
      vessel_flag: entity.flag || '',
      vessel_type: entity.type || ''
    },
    location: { address: `${entity.city || ''}, ${entity.a3 || ''}` },
    remarks: entity.summary || ''
  };

  // 2. Run Orchestrator Sanctions screening of KYC form against regulatory PDF document
  const orchestrator = require('../agents/orchestrator');
  let orchAssessment = null;
  try {
    orchAssessment = await orchestrator.screenKycAgainstSanctions(kycForm);
    emit({
      type: 'orchestrator_assessment',
      assessment: orchAssessment
    });
  } catch (orchErr) {
    console.error('[Pond-Guard] Orchestrator screening failed:', orchErr.message);
  }
  if (!m.live) return offlineRun(db, entity, evidence.kinds, emit, m.reason, m.kind, orchAssessment);
  if (!takeDailyBudget(db, 'pond_guard', config.pondGuardDailyCap)) return offlineRun(db, entity, evidence.kinds, emit, 'Daily limit reached.', 'limit', orchAssessment);

  const policy = await policyFor(db, rules, evidence.kinds);
  for (const agent of evidence.kinds) evidence.briefs[agent].policy = policy[agent];
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
        const vetted = event.ok ? vetAgentFindings(db, event.agent, event, evidence, { idPrefix, promptVersion: meta.prompt_version, subject: entity, policy, rules }) : [];
        raw.push(...vetted);
        ran[event.agent] = { ok: Boolean(event.ok), sources: [...new Set((evidence.briefs[event.agent].evidence || []).map(e => e.source_name))], grounded: (event.grounded_sources || []).length };
        const rules2 = rules.rowById;
        return emit({
          type: 'agent_done', agent: event.agent, label: AGENTS[event.agent].label, ok: Boolean(event.ok), error: event.error || '', note: event.note || '',
          policy: (policy[event.agent] || []).map(c => ({ id: c.id, title: c.title })),
          findings: vetted.map(v => ({ id: v.id, category: v._reason ? '' : v.category, short: v._reason ? 'Not counted' : (rules2[v.category] || {}).short, summary: v.summary, quote: v.evidence_quote, sourceName: v.source_name, sourceUrl: v.source_url, accepted: !v._reason, reason: v._reason || '', policyClause: v.policy_clause, policyQuote: v.policy_quote, policyNote: v.policy_note, suggestedAction: v._reason ? '' : v.suggested_action }))
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
  // An agent that did not answer has not screened anything. Dropping what it found last time would lower the
  // score for no reason, so its earlier findings stay with the case and its check is marked as not run this time.
  // With fewer than half the agents answering there is no screening to speak of: nothing is changed.
  const silentIds = evidence.kinds.filter(k => !ran[k] || !ran[k].ok);
  const silent = silentIds.map(k => AGENTS[k].label);
  if (silentIds.length > evidence.kinds.length / 2) {
    emit({ type: 'error', message: `${silent.join(' and ')} did not answer, so the stored findings are kept.` });
    return offlineRun(db, entity, evidence.kinds, emit, `Too few agents answered (${silent.join(', ')} did not). Nothing was changed.`);
  }
  if (silent.length) emit({ type: 'error', message: `${silent.join(' and ')} did not answer in time. ${silent.length === 1 ? 'Its' : 'Their'} earlier findings are kept and the check is marked as not run.` });

  // Store what was read (accepted and rejected), record which checks ran, and score
  const readAt = new Date().toISOString();
  for (const f of raw) if (meta.prompt_version && f.prompt_version === 'unknown') f.prompt_version = meta.prompt_version;
  const have = new Set(raw.filter(f => !f._reason).map(f => f.category));
  const backstop = ruleFindings(db, rules, entity, have, { idPrefix, readAt });
  for (const f of backstop.findings) f.summary += ' (Added by the rule check: the agent did not report it.)';
  // Facts that no screening agent owns (what a returned questionnaire showed) stay with the case
  const owned = new Set(Object.entries(AGENTS).filter(([id]) => !silentIds.includes(id)).flatMap(([, a]) => a.categories));
  const kept = db.getFindingRecords(entityId).filter(r => r.status === 'accepted' && !owned.has(r.finding.category) && !have.has(r.finding.category)).map(r => r.finding);
  riskService.recordFindings(db, entityId, [...raw, ...backstop.findings, ...kept], { replace: true });
  const checks = { _kind: entity.kind };
  for (const [agent, r] of Object.entries(ran)) {
    if (!r.ok) continue;
    const source = agent === 'adverse_media' ? 'Google Search (Grounding with Google Search)' : r.sources[0] || BUILT_IN_LISTS;
    checks[AGENTS[agent].check] = { ran: true, source_name: source, source_url: agent === 'adverse_media' ? 'https://www.google.com/search?q=' + encodeURIComponent(`"${entity.name}"`) : riskService.sourceLink(source), read_at: readAt, result: `${raw.filter(f => !f._reason && AGENTS[agent].categories.includes(f.category)).length} finding(s)` };
  }
  for (const agent of silentIds) checks[AGENTS[agent].check] = { ran: false, result: 'The agent did not answer in time in this run. Earlier findings, if any, are kept.' };
  // The country check ran only if a country on file is in the CPI data, whatever the agent said
  checks.country = backstop.countryCheck;
  db.setRiskChecks(entityId, checks);
  const scored = riskService.rescoreEntity(db, entityId);
  const breakdown = riskService.assessEntity(db, entityId);
  const hasRecord = Boolean(db.getEntityById(entityId));
  if (hasRecord) db.addAlert('Pond-Guard', entityId, `${entity.name} screened by Pond-Guard: ${breakdown.risk} of ${breakdown.cap}, ${breakdown.routeLabel}`, breakdown.route);
  require('../events/bus').publish('screening-completed', { entityId, risk: breakdown.risk, confidence: breakdown.confidence, route: breakdown.route, offline: false, modelId: meta.model_id || '' });
  emit({ type: 'scored', offline: false, breakdown, before: scored ? scored.before : null, modelId: meta.model_id || '' });

  // Dilly, the orchestrator: a summary and next steps for what has just been checked and scored
  emit({ type: 'dilly_started', label: 'Dilly' });
  const accepted = raw.filter(f => !f._reason).concat(backstop.findings);
  const dilly = await askDilly(db, entity, breakdown, accepted, policy, rules);
  const suggestion = db.addSuggestion(suggestionOf(idPrefix, entityId, breakdown, rules, {
    kycId, entityKey, mode: 'live',
    detail: { findingIds: accepted.map(f => f.id), dilly, orchestrator: orchAssessment, modelId: meta.model_id || '', promptVersion: meta.prompt_version || '' }
  }));
  emit({ type: 'dilly', dilly, suggestion: latestSuggestion(db, entityId) });
  return { live: true, kind: 'live', reason: '', breakdown, suggestion, orchestrator: orchAssessment };
}

function status(db) {
  const m = mode(db);
  return { mode: m.live ? 'live' : 'offline', kind: m.kind, reason: m.reason, dailyCap: config.pondGuardDailyCap, left: dailyBudgetLeft(db, 'pond_guard', config.pondGuardDailyCap), agents: Object.entries(AGENTS).map(([id, a]) => ({ id, label: a.label })) };
}

module.exports = { screenEntity, gatherEvidence, vetAgentFindings, vetPolicy, vetDilly, ruleFindings, policyFor, latestSuggestion, suggestionOf, trustFor, status, mode, countryPlaces, kindsFor, AGENTS };
