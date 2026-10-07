const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { generateDDQ, processDDQAnswers } = require('../services/ddqService');

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

module.exports = router;
