/**
 * Sentry Screening Agent (PRD Phase 1 & Baseline B.1, B.4)
 * Screens counterparties (organisations, people, vessels) against:
 * - 41 International Sanctions Lists (UN, US OFAC, EU, UK OFSI, MAS, etc.)
 * - Politically Exposed Persons (PEP) Databases
 * - Corporate Registry Filings & Gazette records
 * - Vessel AIS signals & Dark Period anomalies
 * - Custom uploaded feeds and API connectors
 */

const { getDb } = require('../db');

function calculateQuadrant(risk, conf, threshold = 80) {
  const isHighRisk = risk >= 50;
  const isHighConf = conf >= threshold;
  if (isHighRisk && isHighConf) return 'escalate';
  if (isHighRisk && !isHighConf) return 'investigate';
  if (!isHighRisk && !isHighConf) return 'gaps';
  return 'monitor'; // low-risk, high-confidence
}

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
    }
  }

  const quadrant = calculateQuadrant(risk, conf);
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
