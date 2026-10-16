/**
 * Risk scoring engine (src/risk): every points row, the confidence formula, the routes, the findings schema,
 * editing the rules, recommended changes, and the Aurora Venture worked example. Runs offline.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { getDb } = require('../src/db');
const { buildRules, applyPatch, updateRules, resetRules, getRules, RulesError } = require('../src/risk/rulesStore');
const { validateFinding, QUOTE_MAX } = require('../src/risk/findingSchema');
const { assess, scoreFindings, findingConfidence, routeFor, levelFor, poseFor } = require('../src/risk/scorer');
const riskService = require('../src/risk/riskService');
const suggestions = require('../src/risk/suggestions');
const cfg = require('../src/risk/points.config');
const { calculateQuadrant } = require('../src/services/screening');

const NOW = Date.parse('2026-10-12T00:00:00Z');
const rules = buildRules();
let n = 0;
const finding = (category, over = {}) => Object.assign({
  id: `T-${++n}`, category, subject: 'Test Co', summary: 'A fact', evidence_quote: 'the exact words', source_name: 'Test source',
  source_url: 'https://example.com/source', source_trust: 'High', read_at: '2026-10-10T00:00:00Z',
  match_basis: category === 'sanctions_confirmed' ? 'second_identifier' : 'not_name', corroborating_sources: [], agent: 'Test', model_id: 'none', prompt_version: 'none'
}, over);
const ALL_CHECKS = Object.fromEntries(['sanctions', 'pep', 'adverse_media', 'ownership', 'country', 'vessel_behaviour'].map(k => [k, { ran: true, source_name: 'Lists', read_at: '2026-10-10T00:00:00Z' }]));

test('points table: the defaults are the table in AI build spec 4.5', () => {
  const expected = {
    sanctions_confirmed: 100, sanctions_possible: 40, pep_owner: 25, pep_associate: 15, country_cpi_low: 20, country_cpi_mid: 10,
    adverse_media_severe: 25, adverse_media_other: 10, ownership_unclear: 15, broker_intermediary: 10, vessel_ais_dark: 20,
    vessel_sts_transfer: 20, vessel_flag_changes: 10, contract_value_high: 5, ddq_contradiction: 15, ddq_not_returned: 10
  };
  assert.deepEqual(Object.fromEntries(rules.rows.map(r => [r.id, r.points])), expected);
  assert.equal(rules.rowById.country_cpi_low.label, 'Country CPI below 40');
  assert.equal(rules.rowById.country_cpi_mid.label, 'Country CPI 40 to 59');
  assert.equal(rules.rowById.contract_value_high.label, 'Contract value above SGD 100,000');
  assert.equal(rules.rowById.pep_owner.policy, '§3.6');
  assert.equal(rules.rowById.vessel_ais_dark.policy, '§5.4');
});

test('points table: every row gives its own points, once', async t => {
  for (const row of cfg.ROWS) {
    await t.test(row.id, () => {
      const one = scoreFindings([finding(row.id)], rules, NOW);
      assert.equal(one.total, row.points);
      assert.equal(one.lines.length, 1);
      assert.equal(one.lines[0].policy, row.policy);
      // A second finding for the same row does not count again
      const two = scoreFindings([finding(row.id), finding(row.id)], rules, NOW);
      assert.equal(two.total, row.points);
      assert.equal(two.notCounted.length, 1);
    });
  }
});

test('points table: cap, confirmed sanctions and the country rule', () => {
  const many = ['sanctions_possible', 'pep_owner', 'adverse_media_severe', 'vessel_ais_dark', 'vessel_sts_transfer'].map(c => finding(c));
  const capped = scoreFindings(many, rules, NOW);
  assert.equal(capped.sum, 130);
  assert.equal(capped.total, 100);
  assert.equal(capped.capped, true);

  const confirmed = scoreFindings([finding('sanctions_confirmed')], rules, NOW);
  assert.equal(confirmed.total, 100);
  assert.equal(confirmed.confirmedSanctions, true);

  // A country counts once: the riskier row wins
  const country = scoreFindings([finding('country_cpi_mid'), finding('country_cpi_low')], rules, NOW);
  assert.equal(country.total, 20);
  assert.deepEqual(country.lines.map(l => l.category), ['country_cpi_low']);
});

test('levels: Low 0 to 49, Medium 50 to 74, High 75 to 100', () => {
  assert.deepEqual([0, 49, 50, 74, 75, 100].map(r => levelFor(r, rules).label), ['Low', 'Low', 'Medium', 'Medium', 'High', 'High']);
});

test('confidence: source trust x match strength x freshness, plus the second-source bonus', () => {
  const c = f => findingConfidence(finding('pep_owner', f), rules, NOW).value;
  assert.equal(c({}), 1);
  assert.equal(c({ source_trust: 'Medium' }), 0.75);
  assert.equal(c({ source_trust: 'Low' }), 0.5);
  assert.equal(c({ match_basis: 'strong_name' }), 0.75);
  assert.equal(c({ match_basis: 'weak_name' }), 0.5);
  assert.equal(c({ match_basis: 'second_identifier' }), 1);
  assert.equal(c({ read_at: '2026-05-01T00:00:00Z' }), 0.85); // within 12 months
  assert.equal(c({ read_at: '2024-05-01T00:00:00Z' }), 0.7); // older
  assert.equal(c({ source_trust: 'Low', corroborating_sources: ['Second source'] }), 0.65);
  assert.equal(c({ corroborating_sources: ['Second source'] }), 1); // never above 1
  assert.equal(c({ source_trust: 'Medium', match_basis: 'strong_name', read_at: '2026-05-01T00:00:00Z' }), 0.48);
});

test('confidence: weighted by points with findings, coverage without', () => {
  const b = assess({ findings: [finding('sanctions_possible', { source_trust: 'Low' }), finding('contract_value_high')], kind: 'org' }, rules, NOW);
  assert.equal(b.risk, 45);
  assert.equal(b.confidence, Math.round(((40 * 0.5 + 5 * 1) / 45) * 100)); // 56
  assert.equal(b.confidenceBasis, 'findings');

  const clean = assess({ findings: [], checks: ALL_CHECKS, kind: 'org' }, rules, NOW);
  assert.equal(clean.risk, 0);
  assert.equal(clean.confidence, 100);
  assert.equal(clean.route, 'monitor');

  // A clean result is only high confidence when the checks actually ran
  const partial = assess({ findings: [], checks: { sanctions: ALL_CHECKS.sanctions, pep: ALL_CHECKS.pep, country: ALL_CHECKS.country }, kind: 'org' }, rules, NOW);
  assert.equal(partial.confidence, 60);
  assert.equal(partial.route, 'gaps');
  // A check without a source does not count; a vessel needs the vessel checks too
  assert.equal(assess({ findings: [], checks: { sanctions: { ran: true } }, kind: 'org' }, rules, NOW).confidence, 0);
  const vessel = Object.assign({}, ALL_CHECKS); delete vessel.vessel_behaviour;
  assert.equal(assess({ findings: [], checks: vessel, kind: 'vessel' }, rules, NOW).confidence, 83);
});

test('routes: the four quadrants, and a confirmed sanctions match always escalates', () => {
  assert.equal(routeFor(50, 80, rules), 'escalate');
  assert.equal(routeFor(50, 79, rules), 'investigate');
  assert.equal(routeFor(49, 79, rules), 'gaps');
  assert.equal(routeFor(49, 80, rules), 'monitor');
  assert.equal(routeFor(100, 10, rules, { confirmedSanctions: true }), 'escalate');
  assert.equal(calculateQuadrant(85, 60, 80), 'investigate');

  const weak = assess({ findings: [finding('sanctions_confirmed', { source_trust: 'Low', read_at: '2020-01-01T00:00:00Z' })], kind: 'person' }, rules, NOW);
  assert.equal(weak.risk, 100);
  assert.ok(weak.confidence < 80);
  assert.equal(weak.route, 'escalate');
  assert.match(weak.routeReason, /always goes to Escalate/);

  assert.equal(poseFor('monitor', rules), 'dilly_done.svg');
  assert.equal(poseFor('investigate', rules), 'dilly_medium.svg');
  assert.equal(poseFor('escalate', rules, { confirmedSanctions: true }), 'dilly_sanctions.svg');
  assert.equal(poseFor('escalate', rules), 'dilly_medium.svg');
});

test('findings schema: no source, no points, and the other checks', () => {
  assert.equal(validateFinding(finding('pep_owner'), rules).ok, true);
  assert.equal(validateFinding(finding('pep_owner', { source_url: '/risk/source?name=Lists' }), rules).ok, true);
  const bad = (over, re) => { const r = validateFinding(finding('pep_owner', over), rules); assert.equal(r.ok, false); assert.match(r.reason, re); };
  bad({ source_url: '' }, /No source, no points/);
  bad({ source_url: 'not a link' }, /not a web address/);
  bad({ category: 'made_up' }, /Unknown category/);
  bad({ evidence_quote: 'x'.repeat(QUOTE_MAX + 1) }, /longer than 300/);
  bad({ evidence_quote: '' }, /No quote/);
  bad({ source_trust: 'Very high' }, /Source trust/);
  bad({ match_basis: 'guess' }, /Match basis/);
  bad({ read_at: 'yesterday' }, /time the source was read/);
  bad({ agent: '' }, /No agent/);
  // A name alone never confirms a sanctions match
  const nameOnly = validateFinding(finding('sanctions_confirmed', { match_basis: 'strong_name' }), rules);
  assert.equal(nameOnly.ok, false);
  assert.match(nameOnly.reason, /second identifier/);
  // The one exception: a DDQ fact may cite the DDQ answer instead of a link
  assert.equal(validateFinding(finding('ddq_contradiction', { source_url: '', ddq_answer_id: 'KYC-1:3.2' }), rules).ok, true);
  assert.equal(validateFinding(finding('pep_owner', { source_url: '', ddq_answer_id: 'KYC-1:3.2' }), rules).ok, false);
});

test('rules: valid edits, invalid edits and locked values', () => {
  const edited = buildRules(applyPatch({}, { points: { vessel_ais_dark: 30 }, thresholds: { aisDarkHours: 12 }, confidence: { sourceTrust: { Low: 0.4 }, threshold: 85 }, policy: { sanctions_possible: '§3.2' } }));
  assert.equal(edited.rowById.vessel_ais_dark.points, 30);
  assert.equal(edited.rowById.vessel_ais_dark.changed, true);
  assert.equal(edited.rowById.vessel_ais_dark.label, 'Vessel: AIS dark for more than 12 hours in the last 90 days');
  assert.equal(edited.confidence.sourceTrust.Low, 0.4);
  assert.equal(edited.confidence.threshold, 85);
  assert.equal(edited.rowById.sanctions_possible.policy, '§3.2');
  assert.equal(scoreFindings([finding('vessel_ais_dark')], edited, NOW).total, 30);

  const rejects = (patch, re) => assert.throws(() => applyPatch({}, patch), err => err instanceof RulesError && re.test(err.message));
  rejects({ points: { sanctions_confirmed: 10 } }, /always 100/);
  rejects({ points: { pep_owner: 101 } }, /0 to 100/);
  rejects({ points: { pep_owner: 2.5 } }, /whole number/);
  rejects({ points: { nope: 5 } }, /no row/);
  rejects({ thresholds: { cpiLow: 70 } }, /lower than the medium-risk/);
  rejects({ confidence: { sourceTrust: { High: 1.5 } } }, /between 0 and 1/);
  rejects({ confidence: { threshold: 30 } }, /60 to 95/);
  rejects({ routes: { riskLine: 10 } }, /cannot be changed/);
  rejects({ removeRows: ['pep_owner'] }, /built-in row/);

  // The user's own rows are scored like any other
  const custom = buildRules(applyPatch({}, { addRows: [{ label: 'State-owned majority shareholder', points: 15, policy: '§3.2' }] }));
  const row = custom.rows.find(r => r.custom);
  assert.equal(scoreFindings([finding(row.id)], custom, NOW).total, 15);
  assert.equal(validateFinding(finding(row.id), rules).ok, false); // unknown without that row
});

test('recommended changes: a policy that differs from the rules', () => {
  const found = suggestions.compare([
    { section: '§5.4', text: '§5.4 Vessels with an AIS gap over 12 hours in the last 90 days need a Tide review before any fixture.', origin: {} },
    { section: '§4.1', text: '§4.1 Apply enhanced due diligence to counterparties in countries scoring below 40 on CPI 2025.', origin: {} },
    { section: '', text: '§2.1 A DDQ is required when the contract value is above SGD 250,000. §9.9 Gifts above the limit must be declared.', origin: {} },
    { section: '§3.2', text: '§3.2 Block direct dealings with any entity 50% or more owned by sanctioned persons.', origin: {} }
  ], rules);
  const byKey = Object.fromEntries(found.map(s => [s.key, s]));
  assert.deepEqual(byKey['threshold:aisDarkHours:12'].patch, { thresholds: { aisDarkHours: 12 } });
  assert.deepEqual(byKey['threshold:contractValueSgd:250000'].patch, { thresholds: { contractValueSgd: 250000 } });
  assert.equal(byKey['threshold:cpiLow:40'], undefined); // already matches
  // The sanctions rows now carry their own clause (§1.1, demo clause), so no clause is suggested for them
  assert.equal(byKey['policy:sanctions_possible:§3.2'], undefined);
  assert.equal(byKey['row:§9.9'].patch.addRows[0].points, 0); // a person sets the number
  for (const s of found) if (s.patch) assert.doesNotThrow(() => applyPatch({}, s.patch));
  assert.equal(suggestions.readableText('%PDF-1.7 binary'), '');
  assert.equal(suggestions.readableText('data:text/plain;base64,' + Buffer.from('CPI below 35 in the policy text, long enough to decode').toString('base64')).includes('CPI below 35'), true);
});

test('Aurora Venture scores 85 from its findings (AI build spec 4.5 worked example)', () => {
  const db = getDb();
  resetRules(db);
  const b = riskService.assessEntity(db, 'aurora', { now: NOW });
  assert.deepEqual(Object.fromEntries(b.lines.map(l => [l.category, l.points])), {
    country_cpi_low: 20, ownership_unclear: 15, vessel_ais_dark: 20, vessel_sts_transfer: 20, vessel_flag_changes: 10
  });
  assert.equal(b.risk, 85);
  assert.equal(b.level.label, 'High');
  assert.equal(b.confidence, 96);
  assert.equal(b.route, 'escalate');
  assert.equal(b.pose, 'dilly_medium.svg'); // escalated, but not because of a sanctions match
  assert.equal(b.pipeline.length, 6);
  // Every point traces to a finding, a rule and a source
  for (const l of b.lines) {
    assert.ok(l.findingId && l.rule && l.quote && l.sourceName && l.sourceUrl && l.readAt, `${l.category} is fully sourced`);
    assert.ok(db.getFindingRecordById(l.findingId));
  }
  assert.equal(db.getCpiByCodeOrName('Cameroon').score, 26);
  // The stored score and the open case follow the breakdown
  const live = riskService.assessEntity(db, 'aurora');
  assert.equal(db.getEntityById('aurora').risk, live.risk);
  assert.equal(db.getCases().find(c => c.id === 'aurora').quadrant, live.route);
});

test('the other demo counterparties are scored from findings too', () => {
  const db = getDb();
  const s = Object.fromEntries(riskService.scores(db, { now: NOW }).map(x => [x.entityId, x]));
  assert.deepEqual([s.zemtsov.risk, s.zemtsov.route, s.zemtsov.pose], [100, 'escalate', 'dilly_sanctions.svg']);
  assert.deepEqual([s.kestrel.risk, s.kestrel.confidence, s.kestrel.route], [55, 48, 'investigate']);
  assert.deepEqual([s.severny.risk, s.severny.confidence, s.severny.route], [60, 76, 'investigate']);
  assert.deepEqual([s.halcyon.risk, s.halcyon.confidence, s.halcyon.route], [40, 100, 'monitor']);
});

test('editing a rule re-scores the cases, and reset brings the defaults back', () => {
  const db = getDb();
  const preview = riskService.previewRules(db, { points: { vessel_ais_dark: 0, vessel_sts_transfer: 0 } }, NOW);
  assert.equal(preview.changed.find(c => c.entityId === 'aurora').after.risk, 45);
  assert.equal(riskService.assessEntity(db, 'aurora', { now: NOW }).risk, 85); // a preview saves nothing

  const { changes } = updateRules(db, { points: { ownership_unclear: 25 } }, { user: 'Test officer', reason: 'test' });
  assert.deepEqual(changes, ['Ownership unclear: 15 to 25 points']);
  riskService.rescoreAll(db, { now: NOW });
  assert.equal(db.getEntityById('aurora').risk, 95);
  assert.equal(getRules(db).changes, 1);

  resetRules(db);
  riskService.rescoreAll(db, { now: NOW });
  assert.equal(db.getEntityById('aurora').risk, 85);
  assert.equal(getRules(db).changes, 0);
});

test('rejected findings are stored with the reason, and add no points', () => {
  const db = getDb();
  const out = riskService.recordFindings(db, 'test-case', [finding('pep_owner', { id: 'T-ok' }), finding('adverse_media_severe', { id: 'T-nosource', source_url: '' })], { replace: true });
  assert.equal(out.accepted.length, 1);
  assert.equal(out.rejected.length, 1);
  db.setRiskChecks('test-case', { _kind: 'org' });
  const b = riskService.assessEntity(db, 'test-case', { now: NOW });
  assert.equal(b.risk, 25);
  assert.equal(b.rejected.length, 1);
  assert.match(b.rejected[0].reason, /No source, no points/);
  assert.equal(db.getFindingRecords('test-case').find(r => r.finding.id === 'T-nosource').status, 'rejected');
  db.deleteFindingRecords('test-case');
  db.db.prepare("DELETE FROM risk_checks WHERE entity_id = 'test-case'").run();
});
