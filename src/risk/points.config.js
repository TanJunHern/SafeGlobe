/**
 * Risk scoring rules: the single definition of the points table, levels, thresholds, confidence weights
 * and routes (GEMINI.md sections 4.3 to 4.7).
 *
 * These are the DEFAULTS. A compliance officer can change the editable numbers in Reviews > Scoring rules;
 * those edits are stored in the database and merged over this file by risk/rulesStore.js. The scorer, the
 * "Why <score>?" panel, the Reviews editor and the "How Dilly works" page all read the merged result, so no
 * number is written anywhere else.
 */

const RULES_VERSION = 1;

// Each row counts at most once per case. `group` rows are alternatives: only the highest one present counts.
const ROWS = [
  { id: 'sanctions_confirmed', label: 'Confirmed sanctions match: name plus a second identifier (date of birth, registration number or IMO)', short: 'Confirmed sanctions match', points: 100, policy: '§1.1', check: 'sanctions', setsTotal: true, alwaysEscalate: true, locked: true, lockedReason: 'A confirmed sanctions match is always 100 and always goes to Escalate.' },
  { id: 'sanctions_possible', label: 'Possible sanctions match: name only, strong similarity', short: 'Possible sanctions match', points: 40, policy: '§1.1', check: 'sanctions' },
  { id: 'pep_owner', label: 'Director, shareholder or beneficial owner is a PEP', short: 'PEP owner or director', points: 25, policy: '§3.6', check: 'pep' },
  { id: 'pep_associate', label: 'Family member or close associate of a PEP', short: 'PEP family or associate', points: 15, policy: '§3.6', check: 'pep' },
  { id: 'country_cpi_low', label: 'Country CPI below {cpiLow}', short: 'High-risk country', points: 20, policy: '§4.1', check: 'country', group: 'country' },
  { id: 'country_cpi_mid', label: 'Country CPI {cpiLow} to {cpiMidMax}', short: 'Medium-risk country', points: 10, policy: 'Proposed, not in policy yet', check: 'country', group: 'country' },
  { id: 'adverse_media_severe', label: 'Severe adverse media in the last {adverseMediaMonths} months (fraud, bribery, sanctions evasion)', short: 'Severe adverse media', points: 25, policy: '§1.2', check: 'adverse_media' },
  { id: 'adverse_media_other', label: 'Other adverse media in the last {adverseMediaMonths} months', short: 'Other adverse media', points: 10, policy: '§1.2', check: 'adverse_media' },
  { id: 'ownership_unclear', label: 'Ownership unclear (nominees, bearer shares, offshore holding, beneficial owner unknown)', short: 'Ownership unclear', points: 15, policy: '§1.3', check: 'ownership' },
  { id: 'broker_intermediary', label: 'Broker or intermediary', short: 'Broker or intermediary', points: 10, policy: '§5.2', check: null },
  { id: 'vessel_ais_dark', label: 'Vessel: AIS dark for more than {aisDarkHours} hours in the last {aisWindowDays} days', short: 'Vessel AIS dark', points: 20, policy: '§5.4', check: 'vessel_behaviour' },
  { id: 'vessel_sts_transfer', label: 'Vessel: ship-to-ship transfer in a high-risk area', short: 'Vessel ship-to-ship transfer', points: 20, policy: '§5.4', check: 'vessel_behaviour' },
  { id: 'vessel_flag_changes', label: 'Vessel: {flagChanges} or more flag changes in {flagWindowYears} years', short: 'Vessel flag changes', points: 10, policy: '§5.4', check: 'vessel_behaviour' },
  { id: 'contract_value_high', label: 'Contract value above SGD {contractValueSgd}', short: 'High contract value', points: 5, policy: '§2.1', check: null, sendsDdq: true },
  { id: 'ddq_contradiction', label: 'DDQ answer contradicts the evidence', short: 'DDQ contradiction', points: 15, policy: '', check: null, ddqFact: true },
  { id: 'ddq_not_returned', label: 'DDQ not returned after {ddqOverdueDays} days', short: 'DDQ overdue', points: 10, policy: '', check: null, ddqFact: true }
];

// Risk levels (section 4.4). The 50-point line is also the route line, so the lower bound of Medium is locked.
const LEVELS = [
  { id: 'low', label: 'Low', min: 0, max: 49, colour: 'green' },
  { id: 'medium', label: 'Medium', min: 50, max: 74, colour: 'amber' },
  { id: 'high', label: 'High', min: 75, max: 100, colour: 'red' }
];

// The numbers quoted inside the row labels. Editable, with the bounds used to validate an edit.
const THRESHOLDS = {
  cpiLow: { value: 40, min: 1, max: 99, unit: 'CPI score', label: 'Country counts as high risk below this CPI score' },
  cpiMid: { value: 60, min: 2, max: 100, unit: 'CPI score', label: 'Country counts as medium risk below this CPI score' },
  adverseMediaMonths: { value: 24, min: 1, max: 120, unit: 'months', label: 'How far back adverse media counts' },
  aisDarkHours: { value: 24, min: 1, max: 720, unit: 'hours', label: 'AIS gap that counts as dark' },
  aisWindowDays: { value: 90, min: 1, max: 730, unit: 'days', label: 'How far back an AIS gap counts' },
  flagChanges: { value: 2, min: 1, max: 20, unit: 'changes', label: 'Flag changes that count' },
  flagWindowYears: { value: 3, min: 1, max: 20, unit: 'years', label: 'Period for counting flag changes' },
  contractValueSgd: { value: 100000, min: 0, max: 1000000000, unit: 'SGD', label: 'Contract value that adds points and sends a DDQ' },
  ddqOverdueDays: { value: 14, min: 1, max: 365, unit: 'days', label: 'Days before an unreturned DDQ counts' }
};

// Confidence (section 4.6): per finding = source trust x match strength x freshness, plus a bonus for a second source.
const CONFIDENCE = {
  sourceTrust: { High: 1.0, Medium: 0.75, Low: 0.5 },
  matchStrength: { second_identifier: 1.0, strong_name: 0.75, weak_name: 0.5, not_name: 1.0 },
  freshness: { within30Days: 1.0, within12Months: 0.85, older: 0.7 },
  corroborationBonus: 0.15,
  // Confidence (in %) a case needs to be auto-cleared or escalated without more evidence
  threshold: 80,
  thresholdMin: 60,
  thresholdMax: 95
};

const MATCH_BASES = Object.keys(CONFIDENCE.matchStrength);
const SOURCE_TRUSTS = Object.keys(CONFIDENCE.sourceTrust);

// Routes (section 4.7). The ids are the quadrant values the app already stores.
const ROUTES = {
  riskLine: 50, // locked: the line already drawn on the Reviews chart
  cap: 100, // locked
  labels: { escalate: 'Escalate', investigate: 'Investigate', gaps: 'Fill the gaps', monitor: 'Auto-clear' }
};

// Checks a case needs before a clean result can be trusted (coverage, section 4.6)
const REQUIRED_CHECKS = {
  all: ['sanctions', 'pep', 'adverse_media', 'ownership', 'country'],
  vessel: ['vessel_behaviour']
};
const CHECK_LABELS = {
  sanctions: 'Sanctions lists',
  pep: 'PEP lists',
  adverse_media: 'Adverse media',
  ownership: 'Ownership',
  country: 'Country risk',
  vessel_behaviour: 'Vessel behaviour'
};

// Dilly poses per route (loader spec)
const POSES = {
  monitor: 'dilly_done.svg',
  investigate: 'dilly_medium.svg',
  escalateSanctions: 'dilly_sanctions.svg',
  escalate: 'dilly_medium.svg',
  error: 'dilly_error.svg'
};

// Never editable, whatever the user changes. Shown in the editor with the reason.
const GUARDRAILS = [
  'A confirmed sanctions match is always 100 points and always goes to Escalate.',
  'The total is capped at 100.',
  'No source, no points: a finding without a source link is rejected.',
  'The 50-point line between Low and Medium stays where it is drawn on the Reviews chart.',
  'The AI finds and classifies facts. It never sets a number or a route.'
];

const PIPELINE = [
  { id: 'read', label: 'Read', what: 'Which sources were read, and when.' },
  { id: 'understand', label: 'Understand', what: 'Findings are extracted, each with a quote and a link.' },
  { id: 'check', label: 'Check', what: 'Each finding is matched to a rule in the points table.' },
  { id: 'score', label: 'Score', what: 'Points are added up, capped at 100.' },
  { id: 'weigh', label: 'Weigh', what: 'Confidence is calculated from the evidence.' },
  { id: 'route', label: 'Route', what: 'The route is set, and a person decides.' }
];

module.exports = {
  RULES_VERSION, ROWS, LEVELS, THRESHOLDS, CONFIDENCE, MATCH_BASES, SOURCE_TRUSTS, ROUTES,
  REQUIRED_CHECKS, CHECK_LABELS, POSES, GUARDRAILS, PIPELINE
};
