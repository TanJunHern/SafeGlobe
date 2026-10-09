/**
 * DDQ questionnaire templates.
 *
 * A template is plain JSON so the compliance officer can edit it in the DDQ Manager:
 *   { title, intro, instructions[], documents[], sections[], declaration, glossary[] }
 *   section  = { id, title, subheading, questions[] }
 *   question = { id, text, type: 'text' | 'yesno' | 'table', detailsPrompt?, columns?, required }
 *
 * The active template is snapshotted onto each KYC request when its DDQ is issued, so later
 * edits never change a questionnaire that is already with a counterparty.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getDb } = require('../db');

const DEFAULT_TEMPLATE_PATH = path.join(__dirname, '..', 'db', 'supplier-cddq-template.md');
const DEFAULT_SETTINGS = { issuingCompany: 'SafeGlobe', contactEmail: 'compliance@safeglobe.com' };
const QUESTION_TYPES = ['text', 'yesno', 'table'];

function cleanInline(text = '', settings = DEFAULT_SETTINGS) {
  return String(text)
    .replace(/&#91;/g, '[').replace(/&#93;/g, ']')
    .replace(/\\([\[\]_*])/g, '$1')
    .replace(/\[Issuing Company\]/gi, settings.issuingCompany)
    .replace(/\[compliance@issuingcompany\.com\]/gi, settings.contactEmail)
    .replace(/\[(\d+)\]/g, '$1')
    .replace(/\[([^\]]+)\]/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}
const isTableRow = line => /^\s*\|.*\|\s*$/.test(line);
const isDivider = line => /^\s*\|[\s:|-]+\|\s*$/.test(line);

// "Is X listed? Yes / No. If Yes, which exchange" -> { text: "Is X listed?", detailsPrompt: "If Yes, which exchange" }
function splitYesNo(text) {
  const m = text.match(/^(.*?)\s*Yes\s*\/\s*No\.?\s*(.*)$/i);
  if (!m) return null;
  return { text: m[1].trim() || text, detailsPrompt: m[2].trim() };
}

/**
 * Parses a CDDQ policy template written in markdown into the template JSON structure.
 */
function parseTemplateMarkdown(markdown = '', settingsInput = {}) {
  const settings = Object.assign({}, DEFAULT_SETTINGS, settingsInput);
  const clean = t => cleanInline(t, settings);
  const lines = String(markdown).replace(/\r\n/g, '\n').split('\n');

  const template = {
    title: 'Due Diligence Questionnaire',
    intro: '',
    instructions: [],
    documents: [],
    sections: [],
    declaration: { intro: '', statements: [] },
    glossary: []
  };

  // Split into "## " blocks
  const blocks = [];
  let current = { heading: '', lines: [] };
  for (const line of lines) {
    const h1 = line.match(/^#\s+(.*)$/);
    const h2 = line.match(/^##\s+(.*)$/);
    if (h1) { template.title = clean(h1[1]).replace(/\s*(Policy\s+)?Template$/i, '') || template.title; continue; }
    if (h2) { blocks.push(current); current = { heading: clean(h2[1]), lines: [] }; continue; }
    current.lines.push(line);
  }
  blocks.push(current);

  for (const block of blocks) {
    const heading = block.heading;
    if (!heading) continue;
    const body = block.lines;

    if (/^appendix|definitions?$/i.test(heading)) {
      for (const line of body) {
        if (!isTableRow(line) || isDivider(line)) continue;
        const [term, meaning] = splitRow(line);
        if (!term || /^term$/i.test(term)) continue;
        template.glossary.push({ term: clean(term), meaning: clean(meaning || '') });
      }
      continue;
    }

    if (/^declaration/i.test(heading)) {
      const intro = [];
      for (const line of body) {
        const item = line.match(/^\s*\d+\.\s+(.*)$/);
        if (item) template.declaration.statements.push(clean(item[1]));
        else if (line.trim() && !isTableRow(line)) intro.push(clean(line));
      }
      template.declaration.intro = intro.join(' ');
      continue;
    }

    const numbered = heading.match(/^(\d+)\.\s+(.*)$/);
    if (!numbered) {
      // Purpose / instructions block
      const intro = [];
      for (const line of body) {
        const doc = line.match(/^\s*-\s*\[[ xX]?\]\s+(.*)$/);
        const step = line.match(/^\s*\d+\.\s+(.*)$/);
        if (doc) template.documents.push(clean(doc[1]));
        else if (step) template.instructions.push(clean(step[1]));
        else if (line.trim() && !/^\*\*.*\*\*$/.test(line.trim()) && !isTableRow(line)) intro.push(clean(line));
      }
      if (intro.length && !template.intro) template.intro = intro.join(' ');
      continue;
    }

    // Numbered question section
    const section = { id: `s${numbered[1]}`, title: numbered[2], subheading: '', questions: [] };
    const preamble = [];
    let pendingTable = null; // "**2.7 Shareholders ...**" waiting for its column header row
    let tableMode = null;    // 'questions' | 'columns' | 'skip'

    for (const line of body) {
      const bold = line.trim().match(/^\*\*(\d+(?:\.\d+)+)\s+(.*?)\*\*$/);
      if (bold) {
        pendingTable = { id: bold[1], text: clean(bold[2]), type: 'table', columns: [], required: true };
        tableMode = null;
        continue;
      }
      if (!isTableRow(line)) {
        if (line.trim() && !section.questions.length && !pendingTable) preamble.push(clean(line));
        if (!line.trim()) tableMode = null;
        continue;
      }
      if (isDivider(line)) continue;
      const cells = splitRow(line);

      if (!tableMode) {
        // Header row decides what this table is
        if (pendingTable) {
          pendingTable.columns = cells.map(clean).filter(Boolean);
          section.questions.push(pendingTable);
          pendingTable = null;
          tableMode = 'skip';
        } else {
          tableMode = /^no\.?$/i.test(cells[0]) ? 'questions' : 'skip';
        }
        continue;
      }
      if (tableMode !== 'questions') continue;

      const [id, rawText, rawResponse = ''] = cells;
      if (!id || !rawText) continue;
      const text = clean(rawText);
      const response = clean(rawResponse);
      const inline = splitYesNo(text);
      const sectionWideYesNo = /answer\s+(each\s+line|yes\s*\/\s*no)/i.test(preamble.join(' '));
      if (inline) {
        section.questions.push({ id, text: inline.text, type: 'yesno', detailsPrompt: inline.detailsPrompt, required: true });
      } else if (/yes\s*\/\s*no/i.test(response) || sectionWideYesNo) {
        const ifYes = text.match(/^(.*?)\.?\s*(If Yes,.*)$/i);
        section.questions.push({
          id,
          text: ifYes ? ifYes[1].trim() : text,
          type: 'yesno',
          detailsPrompt: ifYes ? ifYes[2].trim() : (sectionWideYesNo ? 'If Yes, give details' : ''),
          required: true
        });
      } else {
        section.questions.push({ id, text, type: 'text', required: true });
      }
    }
    section.subheading = preamble.join(' ');
    if (section.questions.length) template.sections.push(section);
  }

  return normalizeTemplate(template);
}

/**
 * Coerces an edited template (from the DDQ Manager) into a safe, complete structure.
 */
function normalizeTemplate(input = {}) {
  const str = (v, max = 2000) => String(v == null ? '' : v).trim().slice(0, max);
  const list = v => (Array.isArray(v) ? v : []);
  const seen = new Set();
  const uniqueId = (wanted, fallback) => {
    let id = str(wanted, 24).replace(/[^\w.-]/g, '') || fallback;
    while (seen.has(id)) id = `${id}-${seen.size}`;
    seen.add(id);
    return id;
  };

  const template = {
    title: str(input.title, 200) || 'Due Diligence Questionnaire',
    intro: str(input.intro, 4000),
    instructions: list(input.instructions).map(s => str(s, 1000)).filter(Boolean),
    documents: list(input.documents).map(s => str(s, 500)).filter(Boolean),
    sections: [],
    declaration: {
      intro: str(input.declaration && input.declaration.intro, 2000),
      statements: list(input.declaration && input.declaration.statements).map(s => str(s, 2000)).filter(Boolean)
    },
    glossary: list(input.glossary)
      .map(g => ({ term: str(g && g.term, 200), meaning: str(g && g.meaning, 2000) }))
      .filter(g => g.term)
  };

  list(input.sections).forEach((s, si) => {
    const section = {
      id: uniqueId(s && s.id, `s${si + 1}`),
      title: str(s && s.title, 200) || `Section ${si + 1}`,
      subheading: str(s && s.subheading, 2000),
      questions: []
    };
    list(s && s.questions).forEach((q, qi) => {
      const text = str(q && q.text, 2000);
      if (!text) return;
      const type = QUESTION_TYPES.includes(q.type) ? q.type : 'text';
      const question = { id: uniqueId(q.id, `${si + 1}.${qi + 1}`), text, type, required: q.required !== false };
      // An empty prompt is meaningful: a plain Yes / No with no follow-up details
      if (type === 'yesno') question.detailsPrompt = q.detailsPrompt == null ? 'If Yes, give details' : str(q.detailsPrompt, 500);
      if (type === 'table') {
        question.columns = list(q.columns).map(c => str(c, 120)).filter(Boolean);
        if (!question.columns.length) question.columns = ['Details'];
      }
      if (str(q.help, 1000)) question.help = str(q.help, 1000);
      section.questions.push(question);
    });
    template.sections.push(section);
  });
  return template;
}

function countQuestions(template) {
  return (template.sections || []).reduce((n, s) => n + s.questions.length, 0);
}

function templateHash(template) {
  return crypto.createHash('sha1').update(JSON.stringify(template)).digest('hex');
}

/**
 * Makes sure there is always an active template; seeds the bundled Supplier CDDQ on first run.
 */
function ensureDefaultTemplate() {
  const db = getDb();
  if (db.getActiveDdqTemplate()) return;
  const existing = db.listDdqTemplates();
  if (existing.length) { db.activateDdqTemplate(existing[0].id); return; }
  const markdown = fs.readFileSync(DEFAULT_TEMPLATE_PATH, 'utf8');
  const template = parseTemplateMarkdown(markdown);
  const saved = db.saveDdqTemplate({
    id: 'TPL-0001',
    name: template.title,
    source_filename: 'Supplier CDDQ Policy Template.md',
    template,
    updated_by: 'System seed'
  });
  db.activateDdqTemplate(saved.id);
}

function getActiveTemplate() {
  ensureDefaultTemplate();
  const row = getDb().getActiveDdqTemplate();
  return row ? row.template : null;
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

const hasText = v => typeof v === 'string' && v.trim().length > 0;

function isAnswered(question, responses = {}) {
  if (question.type === 'table') {
    const rows = (responses.tables && responses.tables[question.id]) || [];
    const marked = responses.answers && responses.answers[question.id];
    if (marked && marked.none) return true;
    return rows.some(r => Object.values(r || {}).some(hasText));
  }
  const a = (responses.answers && responses.answers[question.id]) || {};
  if (question.type === 'yesno') {
    if (a.value === 'No') return true;
    if (a.value === 'Yes') return !question.detailsPrompt || hasText(a.details);
    return false;
  }
  return hasText(a.value);
}

function computeProgress(template, responses = {}) {
  const sections = (template.sections || []).map(s => {
    const required = s.questions.filter(q => q.required !== false);
    const done = required.filter(q => isAnswered(q, responses)).length;
    return { id: s.id, title: s.title, answered: done, total: required.length, missing: required.filter(q => !isAnswered(q, responses)).map(q => q.id) };
  });
  const answered = sections.reduce((n, s) => n + s.answered, 0);
  const total = sections.reduce((n, s) => n + s.total, 0);
  const d = responses.declaration || {};
  const declarationDone = Boolean(d.agreed && hasText(d.full_name) && hasText(d.signature));
  return { sections, answered, total, declarationDone, complete: answered === total && declarationDone };
}

// "Yes, we have an anti-bribery policy" is a control, not a disclosure: a Yes there is good news
function isControlQuestion(sectionTitle = '', text = '') {
  return /procedure|polic(y|ies) and control/i.test(sectionTitle)
    || /^(a|an)\s|^does the supplier (have|screen)|^relevant certifications|^accurate books|^internal or external audit|^compliance training|^due diligence on/i.test(text);
}

/**
 * Derives the fields the re-screening engine and triage drawer rely on, whatever the template
 * wording is. Matching is by question / section text because officers can edit both.
 */
function deriveScreeningFields(template, responses = {}) {
  const answers = responses.answers || {};
  const tables = responses.tables || {};
  const yes = [];
  let ubo = [];

  for (const section of template.sections || []) {
    for (const q of section.questions) {
      if (q.type === 'table' && /beneficial owner/i.test(q.text)) {
        ubo = (tables[q.id] || []).map(row => {
          const entries = Object.entries(row || {});
          const find = re => (entries.find(([k]) => re.test(k)) || [])[1] || '';
          const pct = String(find(/%|held|control/i)).match(/\d+(\.\d+)?/);
          return { name: String(find(/name/i)).trim(), nationality: String(find(/nationality/i)).trim(), ownership: pct ? Number(pct[0]) : 0 };
        }).filter(u => u.name);
      }
      if (q.type === 'yesno' && answers[q.id] && answers[q.id].value === 'Yes') {
        yes.push({ id: q.id, section: section.title, text: q.text, details: answers[q.id].details || '' });
      }
    }
  }

  const isControl = y => isControlQuestion(y.section, y.text);
  const disclosures = yes.filter(y => !isControl(y));
  const hit = re => disclosures.filter(y => re.test(`${y.section} ${y.text}`));
  return {
    ubo_list: ubo,
    // Being a PEP / state-linked, not merely dealing with officials (permits, customs) in the course of work
    pep_declared: hit(/\bPEP\b|politically exposed|public office|government position|owned or controlled by a government/i).length > 0,
    litigation_declared: hit(/violation|investigat|convict|litigation|enforcement|insolvency|adverse media|bribery|fraud|laundering|debar/i).length > 0,
    sanctions_declared: hit(/sanction/i).length > 0,
    conflict_declared: hit(/conflict of interest|family member or close associate of a director or employee/i).length > 0,
    yes_answers: yes
  };
}

module.exports = {
  parseTemplateMarkdown,
  normalizeTemplate,
  countQuestions,
  templateHash,
  ensureDefaultTemplate,
  getActiveTemplate,
  isAnswered,
  computeProgress,
  deriveScreeningFields,
  isControlQuestion,
  QUESTION_TYPES
};
