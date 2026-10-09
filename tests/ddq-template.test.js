// Run offline: the AI guide must degrade gracefully and tests must not depend on a live model
process.env.GEMINI_API_KEY = '';
process.env.GOOGLE_API_KEY = '';
process.env.GOOGLE_GENAI_API_KEY = '';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, stopServer } = require('../src/server');
const templateService = require('../src/services/ddqTemplateService');

const TEST_PORT = 8094;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const EMPLOYEE = { 'x-user-email': 'john.doe@safeglobe.com', 'x-user-role': 'employee' };
const OTHER_EMPLOYEE = { 'x-user-email': 'someone.else@safeglobe.com', 'x-user-role': 'employee' };
const COMPLIANCE = { 'x-user-email': 'compliance@safeglobe.com', 'x-user-role': 'compliance_officer' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

const call = async (method, url, body, headers = {}) => {
  const res = await fetch(`${BASE_URL}${url}`, {
    method,
    headers: { ...JSON_HEADERS, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

// Answers every required question of a template so a submission is complete
function completeResponses(template, overrides = {}) {
  const responses = { format: 'template-v1', answers: {}, tables: {}, documents: {}, language: 'English' };
  for (const section of template.sections) {
    for (const q of section.questions) {
      if (q.type === 'yesno') responses.answers[q.id] = { value: 'No' };
      else if (q.type === 'table') responses.answers[q.id] = { none: true };
      else responses.answers[q.id] = { value: 'Test answer' };
    }
  }
  responses.declaration = { agreed: true, full_name: 'Ong Bee Lian', job_title: 'Director', company: 'Test Co', date: '2026-10-09', signature: 'data:image/png;base64,iVBORw0KGgo=' };
  return Object.assign(responses, overrides);
}

async function issueDdq(name) {
  const res = await call('POST', '/api/kyc/submit', {
    counterparty_name: name, entity_type: 'Organisation', country: 'SGP',
    relationship_type: 'Vendor/Supplier', contract_value: 200000
  }, EMPLOYEE);
  assert.equal(res.status, 201);
  return { id: res.body.request.id, token: res.body.request.ddq_link.split('token=')[1] };
}

test('DDQ template parser reads the Supplier CDDQ policy template', () => {
  const markdown = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'supplier-cddq-template.md'), 'utf8');
  const t = templateService.parseTemplateMarkdown(markdown);
  const find = id => t.sections.flatMap(s => s.questions).find(q => q.id === id);

  assert.equal(t.sections.length, 7);
  assert.deepEqual(t.sections.map(s => s.title), [
    'Company information', 'Company ownership structure', 'Government relations', 'Conflict of interest',
    'Violations', 'Company procedures', 'Sanctions exposure'
  ]);
  assert.equal(templateService.countQuestions(t), 77);
  assert.equal(t.documents.length, 5);
  assert.equal(t.glossary.length, 19);
  assert.equal(t.declaration.statements.length, 7);

  assert.equal(find('1.1').type, 'text');
  assert.equal(find('1.14').type, 'yesno');
  assert.equal(find('1.14').text, 'Is the company or its parent listed on a stock exchange?');
  assert.equal(find('1.14').detailsPrompt, 'If Yes, which exchange and ticker');
  assert.equal(find('3.7').detailsPrompt, '');
  assert.equal(find('5.1').type, 'yesno');
  assert.equal(find('2.8').type, 'table');
  assert.deepEqual(find('2.8').columns, ['Full name', 'Nationality', 'Country of residence', '% held or nature of control']);
  assert.ok(t.sections[4].subheading.startsWith('In the last 5 years'));

  // Placeholders are filled in, not shown to the counterparty
  const everything = JSON.stringify(t);
  assert.ok(!everything.includes('[Issuing Company'));
  assert.ok(!everything.includes('&#91;'));
  assert.ok(t.intro.startsWith('SafeGlobe requires every new supplier'));
});

test('deriveScreeningFields maps template answers onto the re-screen inputs', () => {
  const t = templateService.getActiveTemplate();
  const r = completeResponses(t);
  r.answers['3.2'] = { value: 'Yes', details: 'Director is a former minister' };
  r.answers['7.4'] = { value: 'Yes', details: 'Legacy contract' };
  r.answers['2.8'] = {};
  r.tables['2.8'] = [{ 'Full name': 'Chen Li Hua', Nationality: 'SGP', '% held or nature of control': '55%' }];
  const d = templateService.deriveScreeningFields(t, r);
  assert.equal(d.pep_declared, true);
  assert.equal(d.sanctions_declared, true);
  assert.equal(d.litigation_declared, false);
  assert.deepEqual(d.ubo_list, [{ name: 'Chen Li Hua', nationality: 'SGP', ownership: 55 }]);
});

test('having compliance controls in place is never treated as an adverse disclosure', () => {
  const t = templateService.getActiveTemplate();
  const r = completeResponses(t);
  // Section 6: Yes means the supplier HAS the policy
  for (const id of ['6.2', '6.4', '6.5', '6.7', '4.6', '7.10']) r.answers[id] = { value: 'Yes', details: 'Reviewed 2026' };
  const d = templateService.deriveScreeningFields(t, r);
  assert.equal(d.litigation_declared, false);
  assert.equal(d.sanctions_declared, false);
  assert.equal(d.conflict_declared, false);
  assert.equal(d.pep_declared, false);

  r.answers['5.1'] = { value: 'Yes', details: 'Fined in 2023' };
  r.answers['7.1'] = { value: 'Yes' };
  r.answers['4.1'] = { value: 'Yes', details: 'Director is the sibling of a SafeGlobe buyer' };
  const flagged = templateService.deriveScreeningFields(t, r);
  assert.equal(flagged.litigation_declared, true);
  assert.equal(flagged.sanctions_declared, true);
  assert.equal(flagged.conflict_declared, true);
});

test('DDQ Manager and template-driven guest portal', async (t) => {
  await startServer(TEST_PORT);
  let original;      // DDQ issued under the seeded template
  let importedId;

  await t.test('standalone pages are served', async () => {
    for (const [route, marker] of [['/ddq/portal?token=x', 'id="guide-fab"'], ['/portal/ddq-manager', 'DDQ Manager'], ['/ddq/print?token=x', 'Printable copy']]) {
      const res = await fetch(`${BASE_URL}${route}`);
      assert.equal(res.status, 200);
      assert.ok((await res.text()).includes(marker), `${route} should contain ${marker}`);
    }
  });

  await t.test('only compliance officers can use the template manager', async () => {
    assert.equal((await call('GET', '/api/ddq-templates', undefined, EMPLOYEE)).status, 403);
    assert.equal((await call('GET', '/api/ddq-templates')).status, 403);
    const list = await call('GET', '/api/ddq-templates', undefined, COMPLIANCE);
    assert.equal(list.status, 200);
    const active = list.body.templates.filter(x => x.is_active);
    assert.equal(active.length, 1);
    assert.equal(active[0].question_count, 77);
  });

  await t.test('a new DDQ carries a snapshot of the active template', async () => {
    original = await issueDdq('Snapshot Original Pte Ltd');
    const state = await call('GET', `/api/ddq/verify-token?token=${original.token}`);
    assert.equal(state.body.valid, true);
    assert.equal(state.body.template.sections.length, 7);
  });

  await t.test('importing, editing and activating a template', async () => {
    const markdown = [
      '# Broker Questionnaire Template', '',
      '## Purpose', 'Short form for brokers.', '', '- [ ] Licence copy', '',
      '## 1. About you', '', '| No. | Question | Response |', '| --- | --- | --- |',
      '| 1.1 | Registered name |  |',
      '| 1.2 | Are you licensed? Yes / No. If Yes, name the regulator |  |', '',
      '**1.3 Key contacts**', '', '| Name | Role |', '| --- | --- |', '|  |  |', '',
      '## Declaration', 'Signed by a director.', '', '1. The answers are true.'
    ].join('\n');

    const empty = await call('POST', '/api/ddq-templates/import', { markdown: 'no sections here' }, COMPLIANCE);
    assert.equal(empty.status, 400);

    const imported = await call('POST', '/api/ddq-templates/import', { markdown, filename: 'broker.md' }, COMPLIANCE);
    assert.equal(imported.status, 201);
    importedId = imported.body.template.id;
    assert.equal(imported.body.question_count, 3);
    assert.equal(imported.body.template.is_active, false);
    assert.equal(imported.body.template.template.title, 'Broker Questionnaire');

    // Officer tweaks a question and adds one
    const body = imported.body.template.template;
    body.sections[0].title = 'About your firm';
    body.sections[0].questions[0].text = 'Full registered name of the brokerage';
    body.sections[0].questions.push({ id: '1.4', text: 'Do you hold client money?', type: 'yesno', detailsPrompt: '' });
    body.sections[0].questions.push({ id: '1.5', text: '   ', type: 'text' }); // blank: dropped
    const saved = await call('PUT', `/api/ddq-templates/${importedId}`, { name: 'Broker DDQ', template: body }, COMPLIANCE);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.question_count, 4);
    assert.equal(saved.body.template.name, 'Broker DDQ');
    assert.equal(saved.body.template.template.sections[0].questions[0].text, 'Full registered name of the brokerage');

    assert.equal((await call('PUT', `/api/ddq-templates/${importedId}`, { template: body }, EMPLOYEE)).status, 403);

    const activated = await call('POST', `/api/ddq-templates/${importedId}/activate`, {}, COMPLIANCE);
    assert.equal(activated.status, 200);
    assert.equal((await call('DELETE', `/api/ddq-templates/${importedId}`, undefined, COMPLIANCE)).status, 400);
  });

  await t.test('new DDQs use the edited template; issued ones keep their snapshot', async () => {
    const fresh = await issueDdq('Snapshot Fresh Pte Ltd');
    const freshState = await call('GET', `/api/ddq/verify-token?token=${fresh.token}`);
    assert.equal(freshState.body.template.sections.length, 1);
    assert.equal(freshState.body.template.sections[0].title, 'About your firm');

    const oldState = await call('GET', `/api/ddq/verify-token?token=${original.token}`);
    assert.equal(oldState.body.template.sections.length, 7);
  });

  await t.test('draft autosave resumes on the same link', async () => {
    const draft = { format: 'template-v1', answers: { '1.1': { value: 'Snapshot Original Pte Ltd' } }, tables: {}, documents: {}, declaration: {} };
    const saved = await call('POST', '/api/ddq/draft', { token: original.token, draft });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.progress.answered, 1);
    assert.equal(saved.body.progress.total, 77);

    const state = await call('GET', `/api/ddq/verify-token?token=${original.token}`);
    assert.equal(state.body.draft.answers['1.1'].value, 'Snapshot Original Pte Ltd');
    assert.equal((await call('POST', '/api/ddq/draft', { token: 'not-a-token', draft })).status, 400);
  });

  await t.test('AI guide answers offline from the glossary, documents and progress', async () => {
    const explain = await call('POST', '/api/ddq/assistant', { token: original.token, questionId: '3.2', message: 'Explain this question' });
    assert.equal(explain.status, 200);
    assert.equal(explain.body.model, 'offline-guide');
    assert.ok(explain.body.reply.includes('Politically Exposed Person'));
    assert.ok(explain.body.reply.includes('Tick Yes or No'));
    assert.ok(explain.body.suggested_documents.some(d => /identity/i.test(d)));

    const left = await call('POST', '/api/ddq/assistant', { token: original.token, message: "What's left?", responses: { answers: {} } });
    assert.ok(left.body.reply.includes('0 of 77'));

    assert.equal((await call('POST', '/api/ddq/assistant', { token: 'bad', message: 'hi' })).status, 400);
  });

  await t.test('translation and prefill degrade gracefully without the model', async () => {
    const translated = await call('POST', '/api/ddq/translate', { token: original.token, language: 'Bahasa Melayu', ui: ['Back', 'Next'] });
    assert.equal(translated.status, 200);
    assert.equal(translated.body.translated, false);
    assert.equal(translated.body.template.sections.length, 7);
    assert.deepEqual(translated.body.ui, ['Back', 'Next']);

    const prefill = await call('POST', '/api/ddq/prefill', { token: original.token, filename: 'profile.txt', fileContent: 'Acme Pte Ltd' });
    assert.equal(prefill.status, 200);
    assert.equal(prefill.body.success, false);
    assert.deepEqual(prefill.body.answers, {});
  });

  await t.test('PDF / Word templates are reserved for Document AI and rejected with a clear fallback', async () => {
    const pdf = await call('POST', '/api/ddq-templates/import', { filename: 'policy.pdf', mimeType: 'application/pdf', base64Data: 'JVBERi0xLjQ=' }, COMPLIANCE);
    assert.equal(pdf.status, 415);
    assert.ok(pdf.body.message.includes('Google Document AI'));
    assert.equal(pdf.body.fallback, '.md');

    // A .md file sent as base64 still imports
    const md = Buffer.from('# Mini\n\n## 1. One\n\n| No. | Question | Response |\n| --- | --- | --- |\n| 1.1 | Name |  |\n').toString('base64');
    const ok = await call('POST', '/api/ddq-templates/import', { filename: 'mini.md', base64Data: md }, COMPLIANCE);
    assert.equal(ok.status, 201);
    assert.equal(ok.body.parser, 'markdown');
    assert.equal((await call('DELETE', `/api/ddq-templates/${ok.body.template.id}`, undefined, COMPLIANCE)).status, 200);
  });

  let storedDoc;
  await t.test('supporting documents are stored locally against the DDQ', async () => {
    const content = Buffer.from('%PDF-1.4 test certificate of incorporation');
    const up = await call('POST', '/api/ddq/document', { token: original.token, index: 0, filename: 'Cert of Inc (2026).pdf', mimeType: 'application/pdf', base64Data: content.toString('base64') });
    assert.equal(up.status, 201);
    storedDoc = up.body.document;
    assert.equal(storedDoc.key, `ddq/${original.id}/0-Cert_of_Inc__2026_.pdf`);
    assert.equal(storedDoc.size, content.length);
    assert.equal(storedDoc.storage, 'local');
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'data', 'uploads', storedDoc.key)));

    assert.equal((await call('POST', '/api/ddq/document', { token: original.token, index: 1, filename: 'run.exe', base64Data: 'AAAA' })).status, 400);
    assert.equal((await call('POST', '/api/ddq/document', { token: 'bad', index: 0, filename: 'a.pdf', base64Data: 'AAAA' })).status, 400);
  });

  await t.test('submission requires every question and a signed declaration', async () => {
    const template = (await call('GET', `/api/ddq/verify-token?token=${original.token}`)).body.template;

    const incomplete = completeResponses(template);
    delete incomplete.answers['1.1'];
    const r1 = await call('POST', '/api/ddq/submit', { token: original.token, responses: incomplete });
    assert.equal(r1.status, 400);
    assert.ok(r1.body.message.includes('1 required questions'));

    const unsigned = completeResponses(template);
    unsigned.declaration.signature = '';
    assert.equal((await call('POST', '/api/ddq/submit', { token: original.token, responses: unsigned })).status, 400);

    const complete = completeResponses(template);
    complete.answers['3.2'] = { value: 'Yes', details: 'A director is a former deputy minister.' };
    complete.answers['2.8'] = {};
    complete.tables['2.8'] = [{ 'Full name': 'Ong Bee Lian', Nationality: 'SGP', 'Country of residence': 'SGP', '% held or nature of control': '60%' }];
    complete.documents = { 0: Object.assign({ checked: true }, storedDoc), 1: { checked: true, key: 'ddq/KYC-2026-0001/0-someone-elses.pdf', filename: 'x.pdf' } };
    const ok = await call('POST', '/api/ddq/submit', { token: original.token, responses: complete });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.re_screening_result, 'PEP Alert');

    const locked = await call('GET', `/api/ddq/verify-token?token=${original.token}`);
    assert.equal(locked.body.readOnly, true);
    assert.equal(locked.body.status, 'DDQ Under Review');
    assert.equal((await call('POST', '/api/ddq/draft', { token: original.token, draft: {} })).status, 400);
  });

  await t.test('returned DDQ is downloadable by compliance and by the requesting employee only', async () => {
    const forOfficer = await call('GET', `/api/kyc/${original.id}/ddq`, undefined, COMPLIANCE);
    assert.equal(forOfficer.status, 200);
    assert.equal(forOfficer.body.submitted, true);
    assert.equal(forOfficer.body.template.sections.length, 7);
    assert.equal(forOfficer.body.responses.answers['3.2'].value, 'Yes');
    assert.equal(forOfficer.body.responses.ubo_list[0].name, 'Ong Bee Lian');
    assert.ok(forOfficer.body.responses.declaration.signature.startsWith('data:image/png'));

    assert.equal((await call('GET', `/api/kyc/${original.id}/ddq`, undefined, EMPLOYEE)).status, 200);
    assert.equal((await call('GET', `/api/kyc/${original.id}/ddq`, undefined, OTHER_EMPLOYEE)).status, 403);

    // Attached documents: same access rule, and a key pointing at another request is never served
    const dl = url => fetch(`${BASE_URL}${url}`, { headers: COMPLIANCE });
    const file = await dl(`/api/kyc/${original.id}/ddq/documents/0`);
    assert.equal(file.status, 200);
    assert.ok(file.headers.get('content-disposition').includes('Cert_of_Inc__2026_.pdf'));
    assert.equal(Buffer.from(await file.arrayBuffer()).toString(), '%PDF-1.4 test certificate of incorporation');
    assert.equal((await dl(`/api/kyc/${original.id}/ddq/documents/1`)).status, 404);
    assert.equal((await dl(`/api/kyc/${original.id}/ddq/documents/9`)).status, 404);
    assert.equal((await fetch(`${BASE_URL}/api/kyc/${original.id}/ddq/documents/0`, { headers: OTHER_EMPLOYEE })).status, 403);
    fs.rmSync(path.join(__dirname, '..', 'data', 'uploads', 'ddq', original.id), { recursive: true, force: true });

    // List payloads stay light: no template snapshot or draft blobs
    const list = await call('GET', '/api/kyc?scope=all', undefined, COMPLIANCE);
    const row = list.body.requests.find(r => r.id === original.id);
    assert.ok(!('ddq_template_json' in row));
    assert.ok(!('ddq_draft_json' in row));
  });

  await stopServer();
});
