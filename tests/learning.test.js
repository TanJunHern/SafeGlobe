/**
 * The review model, offline: features, synthetic labelled reviews, training with tuning trials, predictions with
 * reasons, the "likely miss" suggestion, the guardrail (scores and routes never change), the BigQuery ML SQL and
 * result parsing (with a stand-in for BigQuery), and the API.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { getDb } = require('../src/db');
const features = require('../src/learning/features');
const synthetic = require('../src/learning/syntheticReviews');
const localModel = require('../src/learning/localModel');
const bqModel = require('../src/learning/bqModel');
const bq = require('../src/services/bigquery');
const learning = require('../src/learning/learningService');
const riskService = require('../src/risk/riskService');
const { startServer, stopServer } = require('../src/server');

const PORT = 8095;
const BASE = `http://localhost:${PORT}`;
const OFFICER = { 'x-user-email': 'compliance@duedilly.com', 'Content-Type': 'application/json' };
const EMPLOYEE = { 'x-user-email': 'john.doe@duedilly.com', 'Content-Type': 'application/json' };
const api = (path, opts = {}) => fetch(BASE + path, Object.assign({}, opts, { headers: Object.assign({}, OFFICER, opts.headers || {}) }));
const withConfig = async (patch, fn) => {
  const before = Object.fromEntries(Object.keys(patch).map(k => [k, config[k]]));
  Object.assign(config, patch);
  try { return await fn(); } finally { Object.assign(config, before); }
};
const scoresOf = db => db.getScoredEntityIds().map(id => { const b = riskService.assessEntity(db, id); return [id, b.risk, b.confidence, b.route]; });
const reset = db => { db.db.exec('DELETE FROM review_labels; DELETE FROM ml_models; DELETE FROM ml_predictions;'); db.setSetting('daily_budget_ml_train', null); db.setSetting('ml_threshold', 0.5); };

test('features: a case becomes numbers taken from its score breakdown', () => {
  const db = getDb();
  const a = features.featuresFor(db, 'aurora');
  assert.equal(a.risk, 85);
  assert.equal(a.features.kind, 'vessel');
  assert.equal(a.features.rule_risk, 85);
  assert.equal(a.features.pts_vessel, 50); // AIS dark 20 + ship-to-ship 20 + flag changes 10
  assert.equal(a.features.pts_country, 20);
  assert.equal(a.features.pts_ownership, 15);
  assert.equal(a.features.country_cpi, 26);
  assert.equal(a.features.findings_counted, 5);
  // Every feature has a value and a plain-word label
  for (const f of features.FEATURES) { assert.notEqual(a.features[f.name], undefined, f.name); assert.ok(f.label.length > 3); }
  assert.equal(features.featuresFor(db, 'no-such-case'), null);
});

test('synthetic demo data: labelled, repeatable, invented, and it contains misses to learn', () => {
  const db = getDb();
  const rows = synthetic.generate(db, { count: 400 });
  assert.equal(rows.length, 400);
  assert.deepEqual(synthetic.generate(db, { count: 400 }).map(r => r.label), rows.map(r => r.label)); // same seed, same data
  assert.ok(rows.every(r => r.isSynthetic === true && /^synthetic-case-/.test(r.entityId) && ['risk', 'no_risk'].includes(r.label)));
  assert.ok(rows.every(r => r.features.rule_risk >= 0 && r.features.rule_risk <= 100));
  // Rule points in the synthetic cases come from the points table in force
  assert.ok(rows.every(r => [0, 10, 20].includes(r.features.pts_country)));
  const low = rows.filter(r => r.features.rule_risk < 50);
  const misses = low.filter(r => r.label === 'risk').length;
  assert.ok(misses > 30 && misses < low.length * 0.6, `misses ${misses} of ${low.length}`);
  // The invented officer mostly agrees with the rules where no pattern applies
  const plain = { kind: 'org', rule_risk: 10, rule_confidence: 95, findings_left_out: 0, pts_country: 0, pts_ownership: 0, is_broker: 0, country_cpi: 80, weak_sources: 0, is_state_owned: 0, pts_sanctions: 0, checks_ran_share: 1 };
  assert.ok(synthetic.officerSaysRisk(plain) < 0.05);
  assert.ok(synthetic.officerSaysRisk(Object.assign({}, plain, { rule_risk: 90 })) > 0.9);
  assert.ok(synthetic.officerSaysRisk(Object.assign({}, plain, { rule_risk: 25, findings_left_out: 3, rule_confidence: 70 })) > 0.7);
});

test('offline model: trains with tuning trials, is measured on held-back reviews, and catches misses', () => {
  const db = getDb();
  const rows = synthetic.generate(db, { count: 600 });
  const out = localModel.train(rows, { threshold: 0.5, riskLine: 50 });
  assert.equal(out.split.training + out.split.validation + out.split.test, 600);
  // Hyperparameter tuning: several trials, one marked best, chosen by validation AUC
  assert.equal(out.trials.length, localModel.TRIALS.length);
  assert.equal(out.trials.filter(t => t.is_optimal).length, 1);
  const best = out.trials.find(t => t.is_optimal);
  assert.ok(out.trials.every(t => t.roc_auc <= best.roc_auc));
  assert.deepEqual(Object.keys(best.hyperparameters), ['max_tree_depth', 'learn_rate']);
  // Measured on reviews it never saw
  assert.ok(out.metrics.roc_auc > 0.8, `AUC ${out.metrics.roc_auc}`);
  assert.equal(out.metrics.true_positives + out.metrics.false_positives + out.metrics.true_negatives + out.metrics.false_negatives, out.split.test);
  assert.ok(out.metrics.missed_by_rules > 5);
  assert.ok(out.metrics.missed_caught_by_model / out.metrics.missed_by_rules >= 0.4, `${out.metrics.missed_caught_by_model} of ${out.metrics.missed_by_rules}`);
  // The same data gives the same model
  assert.deepEqual(localModel.train(rows, { threshold: 0.5, riskLine: 50 }).metrics, out.metrics);

  // A prediction is a probability with reasons, and a known miss pattern raises it
  const quiet = { kind: 'org', rule_risk: 20, rule_confidence: 95, findings_counted: 1, findings_left_out: 0, pts_sanctions: 0, pts_pep: 0, pts_country: 20, pts_adverse_media: 0, pts_ownership: 0, pts_vessel: 0, pts_other: 0, country_cpi: 30, checks_ran_share: 1, weak_sources: 0, is_broker: 0, is_state_owned: 0, ddq_pending: 0 };
  const noisy = Object.assign({}, quiet, { findings_left_out: 3 });
  const a = localModel.predict(out.model, quiet), b = localModel.predict(out.model, noisy);
  assert.ok(a.p >= 0 && a.p <= 1 && b.p > a.p + 0.2, `${a.p} -> ${b.p}`);
  assert.equal(b.reasons[0].feature, 'findings_left_out');
  assert.ok(b.reasons[0].attribution > 0);

  assert.throws(() => localModel.train(rows.slice(0, 10)), /At least 40 labelled reviews/);
  assert.throws(() => localModel.train(rows.filter(r => r.label === 'risk').slice(0, 50)), /all the same colour/);
});

test('more labelled reviews make a better model', () => {
  const db = getDb();
  const rows = synthetic.generate(db, { count: 800 });
  const small = localModel.train(rows.slice(0, 80)).metrics, large = localModel.train(rows).metrics;
  assert.ok(large.missed_by_rules > small.missed_by_rules);
  assert.ok(large.missed_caught_by_model > small.missed_caught_by_model);
});

test('suggestions: a likely miss asks for a person; a likely false alarm clears nothing', () => {
  assert.equal(learning.flagFor(0.82, 30, 0.5, 50), 'likely_miss');
  assert.equal(learning.flagFor(0.49, 30, 0.5, 50), 'agrees');
  assert.equal(learning.flagFor(0.1, 30, 0.5, 50), 'agrees');
  assert.equal(learning.flagFor(0.1, 80, 0.5, 50), 'likely_false_alarm');
  assert.equal(learning.flagFor(0.9, 80, 0.5, 50), 'agrees');
  // The holdout is a fixed 15% or so, the same rows every time
  const ids = Array.from({ length: 1000 }, (_, i) => ({ id: `syn-1-${i}` }));
  const held = ids.filter(learning.isHoldout).length;
  assert.ok(held > 110 && held < 190, String(held));
  assert.equal(learning.isHoldout(ids[3]), learning.isHoldout({ id: 'syn-1-3' }));
});

test('the loop: label, add synthetic data, train, predict. Scores and routes never change', async () => {
  const db = getDb();
  reset(db);
  const before = scoresOf(db);
  assert.equal(learning.status(db).model, null);
  assert.equal(learning.status(db).canTrain, false);
  await assert.rejects(learning.train(db, {}), /At least 40 labelled reviews/);

  // An officer classifies a case: red or green. A correction replaces the earlier label.
  const first = learning.addLabel(db, 'halcyon', 'red', { email: 'compliance@duedilly.com' }, 'Manages a vessel that went dark');
  assert.equal(first.label, 'risk');
  assert.equal(first.colour, 'red');
  assert.equal(first.agreesWithRules, false); // the rules scored Halcyon 40, below the line
  assert.equal(first.features.rule_risk, 40);
  learning.addLabel(db, 'halcyon', 'green', { email: 'compliance@duedilly.com' });
  assert.equal(db.getReviewLabels({ entityId: 'halcyon' }).length, 1);
  assert.equal(db.getReviewLabels({ entityId: 'halcyon' })[0].label, 'no_risk');
  assert.throws(() => learning.addLabel(db, 'halcyon', 'amber'), /red .* or green/);
  assert.throws(() => learning.addLabel(db, 'no-such-case', 'red'), /not been scored/);

  assert.equal(learning.generateSynthetic(db, 500).label, 'synthetic demo data');
  let s = learning.status(db);
  assert.equal(s.labels.synthetic.risk + s.labels.synthetic.no_risk, 500);
  assert.equal(s.labels.real.no_risk, 1);
  assert.equal(s.labels.syntheticShare, 100); // 500 of 501
  assert.equal(s.mode, 'local');
  assert.match(s.modeReason, /not connected/);

  const model = await learning.train(db, { email: 'compliance@duedilly.com' });
  assert.equal(model.status, 'ready');
  assert.equal(model.backend, 'local');
  s = learning.status(db);
  assert.equal(s.model.rows, 501);
  assert.equal(s.model.realRows, 1);
  assert.equal(s.model.syntheticRows, 500);
  assert.equal(s.model.backendLabel, 'Offline model (boosted trees inside the app)');
  assert.equal(s.model.tuning.trials.filter(t => t.is_optimal).length, 1);
  assert.ok(s.model.metrics.roc_auc > 0.75);
  assert.equal(s.history.length, 1);
  assert.ok(s.glossary.some(g => g.term === 'Hyperparameter tuning') && s.glossary.some(g => g.term === 'Inference') && s.glossary.some(g => g.term === 'Prediction') && s.glossary.some(g => g.term === 'Suggestion'));

  const preds = learning.predictions(db);
  assert.ok(preds.length >= 5 && ['aurora', 'halcyon', 'kestrel', 'severny', 'zemtsov'].every(id => preds.some(p => p.entityId === id)));
  for (const p of preds) {
    assert.ok(p.p >= 0 && p.p <= 1);
    assert.ok(['likely_miss', 'likely_false_alarm', 'agrees'].includes(p.flag));
    assert.equal(p.needsPerson, p.flag === 'likely_miss');
    assert.ok(Array.isArray(p.reasons));
  }
  assert.equal(preds.find(p => p.entityId === 'halcyon').officerLabel.colour, 'green');
  assert.equal(preds.find(p => p.entityId === 'aurora').officerLabel, null);
  // A confirmed sanctions match at 100 is never suggested as a false alarm into clearing anything: the flag is text only
  // GUARDRAIL: labelling, training and predicting changed no score, confidence or route
  assert.deepEqual(scoresOf(db), before);

  // The threshold is a setting; moving it changes suggestions, never scores
  assert.equal(learning.setThreshold(db, 0.3), 0.3);
  assert.throws(() => learning.setThreshold(db, 1.5), /between 5% and 95%/);
  await learning.refreshPredictions(db);
  assert.deepEqual(scoresOf(db), before);

  // An officer's own review counts for more than a synthetic one, so a correction shows up after retraining
  assert.equal(learning.status(db).realLabelWeight, 10);
  const halcyonBefore = learning.predictions(db).find(p => p.entityId === 'halcyon').p;
  learning.addLabel(db, 'halcyon', 'red', { email: 'compliance@duedilly.com' });
  await learning.train(db, {});
  const halcyonAfter = learning.predictions(db).find(p => p.entityId === 'halcyon');
  assert.ok(halcyonAfter.p > halcyonBefore + 0.15, `${halcyonBefore} -> ${halcyonAfter.p}`);
  assert.equal(halcyonAfter.officerLabel.colour, 'red');
  assert.equal(learning.status(db).history.length, 2);
  assert.deepEqual(scoresOf(db), before);

  // Synthetic rows can be removed without touching real labels
  assert.equal(learning.clearSynthetic(db).removed, 500);
  assert.equal(db.getReviewLabels().length, 1);
  db.setSetting('daily_budget_ml_train', null);

  // The daily cap
  learning.generateSynthetic(db, 100);
  await withConfig({ mlTrainDailyCap: 1 }, async () => { await learning.train(db, {}); await assert.rejects(learning.train(db, {}), /limit of 1 training runs/); });
  reset(db);
});

test('BigQuery ML: the SQL that trains, tunes and explains', () => {
  withConfigSync({ googleCloudProject: 'test-project', appEnv: 'uat', bigquery: { mode: 'bigquery', dataset: '', location: 'asia-southeast1', maxBytesBilled: 1000 } }, () => {
    const train = bqModel.trainSql(6);
    assert.match(train, /^CREATE OR REPLACE MODEL `test-project\.duedilly_uat\.review_risk_model`/);
    assert.match(train, /MODEL_TYPE = 'BOOSTED_TREE_CLASSIFIER'/);
    assert.match(train, /INPUT_LABEL_COLS = \['officer_label'\]/);
    assert.match(train, /NUM_TRIALS = 6/);
    assert.match(train, /MAX_PARALLEL_TRIALS = 3/);
    assert.match(train, /HPARAM_TUNING_OBJECTIVES = \['ROC_AUC'\]/);
    assert.match(train, /MAX_TREE_DEPTH = HPARAM_RANGE\(2, 6\)/);
    assert.match(train, /LEARN_RATE = HPARAM_RANGE\(0\.05, 0\.4\)/);
    assert.match(train, /ENABLE_GLOBAL_EXPLAIN = TRUE/);
    assert.match(train, /WHERE holdout = FALSE/); // held-back reviews are never trained on
    for (const f of features.FEATURES) assert.match(train, new RegExp(`\\b${f.name}\\b`));
    assert.doesNotMatch(train, /is_synthetic|review_id/); // neither is a feature

    const sync = bqModel.syncLabelsSql();
    assert.match(sync, /^CREATE OR REPLACE TABLE `test-project\.duedilly_uat\.review_labels` AS/);
    assert.match(sync, /UNNEST\(JSON_QUERY_ARRAY\(@rows\)\)/); // values travel as a parameter, never inside the SQL
    assert.match(bqModel.explainSql(4), /ML\.EXPLAIN_PREDICT\(\s*MODEL `test-project\.duedilly_uat\.review_risk_model`/);
    assert.match(bqModel.explainSql(4), /STRUCT\(4 AS top_k_features\)/);
    assert.match(bqModel.trialsSql(), /ML\.TRIAL_INFO\(MODEL/);

    // Every ordinary query carries a bytes limit; a training statement is started without waiting
    const req = bq.request('SELECT 1', { params: { rows: '[]' }, timeoutMs: 1000 });
    assert.equal(req.maximumBytesBilled, '1000');
    assert.equal(req.useLegacySql, false);
    assert.equal(req.location, 'asia-southeast1');
    assert.deepEqual(req.queryParameters, [{ name: 'rows', parameterType: { type: 'STRING' }, parameterValue: { value: '[]' } }]);
    assert.equal(bq.request('CREATE MODEL x', { limitBytes: false }).maximumBytesBilled, undefined);
    assert.equal(bq.table('review_labels; DROP TABLE x'), '`test-project.duedilly_uat.review_labelsDROPTABLEx`');
  });
  const row = bqModel.labelRow({ id: 'r1', label: 'risk', isSynthetic: true, features: { kind: 'org', rule_risk: 20 } }, true);
  assert.deepEqual(row, { review_id: 'r1', officer_label: 'risk', is_synthetic: 'true', holdout: 'true', kind: 'org', rule_risk: 20 });
});
function withConfigSync(patch, fn) {
  const before = Object.fromEntries(Object.keys(patch).map(k => [k, config[k]]));
  Object.assign(config, patch);
  try { return fn(); } finally { Object.assign(config, before); }
}

test('BigQuery ML: what comes back is read carefully', () => {
  // The probability is for the predicted class, and so are the attributions: both are turned to point towards "risk"
  const risk = bqModel.parsePrediction(JSON.stringify({ id: 'aurora', predicted_officer_label: 'risk', probability: 0.91, top_feature_attributions: [{ feature: 'pts_vessel', attribution: 1.2 }, { feature: 'rule_confidence', attribution: -0.3 }] }));
  assert.deepEqual(risk, { id: 'aurora', p: 0.91, reasons: [{ feature: 'pts_vessel', attribution: 1.2 }, { feature: 'rule_confidence', attribution: -0.3 }] });
  const clear = bqModel.parsePrediction({ id: 'apex', predicted_officer_label: 'no_risk', probability: 0.8, top_feature_attributions: [{ feature: 'rule_risk', attribution: 0.9 }] });
  assert.equal(clear.p, 0.2);
  assert.deepEqual(clear.reasons, [{ feature: 'rule_risk', attribution: -0.9 }]);
  assert.equal(bqModel.parsePrediction({ id: 'x', predicted_officer_label: 'maybe', probability: 0.5 }), null);
  assert.equal(bqModel.parsePrediction({ id: 'x', predicted_officer_label: 'risk', probability: 'high' }), null);

  const trials = bqModel.parseTrials([
    { j: JSON.stringify({ trial_id: 2, hyperparameters: { max_tree_depth: '4', learn_rate: 0.21234 }, hparam_tuning_evaluation_metrics: { roc_auc: 0.9312 }, is_optimal: true, status: 'SUCCEEDED' }) },
    { j: JSON.stringify({ trial_id: 1, hyperparameters: { max_tree_depth: '2', learn_rate: 0.05 }, hparam_tuning_evaluation_metrics: { roc_auc: 0.88 }, is_optimal: false }) }
  ]);
  assert.deepEqual(trials.map(t => t.trial_id), [1, 2]);
  assert.deepEqual(trials[1], { trial_id: 2, hyperparameters: { max_tree_depth: 4, learn_rate: 0.212 }, roc_auc: 0.931, is_optimal: true, status: 'SUCCEEDED' });
});

test('BigQuery ML path with a stand-in for BigQuery: sync, train, tune, measure on held-back reviews, predict', async () => {
  const db = getDb();
  reset(db);
  const before = scoresOf(db);
  learning.generateSynthetic(db, 300);
  const sent = [];
  let trainingPolls = 0;
  const local = localModel.train(db.getReviewLabels(), {}).model; // the stand-in answers with a real model's numbers
  const stubs = {
    live: () => true,
    query: async (sql, opts = {}) => {
      sent.push({ sql, params: opts.params });
      if (/ML\.TRIAL_INFO/.test(sql)) return { rows: [{ j: JSON.stringify({ trial_id: 1, hyperparameters: { max_tree_depth: 3, learn_rate: 0.2 }, hparam_tuning_evaluation_metrics: { roc_auc: 0.9 }, is_optimal: true }) }] };
      if (/ML\.EXPLAIN_PREDICT/.test(sql)) return { rows: JSON.parse(opts.params.rows).map(r => { const p = localModel.predict(local, r); const risk = p.p >= 0.5; return { j: JSON.stringify({ id: r.id, predicted_officer_label: risk ? 'risk' : 'no_risk', probability: risk ? p.p : 1 - p.p, top_feature_attributions: p.reasons.map(x => ({ feature: x.feature, attribution: risk ? x.attribution : -x.attribution })) }) }; }) };
      return { rows: [] };
    },
    start: async sql => { sent.push({ sql, started: true }); return { done: false, jobId: 'job_1', location: 'asia-southeast1' }; },
    poll: async () => ({ done: ++trainingPolls >= 2, error: null })
  };
  const real = Object.fromEntries(Object.keys(stubs).map(k => [k, bq[k]]));
  Object.assign(bq, stubs);
  try {
    const started = await learning.train(db, { email: 'compliance@duedilly.com' });
    assert.equal(started.status, 'training');
    assert.equal(started.backend, 'bigquery');
    assert.match(sent[0].sql, /CREATE OR REPLACE TABLE/);
    const uploaded = JSON.parse(sent[0].params.rows);
    assert.equal(uploaded.length, 300);
    assert.ok(uploaded.some(r => r.holdout === 'true') && uploaded.some(r => r.holdout === 'false'));
    assert.ok(sent[1].started && /CREATE OR REPLACE MODEL/.test(sent[1].sql));
    assert.equal(learning.status(db).training.status, 'training');
    assert.equal(learning.status(db).model, null); // nothing is used until training has finished
    await assert.rejects(learning.train(db, {}), /already being trained/);

    assert.equal((await learning.checkTraining(db)).status, 'training'); // first poll: not done
    const done = await learning.checkTraining(db);
    assert.equal(done.status, 'ready');
    const s = learning.status(db);
    assert.equal(s.model.backendLabel, 'BigQuery ML (boosted trees)');
    assert.equal(s.model.tuning.best.trial_id, 1);
    assert.ok(s.model.metrics.rows > 20 && s.model.metrics.rows < 80); // measured only on the held-back reviews
    assert.ok(s.model.metrics.roc_auc > 0.7);
    const preds = learning.predictions(db);
    assert.ok(preds.every(p => p.backend === 'bigquery' && p.p >= 0 && p.p <= 1));
    assert.deepEqual(scoresOf(db), before);

    // If BigQuery cannot be reached, the offline model is trained and says why
    reset(db);
    learning.generateSynthetic(db, 120);
    bq.query = async () => { throw new Error('BigQuery answered 403: access denied'); };
    const fallback = await learning.train(db, {});
    assert.equal(fallback.backend, 'local');
    assert.match(fallback.info.note, /BigQuery ML could not be used .*403/);
  } finally { Object.assign(bq, real); reset(db); }
});

test('the review model over HTTP', async t => {
  await startServer(PORT);
  t.after(async () => { await stopServer(); });
  const db = getDb();
  reset(db);

  for (const [method, path] of [['GET', '/api/learning/status'], ['GET', '/api/learning/predictions'], ['POST', '/api/learning/labels'], ['POST', '/api/learning/synthetic'], ['POST', '/api/learning/train'], ['DELETE', '/api/learning/synthetic']]) {
    const res = await fetch(BASE + path, { method, headers: EMPLOYEE, body: method === 'POST' ? '{}' : undefined });
    assert.equal(res.status, 403, `${method} ${path}`);
  }
  assert.equal((await api('/api/learning/train', { method: 'POST', body: '{}' })).status, 400);
  assert.equal((await api('/api/learning/labels', { method: 'POST', body: JSON.stringify({ entityId: 'aurora', label: 'purple' }) })).status, 400);

  const label = await api('/api/learning/labels', { method: 'POST', body: JSON.stringify({ entityId: 'aurora', label: 'red', note: 'Dark period and transfer' }) });
  assert.equal(label.status, 201);
  assert.equal((await label.json()).label.agreesWithRules, true);
  assert.equal((await api('/api/learning/synthetic', { method: 'POST', body: JSON.stringify({ count: 300 }) })).status, 201);
  const trained = await api('/api/learning/train', { method: 'POST', body: '{}' });
  assert.equal(trained.status, 201);
  const body = await trained.json();
  assert.equal(body.status, 'ready');
  assert.equal(body.learning.model.rows, 301);
  assert.ok(body.learning.guardrail.includes('never changes a risk score'));

  const preds = (await (await api('/api/learning/predictions')).json()).predictions;
  const aurora = preds.find(p => p.entityId === 'aurora');
  assert.equal(aurora.officerLabel.colour, 'red');
  assert.ok(aurora.percent >= 0 && aurora.percent <= 100);
  assert.equal(aurora.ruleRisk, 85);
  const thr = await api('/api/learning/threshold', { method: 'PUT', body: JSON.stringify({ threshold: 0.4 }) });
  assert.equal((await thr.json()).threshold, 0.4);
  assert.equal((await api('/api/learning/threshold', { method: 'PUT', body: JSON.stringify({ threshold: 7 }) })).status, 400);
  const removed = await (await api('/api/learning/synthetic', { method: 'DELETE' })).json();
  assert.equal(removed.removed, 300);
  assert.equal(removed.labels.real.risk, 1);
  reset(db);
});
