const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { sectionStatus, declarationStatus, evaluate } = require('../ddq-section-status');
const { parseTemplateMarkdown } = require('../src/services/ddqTemplateService');

const TEMPLATE = parseTemplateMarkdown(fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'supplier-cddq-template.md'), 'utf8'));
const SAMPLE_MD = fs.readFileSync(path.join(__dirname, 'fixtures', 'cddq-sample-response-meridian.md'), 'utf8');

const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());

// Turns the completed sample questionnaire (markdown) into the template-v1 response format
function sampleResponses() {
  const lines = SAMPLE_MD.split('\n');
  const byId = {};
  lines.forEach(l => { const c = cells(l); if (/^\d+\.\d+$/.test(c[0]) && c.length >= 3) byId[c[0]] = c[c.length - 1]; });

  const R = { format: 'template-v1', answers: {}, tables: {}, documents: {}, declaration: {} };
  TEMPLATE.sections.forEach(s => s.questions.forEach(q => {
    if (q.type === 'table') {
      const start = lines.findIndex(l => l.startsWith(`**${q.id} `));
      const rows = [];
      for (let i = start + 1; i < lines.length; i++) {
        if (!lines[i].trim()) { if (rows.length) break; continue; }
        if (!lines[i].trim().startsWith('|')) break;
        rows.push(cells(lines[i]));
      }
      R.tables[q.id] = rows.slice(2).map(r => Object.fromEntries(q.columns.map((c, ci) => [c, r[ci] || ''])));
      return;
    }
    const raw = byId[q.id] || '';
    if (q.type === 'yesno') {
      const m = raw.match(/^(?:Attached:\s*)?(Yes|No|Not applicable)\b[\s.,:;–-]*(.*)$/i);
      R.answers[q.id] = m ? { value: m[1], details: m[2] } : { value: raw };
    } else {
      R.answers[q.id] = { value: raw };
    }
  }));

  const decl = {};
  lines.forEach(l => { const c = cells(l); if (c.length === 2) decl[c[0]] = c[1]; });
  R.declaration = { agreed: true, full_name: decl['Full name'], job_title: decl['Job title'], company: decl['Company name'], date: decl.Date, signature: decl.Signature };
  return R;
}

const section = n => TEMPLATE.sections[n - 1];
const clone = o => JSON.parse(JSON.stringify(o));

test('DDQ section status - completed sample questionnaire', async (t) => {
  const R = sampleResponses();

  await t.test('every section of the Meridian sample is done', () => {
    const result = evaluate(TEMPLATE, R);
    assert.equal(result.total, TEMPLATE.sections.length);
    result.sections.forEach(s => assert.equal(s.status, 'done', `section ${s.index + 1} ${s.title}: ${JSON.stringify(s.failed)}`));
    assert.equal(result.declaration.status, 'done');
    assert.equal(result.ready, true);
  });

  await t.test('an untouched section is not_started', () => {
    assert.equal(sectionStatus(section(1), { answers: {}, tables: {} }).status, 'not_started');
  });

  await t.test('a partly answered section is in_progress', () => {
    const s = sectionStatus(section(1), { answers: { '1.1': { value: 'Meridian Port Logistics Pte. Ltd.' } }, tables: {} });
    assert.equal(s.status, 'in_progress');
    assert.equal(s.answered, 1);
    assert.deepEqual(s.failed, []);
  });

  await t.test('an AI suggestion that is not confirmed keeps the section in_progress', () => {
    const r = clone(R);
    Object.assign(r.answers['1.1'], { ai_suggested: true, confirmed: false });
    assert.equal(sectionStatus(section(1), r).status, 'in_progress');
  });
});

test('DDQ section status - one failing case per check', async (t) => {
  const failing = (n, mutate) => { const r = sampleResponses(); mutate(r); return sectionStatus(section(n), r); };

  await t.test('yes_without_details: Yes with fewer than 15 characters of detail', () => {
    const s = failing(2, r => { r.answers['2.5'].details = ''; });
    assert.equal(s.status, 'needs_attention');
    assert.deepEqual(s.failed.map(f => f.check), ['yes_without_details']);
    assert.equal(s.failed[0].message, 'Question 2.5: you answered Yes. Please describe the change.');
  });

  await t.test('na_without_reason: Not applicable with nothing after it', () => {
    const s = failing(1, r => { r.answers['1.8'].value = 'N/A'; });
    assert.equal(s.status, 'needs_attention');
    assert.deepEqual(s.failed.map(f => f.check), ['na_without_reason']);
    assert.equal(s.failed[0].questionId, '1.8');
  });

  await t.test('na_without_reason: a reason after Not applicable passes', () => {
    const s = failing(1, r => { r.answers['1.8'].value = 'Not applicable - we have no website'; });
    assert.equal(s.status, 'done');
  });

  await t.test('yes_no_unclear: a Yes / No question answered with something else', () => {
    const s = failing(2, r => { r.answers['2.3'] = { value: 'Maybe, depends on the trust deed' }; });
    assert.equal(s.status, 'needs_attention');
    assert.deepEqual(s.failed.map(f => f.check), ['yes_no_unclear']);
  });

  await t.test('ownership_over_100: percentages in one table add up to more than 100%', () => {
    const s = failing(2, r => { r.tables['2.8'][1]['% held or nature of control'] = '60%, indirectly'; });
    assert.equal(s.status, 'needs_attention');
    assert.deepEqual(s.failed.map(f => f.check), ['ownership_over_100']);
    assert.match(s.failed[0].message, /115%/);
  });

  await t.test('declaration_incomplete: name, job title, date or signature blank', () => {
    const r = sampleResponses();
    for (const field of ['full_name', 'job_title', 'date', 'signature']) {
      const d = declarationStatus(Object.assign({}, r.declaration, { [field]: '' }));
      assert.equal(d.status, 'in_progress', field);
      assert.equal(d.failed[0].check, 'declaration_incomplete');
    }
    assert.equal(evaluate(TEMPLATE, Object.assign(r, { declaration: {} })).ready, false);
  });

  // missing_attachment is not implemented: files are attached to the supporting-documents list,
  // not to a question, so there is no field linking question 2.6 to an uploaded file.
});
