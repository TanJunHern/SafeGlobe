/**
 * Pond-Guard strengthened, offline: screening at the first instance (a new KYC request), reuse within 24 hours,
 * the daily limit and the offline label, the run inside a request on Cloud Run, policy clauses and their checks,
 * the Country and contract agent's number checks, Dilly the orchestrator, the stored suggestion, and how near
 * the suggestion was to the officer's final decision. No model and no website is called: the agents are stand-ins.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { getDb } = require('../src/db');
const bus = require('../src/events/bus');
const handlers = require('../src/events/handlers');
const kyc = require('../src/services/kycService');
const pondGuard = require('../src/services/pondGuardService');
const agentsClient = require('../src/services/agentsClient');
const riskService = require('../src/risk/riskService');
const { getRules } = require('../src/risk/rulesStore');
const policySearch = require('../src/services/policySearch');
const agreement = require('../src/learning/agreement');
const bq = require('../src/services/bigquery');
const { startServer, stopServer } = require('../src/server');

const PORT = 8098;
const BASE = `http://localhost:${PORT}`;
const OFFICER = { 'x-user-email': 'compliance@duedilly.com', 'Content-Type': 'application/json' };
const EMPLOYEE = { 'x-user-email': 'john.doe@duedilly.com', 'Content-Type': 'application/json' };
const withStub = async (object, patch, fn) => {
  const before = Object.fromEntries(Object.keys(patch).map(k => [k, object[k]]));
  Object.assign(object, patch);
  try { return await fn(); } finally { Object.assign(object, before); }
};
const withConfig = (patch, fn) => withStub(config, patch, fn);

// Stand-in sub-agents. Each reads its brief and cites the evidence it was given, with the first policy clause it
// was given. The country and contract agent claims every row for every item, so the checks in the app are what decide.
const quoteOf = item => item.text.slice(0, 90);
function findingsFor(agent, brief) {
  const clause = brief.policy[0];
  const cite = (item, category, extra = {}) => Object.assign({
    category, subject: 'the counterparty', summary: `Reported by the ${agent} stand-in.`, evidence_quote: quoteOf(item), evidence_ref: item.ref, match_basis: 'not_name',
    policy_clause: clause ? clause.id : '', policy_quote: clause ? clause.text.slice(0, 60) : '', suggested_action: 'Ask the counterparty for the record behind this.'
  }, extra);
  const out = [];
  for (const item of brief.evidence) {
    if (agent === 'vessel_behaviour') {
      if (/AIS dark/i.test(item.text)) out.push(cite(item, 'vessel_ais_dark'));
      else if (/ship-to-ship|\bSTS\b/i.test(item.text)) out.push(cite(item, 'vessel_sts_transfer'));
      else if (/Flag history/i.test(item.text)) out.push(cite(item, 'vessel_flag_changes'));
    } else if (agent === 'ownership' && /nominee/i.test(item.text)) out.push(cite(item, 'ownership_unclear'));
    else if (agent === 'country_contract') {
      if (/Corruption Perceptions/.test(item.text)) out.push(cite(item, 'country_cpi_low'));
      if (/contract value/.test(item.text)) out.push(cite(item, 'contract_value_high'));
      if (/Relationship type|Role on file/.test(item.text)) out.push(cite(item, 'broker_intermediary'));
    }
  }
  // One of each category at most, as the real agents are told
  return out.filter((f, i) => out.findIndex(x => x.category === f.category) === i);
}
const dillyAnswer = payload => ({
  summary: `${payload.findings.length} findings were checked for ${payload.subject.name}.`,
  next_steps: payload.findings.slice(0, 2).map(f => ({ action: `Follow up on ${f.rule}.`, finding_ids: [f.id], policy_clauses: f.policy_clause ? [f.policy_clause] : [] })),
  note_reason: 'none', note: '', model_id: 'test-model'
});
function standIn({ find = findingsFor, dilly = dillyAnswer } = {}) {
  const calls = { screen: [], dilly: [] };
  return {
    calls,
    stub: {
      configured: () => true,
      screen: async (payload, onEvent) => {
        calls.screen.push(payload);
        for (const agent of Object.keys(payload.briefs)) await onEvent({ type: 'agent_started', agent });
        for (const [agent, brief] of Object.entries(payload.briefs)) await onEvent({ type: 'agent_done', agent, ok: true, model_id: 'test-model', note: '', findings: find(agent, brief), grounded_sources: [] });
        await onEvent({ type: 'done', prompt_version: 'test-v', model_id: 'test-model' });
      },
      dilly: async payload => { calls.dilly.push(payload); return dilly(payload); }
    }
  };
}
let serial = 0;
const vesselRequest = (over = {}) => Object.assign({
  counterparty_name: 'Aurora Venture', entity_type: 'Vessel', country: 'CMR', relationship_type: 'Customer/Trading Partner', contract_value: 420000,
  attributes: { imo: '9304124', vessel_type: 'Crude oil tanker' }, counterparty_email: 'ops@example.com'
}, over);
const orgRequest = (over = {}) => Object.assign({
  counterparty_name: `Quiet Harbour Supplies ${++serial} Pte Ltd`, entity_type: 'Organisation', country: 'SGP', relationship_type: 'Vendor/Supplier', contract_value: 20000,
  attributes: { reg_no: `2026${String(10000 + serial)}K` }
}, over);
const entityIdOf = request => `kyc-${request.id.toLowerCase()}`;
const noBudgetUsed = db => db.setSetting('daily_budget_pond_guard', null);

test.before(() => { handlers.register(); });

test('first instance: a new request is screened by Pond-Guard in the background, once, and the result is written back', async () => {
  const db = getDb();
  noBudgetUsed(db);
  const agents = standIn();
  await withStub(agentsClient, agents.stub, async () => {
    const created = kyc.createKycRequest(vesselRequest(), { email: 'john.doe@duedilly.com' });
    const first = { score: created.ai_score, result: created.ai_result };
    const state = kyc.requestScreening(db, created);
    assert.equal(state.status, 'screening');
    assert.equal(db.getKycRequestById(created.id).pond_guard.status, 'screening');
    // The rule-based result is the suggestion on record until the agents answer
    assert.equal(db.getLatestSuggestion(entityIdOf(created)).mode, 'rules');
    assert.equal(db.getLatestSuggestion(entityIdOf(created)).risk, first.score);

    await bus.drain();
    assert.equal(agents.calls.screen.length, 1);
    const after = db.getKycRequestById(created.id);
    assert.equal(after.pond_guard.status, 'done');
    assert.equal(after.pond_guard.knownAs.id, 'aurora', 'the request names a vessel already on the watchlist, by its IMO number');

    // Every counterparty gets five agents; a vessel gets the sixth
    assert.deepEqual(Object.keys(agents.calls.screen[0].briefs), ['sanctions', 'pep', 'adverse_media', 'ownership', 'country_contract', 'vessel_behaviour']);
    // The watchlist record's evidence was read for the request
    assert.ok(agents.calls.screen[0].briefs.vessel_behaviour.evidence.some(e => /AIS dark for 31 h/.test(e.text)));

    const b = riskService.assessEntity(db, entityIdOf(created));
    assert.equal(after.ai_score, b.risk);
    assert.equal(after.ai_confidence, b.confidence);
    assert.match(after.ai_result, /Risk \(Confidence \d+%\)/);
    const counted = b.lines.map(l => l.category).sort();
    for (const row of ['vessel_ais_dark', 'vessel_sts_transfer', 'ownership_unclear', 'country_cpi_low', 'contract_value_high']) assert.ok(counted.includes(row), row);
    assert.ok(b.lines.every(l => /^Pond-Guard/.test(l.agent)));

    const s = db.getLatestSuggestion(entityIdOf(created));
    assert.equal(s.mode, 'live');
    assert.equal(s.risk, b.risk);
    assert.equal(s.route, b.route);
    assert.equal(s.kycId, created.id);
    assert.equal(s.detail.dilly.label, 'AI suggestion');

    // A redelivered event, or a second caller, does not screen again
    await kyc.screenRequest(db, created.id);
    assert.equal(agents.calls.screen.length, 2, 'an explicit call runs; the event itself is handled once (events_seen)');
  });
});

test('first instance: the same counterparty within 24 hours reuses the result and makes no run', async () => {
  const db = getDb();
  noBudgetUsed(db);
  const agents = standIn();
  await withStub(agentsClient, agents.stub, async () => {
    const a = kyc.createKycRequest(vesselRequest({ counterparty_name: 'MV Reuse Test', attributes: { imo: '9555001' }, contract_value: 500000 }), {});
    kyc.requestScreening(db, a);
    await bus.drain();
    assert.equal(agents.calls.screen.length, 1);

    // Same IMO number, another request, a small contract this time
    const b = kyc.createKycRequest(vesselRequest({ counterparty_name: 'M/V REUSE TEST', attributes: { imo: '9555001' }, contract_value: 5000 }), {});
    assert.equal(kyc.entityKeyFor(a), kyc.entityKeyFor(b));
    kyc.requestScreening(db, b);
    await bus.drain();
    assert.equal(agents.calls.screen.length, 1, 'no second run');
    const after = db.getKycRequestById(b.id);
    assert.equal(after.pond_guard.status, 'reused');
    assert.match(after.pond_guard.message, /^Reused from the screening at \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    assert.equal(db.getLatestSuggestion(entityIdOf(b)).mode, 'reused');
    const first = riskService.assessEntity(db, entityIdOf(a)).lines.map(l => l.category);
    const second = riskService.assessEntity(db, entityIdOf(b)).lines.map(l => l.category);
    // The findings are the first screening's; the contract value is this request's own
    assert.ok(first.includes('contract_value_high'));
    assert.equal(second.includes('contract_value_high'), false);
    assert.deepEqual(second.sort(), first.filter(c => c !== 'contract_value_high').sort());

    // An officer who presses Screen gets a fresh run
    await kyc.screenRequest(db, b.id, { force: true });
    assert.equal(agents.calls.screen.length, 2);
    assert.equal(db.getKycRequestById(b.id).pond_guard.status, 'done');

    // No identifier on the request: the name and the country are the key
    const k1 = kyc.entityKeyFor({ counterparty_name: 'Blue  Heron Ltd.', country: 'sgp', attributes: {} });
    assert.equal(k1, kyc.entityKeyFor({ counterparty_name: 'blue heron ltd', country: 'SGP', attributes: {} }));
    assert.notEqual(k1, kyc.entityKeyFor({ counterparty_name: 'blue heron ltd', country: 'MYS', attributes: {} }));
  });
});

test('first instance: over the daily limit, or with no agents, the rule-based result stays and says why', async () => {
  const db = getDb();
  const agents = standIn();
  // 1. The limit: no run, the message, and the runs left for officers
  await withStub(agentsClient, agents.stub, () => withConfig({ pondGuardDailyCap: 2 }, async () => {
    db.setSetting('daily_budget_pond_guard', { day: new Date().toISOString().slice(0, 10), used: 2 });
    const r = kyc.createKycRequest(orgRequest(), {});
    const state = kyc.requestScreening(db, r);
    assert.equal(state.status, 'limit');
    assert.equal(state.message, 'Pond-Guard daily limit reached, press Screen tomorrow');
    await bus.drain();
    assert.equal(agents.calls.screen.length, 0);
    const after = db.getKycRequestById(r.id);
    assert.equal(after.ai_score, r.ai_score);
    assert.equal(after.ai_result, r.ai_result);
    assert.equal(pondGuard.status(db).left, 0);
    assert.equal(pondGuard.status(db).dailyCap, 2);
  }));
  noBudgetUsed(db);
  // 2. No agents service: Offline
  const r = kyc.createKycRequest(orgRequest(), {});
  const state = kyc.requestScreening(db, r);
  assert.equal(state.status, 'offline');
  assert.equal(state.message, 'Offline');
  assert.equal(db.getKycRequestById(r.id).ai_score, r.ai_score);
  // 3. The run breaks half way: the first result stays, labelled Offline
  const broken = { configured: () => true, screen: async () => { throw new Error('connection dropped'); }, dilly: async () => ({}) };
  await withStub(agentsClient, broken, async () => {
    const x = kyc.createKycRequest(orgRequest(), {});
    kyc.requestScreening(db, x);
    await bus.drain();
    const after = db.getKycRequestById(x.id);
    assert.equal(after.pond_guard.status, 'offline');
    assert.equal(after.ai_score, x.ai_score);
  });
});

test('first instance: a request the first rules had cleared goes to a person when the agents find risk', async () => {
  const db = getDb();
  noBudgetUsed(db);
  // The stand-in sanctions agent reports a possible match from a source record the app holds
  const name = `Northgate Meridian Trading ${++serial}`;
  db.addSourceRecord({ id: `rec_pg_${serial}`, source_id: 's_pg', source_label: 'UK sanctions list', source_type: 'list', entity_name: name, entity_kind: 'org', jurisdiction: 'SGP', reg_no: '', risk_level: 'High', risk_score: 90, summary: `${name} is designated under the sanctions list.`, details_json: '{}', raw_content: 'Designated party.' });
  const agents = standIn({ find: (agent, brief) => (agent === 'sanctions' && brief.evidence[0] ? [{ category: 'sanctions_possible', subject: name, summary: 'A list entry carries this name.', evidence_quote: quoteOf(brief.evidence[0]), evidence_ref: brief.evidence[0].ref, match_basis: 'strong_name', policy_clause: '§1.1', policy_quote: 'A name-only match with strong similarity is a possible match', suggested_action: 'Compare a second identifier.' }] : []) });
  await withStub(agentsClient, agents.stub, async () => {
    const r = kyc.createKycRequest(orgRequest({ counterparty_name: name, request_status: 'Approved' }), {});
    assert.equal(r.request_status, 'Approved');
    kyc.requestScreening(db, r);
    await bus.drain();
    const after = db.getKycRequestById(r.id);
    assert.equal(after.pond_guard.status, 'done');
    assert.ok(after.ai_score >= getRules(db).routes.riskLine === false || after.request_status === 'Under Review');
    assert.equal(after.screening_result, 'Sanctions Alert');
    assert.notEqual(after.request_status, 'Rejected', 'Pond-Guard never rejects');
    const line = riskService.assessEntity(db, entityIdOf(r)).lines.find(l => l.category === 'sanctions_possible');
    assert.equal(line.policyClause, '§1.1');
    assert.match(line.policyQuote, /strong similarity/);
    assert.equal(line.suggestedAction, 'Compare a second identifier.');
  });
});

test('offline: a counterparty with no scored findings yet is shown without a score, and nothing is stored', async () => {
  const db = getDb();
  const events = [];
  const before = db.getLatestSuggestion('aurora');
  const result = await withConfig({ agentsServiceUrl: '' }, () =>
    withStub(riskService, { assessEntity: () => null }, () => pondGuard.screenEntity(db, 'aurora', e => events.push(e))));
  assert.equal(result.live, false);
  assert.equal(result.breakdown, null);
  const scored = events.find(e => e.type === 'scored');
  assert.ok(scored, 'the run still finishes');
  assert.equal(scored.breakdown, null);
  assert.deepEqual(db.getLatestSuggestion('aurora'), before, 'no suggestion is stored without a score');
});

test('policy: three demo clauses exist, each agent is given its own, and a citation is checked against the clause', async () => {
  const db = getDb();
  const rules = getRules(db);
  const clauses = policySearch.localClauses();
  for (const id of ['§1.1', '§1.2', '§1.3']) assert.match(clauses.find(c => c.id === id).title, /demo clause/);
  // The clause wording matches the points rows
  assert.match(clauses.find(c => c.id === '§1.1').text, /name-only match with strong similarity is a possible match/);
  assert.match(clauses.find(c => c.id === '§1.2').text, /fraud, bribery or sanctions evasion/);
  assert.match(clauses.find(c => c.id === '§1.3').text, /Nominee shareholders, bearer shares, an offshore holding company, or an unknown beneficial owner/);
  for (const [row, clause] of [['sanctions_confirmed', '§1.1'], ['sanctions_possible', '§1.1'], ['adverse_media_severe', '§1.2'], ['adverse_media_other', '§1.2'], ['ownership_unclear', '§1.3']]) assert.equal(rules.rowById[row].policy, clause);

  const policy = await pondGuard.policyFor(db, rules, pondGuard.kindsFor({ kind: 'vessel' }));
  assert.deepEqual(Object.fromEntries(Object.entries(policy).map(([agent, list]) => [agent, list.map(c => c.id)])), {
    sanctions: ['§1.1'], pep: ['§3.6'], adverse_media: ['§1.2'], ownership: ['§1.3'], country_contract: ['§4.1', '§2.1', '§5.2'], vessel_behaviour: ['§5.4']
  });
  assert.equal(pondGuard.kindsFor({ kind: 'org' }).length, 5);
  assert.equal(pondGuard.kindsFor({ kind: 'person' }).includes('vessel_behaviour'), false);

  const given = policy.ownership;
  const good = pondGuard.vetPolicy({ policy_clause: 'Clause 1.3', policy_quote: 'an offshore  holding company', suggested_action: '  Ask for the register of members.  ' }, given);
  assert.deepEqual([good.policy_clause, good.policy_quote, good.suggested_action, good.policy_note], ['§1.3', 'an offshore  holding company', 'Ask for the register of members.', '']);
  const madeUp = pondGuard.vetPolicy({ policy_clause: '§1.3', policy_quote: 'ownership must be notarised in triplicate' }, given);
  assert.equal(madeUp.policy_clause, '§1.3');
  assert.equal(madeUp.policy_quote, '');
  assert.match(madeUp.policy_note, /not in the clause word for word/);
  const notGiven = pondGuard.vetPolicy({ policy_clause: '§5.4', policy_quote: 'AIS telemetry dark periods' }, given);
  assert.equal(notGiven.policy_clause, '');
  assert.match(notGiven.policy_note, /was not given/);
  assert.match(pondGuard.vetPolicy({ policy_clause: '' }, given).policy_note, /cited no policy clause/);
  assert.match(pondGuard.vetPolicy({ policy_clause: '§1.3' }, []).policy_note, /no clause for this/);
});

test('Country and contract: the agent reads the figures, the app checks them, and the riskiest country counts once', () => {
  const db = getDb();
  const rules = getRules(db);
  const subject = { id: 'kyc-test', kind: 'org', name: 'Two Country Co', a3: 'SGP', nationality: 'Cameroon', request: { id: 'K', contract_value: 90000, relationship_type: '3rd Party Reps & Brokers', country: 'SGP' } };
  const evidence = pondGuard.gatherEvidence(db, subject, rules);
  const items = evidence.briefs.country_contract.evidence;
  const sgp = items.find(e => /Singapore/.test(e.text));
  const cmr = items.find(e => /Cameroon/.test(e.text));
  const contract = items.find(e => /contract value/.test(e.text));
  const relation = items.find(e => /Relationship type/.test(e.text));
  assert.match(cmr.text, /score 26\/100/);
  assert.equal(cmr.source_name, 'Transparency International CPI 2025');
  assert.equal(contract.source_name, 'KYC intake form');
  assert.deepEqual(evidence.briefs.country_contract.categories.map(c => c.id), ['country_cpi_low', 'country_cpi_mid', 'contract_value_high', 'broker_intermediary']);
  assert.match(evidence.briefs.country_contract.categories[2].label, /above SGD 100,000/);

  const f = (item, category) => ({ category, subject: 'Two Country Co', summary: 's', evidence_quote: item.text.slice(0, 60), evidence_ref: item.ref, match_basis: 'strong_name' });
  const vet = list => pondGuard.vetAgentFindings(db, 'country_contract', { findings: list, model_id: 'm' }, evidence, { idPrefix: 'T', promptVersion: 'v', rules });
  const [low, safe, small, broker, mid] = vet([f(cmr, 'country_cpi_low'), f(sgp, 'country_cpi_low'), f(contract, 'contract_value_high'), f(relation, 'broker_intermediary'), f(cmr, 'country_cpi_mid')]);
  assert.equal(low._reason, undefined);
  assert.equal(low.source_url, 'https://www.transparency.org/en/cpi/2025');
  assert.equal(low.match_basis, 'not_name');
  assert.match(safe._reason, /does not meet this rule/);       // Singapore's score is not below the line
  assert.match(small._reason, /does not meet this rule/);      // SGD 90,000 is not above SGD 100,000
  assert.equal(broker._reason, undefined);
  assert.match(broker.source_url, /^\/risk\/source\?name=KYC/);
  assert.match(mid._reason, /does not meet this rule/);        // 26 is in the low band, not the middle one

  // A less risky country cannot stand in for the riskiest one
  const two = { id: 'kyc-test2', kind: 'org', name: 'Two Low Co', a3: 'NGA', nationality: 'Russia', request: null };
  const ev2 = pondGuard.gatherEvidence(db, two, rules);
  const nga = ev2.briefs.country_contract.evidence.find(e => /Nigeria/.test(e.text));
  const [notWorst] = pondGuard.vetAgentFindings(db, 'country_contract', { findings: [f(nga, 'country_cpi_low')], model_id: 'm' }, ev2, { idPrefix: 'T', promptVersion: 'v', rules });
  assert.match(notWorst._reason, /riskier country is on file/);

  // The rule check behind the agent: a row the agent did not report is not lost, and says where it came from
  const missed = pondGuard.ruleFindings(db, rules, subject, new Set(), { idPrefix: 'T', readAt: new Date().toISOString() });
  assert.deepEqual(missed.findings.map(x => x.category).sort(), ['broker_intermediary', 'country_cpi_low']);
  assert.ok(missed.findings.every(x => /rule check/.test(x.agent)));
  assert.deepEqual(pondGuard.ruleFindings(db, rules, subject, new Set(['country_cpi_low', 'broker_intermediary']), { idPrefix: 'T', readAt: new Date().toISOString() }).findings, []);
});

test('Dilly: next steps must rest on a finding or a clause of this run, the note has two allowed reasons, and no answer can move the score', async () => {
  const ctx = { findingIds: new Set(['F1', 'F2']), clauseIds: new Set(['§5.4', '§1.3']), checksNotRun: 0 };
  const out = pondGuard.vetDilly({
    summary: '  Two findings carry the points.  ',
    next_steps: [
      { action: 'Ask the ship manager for the voyage records.', finding_ids: ['F1', 'F9'], policy_clauses: ['Clause 5.4', '§9.9'] },
      { action: 'Approve the request.', finding_ids: [], policy_clauses: [] },
      { action: 'Check the owner register.', finding_ids: ['F404'], policy_clauses: ['§1.3'] },
      { action: '', finding_ids: ['F2'] }
    ],
    note_reason: 'check_not_run', note: 'The PEP check did not run.',
    risk: 5, route: 'auto_clear', level: 'Low'
  }, ctx);
  assert.equal(out.label, 'AI suggestion');
  assert.equal(out.summary, 'Two findings carry the points.');
  assert.deepEqual(out.nextSteps, [
    { action: 'Ask the ship manager for the voyage records.', findingIds: ['F1'], policyClauses: ['§5.4'] },
    { action: 'Check the owner register.', findingIds: [], policyClauses: ['§1.3'] }
  ]);
  assert.equal(out.droppedSteps, 2);
  // "A check did not run" is only accepted when one really did not
  assert.equal(out.note, '');
  assert.equal(pondGuard.vetDilly({ summary: 's', note_reason: 'check_not_run', note: 'The PEP check did not run.' }, Object.assign({}, ctx, { checksNotRun: 1 })).note, 'The PEP check did not run.');
  assert.equal(pondGuard.vetDilly({ summary: 's', note_reason: 'agents_disagree', note: 'Ownership and PEP point different ways.' }, ctx).noteReason, 'agents_disagree');
  assert.equal(pondGuard.vetDilly({ summary: 's', note_reason: 'none', note: 'Looks fine to me.' }, ctx).note, '');
  // Nothing in a checked answer is a number or a route
  assert.deepEqual(Object.keys(out).sort(), ['droppedSteps', 'label', 'nextSteps', 'note', 'noteReason', 'summary']);
  assert.equal(pondGuard.vetDilly({ next_steps: Array.from({ length: 9 }, () => ({ action: 'Step.', finding_ids: ['F1'] })) }, ctx).nextSteps.length, 6);

  // End to end: Dilly answers with another score and route; the request keeps the computed ones
  const db = getDb();
  noBudgetUsed(db);
  const agents = standIn({ dilly: payload => Object.assign(dillyAnswer(payload), { risk: 0, route: 'auto_clear', level: 'Low', note_reason: 'none', note: 'Nothing to see.' }) });
  await withStub(agentsClient, agents.stub, async () => {
    const r = kyc.createKycRequest(vesselRequest({ counterparty_name: 'MV Dilly Test', attributes: { imo: '9555002' } }), {});
    const events = [];
    const result = await pondGuard.screenEntity(db, entityIdOf(r), e => events.push(e), { subject: kyc.subjectForRequest(db, r), kycId: r.id, entityKey: kyc.entityKeyFor(r) });
    const b = riskService.assessEntity(db, entityIdOf(r));
    assert.ok(b.risk > 0);
    assert.equal(result.suggestion.risk, b.risk);
    assert.equal(result.suggestion.route, b.route);
    assert.equal(result.suggestion.detail.dilly.note, '');
    // What Dilly was given: checked findings with the points from the table, the computed result, the checks, the clauses
    const given = agents.calls.dilly[0];
    assert.equal(given.risk, b.risk);
    assert.equal(given.route, b.routeLabel);
    assert.ok(given.findings.every(f => typeof f.points === 'number' && f.id));
    assert.ok(given.clauses.some(c => c.id === '§4.1'));
    // The drawer's order: the agents, the score, then Dilly
    const order = events.map(e => e.type);
    assert.ok(order.indexOf('scored') < order.indexOf('dilly_started') && order.indexOf('dilly_started') < order.indexOf('dilly'));
    assert.equal(events.find(e => e.type === 'dilly').dilly.label, 'AI suggestion');
  });
  // Dilly fails: the findings, the score and the route stand without it
  const silent = standIn({ dilly: () => { throw new Error('model overloaded'); } });
  await withStub(agentsClient, silent.stub, async () => {
    const r = kyc.createKycRequest(vesselRequest({ counterparty_name: 'MV Dilly Silent', attributes: { imo: '9555003' } }), {});
    const result = await pondGuard.screenEntity(db, entityIdOf(r), () => {}, { subject: kyc.subjectForRequest(db, r), kycId: r.id });
    assert.equal(result.live, true);
    assert.equal(result.suggestion.detail.dilly.ok, false);
    assert.equal(result.suggestion.risk, riskService.assessEntity(db, entityIdOf(r)).risk);
  });
});

test('nearness: agreed, stricter, more lenient and waiting, judged by one SQL statement', async () => {
  const db = getDb();
  const line = getRules(db).routes.riskLine;
  assert.equal(line, 50);
  const outcome = (kycId, risk, decision, isFinal = true) => db.saveOutcome({ kycId, entityId: `kyc-${kycId}`, counterpartyName: kycId, suggestionMode: 'live', suggestedRisk: risk, suggestedRoute: 'x', suggestedAt: new Date().toISOString(), riskLine: line, decision, isFinal, decidedBy: 'T', decidedAt: new Date().toISOString(), isDemo: true });
  outcome('NEAR-1', 85, 'Rejected');
  outcome('NEAR-2', 50, 'Rejected');   // exactly on the line counts as "50 or more"
  outcome('NEAR-3', 20, 'Approved');
  outcome('NEAR-4', 75, 'Approved');
  outcome('NEAR-5', 49, 'Rejected');
  outcome('NEAR-6', 90, 'Pending DDQ', false);
  const judged = agreement.local(db);
  const result = id => judged.cases.find(c => c.kyc_id === id).result;
  assert.deepEqual(['NEAR-1', 'NEAR-2', 'NEAR-3', 'NEAR-4', 'NEAR-5', 'NEAR-6'].map(result), ['agreed', 'agreed', 'agreed', 'dilly_stricter', 'dilly_more_lenient', 'waiting']);
  assert.equal(judged.via, 'Offline (SQLite)');
  const mine = judged.cases.filter(c => c.kyc_id.startsWith('NEAR-'));
  assert.equal(mine.filter(c => c.result === 'waiting').length, 1);
  assert.ok(judged.disagreements.some(c => c.kyc_id === 'NEAR-4' && c.resultLabel === 'Dilly was stricter'));
  assert.ok(judged.disagreements.some(c => c.kyc_id === 'NEAR-5' && c.resultLabel === 'Dilly was more lenient'));
  assert.equal(agreement.summarise([{ result: 'agreed' }, { result: 'agreed' }, { result: 'dilly_stricter' }, { result: 'waiting' }].map(r => Object.assign({ risk_line: 50, is_final: 1 }, r)), 'x').agreementRate, 67);
  assert.equal(agreement.summarise([], 'x').agreementRate, null);

  // BigQuery: the same statement is the view, and the app only uploads rows and reads the view
  assert.ok(agreement.viewSql().includes(agreement.AGREEMENT_SQL('').split('FROM')[0].trim()));
  assert.match(agreement.viewSql(), /^CREATE OR REPLACE VIEW `[^`]*dilly_agreement` AS/);
  const sent = [];
  const fake = { live: () => true, query: async (sql, opts = {}) => { sent.push({ sql, opts }); return /^SELECT \* FROM/.test(sql) ? { rows: judged.cases.map(c => Object.assign({}, c, { suggested_risk: String(c.suggested_risk), risk_line: String(c.risk_line), is_final: c.is_final ? '1' : '0' })), bytesProcessed: 1200 } : { rows: [], bytesProcessed: 300 }; } };
  const viaBq = await withStub(bq, fake, () => agreement.judgeInBigQuery(db));
  assert.match(viaBq.via, /^BigQuery/);
  assert.equal(sent.length, 3);
  assert.match(sent[0].sql, /^CREATE OR REPLACE TABLE/);
  assert.equal(JSON.parse(sent[0].opts.params.rows).length, db.getOutcomeRows().length);
  assert.match(sent[1].sql, /CREATE OR REPLACE VIEW/);
  assert.deepEqual([viaBq.agreed, viaBq.stricter, viaBq.lenient, viaBq.waiting], [judged.agreed, judged.stricter, judged.lenient, judged.waiting], 'both engines give the same answer on the same rows');
  assert.equal(viaBq.bytesProcessed, 1500);
  // BigQuery down: the same rule runs inside the app, and says so
  const down = await withStub(bq, { live: () => true, query: async () => { throw new Error('BigQuery answered 403'); } }, () => agreement.judgeInBigQuery(db));
  assert.equal(down.via, 'Offline (SQLite)');
  assert.match(down.reason, /could not be reached/);
  assert.match((await agreement.judgeInBigQuery(db)).reason, /not connected/);
});

test('over HTTP: the screening state, the run inside a request on Cloud Run, decisions and the agreement panel', async t => {
  await startServer(PORT);
  t.after(async () => { await bus.drain(); await stopServer(); });
  const db = getDb();
  noBudgetUsed(db);
  const call = (who, path, method = 'GET', body) => fetch(BASE + path, { method, headers: who, body: body ? JSON.stringify(body) : undefined });
  const agents = standIn();

  await withStub(agentsClient, agents.stub, () => withConfig({ isCloudRun: true }, async () => {
    // On Cloud Run with events handled inside the app, nothing is started after the answer
    const res = await call(EMPLOYEE, '/api/kyc/submit', 'POST', orgRequest({ country: 'NGA', contract_value: 250000 }));
    assert.equal(res.status, 201);
    const created = (await res.json()).request;
    assert.equal(created.pond_guard.status, 'screening');
    assert.equal(created.pond_guard.via, 'page');
    await bus.drain();
    assert.equal(agents.calls.screen.length, 0);
    assert.equal((await (await call(EMPLOYEE, `/api/kyc/${created.id}/pond-guard`)).json()).state.status, 'screening');

    // The page asks for it: the run happens inside that request
    const now = await (await call(EMPLOYEE, `/api/kyc/${created.id}/screen-now`, 'POST', {})).json();
    assert.equal(now.ran, true);
    assert.equal(agents.calls.screen.length, 1);
    assert.equal(now.state.status, 'done');
    assert.equal(now.suggestion.mode, 'live');
    assert.equal(now.suggestion.dilly.label, 'AI suggestion');
    assert.equal(now.runs, undefined, 'an employee is not shown the runs left');
    assert.ok(now.request.ai_score >= 20);
    // Asked again: nothing to run
    assert.equal((await (await call(EMPLOYEE, `/api/kyc/${created.id}/screen-now`, 'POST', {})).json()).ran, false);
    assert.equal(agents.calls.screen.length, 1);
    // "force" is an officer's: an employee cannot spend a run with it
    assert.equal((await (await call(EMPLOYEE, `/api/kyc/${created.id}/screen-now`, 'POST', { force: true })).json()).ran, false);
    const officer = await (await call(OFFICER, `/api/kyc/${created.id}/pond-guard`)).json();
    assert.equal(typeof officer.runs.left, 'number');
    assert.equal(officer.runs.dailyCap, config.pondGuardDailyCap);
    assert.equal((await call(EMPLOYEE, '/api/kyc/KYC-0000-0000/screen-now', 'POST', {})).status, 404);

    // The officer decides. "Request more info" is not final: Waiting, then counted once it is approved or rejected
    const suggested = now.suggestion.risk;
    const triage = action => call(OFFICER, `/api/kyc/${created.id}/triage`, 'POST', { action, notes: 'Checked.' });
    assert.equal((await triage('Bounce Back')).status, 200);
    let panel = await (await call(OFFICER, '/api/learning/agreement')).json();
    let mine = panel.cases.find(c => c.kyc_id === created.id);
    assert.equal(mine.result, 'waiting');
    assert.equal(mine.resultLabel, 'Waiting');
    assert.equal((await triage('Approve')).status, 200);
    panel = await (await call(OFFICER, '/api/learning/agreement')).json();
    mine = panel.cases.find(c => c.kyc_id === created.id);
    assert.equal(mine.suggested_risk, suggested);
    assert.equal(mine.suggestion_mode, 'live');
    assert.equal(mine.result, suggested >= 50 ? 'dilly_stricter' : 'agreed');
    assert.equal(typeof panel.agreementRate, 'number');
    assert.equal(panel.via, 'Offline (SQLite)');
    assert.equal(panel.bigQuery.connected, false);
    assert.ok('officerRedPercent' in mine);
    // The decision did not move the suggestion or the score
    assert.equal(db.getLatestSuggestion(`kyc-${created.id.toLowerCase()}`).risk, suggested);
    // Employees have no agreement panel
    assert.equal((await call(EMPLOYEE, '/api/learning/agreement')).status, 403);
    assert.equal((await call(EMPLOYEE, '/api/learning/agreement/judge', 'POST', {})).status, 403);
    const judged = await (await call(OFFICER, '/api/learning/agreement/judge', 'POST', {})).json();
    assert.equal(judged.via, 'Offline (SQLite)');
  }));

  // Not on Cloud Run: the event is handled inside the app and the request is screened without the page asking
  const res = await withStub(agentsClient, agents.stub, async () => {
    const r = await call(EMPLOYEE, '/api/kyc/submit', 'POST', orgRequest());
    const created = (await r.json()).request;
    assert.equal(created.pond_guard.status, 'screening');
    assert.equal(created.pond_guard.via, 'inline');
    await bus.drain();
    return db.getKycRequestById(created.id);
  });
  assert.equal(res.pond_guard.status, 'done');
});
