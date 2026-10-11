/**
 * Phase 2, offline: demo mode and sign-in, the AI rate limit and daily budget, the Vertex AI request,
 * Pond-Guard's vetting of what the agents return, its offline fallback, and the read-only tool API.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { getDb } = require('../src/db');
const { authenticate, getRoleForEmail } = require('../src/middleware/auth');
const rateLimit = require('../src/middleware/rateLimit');
const gemini = require('../src/services/geminiClient');
const pondGuard = require('../src/services/pondGuardService');
const riskService = require('../src/risk/riskService');
const { getRules } = require('../src/risk/rulesStore');
const { startServer, stopServer } = require('../src/server');

// Routes that used to be open now need a signed-in compliance officer (Accounts phase).
// A call that names no persona acts as the demo compliance officer, except on routes that already checked the caller.
const OFFICER_DEFAULT = { 'x-user-email': 'compliance@duedilly.com' };
const fetch = (url, opts = {}) => globalThis.fetch(url, Object.assign({}, opts, {
  headers: Object.assign(/\/api\/(kyc|monitoring|ddq-templates|config|health|auth)|\/v1\/|\/internal\//.test(url) ? {} : OFFICER_DEFAULT, opts.headers || {})
}));

const PORT = 8098;
const BASE = `http://localhost:${PORT}`;
const withConfig = async (patch, fn) => {
  const before = Object.fromEntries(Object.keys(patch).map(k => [k, config[k]]));
  Object.assign(config, patch);
  try { return await fn(); } finally { Object.assign(config, before); }
};
const fakeRes = () => ({ code: 200, body: null, headers: {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set(k, v) { this.headers[k] = v; return this; } });
const runAuth = headers => new Promise(resolve => { const req = { headers }; const res = fakeRes(); authenticate(req, res, () => resolve({ req, res, passed: true })).then(() => { if (res.body) resolve({ req, res, passed: false }); }); });

test('demo mode: the persona headers work only when DEMO_MODE is on', async () => {
  await withConfig({ demoMode: true }, async () => {
    // Nobody picks their own role: the header names a demo persona, and the role comes from the account
    const { req } = await runAuth({ 'x-user-email': 'someone@example.com', 'x-user-role': 'compliance_officer' });
    assert.equal(req.user.role, 'employee');
    assert.equal(req.user.workspace.isDemo, true);
    const officer = await runAuth({ 'x-user-email': 'compliance@duedilly.com', 'x-user-role': 'employee' });
    assert.equal(officer.req.user.role, 'compliance_officer');
    assert.equal(getRoleForEmail('compliance.team@example.com'), 'employee');
  });
  await withConfig({ demoMode: false }, async () => {
    const out = await runAuth({ 'x-user-email': 'compliance@duedilly.com', 'x-user-role': 'compliance_officer' });
    assert.equal(out.passed, false);
    assert.equal(out.res.code, 401);
    // COMPLIANCE_OFFICER_EMAILS no longer makes anyone a compliance officer: only an account does
    assert.equal(getRoleForEmail('listed.officer@example.com'), 'employee');
  });
});

test('AI rate limit: per IP, friendly message, off when max is 0', async () => {
  rateLimit._reset();
  const call = ip => { const res = fakeRes(); let passed = false; rateLimit.aiRateLimit({ ip }, res, () => { passed = true; }); return { passed, res }; };
  await withConfig({ aiRateLimit: { max: 2, windowMinutes: 10 } }, async () => {
    assert.equal(call('1.1.1.1').passed, true);
    assert.equal(call('1.1.1.1').passed, true);
    const third = call('1.1.1.1');
    assert.equal(third.passed, false);
    assert.equal(third.res.code, 429);
    assert.match(third.res.body.message, /try again in about \d+ minute/);
    assert.equal(call('2.2.2.2').passed, true); // another visitor is not affected
  });
  await withConfig({ aiRateLimit: { max: 0, windowMinutes: 10 } }, async () => { for (let i = 0; i < 50; i++) assert.equal(call('3.3.3.3').passed, true); });
});

test('daily budget: counts down and stops at the cap', () => {
  const db = getDb();
  db.setSetting('daily_budget_test', null);
  assert.equal(rateLimit.takeDailyBudget(db, 'test', 2), true);
  assert.equal(rateLimit.dailyBudgetLeft(db, 'test', 2), 1);
  assert.equal(rateLimit.takeDailyBudget(db, 'test', 2), true);
  assert.equal(rateLimit.takeDailyBudget(db, 'test', 2), false);
  assert.equal(rateLimit.takeDailyBudget(db, 'test', 0), true); // 0 = no cap
  db.db.prepare("DELETE FROM app_settings WHERE key = 'daily_budget_test'").run();
});

test('Gemini on Vertex AI: backend, endpoint, model chain and request body', async () => {
  await withConfig({ geminiBackend: 'vertex', googleCloudProject: 'p1', googleCloudLocation: 'asia-southeast1', vertexModel: '', vertexFallbackModels: [] }, async () => {
    assert.equal(gemini.backend(), 'disabled'); // no model chosen yet
  });
  await withConfig({ geminiBackend: 'vertex', googleCloudProject: 'p1', googleCloudLocation: 'asia-southeast1', vertexModel: 'model-a', vertexFallbackModels: ['model-b'] }, async () => {
    assert.equal(gemini.backend(), 'vertex');
    assert.deepEqual(gemini.modelChain(), ['model-a', 'model-b']);
    assert.equal(gemini.endpointFor('model-a'), 'https://asia-southeast1-aiplatform.googleapis.com/v1/projects/p1/locations/asia-southeast1/publishers/google/models/model-a:generateContent');
  });
  await withConfig({ geminiBackend: 'vertex', googleCloudProject: 'p1', googleCloudLocation: 'global', vertexModel: 'model-a' }, async () => {
    assert.equal(gemini.endpointFor('model-a'), 'https://aiplatform.googleapis.com/v1/projects/p1/locations/global/publishers/google/models/model-a:generateContent');
  });
  const schema = { type: 'array', items: { type: 'object' } };
  const body = gemini.buildBody([{ text: 'hi' }], { responseSchema: schema, systemInstruction: 'be brief' });
  assert.equal(body.contents[0].role, 'user');
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(body.generationConfig.responseSchema, schema);
  assert.equal(body.systemInstruction.parts[0].text, 'be brief');
});

test('Pond-Guard: each agent gets its own evidence, and only evidence the app holds', () => {
  const db = getDb();
  const ev = pondGuard.gatherEvidence(db, db.getEntityById('aurora'), getRules(db));
  assert.deepEqual(ev.kinds, ['sanctions', 'pep', 'adverse_media', 'ownership', 'vessel_behaviour']);
  assert.deepEqual(ev.briefs.vessel_behaviour.categories.map(c => c.id), ['vessel_ais_dark', 'vessel_sts_transfer', 'vessel_flag_changes']);
  assert.ok(ev.briefs.vessel_behaviour.evidence.some(e => /AIS dark for 31 h/.test(e.text)));
  assert.ok(ev.briefs.ownership.evidence.some(e => /nominee/.test(e.text)));
  assert.equal(ev.briefs.adverse_media.evidence.length, 0); // adverse media searches the web; the others never do
  const person = pondGuard.gatherEvidence(db, db.getEntityById('zemtsov'), getRules(db));
  assert.equal(person.kinds.includes('vessel_behaviour'), false);
  assert.equal(person.briefs.sanctions.evidence[0].second_identifier_match, true);
});

test('Pond-Guard: what an agent returns is checked before it counts', () => {
  const db = getDb();
  const rules = getRules(db);
  const evidence = pondGuard.gatherEvidence(db, db.getEntityById('zemtsov'), rules);
  const [withId, nameOnly] = evidence.briefs.sanctions.evidence;
  assert.equal(nameOnly.second_identifier_match, false);
  const f = (over) => Object.assign({ category: 'sanctions_confirmed', subject: 'Arkady Zemtsov', summary: 'Listed.', evidence_quote: 'Matched on name, date of birth, nationality', evidence_ref: withId.ref, match_basis: 'second_identifier' }, over);
  const vet = findings => pondGuard.vetAgentFindings(db, 'sanctions', { findings, model_id: 'm' }, evidence, { idPrefix: 'T', promptVersion: 'v1' });

  const [ok] = vet([f({})]);
  assert.equal(ok._reason, undefined);
  assert.equal(ok.category, 'sanctions_confirmed');
  assert.equal(ok.source_name, 'UK sanctions list'); // the source comes from the evidence, not from the model
  assert.match(ok.source_url, /^\/risk\/source\?name=UK/);
  assert.equal(ok.agent, 'Pond-Guard · Sanctions');

  // A name alone never confirms a sanctions match, whatever the agent says
  const [down] = vet([f({ evidence_ref: nameOnly.ref, evidence_quote: 'OFAC designated individual' })]);
  assert.equal(down.category, 'sanctions_possible');
  assert.equal(down.match_basis, 'strong_name');

  assert.match(vet([f({ evidence_ref: 'E999' })])[0]._reason, /evidence the agent was not given/);
  assert.match(vet([f({ evidence_quote: 'words that are not there' })])[0]._reason, /quote is not in the cited evidence/);
  assert.match(vet([f({ category: 'vessel_ais_dark' })])[0]._reason, /may not report/);

  // A notice that only names the counterparty is not a sanctions match, and is not handed to the sanctions agent at all
  const notice = { id: 'rec_notice', source_id: 's_n', source_label: 'Port notices', source_type: 'website', entity_name: 'Arkady Zemtsov', entity_kind: 'person', summary: 'Arkady Zemtsov attended the port users meeting.', raw_content: 'Arkady Zemtsov attended the port users meeting.', risk_level: 'Unrated', risk_score: 0 };
  db.addSourceRecord(notice);
  const withNotice = pondGuard.gatherEvidence(db, db.getEntityById('zemtsov'), rules);
  assert.equal(Object.values(withNotice.briefs).some(b => b.evidence.some(e => /port users meeting/.test(e.text))), false);
  const plain = { ref: 'E900', agent: 'sanctions', source_name: 'Port notices', text: 'Arkady Zemtsov attended the port users meeting.', read_at: new Date().toISOString(), second_identifier_match: false };
  withNotice.items.set('E900', plain);
  const [notSanctions] = pondGuard.vetAgentFindings(db, 'sanctions', { findings: [f({ category: 'sanctions_possible', evidence_ref: 'E900', evidence_quote: 'attended the port users meeting', match_basis: 'strong_name' })], model_id: 'm' }, withNotice, { idPrefix: 'T', promptVersion: 'v1' });
  assert.match(notSanctions._reason, /does not mention sanctions/);
  db.deleteSourceRecordsBySourceId('s_n');

  // Adverse media: the page must be one Google Search returned in this run, cited by its ref, and it must be about this counterparty
  const page = { ref: 'G1', url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc', title: 'Example News', domain: 'news.example', segments: ['Arkady Zemtsov was charged with fraud in March 2026.'] };
  const m = over => f(Object.assign({ category: 'adverse_media_severe', evidence_ref: 'G1', evidence_quote: 'Arkady Zemtsov was charged with fraud in March 2026.', match_basis: 'strong_name' }, over));
  const vetMedia = (findings, subject) => pondGuard.vetAgentFindings(db, 'adverse_media', { findings, grounded_sources: [page, Object.assign({}, page, { ref: 'G2', url: 'https://x.example/2', segments: ['The tanker NEON (IMO 9183295) was added to a sanctions list.'] })], search_notes: 'Notes. The **King Loon** was detained.' }, evidence, { idPrefix: 'T', promptVersion: 'v1', subject });
  const zemtsov = db.getEntityById('zemtsov');
  const [real, invented, misquoted] = vetMedia([m({}), m({ evidence_ref: 'https://made-up.example/x' }), m({ evidence_quote: 'He was convicted.' })], zemtsov);
  assert.equal(real._reason, undefined);
  assert.equal(real.source_url, page.url); // the link is Google's, never one the model wrote
  assert.equal(real.source_name, 'Example News');
  assert.match(invented._reason, /not among the pages Google Search returned/);
  assert.match(misquoted._reason, /quote is not in what Google Search returned/);
  // Namesakes are left out: another vessel's news never lands on this counterparty
  const aurora = db.getEntityById('aurora');
  const [otherShip, otherName] = vetMedia([m({ evidence_ref: 'G2', evidence_quote: 'The tanker NEON (IMO 9183295) was added to a sanctions list.' }), m({ evidence_ref: 'G2', evidence_quote: 'The King Loon was detained.' })], aurora);
  assert.match(otherShip._reason, /does not name Aurora Venture|different vessel/);
  assert.match(otherName._reason, /does not name Aurora Venture/);

  // A ruled-out finding is stored as rejected with its reason and adds no points
  const out = riskService.recordFindings(db, 'vet-case', [ok, vet([f({ evidence_ref: 'E999' })])[0]], { replace: true });
  assert.equal(out.accepted.length, 1);
  assert.match(out.rejected[0].reason, /not given/);
  db.deleteFindingRecords('vet-case');
});

test('Pond-Guard offline: without the agents service the stored findings are shown and nothing changes', async () => {
  const db = getDb();
  await withConfig({ agentsServiceUrl: '', agentsInternalToken: '' }, async () => {
    assert.equal(pondGuard.status(db).mode, 'offline');
    const before = db.getFindingRecords('aurora').length;
    const events = [];
    await pondGuard.screenEntity(db, 'aurora', e => events.push(e));
    assert.equal(events[0].type, 'started');
    assert.equal(events[0].mode, 'offline');
    assert.equal(events.filter(e => e.type === 'agent_done').length, 5);
    const scored = events.at(-1);
    assert.equal(scored.type, 'scored');
    assert.equal(scored.offline, true);
    assert.equal(scored.breakdown.lines.length, 5);
    assert.equal(db.getFindingRecords('aurora').length, before);
  });
});

test('a sanctions alert goes to a person, never straight to Rejected', () => {
  const kyc = require('../src/services/kycService');
  const r = kyc.createKycRequest({ counterparty_name: 'Varnell Capital Holdings', entity_type: 'Organisation', country: 'ARE', relationship_type: 'Vendor/Supplier', contract_value: 1000 }, {});
  assert.equal(r.screening_result, 'Sanctions Alert');
  assert.equal(r.request_status, 'Under Review');
});

test('HTTP: Pond-Guard stream, Ask Dilly offline, and the read-only tool API', async t => {
  await startServer(PORT);
  t.after(async () => { await stopServer(); });

  const res = await fetch(`${BASE}/api/pond-guard/aurora/screen`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 200);
  const events = (await res.text()).trim().split('\n').map(l => JSON.parse(l));
  assert.deepEqual([events[0].type, events.at(-1).type], ['started', 'scored']);
  assert.equal((await fetch(`${BASE}/api/pond-guard/nobody/screen`, { method: 'POST' })).status, 404);

  const ask = await (await fetch(`${BASE}/api/pond-guard/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'Which vessels went dark?' }) })).json();
  assert.equal(ask.mode, 'offline');

  // The tool API is closed without the token, closed when no token is configured, and read-only
  assert.equal((await fetch(`${BASE}/internal/ask-tools/alerts`)).status, 401);
  assert.equal((await fetch(`${BASE}/internal/ask-tools/alerts`, { headers: { 'x-internal-token': '' } })).status, 401);
  await withConfig({ agentsInternalToken: 'tok-123' }, async () => {
    const h = { 'x-internal-token': 'tok-123' };
    const found = await (await fetch(`${BASE}/internal/ask-tools/counterparties?q=aurora`, { headers: h })).json();
    assert.equal(found.counterparties[0].id, 'aurora');
    const b = await (await fetch(`${BASE}/internal/ask-tools/breakdown/aurora`, { headers: h })).json();
    assert.equal(b.findings.length, 5);
    assert.equal((await fetch(`${BASE}/internal/ask-tools/cases/aurora`, { headers: h })).status, 200);
    assert.equal((await fetch(`${BASE}/internal/ask-tools/cases/aurora`, { method: 'POST', headers: h })).status, 405);
    assert.equal((await fetch(`${BASE}/internal/ask-tools/alerts`, { headers: { 'x-internal-token': 'wrong' } })).status, 401);
  });

  const pub = await (await fetch(`${BASE}/api/config/public`)).json();
  assert.equal(pub.demoMode, true);
  assert.equal(pub.dataResets, false);
});
