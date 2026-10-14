/**
 * How near Dilly's suggestion was to the officer's final decision.
 *
 * One row per decided request (table suggestion_outcomes): what Dilly suggested when the officer decided, the
 * line between "low" and "medium or high" in the rules in force then, and the decision.
 *
 *   suggested on or over the line, and Rejected   Agreed
 *   suggested under the line, and Approved        Agreed
 *   suggested on or over the line, and Approved   Dilly was stricter
 *   suggested under the line, and Rejected        Dilly was more lenient
 *   "Request more info" is not a final decision   Waiting (counted when the request is approved or rejected)
 *
 * The judging is one SQL statement (AGREEMENT_SQL). In BigQuery it is the view `dilly_agreement`; offline the
 * same statement runs on SQLite. No model is trained and nothing here changes a score, a route or a suggestion.
 */
const config = require('../config');
const bq = require('../services/bigquery');
const { getRules } = require('../risk/rulesStore');
const { currentWorkspaceId } = require('../db');

const OUTCOMES_TABLE = 'suggestion_outcomes';
const VIEW_NAME = 'dilly_agreement';
const FINAL = { Approved: true, Rejected: true };
const LABELS = { agreed: 'Agreed', dilly_stricter: 'Dilly was stricter', dilly_more_lenient: 'Dilly was more lenient', waiting: 'Waiting', no_suggestion: 'No suggestion on record' };
const COLUMNS = ['kyc_id', 'entity_id', 'counterparty_name', 'suggestion_mode', 'suggested_risk', 'suggested_route', 'suggested_at', 'risk_line', 'decision', 'is_final', 'decided_by', 'decided_at', 'is_demo'];

/** The judging, as SQL that both SQLite and BigQuery run unchanged. `table` is the outcomes table as that engine names it. */
const AGREEMENT_SQL = table => `SELECT ${COLUMNS.join(', ')},
  CASE
    WHEN is_final = 0 THEN 'waiting'
    WHEN suggested_risk IS NULL THEN 'no_suggestion'
    WHEN suggested_risk >= risk_line AND decision = 'Rejected' THEN 'agreed'
    WHEN suggested_risk < risk_line AND decision = 'Approved' THEN 'agreed'
    WHEN suggested_risk >= risk_line AND decision = 'Approved' THEN 'dilly_stricter'
    ELSE 'dilly_more_lenient'
  END AS result
FROM ${table}`;

/**
 * Stores an officer's decision on a request next to the suggestion that was current when it was made.
 * status: the request status the decision leads to (Approved, Rejected, or Pending DDQ for "Request more info").
 */
function recordDecision(db, request, status, reviewer = '') {
  const entityId = `kyc-${String(request.id).toLowerCase()}`;
  const decidedAt = new Date().toISOString();
  const s = db.getLatestSuggestion(entityId, { before: decidedAt });
  const score = Number(request.ai_score);
  db.saveOutcome({
    kycId: request.id, entityId, counterpartyName: request.counterparty_name,
    suggestionId: s ? s.id : null, suggestionMode: s ? s.mode : 'rules',
    suggestedRisk: s ? s.risk : (Number.isFinite(score) ? score : null), suggestedRoute: s ? s.route : null, suggestedAt: s ? s.at : null,
    riskLine: s && s.riskLine ? s.riskLine : getRules(db).routes.riskLine,
    decision: status, isFinal: Boolean(FINAL[status]), decidedBy: reviewer, decidedAt, isDemo: !currentWorkspaceId()
  });
}

const typed = r => Object.assign({}, r, {
  suggested_risk: r.suggested_risk === null || r.suggested_risk === undefined || r.suggested_risk === '' ? null : Number(r.suggested_risk),
  risk_line: Number(r.risk_line), is_final: Number(r.is_final) === 1 || r.is_final === true || r.is_final === 'true', is_demo: Number(r.is_demo) === 1 || r.is_demo === true || r.is_demo === 'true'
});

/** Counts, rate and the list of disagreements from judged rows (whichever engine judged them). */
function summarise(rows, via) {
  const cases = rows.map(typed).map(r => Object.assign(r, { resultLabel: LABELS[r.result] || r.result }));
  const count = result => cases.filter(c => c.result === result).length;
  const agreed = count('agreed');
  const stricter = count('dilly_stricter');
  const lenient = count('dilly_more_lenient');
  const judged = agreed + stricter + lenient;
  return {
    via, judged, agreed, stricter, lenient, waiting: count('waiting'),
    agreementRate: judged ? Math.round((agreed / judged) * 100) : null,
    disagreements: cases.filter(c => c.result === 'dilly_stricter' || c.result === 'dilly_more_lenient').sort((a, b) => String(b.decided_at).localeCompare(String(a.decided_at))),
    cases
  };
}

/** The offline judging: the same statement, on this workspace's SQLite database. */
const local = db => summarise(db.queryOutcomes(AGREEMENT_SQL(OUTCOMES_TABLE)), 'Offline (SQLite)');

const workspace = () => currentWorkspaceId() || 'demo';
const syncSql = () => `CREATE OR REPLACE TABLE ${bq.table(OUTCOMES_TABLE)} AS
  SELECT
    JSON_VALUE(r, '$.kyc_id') AS kyc_id, JSON_VALUE(r, '$.entity_id') AS entity_id, JSON_VALUE(r, '$.counterparty_name') AS counterparty_name,
    JSON_VALUE(r, '$.suggestion_mode') AS suggestion_mode, SAFE_CAST(JSON_VALUE(r, '$.suggested_risk') AS INT64) AS suggested_risk,
    JSON_VALUE(r, '$.suggested_route') AS suggested_route, JSON_VALUE(r, '$.suggested_at') AS suggested_at,
    SAFE_CAST(JSON_VALUE(r, '$.risk_line') AS INT64) AS risk_line, JSON_VALUE(r, '$.decision') AS decision,
    SAFE_CAST(JSON_VALUE(r, '$.is_final') AS INT64) AS is_final, JSON_VALUE(r, '$.decided_by') AS decided_by, JSON_VALUE(r, '$.decided_at') AS decided_at,
    SAFE_CAST(JSON_VALUE(r, '$.is_demo') AS INT64) AS is_demo, JSON_VALUE(r, '$.workspace_id') AS workspace_id
  FROM UNNEST(JSON_QUERY_ARRAY(@rows)) AS r`;
const viewSql = () => `CREATE OR REPLACE VIEW ${bq.table(VIEW_NAME)} AS\n${AGREEMENT_SQL(bq.table(OUTCOMES_TABLE))}`;
const readSql = () => `SELECT * FROM ${bq.table(VIEW_NAME)}`;

/**
 * BigQuery does the judging: the decided requests are uploaded, the view holds the rule, and the view is read.
 * Run only when a compliance officer asks for it. Falls back to the offline judging and says why.
 */
async function judgeInBigQuery(db) {
  const offline = local(db);
  if (!bq.live()) return Object.assign(offline, { reason: 'BigQuery is not connected (BIGQUERY=bigquery).' });
  try {
    const rows = db.getOutcomeRows().map(r => Object.assign({}, r, { workspace_id: workspace() }));
    const sync = await bq.query(syncSql(), { params: { rows: JSON.stringify(rows) }, waitMs: 60000 });
    await bq.query(viewSql(), { waitMs: 60000 });
    const read = await bq.query(readSql(), { waitMs: 60000 });
    const out = Object.assign(summarise(read.rows, `BigQuery (view ${VIEW_NAME})`), { bytesProcessed: (sync.bytesProcessed || 0) + (read.bytesProcessed || 0), judgedAt: new Date().toISOString() });
    db.setSetting('dilly_agreement_bigquery', { judgedAt: out.judgedAt, judged: out.judged, agreed: out.agreed, stricter: out.stricter, lenient: out.lenient, waiting: out.waiting, agreementRate: out.agreementRate, bytesProcessed: out.bytesProcessed });
    return out;
  } catch (err) {
    console.error('[Agreement] BigQuery could not judge, using the offline judging:', err.message);
    return Object.assign(offline, { reason: 'BigQuery could not be reached, so the same rule was run inside the app.' });
  }
}

/** What Reviews shows without asking BigQuery anything: the offline judging, and BigQuery's last answer if there is one. */
function overview(db) {
  return Object.assign(local(db), { labels: LABELS, bigQuery: { connected: bq.live(), last: db.getSetting('dilly_agreement_bigquery', null), dataset: config.bigquery.dataset || null } });
}

module.exports = { recordDecision, overview, local, judgeInBigQuery, summarise, AGREEMENT_SQL, syncSql, viewSql, readSql, OUTCOMES_TABLE, VIEW_NAME, LABELS };
