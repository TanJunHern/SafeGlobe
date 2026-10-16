/**
 * The scorer: findings in; risk points, confidence and route out (AI build spec section 4).
 * Pure functions, no database and no AI. "The AI understands; the rules score; a person decides."
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const round2 = n => Math.round(n * 100) / 100;

function levelFor(risk, rules) {
  return rules.levels.find(l => risk >= l.min && risk <= l.max) || rules.levels[rules.levels.length - 1];
}

/** escalate | investigate | gaps | monitor. A confirmed sanctions match always escalates. */
function routeFor(risk, confidence, rules, { confirmedSanctions = false } = {}) {
  if (confirmedSanctions) return 'escalate';
  const high = risk >= rules.routes.riskLine;
  const sure = confidence >= rules.confidence.threshold;
  return high ? (sure ? 'escalate' : 'investigate') : (sure ? 'monitor' : 'gaps');
}

function poseFor(route, rules, { confirmedSanctions = false } = {}) {
  if (route === 'escalate') return confirmedSanctions ? rules.poses.escalateSanctions : rules.poses.escalate;
  return rules.poses[route] || null; // "Fill the gaps" has no pose
}

function freshnessFor(readAt, rules, now = Date.now()) {
  const age = now - Date.parse(readAt);
  const f = rules.confidence.freshness;
  if (!(age >= 0)) return { key: 'within30Days', value: f.within30Days }; // read "in the future": clock skew, treat as fresh
  if (age <= 30 * DAY_MS) return { key: 'within30Days', value: f.within30Days };
  if (age <= 365 * DAY_MS) return { key: 'within12Months', value: f.within12Months };
  return { key: 'older', value: f.older };
}

/** Per finding: source trust x match strength x freshness, plus the bonus for a second independent source (capped at 1). */
function findingConfidence(finding, rules, now = Date.now()) {
  const c = rules.confidence;
  const trust = c.sourceTrust[finding.source_trust] ?? 0;
  const match = c.matchStrength[finding.match_basis] ?? 0;
  const fresh = freshnessFor(finding.read_at, rules, now);
  const corroborated = (finding.corroborating_sources || []).length > 0;
  const bonus = corroborated ? c.corroborationBonus : 0;
  return {
    value: round2(Math.min(1, trust * match * fresh.value + bonus)),
    parts: { sourceTrust: trust, matchStrength: match, freshness: fresh.value, freshnessKey: fresh.key, corroborationBonus: bonus }
  };
}

/**
 * Turns accepted findings into points.
 * Each row counts once; rows in the same group are alternatives; the total is capped; a confirmed sanctions match sets it to the cap.
 */
function scoreFindings(findings, rules, now = Date.now()) {
  const lines = [];
  const notCounted = [];
  const byRow = new Map();
  for (const f of findings) {
    const row = rules.rowById[f.category];
    if (!row) { notCounted.push({ id: f.id, category: f.category, reason: 'Not a row in the points table.' }); continue; }
    const conf = findingConfidence(f, rules, now);
    const held = byRow.get(row.id);
    // The best-evidenced finding speaks for its row
    if (!held || conf.value > held.conf.value) {
      if (held) notCounted.push({ id: held.finding.id, category: row.id, reason: `"${row.short}" already counted once for this case.` });
      byRow.set(row.id, { finding: f, row, conf });
    } else {
      notCounted.push({ id: f.id, category: row.id, reason: `"${row.short}" already counted once for this case.` });
    }
  }

  // Alternatives (country): only the row with the most points counts
  const groups = new Map();
  for (const entry of byRow.values()) {
    if (!entry.row.group) continue;
    const best = groups.get(entry.row.group);
    if (!best || entry.row.points > best.row.points) groups.set(entry.row.group, entry);
  }
  for (const entry of [...byRow.values()]) {
    if (entry.row.group && groups.get(entry.row.group) !== entry) {
      byRow.delete(entry.row.id);
      notCounted.push({ id: entry.finding.id, category: entry.row.id, reason: `"${groups.get(entry.row.group).row.short}" already counts for the country. A country counts once.` });
    }
  }

  for (const row of rules.rows) {
    const entry = byRow.get(row.id);
    if (!entry) continue;
    const f = entry.finding;
    lines.push({
      findingId: f.id, category: row.id, rule: row.label, short: row.short, policy: row.policy || '', points: row.points,
      subject: f.subject, summary: f.summary, quote: f.evidence_quote, sourceName: f.source_name, sourceUrl: f.source_url || '',
      ddqAnswerId: f.ddq_answer_id || '', readAt: f.read_at, agent: f.agent, demo: Boolean(f.demo),
      corroboratingSources: f.corroborating_sources || [], confidence: entry.conf.value, confidenceParts: entry.conf.parts,
      setsTotal: Boolean(row.setsTotal), sendsDdq: Boolean(row.sendsDdq),
      // What the screening agent cited from the policy and suggested (display only: neither changes the points)
      policyClause: f.policy_clause || '', policyQuote: f.policy_quote || '', policyNote: f.policy_note || '', suggestedAction: f.suggested_action || ''
    });
  }

  const cap = rules.routes.cap;
  const sum = lines.reduce((n, l) => n + l.points, 0);
  const confirmedSanctions = lines.some(l => l.setsTotal);
  const total = confirmedSanctions ? cap : Math.min(cap, sum);
  return { total, sum, capped: !confirmedSanctions && sum > cap, confirmedSanctions, lines, notCounted };
}

/** The checks this kind of case needs, each marked as run or not run. */
function coverageFor(checks, kind, rules) {
  const required = [...rules.requiredChecks.all, ...(kind === 'vessel' ? rules.requiredChecks.vessel : [])];
  const list = required.map(id => {
    const c = (checks || {})[id] || {};
    // A check only counts when it ran and its result names a source
    const ran = Boolean(c.ran && c.source_name);
    return { id, label: rules.checkLabels[id] || id, ran, sourceName: c.source_name || '', sourceUrl: c.source_url || '', readAt: c.read_at || '', result: c.result || (ran ? '' : 'Not run') };
  });
  const done = list.filter(c => c.ran).length;
  return { list, done, required: required.length, share: required.length ? done / required.length : 0 };
}

/**
 * Case confidence, as a percentage.
 * With findings: the average of the counted findings' confidence, weighted by their points.
 * Without: coverage, the share of required checks that ran and returned a sourced result.
 */
function confidenceFor(score, checks, kind, rules) {
  const coverage = coverageFor(checks, kind, rules);
  const weighted = score.lines.filter(l => l.points > 0);
  if (weighted.length) {
    const weight = weighted.reduce((n, l) => n + l.points, 0);
    const value = weighted.reduce((n, l) => n + l.confidence * l.points, 0) / weight;
    return { value: Math.round(value * 100), basis: 'findings', coverage, explanation: 'Average confidence of the counted findings, weighted by their points.' };
  }
  return { value: Math.round(coverage.share * 100), basis: 'coverage', coverage, explanation: `No finding added points, so confidence is coverage: ${coverage.done} of ${coverage.required} required checks ran and returned a sourced result.` };
}

function routeReason(route, risk, confidence, rules, confirmedSanctions) {
  const line = rules.routes.riskLine;
  const thr = rules.confidence.threshold;
  if (confirmedSanctions) return 'A confirmed sanctions match always goes to Escalate, whatever the confidence.';
  const r = risk >= line ? `Risk ${risk} is ${line} or more` : `Risk ${risk} is below ${line}`;
  const c = confidence >= thr ? `confidence ${confidence}% is ${thr}% or more` : `confidence ${confidence}% is under ${thr}%`;
  return `${r} and ${c}, so the route is ${rules.routes.labels[route]}.`;
}

/**
 * The whole breakdown for one case: what the drawer, the Reviews queue and the API show.
 * findings: accepted findings. rejected: findings that failed validation, with their reasons. checks: which checks ran.
 */
function assess({ findings = [], rejected = [], checks = {}, kind = 'org' } = {}, rules, now = Date.now()) {
  const score = scoreFindings(findings, rules, now);
  const level = levelFor(score.total, rules);
  const confidence = confidenceFor(score, checks, kind, rules);
  const route = routeFor(score.total, confidence.value, rules, score);
  const sources = new Map();
  for (const f of findings) if (f.source_name) sources.set(f.source_name, { name: f.source_name, url: f.source_url || '', readAt: f.read_at });
  for (const c of confidence.coverage.list) if (c.ran && !sources.has(c.sourceName)) sources.set(c.sourceName, { name: c.sourceName, url: c.sourceUrl, readAt: c.readAt });

  return {
    risk: score.total,
    sum: score.sum,
    capped: score.capped,
    cap: rules.routes.cap,
    confirmedSanctions: score.confirmedSanctions,
    level: { id: level.id, label: level.label, colour: level.colour },
    confidence: confidence.value,
    confidenceBasis: confidence.basis,
    confidenceExplanation: confidence.explanation,
    confidenceThreshold: rules.confidence.threshold,
    coverage: confidence.coverage,
    route,
    routeLabel: rules.routes.labels[route],
    routeReason: routeReason(route, score.total, confidence.value, rules, score.confirmedSanctions),
    pose: poseFor(route, rules, score),
    sendsDdq: score.lines.some(l => l.sendsDdq),
    lines: score.lines,
    notCounted: score.notCounted,
    rejected: rejected.map(r => ({ id: r.finding.id, category: r.finding.category, summary: r.finding.summary, sourceName: r.finding.source_name, reason: r.reason })),
    sources: [...sources.values()],
    pipeline: [
      { id: 'read', label: 'Read', detail: `${sources.size} source${sources.size === 1 ? '' : 's'} read` },
      { id: 'understand', label: 'Understand', detail: `${findings.length + rejected.length} finding${findings.length + rejected.length === 1 ? '' : 's'}${rejected.length ? `, ${rejected.length} rejected` : ''}` },
      { id: 'check', label: 'Check', detail: `${score.lines.length} matched a rule` },
      { id: 'score', label: 'Score', detail: `${score.total} of ${rules.routes.cap}${score.capped ? ' (capped)' : ''}` },
      { id: 'weigh', label: 'Weigh', detail: `${confidence.value}% confidence` },
      { id: 'route', label: 'Route', detail: rules.routes.labels[route] }
    ],
    rulesVersion: rules.version,
    rulesChanged: rules.changes
  };
}

module.exports = { assess, scoreFindings, findingConfidence, confidenceFor, coverageFor, routeFor, levelFor, poseFor, freshnessFor };
