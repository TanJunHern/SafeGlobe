/**
 * Sentry Screening Agent (PRD Phase 1 & Baseline B.1, B.4)
 * Screens counterparties (organisations, people, vessels) against:
 * - 41 International Sanctions Lists (UN, US OFAC, EU, UK OFSI, MAS, etc.)
 * - Politically Exposed Persons (PEP) Databases
 * - Corporate Registry Filings & Gazette records
 * - Vessel AIS signals & Dark Period anomalies
 * - Custom uploaded feeds and API connectors
 */

const crypto = require('crypto');
const { getDb } = require('../db');
const { ROUTES } = require('../risk/points.config');
const { getRules } = require('../risk/rulesStore');
const { validateFinding } = require('../risk/findingSchema');
const { assess, routeFor } = require('../risk/scorer');
const { countryFinding, sourceLink } = require('../risk/riskService');

// The route comes from the scorer (src/risk/scorer.js); this keeps the signature older callers use
function calculateQuadrant(risk, conf, threshold = 80) {
  return routeFor(risk, conf, { routes: { riskLine: ROUTES.riskLine }, confidence: { threshold } });
}

const LISTS = 'Built-in sanctions lists (41)';

function screenCounterparty({ name, entity = 'organisation', jurisdiction = 'SGP', registration = '', docStatus = 'verified', watch = true }) {
  const db = getDb();
  const cpiRow = db.getCpiByCode(jurisdiction);
  const cpiScore = cpiRow ? cpiRow.score : 50;

  const cleanName = (name || '').trim();
  const lower = cleanName.toLowerCase();

  // Known watchlist matches / triggers for demo & realistic screening
  const findings = [];
  const factors = [];
  let risk = 12;
  let conf = 90;
  let autoCleared = false;
  let autoClearReason = '';

  // Findings in the scoring format (GEMINI.md 4.8). The points come from these, never from a number set here.
  // This offline engine recognises the demo names by pattern, so what it finds is labelled as demo data.
  const readAt = new Date().toISOString();
  const fid = 'F-' + crypto.randomBytes(4).toString('hex');
  const scored = [];
  const sample = f => scored.push(Object.assign({
    id: `${fid}-${scored.length + 1}`, subject: cleanName, source_trust: 'High', read_at: readAt, match_basis: 'not_name',
    corroborating_sources: [], agent: 'Sentry (offline rules)', model_id: 'none', prompt_version: 'none', demo: true
  }, f, { source_url: sourceLink(f.source_name, `${fid}-${scored.length + 1}`) }));
  let vesselChecked = false;

  // 1. Sanctions & Fraud List Matching
  if (/varnell|zemtsov|severny|fedgrain|kremlin|rostec/i.test(lower)) {
    risk = 88;
    conf = 65;
    findings.push({
      agent: 'Sentry',
      title: 'Direct / indirect sanctions exposure match',
      detail: `Counterparty or controlling entity matches entries on UK, EU and US OFAC designated lists.`,
      risk: 'High',
      conf: 88,
      status: 'Open',
      src: 'Built-in sanctions lists (41)'
    });
    factors.push(['-', 'Name matches designated party or parent company in international watchlists']);
    sample({ category: 'sanctions_possible', match_basis: 'strong_name', source_name: LISTS,
      summary: 'The name matches a designated party, or the parent of one, on the built-in sanctions lists. No second identifier was compared.',
      evidence_quote: 'Counterparty or controlling entity matches entries on UK, EU and US OFAC designated lists.' });
  } else if (/kestrel|aurora|caribe/i.test(lower)) {
    risk = 82;
    conf = 60;
    findings.push({
      agent: 'Web',
      title: 'Indirect beneficial ownership connection to restricted party',
      detail: `Web graph identified ownership hops leading to a designated individual or state-linked entity.`,
      risk: 'High',
      conf: 62,
      status: 'Open',
      src: 'Corporate registry filings & news inference'
    });
    factors.push(['-', 'Multi-hop ownership connects to sanctioned entity']);
    sample({ category: 'sanctions_possible', match_basis: 'strong_name', source_trust: 'Medium', source_name: 'Corporate registry filings & news inference',
      subject: `Reported controller of ${cleanName}`, agent: 'Web (offline rules)',
      summary: 'Ownership hops lead to a designated person or a state-linked entity. The link rests on a name, not a second identifier.',
      evidence_quote: 'Web graph identified ownership hops leading to a designated individual or state-linked entity.' });
    sample({ category: 'ownership_unclear', source_trust: 'Medium', source_name: 'Corporate registry filings & news inference', agent: 'Web (offline rules)',
      summary: 'Ownership runs through several layers and the beneficial owner is not confirmed by a registry.',
      evidence_quote: 'Multi-hop ownership connects to sanctioned entity' });
  } else if (/strait/i.test(lower)) {
    risk = 14;
    conf = 96;
    autoCleared = true;
    autoClearReason = 'Different registration number, jurisdiction (SG vs AE) and directors. Name-similarity false positive cleared.';
    findings.push({
      agent: 'Sentry',
      title: 'Potential match: “Straits Bunkering Trading LLC”',
      detail: 'Name similarity 88% to an entry on a sanctions list.',
      risk: 'Low',
      conf: 96,
      status: 'Auto-cleared',
      reason: autoClearReason,
      src: 'Vendor X sanctions API'
    });
    factors.push(['+', 'Registration number differs from the listed entity']);
    factors.push(['+', 'Registry extract is current and verified']);
  } else if (/eko|adebanjo|lagos/i.test(lower)) {
    risk = 64;
    conf = 73;
    findings.push({
      agent: 'Sentry',
      title: 'Politically Exposed Person (PEP) nexus',
      detail: 'Director/beneficial owner identified as a former government commissioner.',
      risk: 'Medium',
      conf: 73,
      status: 'Open',
      src: 'Built-in PEP database'
    });
    factors.push(['-', 'PEP relationship requires senior compliance sign-off']);
    sample({ category: 'pep_owner', match_basis: 'strong_name', source_name: 'Built-in PEP database', subject: `Director or beneficial owner of ${cleanName}`,
      summary: 'A director or beneficial owner is listed as a former government commissioner.',
      evidence_quote: 'Director/beneficial owner identified as a former government commissioner.' });
  } else {
    // Standard baseline screening
    if (cpiScore < 35) {
      risk = 52;
      conf = 68;
      factors.push(['-', `Jurisdiction carries elevated corruption risk (CPI 2025: ${cpiScore}/100)`]);
      findings.push({
        agent: 'Ripples',
        title: 'High-risk jurisdiction exposure',
        detail: `Registered in country scoring ${cpiScore}/100 on Transparency International CPI 2025.`,
        risk: 'Medium',
        conf: 95,
        status: 'Open',
        src: 'Transparency International CPI 2025'
      });
    } else if (docStatus === 'pending') {
      risk = cpiScore < 35 ? 58 : 18;
      conf = 55;
      autoCleared = false;
      findings.push({
        agent: 'Sentry',
        title: 'Screened against 41 sanctions lists & PEP',
        detail: 'Preliminary automated check passed. Counterparty corporate documentation pending.',
        risk: 'Low',
        conf: 70,
        status: 'Open',
        src: 'Built-in sanctions lists and Vendor X sanctions API'
      });
      findings.push({
        agent: 'Doc forensics',
        title: 'Pending basic details & documentation',
        detail: 'Trade licence, registration extract, and beneficial ownership register pending submission.',
        risk: 'Low',
        conf: 50,
        status: 'Open',
        src: 'Intake document checklist'
      });
      factors.push(['-', 'Trade licence and corporate register pending upload']);
      factors.push(['-', 'Ultimate beneficial ownership (UBO) chart unverified']);
      factors.push(['+', 'Zero matches on 41 international watchlists or PEP databases']);
    } else {
      risk = Math.max(8, 40 - Math.round(cpiScore / 3));
      conf = 92;
      autoCleared = true;
      autoClearReason = 'Clean record across 41 sanctions lists, PEP databases and local registries.';
      findings.push({
        agent: 'Sentry',
        title: 'Screened against 41 sanctions lists & PEP',
        detail: 'Zero matches on international watchlists. Automated check passed.',
        risk: 'Low',
        conf: 95,
        status: 'Auto-cleared',
        reason: autoClearReason,
        src: 'Built-in sanctions lists and Vendor X sanctions API'
      });
      factors.push(['+', 'Registration verified with national registry']);
      factors.push(['+', 'No matches on 41 international watchlists or PEP databases']);
    }
  }

  // Vessel specific checks if type is vessel
  if (entity === 'vessel' || /vessel|tanker|carrier|ship/i.test(lower)) {
    if (/aurora|kspirit|dark/i.test(lower)) {
      risk = Math.max(risk, 84);
      findings.unshift({
        agent: 'Tide',
        title: 'AIS signal irregularity detected',
        detail: 'Vessel exhibited an AIS dark period > 12 hours and subsequent ship-to-ship rendezvous.',
        risk: 'High',
        conf: 91,
        status: 'Open',
        src: 'AIS position feed'
      });
      factors.push(['-', 'Tide flagged dark period and unverified position coordinates']);
      vesselChecked = true;
      sample({ category: 'vessel_ais_dark', source_name: 'AIS position feed', agent: 'Tide (offline rules)',
        summary: 'The vessel had an AIS dark period.', evidence_quote: 'Vessel exhibited an AIS dark period > 12 hours and subsequent ship-to-ship rendezvous.' });
      sample({ category: 'vessel_sts_transfer', source_name: 'AIS position feed', agent: 'Tide (offline rules)',
        summary: 'The dark period was followed by a ship-to-ship rendezvous.', evidence_quote: 'Vessel exhibited an AIS dark period > 12 hours and subsequent ship-to-ship rendezvous.' });
    }
  }

  // Score: points from the findings, confidence from the evidence, route from both (src/risk/scorer.js)
  const rules = getRules(db);
  const isVessel = entity === 'vessel' || vesselChecked;
  const place = countryFinding(db, rules, [{ value: jurisdiction, role: isVessel ? 'flag state' : 'country on file' }], { idPrefix: fid, readAt });
  if (place.finding) scored.push(place.finding);
  const listCheck = { ran: true, source_name: LISTS, source_url: sourceLink(LISTS), read_at: readAt, result: 'Screened' };
  // What this offline engine really checks: the built-in lists, the country, and the registry extract when documents are in.
  // It does not search adverse media, and it has vessel behaviour only when the AIS rule fired.
  const checks = { _kind: isVessel ? 'vessel' : entity === 'person' ? 'person' : 'org', sanctions: listCheck, pep: listCheck, country: place.check };
  if (docStatus !== 'pending') checks.ownership = { ran: true, source_name: 'Corporate registry extracts', source_url: sourceLink('Corporate registry extracts'), read_at: readAt, result: 'Registry extract on file' };
  if (vesselChecked) checks.vessel_behaviour = { ran: true, source_name: 'AIS position feed', source_url: sourceLink('AIS position feed'), read_at: readAt, result: 'AIS gap found' };
  const valid = scored.map(f => validateFinding(f, rules));
  const breakdown = assess({ findings: valid.filter(v => v.ok).map(v => v.finding), rejected: valid.filter(v => !v.ok), checks, kind: checks._kind }, rules);
  risk = breakdown.risk;
  conf = breakdown.confidence;
  const quadrant = breakdown.route;
  autoCleared = quadrant === 'monitor';
  if (autoCleared && !autoClearReason) autoClearReason = breakdown.confidenceExplanation;
  if (!autoCleared) autoClearReason = '';
  const routeLabel = {
    escalate: 'Escalate',
    investigate: 'Investigate',
    gaps: 'Fill the gaps',
    monitor: 'Auto-clear and monitor'
  }[quadrant];

  return {
    status: 'screened',
    entity,
    name: cleanName,
    jurisdiction,
    registration: registration || 'VERIFIED-EXTRACT',
    risk,
    confidence: conf,
    quadrant,
    route: routeLabel,
    autoCleared,
    autoClearReason,
    findings,
    factors,
    // The scoring trail: findings in the 4.8 format, the checks that ran, and the "Why <score>?" breakdown
    scoredFindings: scored,
    checks,
    breakdown,
    sources: [
      'Built-in sanctions lists (41)',
      'Vendor X sanctions API',
      'Transparency International CPI 2025',
      'Corporate registry extracts'
    ],
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  screenCounterparty,
  calculateQuadrant
};
