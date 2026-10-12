/**
 * The review model: it learns from how compliance officers classify cases, and says which cases an officer
 * would probably mark as real risk.
 *
 *   label      an officer marks a case red (real risk) or green (not a risk). Every label is a training example.
 *   train      a supervised classifier (boosted trees) is trained on the labels: BigQuery ML when connected,
 *              otherwise the offline model inside the app. Hyperparameter tuning picks its settings.
 *   predict    for each case: the probability an officer would mark it real risk (inference), with reasons.
 *   suggest    "likely miss": the rules scored it below the line but the model expects an officer to call it risk.
 *              "likely false alarm": the rules scored it above the line but the model expects "not a risk".
 *
 * What the model may never do: change a risk score, a confidence or a route. It only suggests a second look.
 * A likely miss asks for a person; a likely false alarm never clears anything. A person signs every decision.
 */
const crypto = require('crypto');
const config = require('../config');
const bq = require('../services/bigquery');
const bqModel = require('./bqModel');
const localModel = require('./localModel');
const synthetic = require('./syntheticReviews');
const { FEATURES, featuresFor, labelOf } = require('./features');
const { getRules } = require('../risk/rulesStore');
const { takeDailyBudget, dailyBudgetLeft } = require('../middleware/rateLimit');

const LABELS = { risk: { colour: 'red', text: 'Real risk' }, no_risk: { colour: 'green', text: 'Not a risk' } };
const FROM_COLOUR = { red: 'risk', green: 'no_risk', risk: 'risk', no_risk: 'no_risk' };
const MIN_ROWS = 40;
// An officer's own review counts this many times a synthetic one in training, so corrections show up quickly
const REAL_LABEL_WEIGHT = 10;
const weighted = rows => rows.map(r => Object.assign({}, r, { weight: r.isSynthetic ? 1 : REAL_LABEL_WEIGHT }));
const FALSE_ALARM_BELOW = 0.2;

const GLOSSARY = [
  { term: 'Training data', text: 'The cases compliance officers have marked red (real risk) or green (not a risk). Each one is an example the model learns from. More examples, better model.' },
  { term: 'Supervised learning', text: 'Learning from examples that carry the right answer. Here the right answer is the officer\'s red or green. The model is a classifier: it sorts a case into one of the two.' },
  { term: 'Prediction', text: 'For a case, the probability that a compliance officer would mark it as real risk. 80% means: officers marked cases like this red four times out of five.' },
  { term: 'Inference', text: 'Using the trained model on a case it has not seen. Training happens now and then; inference happens every time a case is shown.' },
  { term: 'Suggestion', text: 'What the model does with a prediction: it flags a "likely miss" for a second look. It never changes the risk score or the route. A person decides.' },
  { term: 'Hyperparameter tuning', text: 'Before training, a model has settings, such as how deep each tree may grow and how fast it learns. Tuning trains several versions with different settings and keeps the one that scores best on reviews held back for checking.' },
  { term: 'Risk and confidence', text: 'Risk comes from the rules and the points table. Confidence comes from the quality of the evidence. The prediction is a third, separate signal: what officers have tended to decide. A ring on the chart marks where it disagrees with the rules.' }
];

// The line between Low and Medium risk (50 points), which is also the route line. It is locked in the rules.
const riskLine = db => { try { const medium = getRules(db).levels.find(l => l.id === 'medium'); return (medium && medium.min) || 50; } catch (e) { return 50; } };
const threshold = db => { const t = Number(db.getSetting('ml_threshold', 0.5)); return t >= 0.05 && t <= 0.95 ? t : 0.5; };
/**
 * A fixed 15% of the labelled reviews is never trained on, so the model can be measured on reviews it has not
 * seen, and one model can be compared with the next on the same reviews. While there are fewer than 50 of the
 * officers' own reviews, all of those are used for training and only synthetic reviews are held back.
 */
const HOLD_REAL_FROM = 50;
const hashHold = row => parseInt(crypto.createHash('md5').update(String(row.id)).digest('hex').slice(0, 8), 16) % 100 < 15;
const holdoutFor = rows => { const real = rows.filter(r => !r.isSynthetic).length; return row => (row.isSynthetic || real >= HOLD_REAL_FROM) && hashHold(row); };
const isHoldout = hashHold;

function flagFor(p, ruleRisk, t, line) {
  if (ruleRisk < line && p >= t) return 'likely_miss';
  if (ruleRisk >= line && p <= FALSE_ALARM_BELOW) return 'likely_false_alarm';
  return 'agrees';
}
const FLAG_TEXT = {
  likely_miss: 'Likely miss: the rules scored this below the line, but officers have marked cases like it as real risk. Suggestion: a person takes a second look.',
  likely_false_alarm: 'Likely false alarm: the rules scored this above the line, but officers have marked cases like it as not a risk. Suggestion only: nothing is cleared.',
  agrees: 'The prediction agrees with the rules.'
};
const describe = reasons => reasons.map(r => ({ feature: r.feature, label: labelOf(r.feature), attribution: r.attribution, direction: r.attribution > 0 ? 'towards real risk' : 'towards not a risk' }));

/** Test metrics from predictions on held-back reviews: the numbers shown as "how good is it". */
function holdoutMetrics(rows, probs, t, line) {
  const y = rows.map(r => (r.label === 'risk' ? 1 : 0));
  const m = localModel.metricsAt(probs, y, t);
  const a = localModel.auc(probs, y);
  const missed = rows.map((r, i) => ({ r, p: probs[i] })).filter(({ r }) => r.label === 'risk' && r.features.rule_risk < line);
  return Object.assign(m, { roc_auc: a === null ? null : Math.round(a * 1000) / 1000, missed_by_rules: missed.length, missed_caught_by_model: missed.filter(x => x.p >= t).length });
}

function addLabel(db, entityId, colour, user = {}, note = '') {
  const label = FROM_COLOUR[String(colour || '').toLowerCase()];
  if (!label) throw Object.assign(new Error('Mark the case red (real risk) or green (not a risk)'), { status: 400 });
  const snapshot = featuresFor(db, entityId);
  if (!snapshot) throw Object.assign(new Error('This case has not been scored from findings yet, so it cannot be labelled'), { status: 400 });
  // One current label per case: a correction replaces the earlier one
  for (const old of db.getReviewLabels({ entityId, synthetic: false })) db.db.prepare('DELETE FROM review_labels WHERE id = ?').run(old.id);
  const row = { id: `rev-${entityId}-${Date.now().toString(36)}`, entityId, label, features: snapshot.features, route: snapshot.route, reviewer: user.email || user.name || '', note: String(note || '').slice(0, 300), isSynthetic: false };
  db.saveReviewLabel(row);
  return Object.assign({ colour: LABELS[label].colour, text: LABELS[label].text, agreesWithRules: (label === 'risk') === (snapshot.risk >= riskLine(db)) }, row);
}

function generateSynthetic(db, count = 800) {
  const n = Math.max(MIN_ROWS, Math.min(3000, Number(count) || 800));
  db.deleteSyntheticReviewLabels();
  const rows = synthetic.generate(db, { count: n });
  for (const row of rows) db.saveReviewLabel(row);
  return { added: rows.length, label: 'synthetic demo data' };
}

const clearSynthetic = db => ({ removed: db.deleteSyntheticReviewLabels() });

const modelSummary = m => (m ? { id: m.id, backend: m.backend, backendLabel: m.backend === 'bigquery' ? 'BigQuery ML (boosted trees)' : 'Offline model (boosted trees inside the app)', status: m.status, trainedAt: m.createdAt, ...m.info } : null);

/** Everything the Reviews tab shows about the model. */
function status(db) {
  const counts = db.countReviewLabels();
  const total = counts.real.risk + counts.real.no_risk + counts.synthetic.risk + counts.synthetic.no_risk;
  const ready = db.getMlModel();
  const latest = db.getLatestMlModel();
  return {
    mode: bq.live() ? 'bigquery' : 'local',
    modeLabel: bq.live() ? 'BigQuery ML' : 'Offline model',
    modeReason: bq.live() ? '' : 'BigQuery is not connected (BIGQUERY=bigquery), so the model is trained inside the app.',
    labels: { real: counts.real, synthetic: counts.synthetic, total, syntheticShare: total ? Math.round(((counts.synthetic.risk + counts.synthetic.no_risk) / total) * 100) : 0 },
    canTrain: total >= MIN_ROWS, minRows: MIN_ROWS,
    threshold: threshold(db), riskLine: riskLine(db),
    model: modelSummary(ready),
    training: latest && latest.status === 'training' ? modelSummary(latest) : null,
    lastFailure: latest && latest.status === 'failed' ? modelSummary(latest) : null,
    history: db.listMlModels(8).filter(m => m.status === 'ready').map(m => ({ id: m.id, backend: m.backend, trainedAt: m.createdAt, rows: m.info.rows, realRows: m.info.realRows, roc_auc: m.info.metrics && m.info.metrics.roc_auc, recall: m.info.metrics && m.info.metrics.recall, missedCaught: m.info.metrics ? `${m.info.metrics.missed_caught_by_model} of ${m.info.metrics.missed_by_rules}` : '' })),
    trainsLeftToday: dailyBudgetLeft(db, 'ml_train', config.mlTrainDailyCap),
    features: FEATURES.map(f => ({ name: f.name, label: f.label })),
    glossary: GLOSSARY,
    realLabelWeight: REAL_LABEL_WEIGHT,
    guardrail: 'The model never changes a risk score, a confidence or a route. It suggests a second look, and a person decides.'
  };
}

function trainLocal(db, rows, info, note = '') {
  const t = threshold(db), line = riskLine(db);
  const out = localModel.train(weighted(rows), { threshold: t, riskLine: line, isHoldout: holdoutFor(rows) });
  const id = `model-${Date.now().toString(36)}`;
  db.saveMlModel({ id, backend: 'local', status: 'ready', model: out.model,
    info: Object.assign({}, info, { algorithm: 'Gradient-boosted decision trees', tuning: { objective: 'ROC AUC on held-back reviews', trials: out.trials, best: out.best }, split: out.split, metrics: out.metrics, note }) });
  refreshPredictions(db);
  return db.getMlModel(id);
}

/**
 * Trains a new model on every labelled review. With BigQuery ML this starts a training job and returns at once
 * (status "training"); checkTraining() finishes it. Offline it trains here and returns the finished model.
 */
async function train(db, user = {}) {
  const rows = db.getReviewLabels();
  if (rows.length < MIN_ROWS) throw Object.assign(new Error(`At least ${MIN_ROWS} labelled reviews are needed to train; there are ${rows.length}. Label more cases, or add the synthetic demo data.`), { status: 400 });
  if (new Set(rows.map(r => r.label)).size < 2) throw Object.assign(new Error('The labelled reviews are all the same colour. Both red and green examples are needed.'), { status: 400 });
  const running = db.getLatestMlModel();
  if (running && running.status === 'training') throw Object.assign(new Error('A model is already being trained. It usually takes a few minutes.'), { status: 409 });
  if (!takeDailyBudget(db, 'ml_train', config.mlTrainDailyCap)) throw Object.assign(new Error(`Today's limit of ${config.mlTrainDailyCap} training runs is used up.`), { status: 429 });
  const info = { rows: rows.length, realRows: rows.filter(r => !r.isSynthetic).length, syntheticRows: rows.filter(r => r.isSynthetic).length, trainedBy: user.email || '', threshold: threshold(db) };

  if (bq.live()) {
    try {
      await bqModel.syncLabels(rows, holdoutFor(rows), REAL_LABEL_WEIGHT);
      const job = await bqModel.startTraining();
      const id = `model-${Date.now().toString(36)}`;
      db.saveMlModel({ id, backend: 'bigquery', status: 'training', info: Object.assign({}, info, { algorithm: 'BigQuery ML BOOSTED_TREE_CLASSIFIER', job, startedAt: new Date().toISOString(), trialsPlanned: config.mlTuningTrials }) });
      return db.getMlModel(id);
    } catch (err) {
      console.error('[Learning] BigQuery ML training could not start, training the offline model instead:', err.message);
      return trainLocal(db, rows, info, `BigQuery ML could not be used (${err.message.slice(0, 160)}), so this is the offline model.`);
    }
  }
  return trainLocal(db, rows, info);
}

/** Finishes a BigQuery ML training job when it is done: reads the tuning trials, measures the model on held-back reviews, refreshes the predictions. */
async function checkTraining(db) {
  const m = db.getLatestMlModel();
  if (!m || m.status !== 'training') return m;
  const state = await bqModel.pollTraining(m.info.job);
  if (!state.done) return m;
  if (state.error) {
    db.saveMlModel({ id: m.id, backend: m.backend, status: 'failed', info: Object.assign({}, m.info, { error: state.error.slice(0, 300) }) });
    return db.getMlModel(m.id);
  }
  try {
    const trials = await bqModel.readTrials();
    const best = trials.find(t => t.is_optimal) || trials[0] || null;
    const labelled = db.getReviewLabels();
    const held = labelled.filter(holdoutFor(labelled));
    const preds = new Map((await bqModel.explain(held.map(r => ({ id: r.id, features: r.features })))).map(p => [p.id, p.p]));
    const scored = held.filter(r => preds.has(r.id));
    const metrics = holdoutMetrics(scored, scored.map(r => preds.get(r.id)), m.info.threshold, riskLine(db));
    db.saveMlModel({ id: m.id, backend: 'bigquery', status: 'ready', info: Object.assign({}, m.info, { finishedAt: new Date().toISOString(), tuning: { objective: 'ROC AUC (HPARAM_TUNING_OBJECTIVES)', trials, best: best ? { trial_id: best.trial_id, hyperparameters: best.hyperparameters } : null }, split: { training: m.info.rows - held.length, test: scored.length }, metrics }) });
    await refreshPredictions(db);
  } catch (err) {
    db.saveMlModel({ id: m.id, backend: m.backend, status: 'failed', info: Object.assign({}, m.info, { error: `The model trained, but its results could not be read: ${err.message.slice(0, 240)}` }) });
  }
  return db.getMlModel(m.id);
}

/** Runs the model on every scored case (inference) and stores the result. Scores and routes are not touched. */
async function refreshPredictions(db) {
  const m = db.getMlModel(null, { withModel: true });
  if (!m) return [];
  const t = threshold(db), line = riskLine(db);
  const cases = db.getScoredEntityIds().map(id => ({ id, snap: featuresFor(db, id) })).filter(c => c.snap);
  let raw;
  if (m.backend === 'bigquery' && bq.live()) raw = new Map((await bqModel.explain(cases.map(c => ({ id: c.id, features: c.snap.features })))).map(p => [p.id, p]));
  else if (m.model) raw = new Map(cases.map(c => [c.id, localModel.predict(m.model, c.snap.features)]));
  else return db.getPredictions();
  const out = cases.filter(c => raw.has(c.id)).map(c => {
    const p = raw.get(c.id);
    const flag = flagFor(p.p, c.snap.risk, t, line);
    return { entityId: c.id, name: c.snap.name, p: p.p, percent: Math.round(p.p * 100), flag, flagText: FLAG_TEXT[flag], needsPerson: flag === 'likely_miss', reasons: describe(p.reasons), ruleRisk: c.snap.risk, ruleConfidence: c.snap.confidence, ruleRoute: c.snap.routeLabel, backend: m.backend };
  });
  db.savePredictions(m.id, out);
  return out;
}

/** Stored predictions with each case's current officer label. A case labelled before any model exists is listed too. */
function predictions(db) {
  const labels = new Map(db.getReviewLabels({ synthetic: false }).map(l => [l.entityId, l]));
  const officer = id => { const l = labels.get(id); return l ? { label: l.label, colour: LABELS[l.label].colour, text: LABELS[l.label].text, by: l.reviewer, at: l.createdAt } : null; };
  const stored = db.getPredictions();
  const seen = new Set(stored.map(p => p.entityId));
  return [
    ...stored.map(p => Object.assign({}, p, { officerLabel: officer(p.entityId) })),
    ...[...labels.keys()].filter(id => !seen.has(id)).map(id => ({ entityId: id, p: null, percent: null, flag: null, reasons: [], officerLabel: officer(id) }))
  ];
}

function setThreshold(db, value) {
  const t = Number(value);
  if (!(t >= 0.05 && t <= 0.95)) throw Object.assign(new Error('The threshold must be between 5% and 95%'), { status: 400 });
  db.setSetting('ml_threshold', Math.round(t * 100) / 100);
  return threshold(db);
}

module.exports = { REAL_LABEL_WEIGHT, status, addLabel, generateSynthetic, clearSynthetic, train, checkTraining, refreshPredictions, predictions, setThreshold, flagFor, holdoutMetrics, isHoldout, GLOSSARY, LABELS, MIN_ROWS };
