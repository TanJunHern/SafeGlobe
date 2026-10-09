// The Compliance Agent must work with no model at all: these tests run in placeholder mode
process.env.GEMINI_API_KEY = '';
process.env.GOOGLE_API_KEY = '';
process.env.GOOGLE_GENAI_API_KEY = '';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, stopServer } = require('../src/server');

const TEST_PORT = 8095;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const EMPLOYEE = { 'x-user-email': 'john.doe@safeglobe.com', 'x-user-role': 'employee' };
const COMPLIANCE = { 'x-user-email': 'compliance@safeglobe.com', 'x-user-role': 'compliance_officer' };

const call = async (method, url, body, headers = {}) => {
  const res = await fetch(`${BASE_URL}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const submitKyc = async body => (await call('POST', '/api/kyc/submit', Object.assign({ entity_type: 'Organisation', country: 'SGP', relationship_type: 'Vendor/Supplier' }, body), EMPLOYEE)).body.request;
const getRequest = async id => (await call('GET', `/api/kyc/${id}`, undefined, COMPLIANCE)).body.request;

function completeResponses(template) {
  const responses = { format: 'template-v1', answers: {}, tables: {}, documents: {}, language: 'English' };
  for (const section of template.sections) {
    for (const q of section.questions) {
      // A sound supplier: no adverse disclosures, compliance controls in place, owners declared
      if (q.type === 'yesno') {
        responses.answers[q.id] = section.title === 'Company procedures'
          ? { value: 'Yes', details: 'In place and last reviewed in 2026.' }
          : { value: 'No' };
      } else if (q.type === 'table' && /beneficial owner/i.test(q.text)) {
        responses.answers[q.id] = {};
        responses.tables[q.id] = [{ 'Full name': 'Ong Bee Lian', Nationality: 'SGP', 'Country of residence': 'SGP', '% held or nature of control': '60%' }];
      } else if (q.type === 'table') responses.answers[q.id] = { none: true };
      else responses.answers[q.id] = { value: 'A specific and complete answer to this question.' };
    }
  }
  responses.declaration = { agreed: true, full_name: 'Ong Bee Lian', job_title: 'Director', date: '2026-10-09', signature: 'data:image/png;base64,iVBORw0KGgo=' };
  return responses;
}

test('Compliance Agent', async (t) => {
  await startServer(TEST_PORT);
  // Use the bundled supplier questionnaire regardless of what earlier test files activated
  const templates = (await call('GET', '/api/ddq-templates', undefined, COMPLIANCE)).body.templates;
  const supplier = templates.find(x => x.question_count === 77);
  await call('POST', `/api/ddq-templates/${supplier.id}/activate`, {}, COMPLIANCE);

  let kyc;        // request that goes through bounce -> resubmit -> approve
  let token;
  let template;

  await t.test('describes itself: name, placeholder mode, stages, tools and guardrails', async () => {
    const res = await call('GET', '/api/agent/compliance');
    assert.equal(res.status, 200);
    assert.equal(res.body.name, 'Compliance Agent');
    assert.equal(res.body.mode, 'placeholder');
    assert.deepEqual(res.body.stages.map(s => s.id), ['intake', 'investigation', 'ddq_review']);
    const tools = res.body.tools.map(x => x.name);
    for (const name of ['screen_watchlists', 'country_risk', 'policy_rules', 'risk_model', 'knowledge_base_search', 'ownership_trace', 'ddq_quality_review']) {
      assert.ok(tools.includes(name), `missing tool ${name}`);
    }
    assert.ok(res.body.guardrails.length >= 3);
  });

  await t.test('stage 1 + 2: scores and investigates every new request', async () => {
    kyc = await submitKyc({ counterparty_name: 'Agent Review Logistics Pte Ltd', contract_value: 220000 });
    token = kyc.ddq_link.split('token=')[1];
    const intake = kyc.agent.intake;
    assert.equal(kyc.agent.name, 'Compliance Agent');
    assert.equal(intake.stage, 'intake');
    assert.equal(intake.mode, 'placeholder');
    assert.equal(intake.recommendation, 'require_ddq');
    assert.equal(typeof intake.score, 'number');
    assert.ok(intake.clauses.some(c => c.text.includes('§2.1') && c.source === 'policy rules'));
    assert.ok(intake.rationale.includes('Agent Review Logistics Pte Ltd'));
    // Every tool call is on the record
    const called = intake.trace.map(e => e.tool);
    for (const name of ['screen_watchlists', 'country_risk', 'policy_rules', 'risk_model', 'knowledge_base_search', 'ownership_trace']) {
      assert.ok(called.includes(name), `trace should include ${name}`);
    }

    const clean = await submitKyc({ counterparty_name: 'Tidy Stationery Pte Ltd', contract_value: 12000 });
    assert.equal(clean.agent.intake.recommendation, 'auto_clear');

    const risky = await submitKyc({ counterparty_name: 'Severny Agro Export LLC', country: 'RUS', contract_value: 900000 });
    assert.equal(risky.agent.intake.recommendation, 'escalate');
    assert.ok(risky.agent.intake.findings.length >= 1);
  });

  await t.test('stage 3: scores a weak questionnaire and recommends bouncing it back', async () => {
    template = (await call('GET', `/api/ddq/verify-token?token=${token}`)).body.template;
    const weak = completeResponses(template);
    weak.answers['1.2'] = { value: 'n/a' };
    weak.answers['1.14'] = { value: 'Yes', details: 'SGX' };
    const res = await call('POST', '/api/ddq/submit', { token, responses: weak });
    assert.equal(res.status, 200);
    assert.equal(res.body.agent_review.recommendation, 'bounce_back');

    const request = await getRequest(kyc.id);
    const review = request.agent.ddq;
    assert.equal(review.stage, 'ddq_review');
    assert.equal(review.round, 1);
    assert.equal(review.recommendation, 'bounce_back');
    assert.equal(review.satisfactory, false);
    assert.ok(review.score < 100);
    const byQuestion = Object.fromEntries(review.issues.map(i => [i.question_id, i]));
    assert.equal(byQuestion['1.2'].category, 'evasive answer');
    assert.equal(byQuestion['1.14'].category, 'insufficient detail');
    assert.equal(byQuestion['documents'].category, 'missing documents');
    assert.ok(review.issues.every(i => i.fixable));
    assert.equal(review.sections.length, 7);
    assert.ok(review.bounce.issues.some(b => b.question_id === '1.2' && b.note));
    assert.ok(request.compliance_notes.startsWith('Compliance Agent DDQ review:'));
  });

  await t.test('bounce back: returns chosen points to the counterparty and re-opens the form', async () => {
    assert.equal((await call('POST', `/api/kyc/${kyc.id}/triage`, { action: 'Bounce Back' }, EMPLOYEE)).status, 403);

    const res = await call('POST', `/api/kyc/${kyc.id}/triage`, {
      action: 'Bounce Back',
      notes: 'Please clarify two points.',
      issues: [
        { question_id: '1.2', note: 'Please list former names, or write "None".' },
        { question_id: '1.14', note: 'Please give the exchange and ticker.' },
        { question_id: '9.99', note: 'not a real question' },
        { question_id: '1.3', note: '   ' }
      ]
    }, COMPLIANCE);
    assert.equal(res.status, 200);
    assert.equal(res.body.request.request_status, 'Pending DDQ');
    assert.equal(res.body.request.ddq_status, 'Returned to Counterparty');
    assert.equal(res.body.request.ddq_bounce.round, 1);
    assert.deepEqual(res.body.request.ddq_bounce.issues.map(i => i.question_id), ['1.2', '1.14']);

    const state = (await call('GET', `/api/ddq/verify-token?token=${token}`)).body;
    assert.equal(state.readOnly, false);
    assert.equal(state.bounce.note, 'Please clarify two points.');
    assert.equal(state.bounce.issues.length, 2);
    // Earlier answers are kept so only the flagged points need changing
    assert.equal(state.draft.answers['1.2'].value, 'n/a');
    assert.equal(state.draft.declaration.full_name, 'Ong Bee Lian');
    assert.ok(!('pep_declared' in state.draft));

    // The DDQ guide tells the counterparty what compliance asked on a flagged question
    const guide = await call('POST', '/api/ddq/assistant', { token, questionId: '1.2', message: 'Explain this question' });
    assert.ok(guide.body.reply.includes('Please list former names'));
  });

  await t.test('resubmission closes the round and the agent re-scores to Approve', async () => {
    const fixed = completeResponses(template);
    fixed.answers['1.1'] = { value: 'Agent Review Logistics Pte Ltd' };
    fixed.answers['1.2'] = { value: 'None in the last 5 years.' };
    fixed.answers['1.14'] = { value: 'Yes', details: 'Listed on the Singapore Exchange (SGX: ARL) since 2019.' };
    for (let i = 0; i < template.documents.length; i++) {
      const up = await call('POST', '/api/ddq/document', { token, index: i, filename: `doc-${i}.pdf`, mimeType: 'application/pdf', base64Data: Buffer.from('%PDF-1.4 test').toString('base64') });
      fixed.documents[i] = Object.assign({ checked: true }, up.body.document);
    }
    const res = await call('POST', '/api/ddq/submit', { token, responses: fixed });
    assert.equal(res.status, 200);

    const request = await getRequest(kyc.id);
    assert.equal(request.ddq_bounce, null);
    assert.equal(request.ddq_responses.bounce_history.length, 1);
    assert.ok(request.ddq_responses.bounce_history[0].resolved_at);
    const review = request.agent.ddq;
    assert.equal(review.round, 2);
    assert.equal(review.issues.length, 0);
    assert.equal(review.score, 100);
    assert.equal(review.recommendation, 'approve');
    assert.equal(review.satisfactory, true);
    assert.deepEqual(request.agent.history.filter(h => h.stage === 'ddq_review').map(h => h.recommendation), ['bounce_back', 'approve']);
    fs.rmSync(path.join(__dirname, '..', 'data', 'uploads', 'ddq', kyc.id), { recursive: true, force: true });
  });

  await t.test('genuine disclosures are escalated to the officer, not bounced', async () => {
    const other = await submitKyc({ counterparty_name: 'Disclosure Shipping Pte Ltd', contract_value: 300000 });
    const otherToken = other.ddq_link.split('token=')[1];
    const answers = completeResponses(template);
    answers.answers['7.1'] = { value: 'Yes' };
    // 6.2 (anti-bribery policy) is answered Yes: a control in place must not count against them
    await call('POST', '/api/ddq/submit', { token: otherToken, responses: answers });
    const review = (await getRequest(other.id)).agent.ddq;
    assert.equal(review.recommendation, 'escalate');
    const sanctions = review.issues.find(i => i.question_id === '7.1');
    assert.equal(sanctions.severity, 'high');
    assert.equal(sanctions.fixable, false);
    assert.ok(!review.issues.some(i => i.question_id === '6.2'));
    assert.ok(!review.bounce.issues.some(b => b.question_id === '7.1'));
  });

  await t.test('re-running the agent is restricted to compliance officers', async () => {
    assert.equal((await call('POST', `/api/kyc/${kyc.id}/agent/run`, {}, EMPLOYEE)).status, 403);
    const res = await call('POST', `/api/kyc/${kyc.id}/agent/run`, {}, COMPLIANCE);
    assert.equal(res.status, 200);
    assert.equal(res.body.agent.intake.stage, 'intake');
    assert.equal(res.body.agent.ddq.round, 2);
    assert.equal((await call('POST', '/api/kyc/KYC-0000-0000/agent/run', {}, COMPLIANCE)).status, 404);
  });

  await stopServer();
});
