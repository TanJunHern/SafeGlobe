/**
 * Synthetic demo data: labelled reviews for training the review model before real reviews exist.
 *
 * Each row is an invented case (no real organisation, person or vessel) with the same features a real case has,
 * and the label an invented compliance officer gave it: "risk" (red) or "no_risk" (green).
 * The invented officer mostly agrees with the rules, and marks some low-scoring cases as real risk when certain
 * patterns appear. Those are the misses the model is meant to learn. Because the labels come from this generator,
 * a model trained on them learns this generator's pattern, not real officers' judgement. Every row is marked
 * is_synthetic and every screen that uses them says "synthetic demo data".
 */
const { getRules } = require('../risk/rulesStore');

// A small seeded generator, so the data set is the same every time
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const sigmoid = z => 1 / (1 + Math.exp(-z));

/** How likely the invented officer is to mark a case as real risk. The patterns beyond the first line are what the rules miss. */
function officerSaysRisk(f) {
  let z = 0.11 * (f.rule_risk - 50);
  if (f.findings_left_out >= 2) z += 4.6;                              // several findings were read but not counted
  if (f.pts_country === 10 && f.pts_ownership > 0) z += 4.2;           // mid-risk country together with unclear ownership
  if (f.is_broker && f.country_cpi < 50) z += 4.0;                     // an intermediary in a weak-governance country
  if (f.weak_sources >= 2 && f.rule_risk >= 25) z += 2.4;              // points rest on lower-trust sources
  if (f.is_state_owned && f.pts_sanctions === 0 && f.country_cpi < 40) z += 3.0;
  if (f.kind === 'org' && f.pts_vessel > 0) z += 4.4;                  // a company whose points come from a vessel it manages or charters
  if (f.checks_ran_share < 0.7) z += 1.4;                              // checks did not all run
  if (f.rule_confidence >= 90 && f.rule_risk < 25 && f.findings_left_out === 0) z -= 1.5;
  return sigmoid(z);
}

function syntheticCase(rand, points) {
  const kind = rand() < 0.62 ? 'org' : rand() < 0.6 ? 'vessel' : 'person';
  const has = p => (rand() < p ? 1 : 0);
  const f = { kind, pts_sanctions: 0, pts_pep: 0, pts_country: 0, pts_adverse_media: 0, pts_ownership: 0, pts_vessel: 0, pts_other: 0 };
  const cpi = Math.round(18 + rand() * 72);
  f.country_cpi = cpi;
  f.pts_country = cpi < 40 ? points.country_cpi_low : cpi < 60 ? points.country_cpi_mid : 0;
  // A few confirmed sanctions matches (always 100), and more possible ones
  if (has(0.04)) f.pts_sanctions = points.sanctions_confirmed;
  else if (has(0.1)) f.pts_sanctions = points.sanctions_possible;
  if (has(0.12)) f.pts_pep = rand() < 0.6 ? points.pep_owner : points.pep_associate;
  if (has(0.2)) f.pts_adverse_media = rand() < 0.35 ? points.adverse_media_severe : points.adverse_media_other;
  if (has(0.25)) f.pts_ownership = points.ownership_unclear;
  // A vessel carries its own behaviour points. Now and then a company carries them too: it manages or charters such a vessel.
  const vessel = kind === 'vessel' ? [has(0.3) * points.vessel_ais_dark, has(0.25) * points.vessel_sts_transfer, has(0.3) * points.vessel_flag_changes]
    : kind === 'org' && has(0.09) ? [points.vessel_ais_dark, has(0.6) * points.vessel_sts_transfer] : [];
  f.pts_vessel = vessel.reduce((a, b) => a + b, 0);
  f.is_broker = kind === 'org' ? has(0.18) : 0;
  f.pts_other = f.is_broker * points.broker_intermediary + has(0.25) * points.contract_value_high;
  f.is_state_owned = kind === 'org' ? has(0.1) : 0;
  f.ddq_pending = has(0.2);
  const parts = [f.pts_sanctions, f.pts_pep, f.pts_country, f.pts_adverse_media, f.pts_ownership, f.pts_other, ...vessel];
  f.findings_counted = parts.filter(p => p > 0).length;
  f.rule_risk = Math.min(100, parts.reduce((a, b) => a + b, 0));
  f.findings_left_out = rand() < 0.72 ? 0 : rand() < 0.55 ? 1 : 2 + Math.floor(rand() * 2);
  f.weak_sources = Math.min(f.findings_counted, rand() < 0.6 ? 0 : 1 + Math.floor(rand() * 2));
  f.checks_ran_share = rand() < 0.6 ? 1 : rand() < 0.6 ? 0.8 : Math.round((0.5 + rand() * 0.25) * 100) / 100;
  // Confidence follows the evidence, as in the app: full when every finding is well sourced and every check ran
  f.rule_confidence = Math.max(30, Math.min(100, Math.round(100 - f.weak_sources * 14 - (1 - f.checks_ran_share) * 40 - (rand() < 0.45 ? 0 : rand() * 12))));
  return f;
}

/** count labelled synthetic reviews. Same seed, same rows. */
function generate(db, { count = 800, seed = 20261012 } = {}) {
  const rules = getRules(db);
  const points = Object.fromEntries(Object.values(rules.rowById).map(r => [r.id, r.points]));
  const rand = rng(seed);
  const rows = [];
  for (let i = 0; i < count; i++) {
    const features = syntheticCase(rand, points);
    const p = officerSaysRisk(features);
    // A little disagreement between officers, as in real reviews
    const label = rand() < (rand() < 0.05 ? 1 - p : p) ? 'risk' : 'no_risk';
    rows.push({ id: `syn-${seed}-${String(i + 1).padStart(4, '0')}`, entityId: `synthetic-case-${i + 1}`, label, features, isSynthetic: true, reviewer: 'Synthetic reviewer (demo)', note: 'Synthetic demo data' });
  }
  return rows;
}

module.exports = { generate, officerSaysRisk, rng };
