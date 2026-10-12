/**
 * The review model on BigQuery ML: a boosted-tree classifier (MODEL_TYPE = 'BOOSTED_TREE_CLASSIFIER') trained on
 * the labelled reviews, with hyperparameter tuning (NUM_TRIALS, HPARAM_RANGE) choosing the tree depth and the
 * learning rate. ML.EXPLAIN_PREDICT returns each prediction with the features that moved it.
 *
 * The SQL is built here from fixed names; values travel as one JSON query parameter, never inside the SQL text.
 * A slice of the labelled reviews is held back from training (holdout = TRUE) so the model can be measured on
 * reviews it has never seen.
 */
const config = require('../config');
const bq = require('../services/bigquery');
const { FEATURES, NUMERIC } = require('./features');

const LABELS_TABLE = 'review_labels';
const MODEL_NAME = 'review_risk_model';
const LABEL_COL = 'officer_label';

/** SELECT list that turns one JSON object per row (@rows) into typed columns. */
const featureColumns = alias => [`JSON_VALUE(${alias}, '$.kind') AS kind`, ...NUMERIC.map(n => `SAFE_CAST(JSON_VALUE(${alias}, '$.${n}') AS FLOAT64) AS ${n}`)].join(',\n    ');
const featureNames = () => FEATURES.map(f => f.name).join(', ');

function syncLabelsSql() {
  return `CREATE OR REPLACE TABLE ${bq.table(LABELS_TABLE)} AS
  SELECT
    JSON_VALUE(r, '$.review_id') AS review_id,
    JSON_VALUE(r, '$.${LABEL_COL}') AS ${LABEL_COL},
    JSON_VALUE(r, '$.is_synthetic') = 'true' AS is_synthetic,
    JSON_VALUE(r, '$.holdout') = 'true' AS holdout,
    ${featureColumns('r')}
  FROM UNNEST(JSON_QUERY_ARRAY(@rows)) AS r`;
}

function trainSql(trials = config.mlTuningTrials) {
  return `CREATE OR REPLACE MODEL ${bq.table(MODEL_NAME)}
OPTIONS(
  MODEL_TYPE = 'BOOSTED_TREE_CLASSIFIER',
  INPUT_LABEL_COLS = ['${LABEL_COL}'],
  NUM_TRIALS = ${Number(trials)},
  MAX_PARALLEL_TRIALS = ${Math.min(Number(trials), 3)},
  HPARAM_TUNING_OBJECTIVES = ['ROC_AUC'],
  MAX_TREE_DEPTH = HPARAM_RANGE(2, 6),
  LEARN_RATE = HPARAM_RANGE(0.05, 0.4),
  MAX_ITERATIONS = 40,
  EARLY_STOP = TRUE,
  ENABLE_GLOBAL_EXPLAIN = TRUE
) AS
SELECT ${LABEL_COL}, ${featureNames()}
FROM ${bq.table(LABELS_TABLE)}
WHERE holdout = FALSE`;
}

const trialsSql = () => `SELECT TO_JSON_STRING(t) AS j FROM ML.TRIAL_INFO(MODEL ${bq.table(MODEL_NAME)}) AS t`;

/** Predictions with reasons for the rows passed in @rows (each with an "id" and the features). */
function explainSql(topK = 4) {
  return `SELECT TO_JSON_STRING(t) AS j
FROM ML.EXPLAIN_PREDICT(
  MODEL ${bq.table(MODEL_NAME)},
  (SELECT JSON_VALUE(r, '$.id') AS id,
    ${featureColumns('r')}
   FROM UNNEST(JSON_QUERY_ARRAY(@rows)) AS r),
  STRUCT(${Number(topK)} AS top_k_features)) AS t`;
}

const labelRow = (row, holdout) => Object.assign({ review_id: row.id, [LABEL_COL]: row.label, is_synthetic: String(Boolean(row.isSynthetic)), holdout: String(Boolean(holdout)) }, row.features);

/** One ML.EXPLAIN_PREDICT row as { id, p: probability of "risk", reasons }. Attributions are for the predicted class, so they are turned to point towards "risk". */
function parsePrediction(json) {
  const r = typeof json === 'string' ? JSON.parse(json) : json;
  const predicted = r[`predicted_${LABEL_COL}`];
  const probability = Number(r.probability);
  if (!['risk', 'no_risk'].includes(predicted) || !Number.isFinite(probability)) return null;
  const sign = predicted === 'risk' ? 1 : -1;
  return {
    id: r.id,
    p: Math.round((predicted === 'risk' ? probability : 1 - probability) * 1000) / 1000,
    reasons: (r.top_feature_attributions || []).map(a => ({ feature: a.feature, attribution: Math.round(sign * Number(a.attribution) * 1000) / 1000 })).filter(a => Number.isFinite(a.attribution) && Math.abs(a.attribution) > 0.001)
  };
}

/** ML.TRIAL_INFO rows in the shape the screens use. Read defensively: only the fields that are there. */
function parseTrials(rows) {
  return rows.map(row => {
    const t = typeof row.j === 'string' ? JSON.parse(row.j) : row.j;
    const metrics = t.hparam_tuning_evaluation_metrics || t.eval_metrics || {};
    const hp = t.hyperparameters || t.hparams || {};
    return { trial_id: Number(t.trial_id), hyperparameters: { max_tree_depth: hp.max_tree_depth === undefined ? undefined : Number(hp.max_tree_depth), learn_rate: hp.learn_rate === undefined ? undefined : Math.round(Number(hp.learn_rate) * 1000) / 1000 },
      roc_auc: metrics.roc_auc === undefined ? null : Math.round(Number(metrics.roc_auc) * 1000) / 1000, is_optimal: Boolean(t.is_optimal), status: t.status || '' };
  }).sort((a, b) => a.trial_id - b.trial_id);
}

/**
 * Uploads the labelled reviews. An officer's own review that is used for training is written realWeight times,
 * so it counts for more than a synthetic one. Held-back reviews are written once and never trained on.
 */
async function syncLabels(rows, isHoldout, realWeight = 1) {
  const out = [];
  for (const r of rows) {
    const held = isHoldout(r);
    const copies = !r.isSynthetic && !held ? realWeight : 1;
    for (let k = 0; k < copies; k++) out.push(labelRow(k ? Object.assign({}, r, { id: `${r.id}#${k + 1}` }) : r, held));
  }
  return bq.query(syncLabelsSql(), { params: { rows: JSON.stringify(out) }, waitMs: 90000 });
}

const startTraining = () => bq.start(trainSql());
const pollTraining = job => bq.poll(job);

async function readTrials() {
  return parseTrials((await bq.query(trialsSql())).rows);
}

/** [{ id, p, reasons }] for [{ id, features }]. */
async function explain(items) {
  if (!items.length) return [];
  const out = await bq.query(explainSql(), { params: { rows: JSON.stringify(items.map(i => Object.assign({ id: i.id }, i.features))) }, waitMs: 90000 });
  return out.rows.map(r => parsePrediction(r.j)).filter(Boolean);
}

module.exports = { syncLabels, startTraining, pollTraining, readTrials, explain, syncLabelsSql, trainSql, trialsSql, explainSql, parsePrediction, parseTrials, labelRow, LABELS_TABLE, MODEL_NAME, LABEL_COL };
