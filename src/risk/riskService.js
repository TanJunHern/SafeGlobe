/**
 * Glue between the scorer and the app's data: stores findings, re-scores cases when findings or rules
 * change, and seeds the demo counterparties' findings so they are scored like any other case.
 * Every function takes the database, so the database can call this while it is being opened.
 */
const { getRules, buildRules, applyPatch, readOverrides } = require('./rulesStore');
const { validateFinding } = require('./findingSchema');
const { assess } = require('./scorer');

const CPI_SOURCE = { name: 'Transparency International CPI 2025', url: 'https://www.transparency.org/en/cpi/2025', trust: 'High' };

/** Link to the page that shows a source held inside DueDilly (built-in lists, feeds, intake forms) and, when given, the finding read from it. */
function sourceLink(name, findingId = '') {
  return `/risk/source?name=${encodeURIComponent(name)}${findingId ? `&finding=${encodeURIComponent(findingId)}` : ''}`;
}

/**
 * The country finding for a case: the riskiest of the places given (incorporation, operating address, flag, residence).
 * Returns { finding, check }. `finding` is null when no place scores, or none is in the CPI data.
 */
function countryFinding(db, rules, places, { idPrefix = 'F', agent = 'Ripples', readAt = new Date().toISOString() } = {}) {
  const known = [];
  for (const p of places) {
    const row = p && p.value ? db.getCpiByCodeOrName(p.value) : null;
    if (row) known.push(Object.assign({ role: p.role }, row));
  }
  if (!known.length) return { finding: null, check: { ran: false, result: 'No country on file is in the CPI 2025 data' } };
  const worst = known.reduce((a, b) => (b.score < a.score ? b : a));
  const check = { ran: true, source_name: CPI_SOURCE.name, source_url: CPI_SOURCE.url, read_at: readAt, result: `${worst.name}: CPI ${worst.score} of 100` };
  const t = rules.thresholds;
  const category = worst.score < t.cpiLow ? 'country_cpi_low' : worst.score < t.cpiMid ? 'country_cpi_mid' : null;
  if (!category) return { finding: null, check };
  return {
    check,
    finding: {
      id: `${idPrefix}-country`, category, subject: `${worst.name} (${worst.role})`,
      summary: `${worst.name} scores ${worst.score} of 100 on the Corruption Perceptions Index 2025. On the CPI a low score is bad, so it adds risk points.`,
      evidence_quote: `${worst.name}: score ${worst.score}/100, rank ${worst.rank}`,
      source_name: CPI_SOURCE.name, source_url: CPI_SOURCE.url, source_trust: CPI_SOURCE.trust, read_at: readAt,
      match_basis: 'not_name', corroborating_sources: [], agent, model_id: 'none', prompt_version: 'none'
    }
  };
}

/** Validates and stores findings for a case. Rejected ones are stored too, with the reason. */
function recordFindings(db, entityId, rawFindings, { replace = false } = {}) {
  const rules = getRules(db);
  if (replace) db.deleteFindingRecords(entityId);
  const out = { accepted: [], rejected: [] };
  for (const raw of rawFindings || []) {
    const res = validateFinding(raw, rules);
    // A caller may already have ruled a finding out (for example: it quotes words that are not in its source)
    if (raw && raw._reason) { res.ok = false; res.reason = raw._reason; }
    db.saveFindingRecord(entityId, { finding: res.finding, status: res.ok ? 'accepted' : 'rejected', reason: res.reason || '' });
    (res.ok ? out.accepted : out.rejected).push(res);
  }
  return out;
}

/** Findings as stored, re-checked against the rules in force (a row may have been removed since). */
function loadCase(db, entityId, rules) {
  const records = db.getFindingRecords(entityId);
  const findings = [];
  const rejected = [];
  for (const r of records) {
    if (r.status !== 'accepted') { rejected.push({ finding: r.finding, reason: r.reason }); continue; }
    const res = validateFinding(r.finding, rules);
    if (res.ok) findings.push(res.finding);
    else rejected.push({ finding: res.finding, reason: res.reason });
  }
  const checks = db.getRiskChecks(entityId);
  return { findings, rejected, checks: checks || {}, hasData: records.length > 0 || checks !== null };
}

/** The full "Why <score>?" breakdown for one case, or null when the case has never been through the scorer. */
function assessEntity(db, entityId, { rules = getRules(db), now = Date.now() } = {}) {
  const entity = db.getEntityById(entityId);
  const data = loadCase(db, entityId, rules);
  if (!data.hasData) return null;
  // A request that is not pinned on the globe has no counterparty record; its kind is kept with its checks
  const kind = entity ? entity.kind : data.checks._kind || 'org';
  const breakdown = assess({ findings: data.findings, rejected: data.rejected, checks: data.checks, kind }, rules, now);
  return Object.assign({ entityId, name: entity ? entity.name : entityId, kind, demo: data.findings.some(f => f.demo) }, breakdown);
}

/** Recomputes one case and writes the score back. Returns { before, after } or null. */
function rescoreEntity(db, entityId, opts = {}) {
  const entity = db.getEntityById(entityId);
  const b = assessEntity(db, entityId, opts);
  if (!b) return null;
  if (entity) db.setEntityScore(entityId, b.risk, b.confidence, b.route);
  return {
    entityId, name: b.name,
    before: entity ? { risk: entity.risk, confidence: entity.conf } : null,
    after: { risk: b.risk, confidence: b.confidence, route: b.route, level: b.level.label }
  };
}

function rescoreAll(db, opts = {}) {
  return db.getScoredEntityIds().map(id => rescoreEntity(db, id, opts)).filter(Boolean);
}

/** One line per scored case: what the lists and the globe show. */
function scores(db, opts = {}) {
  return db.getScoredEntityIds().map(id => assessEntity(db, id, opts)).filter(Boolean).map(b => ({
    entityId: b.entityId, name: b.name, kind: b.kind, risk: b.risk, level: b.level, confidence: b.confidence,
    route: b.route, routeLabel: b.routeLabel, confirmedSanctions: b.confirmedSanctions, pose: b.pose, demo: b.demo
  }));
}

/** What a rules edit would do to the scored cases, without saving anything. */
function previewRules(db, patch, now = Date.now()) {
  const current = getRules(db);
  const next = buildRules(applyPatch(readOverrides(db), patch));
  const changed = [];
  for (const id of db.getScoredEntityIds()) {
    const a = assessEntity(db, id, { rules: current, now });
    const b = assessEntity(db, id, { rules: next, now });
    if (!a || !b) continue;
    if (a.risk !== b.risk || a.confidence !== b.confidence || a.route !== b.route) {
      changed.push({ entityId: id, name: a.name, before: { risk: a.risk, confidence: a.confidence, route: a.routeLabel }, after: { risk: b.risk, confidence: b.confidence, route: b.routeLabel } });
    }
  }
  return { cases: db.getScoredEntityIds().length, changed, routeChanges: changed.filter(c => c.before.route !== c.after.route).length };
}

// ---------------------------------------------------------------------------------------------------------
// Demo counterparties. All five are fictional (src/db/seed-data.js); their findings restate the facts already
// in that seed data in the findings format, so the demo scores come out of the scorer, not out of a literal.
// ---------------------------------------------------------------------------------------------------------
const DEMO_VERSION = 1;
const DEMO_SETTING = 'risk_demo_findings_version';
const BUILT_IN_LISTS = 'Built-in sanctions and PEP data';

const demo = f => Object.assign({ corroborating_sources: [], model_id: 'none', prompt_version: 'none', demo: true }, f,
  { source_url: f.source_url || sourceLink(f.source_name, f.id) });

const listCheck = readAt => ({ ran: true, source_name: BUILT_IN_LISTS, source_url: sourceLink(BUILT_IN_LISTS), read_at: readAt, result: 'Screened' });

function demoCases(db, rules) {
  const cases = [];
  const country = (id, places, readAt) => countryFinding(db, rules, places, { idPrefix: `F-${id}`, readAt });
  const mark = c => { if (c.finding) c.finding.demo = true; return c; };

  // Aurora Venture: the worked example in GEMINI.md section 4.5
  {
    const readAt = '2026-10-06T09:42:00+08:00';
    const c = mark(country('aurora', [{ value: 'Cameroon', role: 'flag state' }], readAt));
    cases.push({
      id: 'aurora',
      checks: {
        sanctions: listCheck(readAt), pep: listCheck(readAt), country: c.check,
        ownership: { ran: true, source_name: 'Vessel registry extract (demo)', source_url: sourceLink('Vessel registry extract (demo)', 'F-aurora-ownership'), read_at: readAt, result: 'Beneficial owner not disclosed' },
        vessel_behaviour: { ran: true, source_name: 'AIS position feed', source_url: sourceLink('AIS position feed', 'F-aurora-ais-dark'), read_at: readAt, result: '31 h dark period, ship-to-ship transfer' }
      },
      findings: [
        demo({ id: 'F-aurora-ais-dark', category: 'vessel_ais_dark', subject: 'Aurora Venture (IMO 9304124)', agent: 'Tide',
          summary: 'The vessel stopped sending AIS for 31 hours in the Arabian Sea on 24 to 25 Sep 2026.',
          evidence_quote: 'AIS dark for 31 h in the Arabian Sea; resumed west of India', source_name: 'AIS position feed', source_trust: 'High',
          read_at: readAt, match_basis: 'not_name', corroborating_sources: ['Satellite AIS gap report'] }),
        demo({ id: 'F-aurora-sts', category: 'vessel_sts_transfer', subject: 'Aurora Venture (IMO 9304124)', agent: 'Tide',
          summary: 'After the dark period the vessel did a ship-to-ship transfer in the anchorage area east of Johor.',
          evidence_quote: 'Ship-to-ship transfer, 38 nm east of Johor', source_name: 'AIS position feed', source_trust: 'High',
          read_at: readAt, match_basis: 'not_name' }),
        demo({ id: 'F-aurora-flags', category: 'vessel_flag_changes', subject: 'Aurora Venture (IMO 9304124)', agent: 'Tide',
          summary: 'The flag changed twice since 2024: Panama to Gabon in 2024, then Gabon to Cameroon in 2025.',
          evidence_quote: 'Flag change: Gabon to Cameroon (2nd in 24 months)', source_name: 'IMO and MMSI registry', source_trust: 'High',
          read_at: readAt, match_basis: 'not_name' }),
        c.finding,
        demo({ id: 'F-aurora-ownership', category: 'ownership_unclear', subject: 'Registered owner of Aurora Venture', agent: 'Web',
          summary: 'The registered owner is a single-ship company held through nominee shareholders. The beneficial owner is not disclosed.',
          evidence_quote: 'Registered owner: single-ship company. Shareholders: nominees. Beneficial owner: not disclosed.',
          source_name: 'Vessel registry extract (demo)', source_trust: 'Medium', read_at: readAt, match_basis: 'not_name' })
      ],
      metadata: e => ({
        factors: [
          ['+', 'IMO number and past names match the registry'],
          ['+', 'Dark period corroborated by satellite AIS gap'],
          ['-', 'Position during gap cannot be verified'],
          ['-', 'Beneficial owner not disclosed: the registered owner is held through nominee shareholders']
        ]
      })
    });
  }

  // Halcyon Marine: nothing on Halcyon itself; its case carries the two findings about the vessel it manages
  {
    const readAt = '2026-10-04T16:48:00+08:00';
    const c = mark(country('halcyon', [{ value: 'SGP', role: 'country of incorporation' }], readAt));
    cases.push({
      id: 'halcyon',
      checks: { sanctions: listCheck(readAt), pep: listCheck(readAt), country: c.check,
        ownership: { ran: true, source_name: 'Company registry extract', source_url: sourceLink('Company registry extract'), read_at: readAt, result: 'Registration number and directors match' } },
      findings: [
        demo({ id: 'F-halcyon-ais-dark', category: 'vessel_ais_dark', subject: 'Aurora Venture (vessel managed by Halcyon)', agent: 'Tide',
          summary: 'A vessel Halcyon manages stopped sending AIS for 31 hours on 24 to 25 Sep 2026.',
          evidence_quote: 'Aurora Venture switched off AIS in the Arabian Sea for 31 hours (24–25 Sep)', source_name: 'AIS position feed', source_trust: 'High',
          read_at: readAt, match_basis: 'not_name' }),
        demo({ id: 'F-halcyon-sts', category: 'vessel_sts_transfer', subject: 'Aurora Venture (vessel managed by Halcyon)', agent: 'Tide',
          summary: 'The managed vessel then did a ship-to-ship transfer east of Johor on 2 Oct 2026.',
          evidence_quote: 'completed a ship-to-ship transfer east of Johor on 2 Oct', source_name: 'AIS position feed', source_trust: 'High',
          read_at: readAt, match_basis: 'not_name' }),
        c.finding
      ]
    });
  }

  // Kestrel Trading: the link to a sanctioned person comes from news, by name only
  {
    const readAt = '2026-10-05T18:30:00+08:00';
    const c = mark(country('kestrel', [{ value: 'ARE', role: 'country of incorporation' }], readAt));
    cases.push({
      id: 'kestrel',
      checks: { sanctions: listCheck(readAt), pep: listCheck(readAt), country: c.check,
        adverse_media: { ran: true, source_name: 'News report (demo)', source_url: sourceLink('News report (demo)', 'F-kestrel-sanctions'), read_at: readAt, result: 'One report on ownership' },
        ownership: { ran: true, source_name: 'Registry filings', source_url: sourceLink('Registry filings', 'F-kestrel-ownership'), read_at: readAt, result: 'Holding structure, owner not confirmed' } },
      findings: [
        demo({ id: 'F-kestrel-sanctions', category: 'sanctions_possible', subject: 'Arkady Zemtsov (reported 50% controller)', agent: 'Web',
          summary: 'A news report names a sanctioned person as the controller of Kestrel\'s holding structure. The link rests on the name alone.',
          evidence_quote: 'Holding structure reportedly controlled by Arkady Zemtsov.', source_name: 'News report (demo)', source_trust: 'Low',
          read_at: readAt, match_basis: 'strong_name' }),
        demo({ id: 'F-kestrel-ownership', category: 'ownership_unclear', subject: 'Kestrel Trading FZE', agent: 'Web',
          summary: 'Half of Kestrel is held through a holding structure, and the registry does not show who is behind it.',
          evidence_quote: '50% owned through holding structure', source_name: 'Registry filings', source_trust: 'Medium',
          read_at: readAt, match_basis: 'not_name' }),
        c.finding
      ]
    });
  }

  // Severny Agro: Russian country risk, and a majority owner under sectoral restrictions (a name-level link, not a confirmed match)
  {
    const readAt = '2026-10-03T10:20:00+08:00';
    const registryRead = '2026-08-15T09:00:00+08:00';
    const c = mark(country('severny', [{ value: 'RUS', role: 'country of incorporation' }], readAt));
    cases.push({
      id: 'severny',
      checks: { sanctions: listCheck(readAt), pep: listCheck(readAt), country: c.check,
        ownership: { ran: true, source_name: 'Russian registry extract, Aug 2026', source_url: sourceLink('Russian registry extract, Aug 2026', 'F-severny-owner'), read_at: registryRead, result: '51% state-owned' } },
      findings: [
        demo({ id: 'F-severny-owner', category: 'sanctions_possible', subject: 'Majority owner (51%, Russian state-owned enterprise)', agent: 'Sentry',
          summary: 'The majority owner is a Russian state-owned enterprise that is subject to sectoral restrictions.',
          evidence_quote: 'Majority owner is a Russian state-owned enterprise subject to sectoral restrictions.',
          source_name: 'Russian registry extract, Aug 2026', source_trust: 'High', read_at: registryRead, match_basis: 'strong_name' }),
        c.finding
      ]
    });
  }

  // Arkady Zemtsov: list match on name and date of birth, which is a confirmed match
  {
    const readAt = '2026-10-06T07:15:00+08:00';
    cases.push({
      id: 'zemtsov',
      checks: { sanctions: { ran: true, source_name: 'UK sanctions list', source_url: sourceLink('UK sanctions list', 'F-zemtsov-sanctions'), read_at: readAt, result: 'Match' }, pep: listCheck(readAt) },
      findings: [
        demo({ id: 'F-zemtsov-sanctions', category: 'sanctions_confirmed', subject: 'Arkady Zemtsov', agent: 'Sentry',
          summary: 'The name, date of birth and nationality all match an entry on the UK sanctions list.',
          evidence_quote: 'Matched on name, date of birth, nationality.', source_name: 'UK sanctions list', source_trust: 'High',
          read_at: readAt, match_basis: 'second_identifier' })
      ]
    });
  }
  return cases;
}

/**
 * Gives the built-in demo counterparties their findings, once per database (and again when DEMO_VERSION changes).
 * Does nothing in a clean workspace (npm run demo:clean), so clearing the demo clears these too.
 */
function ensureDemoFindings(db) {
  if (!db.hasPlaceholderData()) return [];
  if (db.getSetting(DEMO_SETTING, 0) === DEMO_VERSION) return [];
  const rules = getRules(db);
  const changes = [];
  for (const c of demoCases(db, rules)) {
    const entity = db.getEntityById(c.id);
    if (!entity) continue;
    recordFindings(db, c.id, c.findings.filter(Boolean), { replace: true });
    db.setRiskChecks(c.id, c.checks);
    if (c.metadata) db.setEntityMetadata(c.id, c.metadata(entity));
    const res = rescoreEntity(db, c.id);
    if (res) changes.push(res);
  }
  db.setSetting(DEMO_SETTING, DEMO_VERSION);
  return changes;
}

module.exports = {
  CPI_SOURCE, sourceLink, countryFinding, recordFindings, loadCase, assessEntity, rescoreEntity, rescoreAll, scores,
  previewRules, ensureDemoFindings, demoCases, DEMO_VERSION
};
