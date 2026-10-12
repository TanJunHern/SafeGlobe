/**
 * The review model: labels, training, predictions (src/learning). Compliance officers only; the router is
 * mounted behind officerOnly. Training and inference that reach BigQuery are rate limited and capped per day.
 *
 *   GET    /api/learning/status          labels, the model, its tuning trials and metrics, the glossary
 *   GET    /api/learning/predictions     one row per scored case: prediction, suggestion, reasons, officer label
 *   POST   /api/learning/labels          { entityId, label: "red" | "green", note }
 *   POST   /api/learning/synthetic       { count }   synthetic demo data: labelled reviews
 *   DELETE /api/learning/synthetic
 *   POST   /api/learning/train           trains a new model on every labelled review
 *   POST   /api/learning/refresh         checks a running training job and re-runs inference
 *   PUT    /api/learning/threshold       { threshold }   how sure the model must be before it flags a likely miss
 */
const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { aiRateLimit } = require('../middleware/rateLimit');
const learning = require('../learning/learningService');

const fail = (res, err) => {
  if (!err.status) console.error('[Learning]', err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'The review model could not do that', message: err.status ? err.message : 'Please try again.' });
};

router.get('/status', async (req, res) => {
  try {
    const db = getDb();
    await learning.checkTraining(db);
    res.json(learning.status(db));
  } catch (err) { fail(res, err); }
});

router.get('/predictions', (req, res) => {
  const db = getDb();
  res.json({ predictions: learning.predictions(db), threshold: learning.status(db).threshold });
});

router.post('/labels', async (req, res) => {
  try {
    const db = getDb();
    const body = req.body || {};
    const label = learning.addLabel(db, String(body.entityId || ''), body.label, req.user || {}, body.note);
    res.status(201).json({ status: 'saved', label, labels: learning.status(db).labels });
  } catch (err) { fail(res, err); }
});

router.post('/synthetic', (req, res) => {
  try {
    const db = getDb();
    const out = learning.generateSynthetic(db, req.body && req.body.count);
    res.status(201).json(Object.assign({ status: 'added' }, out, { labels: learning.status(db).labels }));
  } catch (err) { fail(res, err); }
});

router.delete('/synthetic', (req, res) => {
  const db = getDb();
  res.json(Object.assign({ status: 'removed' }, learning.clearSynthetic(db), { labels: learning.status(db).labels }));
});

router.post('/train', aiRateLimit, async (req, res) => {
  try {
    const db = getDb();
    const model = await learning.train(db, req.user || {});
    res.status(model.status === 'training' ? 202 : 201).json({ status: model.status, modelId: model.id, backend: model.backend, learning: learning.status(db) });
  } catch (err) { fail(res, err); }
});

router.post('/refresh', aiRateLimit, async (req, res) => {
  try {
    const db = getDb();
    await learning.checkTraining(db);
    await learning.refreshPredictions(db);
    res.json({ status: 'done', learning: learning.status(db), predictions: learning.predictions(db) });
  } catch (err) { fail(res, err); }
});

router.put('/threshold', async (req, res) => {
  try {
    const db = getDb();
    const threshold = learning.setThreshold(db, req.body && req.body.threshold);
    await learning.refreshPredictions(db);
    res.json({ status: 'saved', threshold, predictions: learning.predictions(db) });
  } catch (err) { fail(res, err); }
});

module.exports = router;
