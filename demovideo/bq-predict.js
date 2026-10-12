/**
 * Asks the real BigQuery ML model (duedilly_uat.review_risk_model, trained on 12 Oct 2026) for its predictions on
 * the cases in the local demo database, and reads its tuning trials. Read-only queries; nothing is trained.
 * record.js shows these in the Reviews scenes, so the screen shows genuine BigQuery ML output without a
 * 27-minute training run during recording.
 *   APP_ENV=uat BIGQUERY=bigquery DATABASE_PATH=demovideo/.data/demo.db node demovideo/bq-predict.js
 */
const { getDb } = require('../src/db');
const bqModel = require('../src/learning/bqModel');
const { featuresFor, labelOf } = require('../src/learning/features');

(async () => {
  const db = getDb();
  const cases = db.getScoredEntityIds().map(id => ({ id, snap: featuresFor(db, id) })).filter(c => c.snap);
  const [preds, trials] = await Promise.all([bqModel.explain(cases.map(c => ({ id: c.id, features: c.snap.features }))), bqModel.readTrials()]);
  const byId = new Map(preds.map(p => [p.id, p]));
  const out = cases.filter(c => byId.has(c.id)).map(c => {
    const p = byId.get(c.id);
    return { entityId: c.id, name: c.snap.name, p: p.p, ruleRisk: c.snap.risk, ruleConfidence: c.snap.confidence, ruleRoute: c.snap.routeLabel,
      reasons: p.reasons.map(r => ({ feature: r.feature, label: labelOf(r.feature), attribution: r.attribution, direction: r.attribution > 0 ? 'towards real risk' : 'towards not a risk' })) };
  });
  process.stdout.write(JSON.stringify({ fetchedAt: new Date().toISOString(), model: 'safe-globe-compliance.duedilly_uat.review_risk_model', trials, predictions: out }));
})().catch(err => { console.error(err.message); process.exit(1); });
