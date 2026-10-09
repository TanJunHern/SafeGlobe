const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const templateService = require('../services/ddqTemplateService');
const documentParser = require('../services/documentParserService');

// DDQ Manager: only compliance officers may view or change questionnaire templates
router.use(authenticate, requireRole('compliance_officer'));

const editor = req => `${req.user.name} (Compliance Officer)`;

// GET /api/ddq-templates
router.get('/', (req, res) => {
  templateService.ensureDefaultTemplate();
  res.json({ success: true, templates: getDb().listDdqTemplates() });
});

// POST /api/ddq-templates/import  { markdown | base64Data, filename, mimeType, name }
// .md is parsed directly; PDF / Word are reserved for Google Document AI (not connected yet)
router.post('/import', async (req, res) => {
  const { markdown = '', base64Data = '', filename = '', mimeType = '', name = '' } = req.body || {};
  if (!String(markdown).trim() && !base64Data) {
    return res.status(400).json({ error: 'Template file is empty' });
  }
  let extracted;
  try {
    extracted = await documentParser.extractTemplateMarkdown({ filename, mimeType, markdown, base64Data });
  } catch (err) {
    if (err.code === 'PARSER_UNAVAILABLE') {
      return res.status(415).json({ error: 'Template format not supported yet', message: err.message, fallback: '.md' });
    }
    throw err;
  }
  const template = templateService.parseTemplateMarkdown(extracted.markdown);
  if (!template.sections.length) {
    return res.status(400).json({
      error: 'No questionnaire sections found',
      message: 'Expected numbered "## 1. Section" headings, each followed by a | No. | Question | Response | table.'
    });
  }
  const saved = getDb().saveDdqTemplate({
    name: String(name).trim() || template.title,
    source_filename: filename,
    template,
    updated_by: editor(req)
  });
  res.status(201).json({ success: true, template: saved, parser: extracted.parser, question_count: templateService.countQuestions(template) });
});

// POST /api/ddq-templates  { name, template? , copyFrom? }  create blank or duplicate
router.post('/', (req, res) => {
  const db = getDb();
  const { name = '', template, copyFrom } = req.body || {};
  let body = template;
  if (copyFrom) {
    const source = db.getDdqTemplate(copyFrom);
    if (!source) return res.status(404).json({ error: 'Template to copy not found' });
    body = source.template;
  }
  const normalized = templateService.normalizeTemplate(body || { title: name || 'New questionnaire', sections: [{ title: 'Section 1', questions: [] }] });
  const saved = db.saveDdqTemplate({ name: String(name).trim() || normalized.title, template: normalized, updated_by: editor(req) });
  res.status(201).json({ success: true, template: saved });
});

// GET /api/ddq-templates/:id
router.get('/:id', (req, res) => {
  const template = getDb().getDdqTemplate(req.params.id);
  if (!template) return res.status(404).json({ error: 'Template not found' });
  res.json({ success: true, template });
});

// PUT /api/ddq-templates/:id  { name, template }
router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = db.getDdqTemplate(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Template not found' });
  const normalized = templateService.normalizeTemplate((req.body && req.body.template) || existing.template);
  if (!normalized.sections.length) {
    return res.status(400).json({ error: 'A questionnaire needs at least one section' });
  }
  const saved = db.saveDdqTemplate({
    id: existing.id,
    name: String((req.body && req.body.name) || existing.name).trim() || existing.name,
    template: normalized,
    updated_by: editor(req)
  });
  res.json({ success: true, template: saved, question_count: templateService.countQuestions(normalized) });
});

// POST /api/ddq-templates/:id/activate
router.post('/:id/activate', (req, res) => {
  const activated = getDb().activateDdqTemplate(req.params.id);
  if (!activated) return res.status(404).json({ error: 'Template not found' });
  res.json({ success: true, template: activated, message: `${activated.name} is now sent with every new DDQ` });
});

// DELETE /api/ddq-templates/:id
router.delete('/:id', (req, res) => {
  const db = getDb();
  const existing = db.getDdqTemplate(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Template not found' });
  if (existing.is_active) return res.status(400).json({ error: 'The active template cannot be deleted. Activate another one first.' });
  db.deleteDdqTemplate(existing.id);
  res.json({ success: true });
});

module.exports = router;
