/**
 * What the review model looks at for one case: numbers taken from the case's score breakdown and record.
 * The same list is used for training rows, for predictions and for the plain-word reasons shown to a reviewer.
 */
const riskService = require('../risk/riskService');

// name, the words shown to a reviewer, and how a value is described
const FEATURES = [
  { name: 'kind', label: 'Type of counterparty', categorical: ['org', 'person', 'vessel'] },
  { name: 'rule_risk', label: 'Risk points from the rules' },
  { name: 'rule_confidence', label: 'Confidence from the evidence' },
  { name: 'findings_counted', label: 'Findings that scored points' },
  { name: 'findings_left_out', label: 'Findings read but not counted' },
  { name: 'pts_sanctions', label: 'Points from sanctions findings' },
  { name: 'pts_pep', label: 'Points from PEP findings' },
  { name: 'pts_country', label: 'Points from country risk' },
  { name: 'pts_adverse_media', label: 'Points from adverse media' },
  { name: 'pts_ownership', label: 'Points from unclear ownership' },
  { name: 'pts_vessel', label: 'Points from vessel behaviour' },
  { name: 'pts_other', label: 'Points from other rules' },
  { name: 'country_cpi', label: 'Country CPI score (low is bad)' },
  { name: 'checks_ran_share', label: 'Share of required checks that ran' },
  { name: 'weak_sources', label: 'Findings from lower-trust sources' },
  { name: 'is_broker', label: 'Broker or intermediary' },
  { name: 'is_state_owned', label: 'State-owned or state-linked' },
  { name: 'ddq_pending', label: 'Questionnaire not yet returned' }
];
const NUMERIC = FEATURES.filter(f => !f.categorical).map(f => f.name);
const GROUP = { sanctions_confirmed: 'pts_sanctions', sanctions_possible: 'pts_sanctions', pep_owner: 'pts_pep', pep_associate: 'pts_pep', country_cpi_low: 'pts_country', country_cpi_mid: 'pts_country', adverse_media_severe: 'pts_adverse_media', adverse_media_other: 'pts_adverse_media', ownership_unclear: 'pts_ownership', vessel_ais_dark: 'pts_vessel', vessel_sts_transfer: 'pts_vessel', vessel_flag_changes: 'pts_vessel' };
const UNKNOWN_CPI = 50;

function cpiOf(db, a3) {
  try {
    // Records hold a country code or a country name
    const row = a3 ? db.getCpiByCodeOrName(a3) : null;
    return row && Number.isFinite(Number(row.score)) ? Number(row.score) : UNKNOWN_CPI;
  } catch (e) { return UNKNOWN_CPI; }
}

/** The feature values of one case, or null when it has not been scored from findings. */
function featuresFor(db, entityId) {
  const b = riskService.assessEntity(db, entityId);
  const e = db.getEntityById(entityId);
  if (!b || !e) return null;
  const f = Object.fromEntries(NUMERIC.map(n => [n, 0]));
  f.kind = ['org', 'person', 'vessel'].includes(b.kind) ? b.kind : 'org';
  f.rule_risk = b.risk;
  f.rule_confidence = b.confidence;
  f.findings_counted = b.lines.filter(l => l.points > 0).length;
  f.findings_left_out = (b.notCounted || []).length + (b.rejected || []).length;
  for (const l of b.lines) f[GROUP[l.category] || 'pts_other'] += l.points;
  f.country_cpi = cpiOf(db, e.kind === 'vessel' ? (e.flag || e.a3) : e.a3);
  const checks = (b.coverage && b.coverage.list) || [];
  f.checks_ran_share = checks.length ? Math.round((checks.filter(c => c.ran).length / checks.length) * 100) / 100 : 1;
  f.weak_sources = b.lines.filter(l => l.points > 0 && l.confidenceParts && l.confidenceParts.sourceTrust < 1).length;
  f.is_broker = /broker|intermediar|agent/i.test(`${e.role || ''} ${e.type || ''}`) ? 1 : 0;
  f.is_state_owned = e.stateOwned ? 1 : 0;
  f.ddq_pending = e.ddqPending ? 1 : 0;
  return { features: f, risk: b.risk, confidence: b.confidence, route: b.route, routeLabel: b.routeLabel, name: b.name };
}

const labelOf = name => (FEATURES.find(f => f.name === name) || { label: name }).label;

module.exports = { FEATURES, NUMERIC, featuresFor, labelOf, UNKNOWN_CPI };
