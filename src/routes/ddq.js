const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { generateDDQ, processDDQAnswers } = require('../services/ddqService');

// Registered before '/:id' so the literal path is not captured as an entity id
// GET /api/ddq/verify-token?token=...
router.get('/verify-token', (req, res) => {
  const { verifyDdqGuestToken } = require('../services/ddqService');
  const token = req.query.token;
  const result = verifyDdqGuestToken(token);
  if (!result.valid) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// ---------------------------------------------------------------------------
// Guest portal: draft autosave + AI guide. All scoped to the signed DDQ token.
// ---------------------------------------------------------------------------

// The AI endpoints are reachable by anyone holding a link, so cap usage per token
const AI_LIMIT = { windowMs: 10 * 60 * 1000, max: 60 };
const aiUsage = new Map();
function aiRateLimit(req, res, next) {
  const key = String((req.body && req.body.token) || '').slice(-32);
  const now = Date.now();
  const entry = aiUsage.get(key);
  if (!entry || now - entry.start > AI_LIMIT.windowMs) {
    aiUsage.set(key, { start: now, count: 1 });
    return next();
  }
  if (++entry.count > AI_LIMIT.max) {
    return res.status(429).json({ error: 'Too many assistant requests', message: 'Please wait a few minutes before asking the guide again.' });
  }
  next();
}

function guest(handler, { requireOpen = false } = {}) {
  return async (req, res) => {
    const { resolveGuestToken } = require('../services/ddqService');
    let state;
    try {
      state = resolveGuestToken(req.body && req.body.token, { requireOpen });
    } catch (err) {
      return res.status(400).json({ error: 'Invalid DDQ link', message: err.message });
    }
    try {
      res.json(await handler(req.body, state));
    } catch (err) {
      console.error('DDQ guest endpoint error:', err);
      res.status(500).json({ error: 'Request failed', message: err.message });
    }
  };
}

// POST /api/ddq/draft  { token, draft }
router.post('/draft', (req, res) => {
  try {
    const { saveDdqDraft } = require('../services/ddqService');
    res.json(saveDdqDraft(req.body.token, req.body.draft || {}));
  } catch (err) {
    res.status(400).json({ error: 'Could not save draft', message: err.message });
  }
});

// POST /api/ddq/document  { token, index, filename, mimeType, base64Data }
// Stores one supporting document and returns the metadata the portal keeps with the answers
router.post('/document', async (req, res) => {
  const { resolveGuestToken } = require('../services/ddqService');
  const storage = require('../services/documentStorage');
  let state;
  try {
    state = resolveGuestToken(req.body && req.body.token, { requireOpen: true });
  } catch (err) {
    return res.status(400).json({ error: 'Invalid DDQ link', message: err.message });
  }
  try {
    const document = await storage.saveDdqDocument({
      kycId: state.kyc_id,
      index: req.body.index,
      filename: req.body.filename,
      mimeType: req.body.mimeType,
      base64Data: req.body.base64Data
    });
    res.status(201).json({ success: true, document });
  } catch (err) {
    res.status(400).json({ error: 'Upload failed', message: err.message });
  }
});

// POST /api/ddq/assistant  { token, message, questionId, sectionId, language, history, responses }
router.post('/assistant', aiRateLimit, guest((body, state) => {
  const assistant = require('../services/ddqAssistantService');
  return assistant.assistantReply({
    template: state.template,
    request: state,
    questionId: body.questionId,
    sectionId: body.sectionId,
    message: body.message,
    language: body.language,
    history: Array.isArray(body.history) ? body.history : [],
    responses: body.responses || state.draft || {}
  });
}));

// POST /api/ddq/prefill  { token, filename, mimeType, base64Data | fileContent }
router.post('/prefill', aiRateLimit, guest((body, state) => {
  const assistant = require('../services/ddqAssistantService');
  return assistant.prefillFromDocument({
    template: state.template,
    filename: body.filename,
    mimeType: body.mimeType || '',
    base64Data: body.base64Data || '',
    fileContent: body.fileContent || ''
  });
}, { requireOpen: true }));

// POST /api/ddq/translate  { token, language }
router.post('/translate', aiRateLimit, guest((body, state) => {
  const assistant = require('../services/ddqAssistantService');
  return assistant.translateTemplate(state.template, body.language, body.ui);
}));

// GET /api/ddq/:id
router.get('/:id', (req, res) => {
  const db = getDb();
  const entity = db.getEntityById(req.params.id);
  if (!entity) {
    return res.status(404).json({ error: 'Entity not found' });
  }

  const questions = generateDDQ(entity);
  res.json({
    entityId: entity.id,
    name: entity.name,
    questions
  });
});

// POST /api/ddq/send
router.post('/send', (req, res) => {
  const { id, questions, dueDate } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'Field "id" is required' });
  }

  const db = getDb();
  const entity = db.getEntityById(id);
  if (!entity) {
    return res.status(404).json({ error: 'Entity not found' });
  }

  entity.ddqPending = true;
  db.upsertEntity(entity);

  db.addAlert(
    'Smart DDQ',
    id,
    `Due diligence questionnaire dispatched to ${entity.short || entity.name}. Responses due ${dueDate || 'in 10 business days'}`,
    'investigate'
  );

  res.json({
    status: 'sent',
    message: `DDQ sent to ${entity.short || entity.name}`
  });
});

// POST /api/ddq/answer
router.post('/answer', (req, res) => {
  const { id, answers } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'Field "id" is required' });
  }

  const updatedEntity = processDDQAnswers(id, answers || {});
  if (!updatedEntity) {
    return res.status(404).json({ error: 'Entity not found' });
  }

  res.json({
    status: 'verified',
    entity: updatedEntity,
    newConfidence: updatedEntity.conf,
    message: `Smart DDQ answers verified. Confidence raised to ${updatedEntity.conf}%`
  });
});

// POST /api/ddq/submit
router.post('/submit', async (req, res) => {
  const { submitKycDdqAnswers } = require('../services/ddqService');
  const { token, responses } = req.body;
  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }

  try {
    const result = await submitKycDdqAnswers(token, responses || req.body);
    res.json(result);
  } catch (err) {
    console.error('Error submitting DDQ answers:', err);
    res.status(400).json({ error: 'Failed to submit DDQ answers', message: err.message });
  }
});

module.exports = router;
