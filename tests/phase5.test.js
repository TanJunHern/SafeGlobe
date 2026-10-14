/**
 * Reviewer copilot, Duck-Scanner and DDQ answer verification, offline.
 * Gemini and Document AI are replaced by stand-ins so that every check on what they return can be tested.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { getDb } = require('../src/db');
const gemini = require('../src/services/geminiClient');
const copilot = require('../src/services/copilotService');
const scanner = require('../src/services/duckScannerService');
const verification = require('../src/services/answerVerificationService');
const templateService = require('../src/services/ddqTemplateService');
const riskService = require('../src/risk/riskService');
const bus = require('../src/events/bus');
const { startServer, stopServer } = require('../src/server');

const PORT = 8094;
const BASE = `http://localhost:${PORT}`;
const OFFICER = { 'x-user-email': 'compliance@duedilly.com', 'Content-Type': 'application/json' };
const EMPLOYEE = { 'x-user-email': 'john.doe@duedilly.com', 'Content-Type': 'application/json' };
const api = (path, opts = {}) => fetch(BASE + path, Object.assign({}, opts, { headers: Object.assign({}, OFFICER, opts.headers || {}) }));
const withStub = async (object, patch, fn) => {
  const before = Object.fromEntries(Object.keys(patch).map(k => [k, object[k]]));
  Object.assign(object, patch);
  try { return await fn(); } finally { Object.assign(object, before); }
};
const withConfig = async (patch, fn) => {
  const before = Object.fromEntries(Object.keys(patch).map(k => [k, config[k]]));
  Object.assign(config, patch);
  try { return await fn(); } finally { Object.assign(config, before); }
};
const scoreOf = (db, id) => { const b = riskService.assessEntity(db, id); return [b.risk, b.confidence, b.route]; };
const answering = data => ({ isConfigured: () => true, generateJsonDetailed: async (parts, opts) => (typeof data === 'function' ? data(parts, opts) : { data, model: 'test-model' }) });

// ---------------------------------------------------------------------------------------------
// Reviewer copilot
// ---------------------------------------------------------------------------------------------
test('copilot offline: the draft is built from the findings, labelled, and decides nothing', async () => {
  const db = getDb();
  const before = scoreOf(db, 'aurora');
  const d = await copilot.draft(db, 'aurora', { email: 'compliance@duedilly.com' });
  assert.equal(d.status, 'draft');
  assert.equal(d.draft.label, 'AI draft');
  assert.equal(d.draft.source, 'offline');
  assert.equal(d.draft.sourceLabel, 'Offline sample');
  assert.match(d.draft.note, /Gemini is not connected/);
  assert.match(d.draft.summary, /85 of 100/);
  assert.equal(d.draft.cited_findings.length, 5);
  assert.deepEqual(d.draft.cited_clauses.sort(), ['§1.3', '§4.1', '§5.4']); // §1.3: the ownership demo clause
  // The suggested route is the computed one, never the model's
  assert.equal(d.draft.suggestedRouteLabel, 'Escalate');
  assert.equal(d.draft.risk, 85);
  assert.deepEqual(scoreOf(db, 'aurora'), before);
  await assert.rejects(copilot.draft(db, 'no-such-case', {}), /not been scored/);
});

test('copilot: what Gemini writes is checked before it is shown', async () => {
  const db = getDb();
  const facts = await copilot.caseFacts(db, 'aurora');
  const ids = facts.b.lines.map(l => l.findingId);
  const good = { summary: 'Aurora Venture went dark for 31 hours and then did a ship-to-ship transfer.', decision_reason: `The route is Escalate: risk is 85 of 100. See [${ids[0]}] and policy §5.4.`, cited_findings: [ids[0], 'F-made-up'], cited_clauses: ['§5.4', '§9.9'] };
  const ok = copilot.vetDraft(good, facts);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.draft.cited_findings, [ids[0]]); // an id that is not on the case is dropped
  assert.deepEqual(ok.draft.cited_clauses, ['§5.4']);   // so is a clause that does not exist

  assert.match(copilot.vetDraft(Object.assign({}, good, { cited_findings: ['F-made-up'] }), facts).why, /cited no finding/);
  assert.match(copilot.vetDraft(Object.assign({}, good, { decision_reason: 'Risk is 85 of 100. See [F-other-case-1].' }), facts).why, /not on this case/);
  assert.match(copilot.vetDraft(Object.assign({}, good, { summary: 'I rate this 92 out of 100.' }), facts).why, /score that is not the computed one/);
  assert.match(copilot.vetDraft(Object.assign({}, good, { decision_reason: `I recommend Auto-clear. [${ids[0]}]` }), facts).why, /route other than the computed one/);
  assert.match(copilot.vetDraft({ summary: '', decision_reason: '' }, facts).why, /empty/);

  // A good Gemini draft is used and named; a bad one falls back to the fixed wording, with the reason
  await withStub(gemini, answering((parts, opts) => { assert.ok(opts.responseSchema); assert.match(parts[0].text, /never give your own/); return { data: good, model: 'test-model' }; }), async () => {
    db.setSetting('daily_budget_copilot', null);
    const d = await copilot.draft(db, 'aurora', { email: 'compliance@duedilly.com' });
    assert.equal(d.draft.source, 'gemini');
    assert.equal(d.draft.sourceLabel, 'Gemini (test-model)');
    assert.equal(d.draft.suggestedRouteLabel, 'Escalate');
  });
  await withStub(gemini, answering(Object.assign({}, good, { summary: 'Score: 40 of 100.' })), async () => {
    const d = await copilot.draft(db, 'aurora', {});
    assert.equal(d.draft.source, 'offline');
    assert.match(d.draft.note, /was not used .*score that is not the computed one/);
  });
  await withStub(gemini, answering(good), async () => {
    await withConfig({ copilotDailyCap: 1 }, async () => {
      db.setSetting('daily_budget_copilot', null);
      await copilot.draft(db, 'aurora', {});
      const capped = await copilot.draft(db, 'aurora', {});
      assert.equal(capped.draft.source, 'offline');
      assert.match(capped.draft.note, /limit of 1 drafts/);
    });
  });
});

test('copilot: a person confirms or edits, and both texts are kept', async () => {
  const db = getDb();
  const d = await copilot.draft(db, 'kestrel', { email: 'compliance@duedilly.com' });
  assert.throws(() => copilot.confirm(db, d.id, { summary: '', decision_reason: 'x' }, { email: 'a@b.c' }), /cannot be empty/);
  assert.throws(() => copilot.confirm(db, d.id, { summary: 's', decision_reason: 'r' }, {}), /named reviewer/);
  assert.throws(() => copilot.confirm(db, 'draft-none', { summary: 's', decision_reason: 'r' }, { email: 'a@b.c' }), /not found/);
  const same = copilot.confirm(db, d.id, { summary: d.draft.summary, decision_reason: d.draft.decision_reason }, { email: 'compliance@duedilly.com' });
  assert.equal(same.status, 'confirmed');
  assert.equal(same.final.edited, false);
  assert.equal(same.confirmedBy, 'compliance@duedilly.com');
  const d2 = await copilot.draft(db, 'kestrel', { email: 'compliance@duedilly.com' });
  const edited = copilot.confirm(db, d2.id, { summary: 'My own summary.', decision_reason: 'My own reason.' }, { email: 'compliance@duedilly.com' });
  assert.equal(edited.final.edited, true);
  assert.equal(edited.final.summary, 'My own summary.');
  assert.equal(edited.draft.summary, d2.draft.summary); // the AI draft is still there beside it
  assert.equal(db.getLatestCopilotDraft('kestrel').id, d2.id);
});

// ---------------------------------------------------------------------------------------------
// Duck-Scanner
// ---------------------------------------------------------------------------------------------
const TEMPLATE = { sections: [
  { id: 's1', title: 'Company information', questions: [{ id: '1.1', text: 'Full registered name of the company', type: 'text' }, { id: '1.2', text: 'Registration number', type: 'text' }] },
  { id: 's3', title: 'Government relations', questions: [{ id: '3.2', text: 'Is any director a Politically Exposed Person (PEP)?', type: 'yesno', detailsPrompt: 'Name them' }] },
  { id: 's2', title: 'Ownership', questions: [{ id: '2.8', text: 'Beneficial Owners', type: 'table', columns: ['Name', '%'] }] }
] };
const DOC_AI = { document: { text: 'Company name: Halcyon Marine Services Pte. Ltd.\nUEN: 201512345K\nPEP among directors: No\n', pages: [{ pageNumber: 1, formFields: [
  { fieldName: { textAnchor: { textSegments: [{ startIndex: '0', endIndex: '13' }] }, confidence: 0.98 }, fieldValue: { textAnchor: { textSegments: [{ startIndex: '14', endIndex: '47' }] }, confidence: 0.97 } },
  { fieldName: { textAnchor: { content: 'UEN:' }, confidence: 0.9 }, fieldValue: { textAnchor: { content: '201512345K' }, confidence: 0.52 } },
  { fieldName: { textAnchor: { content: 'PEP among directors:' }, confidence: 0.95 }, fieldValue: { textAnchor: { content: 'No' }, confidence: 0.93 } }
] }] } };

test('Duck-Scanner: Document AI output is read into text and form fields', () => {
  const read = scanner.readDocumentAi(DOC_AI);
  assert.equal(read.pages, 1);
  assert.deepEqual(read.fields[0], { name: 'Company name:', value: 'Halcyon Marine Services Pte. Ltd.', confidence: 0.97, page: 1 });
  assert.equal(read.fields[1].confidence, 0.52); // the less sure of label and value
  assert.equal(scanner.readDocumentAi({}).fields.length, 0);
});

test('Duck-Scanner: every suggestion is checked, and unsure ones are marked for the supplier', () => {
  const read = scanner.readDocumentAi(DOC_AI);
  const raw = { answers: [
    { question_id: '1.1', value: 'Halcyon Marine Services Pte. Ltd.', source: 'Company name: Halcyon Marine Services Pte. Ltd.', confidence: 0.99 },
    { question_id: '1.2', value: '201512345K', source: 'UEN: 201512345K', confidence: 0.95 },          // read poorly by Document AI
    { question_id: '3.2', value: 'no', source: 'PEP among directors: No', confidence: 0.9 },
    { question_id: '3.2', value: 'Maybe', source: 'PEP among directors: No', confidence: 0.99 },          // not Yes or No
    { question_id: '9.9', value: 'x', source: 'Company name', confidence: 1 },                              // not in this questionnaire
    { question_id: '2.8', value: 'A. Person', source: 'Company name', confidence: 1 },                      // a table
    { question_id: '1.1', value: 'Invented Holdings', source: 'words that are not in the document', confidence: 1 }
  ] };
  const { answers, dropped } = scanner.vetAnswers(TEMPLATE, raw, read);
  assert.deepEqual(Object.keys(answers).sort(), ['1.1', '1.2', '3.2']);
  assert.equal(answers['1.1'].value, 'Halcyon Marine Services Pte. Ltd.');
  assert.equal(answers['1.1'].needs_confirmation, false);
  assert.equal(answers['1.1'].ai_suggested, true);
  // How well the field was read caps how sure the answer can be
  assert.equal(answers['1.2'].confidence, 0.52);
  assert.equal(answers['1.2'].needs_confirmation, true);
  assert.equal(answers['3.2'].value, 'No');
  assert.equal(dropped.length, 4);
  assert.ok(dropped.some(d => /not in the document/.test(d.reason)) && dropped.some(d => /Yes or No/.test(d.reason)) && dropped.some(d => /Not a question/.test(d.reason)));
});

test('Duck-Scanner: Document AI then Gemini; without Document AI Gemini reads the file; without Gemini nothing is suggested', async () => {
  const db = getDb();
  const pdf = { template: TEMPLATE, filename: 'returned-ddq.pdf', mimeType: 'application/pdf', base64Data: Buffer.from('%PDF-1.4 test').toString('base64') };
  // Offline: no suggestion, and the supplier fills the form in
  const off = await scanner.scan(db, pdf);
  assert.equal(off.success, false);
  assert.match(off.message, /complete the questionnaire manually/);
  assert.equal(scanner.status().documentAi, 'offline');

  const mapped = { answers: [{ question_id: '1.1', value: 'Halcyon Marine Services Pte. Ltd.', source: 'Company name: Halcyon Marine Services Pte. Ltd.', confidence: 0.96 }, { question_id: '1.2', value: '201512345K', source: 'UEN: 201512345K', confidence: 0.9 }], summary: 'A returned questionnaire.' };
  // Gemini only: the file itself is sent, and the confidence is Gemini's own
  await withStub(gemini, answering((parts) => { assert.ok(parts[1] && parts[1].inlineData && parts[1].inlineData.mimeType === 'application/pdf'); return { data: mapped, model: 'test-model' }; }), async () => {
    const out = await scanner.scan(db, pdf);
    assert.equal(out.success, true);
    assert.equal(out.reader, 'gemini');
    assert.match(out.note, /Document AI is not connected/);
    assert.equal(out.answers['1.2'].needs_confirmation, false);
    assert.match(out.message, /Nothing is submitted until you submit/);
  });

  // Document AI connected: its text and fields go to Gemini, not the file
  const realFetch = globalThis.fetch;
  const gal = require('google-auth-library');
  const RealAuth = gal.GoogleAuth;
  gal.GoogleAuth = function () { return { getClient: async () => ({ getAccessToken: async () => ({ token: 't' }) }) }; };
  const calls = [];
  globalThis.fetch = async (url, opts) => { calls.push({ url: String(url), body: JSON.parse(opts.body) }); return new Response(JSON.stringify(DOC_AI), { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    await withConfig({ documentAi: { projectId: 'test-project', location: 'us', processorId: 'abc123' }, documentAiDailyCap: 1 }, async () => {
      db.setSetting('daily_budget_document_ai', null);
      await withStub(gemini, answering((parts) => { assert.equal(parts.length, 1); assert.match(parts[0].text, /FORM FIELDS READ BY DOCUMENT AI/); assert.match(parts[0].text, /UEN: => 201512345K \(0\.52\)/); return { data: mapped, model: 'test-model' }; }), async () => {
        const out = await scanner.scan(db, pdf);
        assert.equal(out.reader, 'document-ai');
        assert.match(out.readerLabel, /Document AI Form Parser \(1 page, 3 form fields\), mapped by Gemini/);
        assert.equal(calls[0].url, 'https://us-documentai.googleapis.com/v1/projects/test-project/locations/us/processors/abc123:process');
        assert.equal(calls[0].body.rawDocument.mimeType, 'application/pdf');
        assert.deepEqual(out.lowConfidence, ['1.2']);
        assert.match(out.message, /1 needs your confirmation/);
        // The daily cap is used up: Gemini reads the file directly, and says so
        const capped = await scanner.scan(db, pdf).catch(e => e);
        assert.ok(capped instanceof Error || /limit of 1 documents/.test(capped.note));
      });
    });
  } finally { globalThis.fetch = realFetch; gal.GoogleAuth = RealAuth; db.setSetting('daily_budget_document_ai', null); }
});

// ---------------------------------------------------------------------------------------------
// Answer verification
// ---------------------------------------------------------------------------------------------
const KYC = 'KYC-2026-0008'; // MV Aurora Tide in the seeded demo: a possible sanctions link and vessel behaviour findings
// The built-in CDDQ questionnaire, whatever template an earlier test left active. Each request keeps its own copy.
const CDDQ = templateService.parseTemplateMarkdown(require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'db', 'supplier-cddq-template.md'), 'utf8'));
const respond = (db, answers, tables = {}) => { db.setKycDdqTemplate(KYC, CDDQ); return db.setKycDdqResponses(KYC, { format: 'template-v1', submitted_at: new Date().toISOString(), answers, tables }); };

test('answer verification: which answers are compared with which findings', () => {
  const db = getDb();
  require('../src/services/kycService').ensurePersonaSeed();
  const template = CDDQ;
  const lines = riskService.assessEntity(db, verification.entityIdOf(KYC)).lines;
  const pairs = verification.candidatePairs(template, { answers: { '7.1': { value: 'No' }, '7.7': { value: 'No' }, '6.5': { value: 'No' }, '7.10': { value: 'No' }, '3.2': { value: 'No' }, '7.2': { value: 'Yes', details: '51% held by a listed person' } }, tables: {} }, lines);
  const seen = pairs.map(p => `${p.questionId}>${p.category}`).sort();
  assert.ok(seen.includes('7.1>sanctions_possible'));
  assert.ok(seen.includes('7.7>vessel_ais_dark') && seen.includes('7.7>vessel_sts_transfer'));
  assert.equal(seen.some(s => s.startsWith('6.5>') || s.startsWith('7.10>')), false); // having a policy or screening is not a claim about the supplier
  assert.equal(seen.some(s => s.startsWith('7.2>')), false);                          // a Yes has already disclosed it
  assert.equal(seen.some(s => s.startsWith('3.2>')), false);                          // no PEP finding on this case
  // A PEP owner finding is compared with "is an owner a PEP?" (3.2), not with the question about family members (3.3)
  const pepLine = [{ findingId: 'F-pep', category: 'pep_owner', short: 'PEP owner or director', summary: 'The beneficial owner is a serving official.', quote: 'PEP declared', sourceName: 'Intake', sourceUrl: '' }];
  const denied = verification.candidatePairs(template, { answers: { '3.2': { value: 'No' }, '3.3': { value: 'No' } }, tables: {} }, pepLine).map(p => p.questionId);
  assert.deepEqual(denied, ['3.2']);
  assert.equal(verification.candidatePairs(template, { answers: { '3.2': { value: 'Yes', details: 'The chairman is a serving official' }, '3.3': { value: 'No' } }, tables: {} }, pepLine).length, 0);
});

test('answer verification offline: contradictions are shown with both sides quoted and add the points once', async () => {
  const db = getDb();
  const entityId = verification.entityIdOf(KYC);
  db.deleteFindingRecord(`DDQ-${KYC}-contradiction`);
  respond(db, {});
  db.setKycDdqResponses(KYC, {});
  assert.equal((await verification.verify(db, KYC)).status, 'not_returned');

  respond(db, { '7.1': { value: 'No' }, '7.7': { value: 'No' }, '6.5': { value: 'No' } });
  const out = await verification.verify(db, KYC);
  assert.equal(out.status, 'checked');
  assert.equal(out.checkedBy, 'Offline rules');
  assert.match(out.note, /Gemini is not connected/);
  assert.equal(out.contradictions.length, 3); // 7.1 against the sanctions finding, 7.7 against two vessel findings
  const c = out.contradictions.find(x => x.questionId === '7.1');
  assert.equal(c.answer, 'No');
  assert.match(c.question, /Sanctioned Person/);
  assert.equal(c.answerId, `${KYC}:7.1`);
  assert.equal(c.rule, 'Possible sanctions match');
  assert.ok(c.findingQuote.length > 5 && c.findingId && c.sourceName); // both sides are quoted
  // One finding, citing the DDQ answer, however many contradictions there are
  const lines = riskService.assessEntity(db, entityId).lines.filter(l => l.category === 'ddq_contradiction');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].points, 15);
  assert.match(lines[0].ddqAnswerId, new RegExp(`^${KYC}:7\\.`));
  assert.equal(db.getDdqVerification(KYC).contradictions.length, 3);

  // Run again: still one finding. Answer truthfully: the finding is taken away again.
  await verification.verify(db, KYC);
  assert.equal(riskService.assessEntity(db, entityId).lines.filter(l => l.category === 'ddq_contradiction').length, 1);
  respond(db, { '7.1': { value: 'Yes', details: 'The owner is listed' }, '7.7': { value: 'Yes', details: 'One tanker' } });
  const honest = await verification.verify(db, KYC);
  assert.equal(honest.contradictions.length, 0);
  assert.equal(riskService.assessEntity(db, entityId).lines.some(l => l.category === 'ddq_contradiction'), false);
  await assert.rejects(verification.verify(db, 'KYC-0000-0000'), /not found/);
});

test('answer verification with Gemini: it may only judge the pairs it was given', async () => {
  const db = getDb();
  respond(db, { '7.1': { value: 'No' }, '7.7': { value: 'No' } });
  await withStub(gemini, answering((parts) => {
    const pairs = JSON.parse(parts[0].text.split('Pairs (JSON): ')[1]);
    assert.ok(pairs.every(p => p.answer === 'No' && p.finding));
    return { model: 'test-model', data: { judgements: [
      { pair_id: pairs.find(p => p.pair_id.startsWith('7.1|')).pair_id, verdict: 'contradicts', reason: 'The answer says nobody is sanctioned, and the finding reports a link to a sanctioned party.' },
      ...pairs.filter(p => p.pair_id.startsWith('7.7|')).map(p => ({ pair_id: p.pair_id, verdict: 'unrelated', reason: 'The finding is about this vessel, not about whether the supplier owns vessels.' })),
      { pair_id: '9.9|F-invented', verdict: 'contradicts', reason: 'Made up.' },
      { pair_id: pairs[0].pair_id, verdict: 'certainly lying', reason: 'x' }
    ] } };
  }), async () => {
    const out = await verification.verify(db, KYC);
    assert.equal(out.checkedBy, 'Gemini (test-model)');
    assert.deepEqual(out.contradictions.map(c => c.questionId), ['7.1']);
    assert.match(out.contradictions[0].reason, /link to a sanctioned party/);
  });
  db.deleteFindingRecord(`DDQ-${KYC}-contradiction`);
  db.setKycDdqResponses(KYC, {});
});

// ---------------------------------------------------------------------------------------------
// Over HTTP
// ---------------------------------------------------------------------------------------------
test('copilot and answer verification over HTTP', async t => {
  await startServer(PORT);
  t.after(async () => { await bus.drain(); await stopServer(); });
  const db = getDb();
  for (const [method, path] of [['GET', '/api/copilot/aurora'], ['POST', '/api/copilot/aurora/draft'], ['POST', '/api/copilot/drafts/x/confirm'], ['GET', `/api/ddq/verification/${KYC}`], ['POST', `/api/ddq/verification/${KYC}`]]) {
    const res = await fetch(BASE + path, { method, headers: EMPLOYEE, body: method === 'POST' ? '{}' : undefined });
    assert.equal(res.status, 403, `${method} ${path}`);
  }
  const made = await api('/api/copilot/severny/draft', { method: 'POST', body: '{}' });
  assert.equal(made.status, 201);
  const d = await made.json();
  assert.equal(d.draft.label, 'AI draft');
  assert.equal(d.draft.suggestedRouteLabel, 'Investigate');
  assert.equal((await api(`/api/copilot/drafts/${d.id}/confirm`, { method: 'POST', body: JSON.stringify({ summary: '', decision_reason: '' }) })).status, 400);
  const confirmed = await (await api(`/api/copilot/drafts/${d.id}/confirm`, { method: 'POST', body: JSON.stringify({ summary: 'Reviewed.', decision_reason: 'Agreed with the route after checking the registry.' }) })).json();
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(confirmed.final.edited, true);
  assert.equal(confirmed.confirmedBy, 'compliance@duedilly.com');
  assert.equal((await (await api('/api/copilot/severny')).json()).id, d.id);
  assert.equal((await api('/api/copilot/no-such-case/draft', { method: 'POST', body: '{}' })).status, 400);

  respond(db, { '7.1': { value: 'No' } });
  const checked = await (await api(`/api/ddq/verification/${KYC}`, { method: 'POST', body: '{}' })).json();
  assert.equal(checked.contradictions.length, 1);
  assert.equal((await (await api(`/api/ddq/verification/${KYC}`)).json()).contradictions[0].questionId, '7.1');
  assert.equal((await api('/api/ddq/verification/KYC-0000-0000', { method: 'POST', body: '{}' })).status, 404);
  // A returned questionnaire is checked when its event arrives
  db.deleteFindingRecord(`DDQ-${KYC}-contradiction`);
  respond(db, { '7.1': { value: 'No' }, '7.7': { value: 'No' } });
  bus.publish('ddq-submitted', { kycId: KYC });
  await bus.drain();
  assert.equal(db.getDdqVerification(KYC).contradictions.length, 3);
  db.deleteFindingRecord(`DDQ-${KYC}-contradiction`);
  db.setKycDdqResponses(KYC, {});
});
