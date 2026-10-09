/**
 * THE COMPLIANCE AGENT
 *
 * One agent that works every stage of a KYC request:
 *
 *   1. Intake scoring   when an employee submits: screens, scores and cites policy
 *   2. Investigation    "digging": knowledge base, ownership graph, beneficial owners
 *   3. DDQ review       when the counterparty returns its questionnaire: scores the answers,
 *                       lists issues by question, and recommends Approve / Bounce back / Escalate
 *
 * It never makes the final decision. The policy rules remain the floor (the agent can raise a
 * recommendation, never lower one), and a compliance officer approves, rejects or bounces.
 *
 * With no working Gemini key it runs in placeholder mode: same tools, same scores, with
 * templated explanations instead of model-written ones.
 */
const { Tool, Agent, Runner } = require('./framework');
const { getDb } = require('../db');
const { screenCounterparty } = require('../services/screening');
const templateService = require('../services/ddqTemplateService');

const AGENT_NAME = 'Compliance Agent';
const INSTRUCTION = `You are the SafeGlobe Compliance Agent. You assist compliance officers with counterparty due diligence.
Base every statement on the tool results you are given; never invent facts, list hits or documents.
You do not approve or reject: you score, explain and recommend. Write for a busy compliance officer: short, specific, plain English.
Respond with JSON only, in the exact shape requested.`;

// Clause numbers that really exist in the SafeGlobe policy; the model may only cite these
function policyClauses() {
  const text = require('../services/policyRagService').CORPORATE_POLICY_DOCUMENT;
  const numbers = new Set([...text.matchAll(/Clause (\d+\.\d+)/g)].map(m => m[1]));
  return { text, numbers };
}

const RECOMMENDATION_RANK = { auto_clear: 0, approve: 0, require_ddq: 1, bounce_back: 1, escalate: 2 };
const RECOMMENDATION_LABEL = {
  auto_clear: 'Auto-clear', require_ddq: 'Require DDQ', escalate: 'Escalate to officer',
  approve: 'Approve', bounce_back: 'Bounce back to counterparty'
};
const levelFor = score => (score >= 70 ? 'High' : score >= 40 ? 'Medium' : 'Low');
const str = (v, max = 600) => String(v == null ? '' : v).trim().slice(0, max);

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const screenWatchlists = new Tool({
  name: 'screen_watchlists',
  description: 'Screen a name against sanctions, PEP and watchlist data',
  parameters: { name: 'string', entity_type: 'Organisation | Vessel | Person', country: 'ISO alpha-3' },
  run: ({ name, entity_type = 'Organisation', country = 'SGP' }) => {
    const hit = screenCounterparty({ name, entity: String(entity_type).toLowerCase(), jurisdiction: country });
    return {
      risk: hit.risk,
      confidence: hit.conf,
      result: hit.screeningResult || (hit.risk >= 80 ? 'Sanctions Alert' : 'Clear'),
      findings: (hit.findings || []).map(f => ({ title: f.title, detail: f.detail, risk: f.risk, source: f.src })),
      summary: `${name}: ${hit.screeningResult || 'screened'} (risk ${hit.risk}, ${(hit.findings || []).length} findings)`
    };
  }
});

const countryRisk = new Tool({
  name: 'country_risk',
  description: 'Look up the Corruption Perceptions Index score for a jurisdiction',
  parameters: { country: 'ISO alpha-3' },
  run: ({ country }) => {
    const row = getDb().getCpiByCode(country);
    const score = row ? row.score : null;
    return { country, name: row ? row.name : country, cpi: score, high_risk: score !== null && score < 40, summary: `${country}: CPI ${score === null ? 'unknown' : score}` };
  }
});

const policyRules = new Tool({
  name: 'policy_rules',
  description: 'Evaluate the request against SafeGlobe policy clauses (the decision floor)',
  parameters: { request: 'KYC request' },
  run: ({ request }) => {
    const out = require('../services/kycService').evaluatePolicyRules(request);
    return { ddq_required: out.ddq_required, clauses: out.triggered_clauses, summary: out.triggered_clauses.join('; ') || 'No clause triggered' };
  }
});

const riskModel = new Tool({
  name: 'risk_model',
  description: 'Compute the composite risk score from screening, jurisdiction, relationship and value',
  parameters: { request: 'KYC request' },
  run: ({ request }) => {
    const hit = screenCounterparty({ name: request.counterparty_name, entity: String(request.entity_type || '').toLowerCase(), jurisdiction: request.country });
    const out = require('../services/kycService').calculateAiRisk(request, hit);
    return { score: out.ai_score, confidence: out.ai_confidence, screening_result: out.screening_result, rationale: out.ai_rationale, summary: `score ${out.ai_score}/100, ${out.screening_result}` };
  }
});

const knowledgeBaseSearch = new Tool({
  name: 'knowledge_base_search',
  description: 'Search ingested sources (registries, adverse media, datasets) for the counterparty',
  parameters: { name: 'string' },
  run: ({ name }) => {
    const hits = (getDb().searchSourceRecords(name) || []).slice(0, 5).map(h => ({
      source: h.source_label, entity: h.entity_name, risk_level: h.risk_level, summary: str(h.summary, 200)
    }));
    return { hits, summary: hits.length ? `${hits.length} record(s): ${hits.map(h => `${h.source} (${h.risk_level})`).join(', ')}` : 'No records found' };
  }
});

const ownershipTrace = new Tool({
  name: 'ownership_trace',
  description: 'Trace ownership and control links for the counterparty in the entity graph',
  parameters: { name: 'string' },
  run: ({ name }) => {
    const db = getDb();
    const entities = db.getAllEntities();
    const byId = new Map(entities.map(e => [e.id, e]));
    const target = entities.find(e => e.name.toLowerCase() === String(name).toLowerCase());
    if (!target) return { links: [], summary: 'Not in the ownership graph' };
    // Edges come back as [sourceId, targetId, label, provenance, confidence]
    const links = db.getOwnershipEdges()
      .filter(([src, tgt]) => src === target.id || tgt === target.id)
      .slice(0, 8)
      .map(([src, tgt, label, provenance]) => {
        const other = byId.get(src === target.id ? tgt : src);
        return { relation: label, with: other ? other.name : (src === target.id ? tgt : src), with_risk: other ? other.risk : null, provenance };
      });
    return { links, summary: links.length ? links.map(l => `${l.relation} ${l.with}`).join('; ') : 'No ownership links recorded' };
  }
});

/**
 * Deterministic review of a returned questionnaire. Produces issues tied to question ids so
 * they can be bounced back to the counterparty one by one.
 *   fixable = the counterparty can resolve it by amending the answer (-> bounce back)
 *   not fixable = a genuine disclosure that needs an officer's judgement (-> escalate)
 */
const ddqQualityReview = new Tool({
  name: 'ddq_quality_review',
  description: 'Score a returned questionnaire: evasive answers, thin details, disclosures, missing controls and documents, inconsistencies',
  parameters: { template: 'questionnaire snapshot', responses: 'counterparty answers', request: 'KYC request' },
  run: ({ template, responses, request }) => {
    const answers = responses.answers || {};
    const tables = responses.tables || {};
    const issues = [];
    const add = (questionId, severity, category, reason, ask, fixable = true) =>
      issues.push({ question_id: questionId, severity, category, reason, ask, fixable });
    const sections = [];

    for (const section of template.sections || []) {
      let sectionIssues = 0;
      const before = issues.length;
      for (const q of section.questions) {
        const a = answers[q.id] || {};
        const control = templateService.isControlQuestion(section.title, q.text);

        if (q.type === 'text') {
          const v = str(a.value_en || a.value, 2000);
          if (/^(n\/?a|na|nil|none|tbc|tbd|-+|\.+|x+|test.*|\?+)$/i.test(v) || v.length < 2) {
            add(q.id, 'medium', 'evasive answer', `Answer "${v}" does not address the question.`, 'Please give a full answer, or state "Not applicable" with the reason.');
          } else if (/^not applicable/i.test(v) && v.length < 24) {
            add(q.id, 'low', 'unexplained N/A', '"Not applicable" was given without a reason.', 'Please explain briefly why this does not apply to your company.');
          }
        } else if (q.type === 'yesno') {
          const details = str(a.details_en || a.details, 2000);
          if (a.value === 'Yes' && q.detailsPrompt && details.length < 15) {
            add(q.id, 'medium', 'insufficient detail', 'Answered Yes but the supporting details are too brief to assess.', `Please give more detail: ${q.detailsPrompt.replace(/^If Yes,?\s*/i, '')}.`);
          }
          if (a.value === 'Yes' && !control) {
            const topic = `${section.title} ${q.text}`;
            if (/sanction/i.test(topic)) add(q.id, 'high', 'sanctions disclosure', `Sanctions exposure declared: ${q.text}`, '', false);
            else if (/violation|bribery|fraud|laundering|convict|investigat|debar|insolvency|adverse media|litigation|enforcement/i.test(topic)) add(q.id, 'high', 'violation disclosure', `Adverse history declared: ${q.text}`, '', false);
            else if (/\bPEP\b|politically exposed|government official|government entity|state-owned/i.test(topic)) add(q.id, 'medium', 'government / PEP link', `Government or PEP connection declared: ${q.text}`, '', false);
            else if (/conflict|family member|close associate|gift|hospitality/i.test(topic)) add(q.id, 'medium', 'conflict of interest', `Potential conflict of interest declared: ${q.text}`, '', false);
          }
          if (a.value === 'No' && control && /anti-bribery|sanctions compliance|anti-money laundering|code of conduct|whistleblowing/i.test(q.text)) {
            add(q.id, 'low', 'missing control', `No ${q.text.replace(/^(a|an)\s/i, '').replace(/\s+that.*$/, '')} in place.`, 'Please confirm whether an equivalent control exists, or when one will be adopted.');
          }
        } else if (q.type === 'table') {
          const rows = (tables[q.id] || []).filter(r => Object.values(r || {}).some(v => str(v)));
          if (/beneficial owner/i.test(q.text)) {
            if (a.none || !rows.length) {
              add(q.id, 'medium', 'ownership gap', 'No beneficial owner was declared.', 'Please name every individual who owns or controls 25% or more, or explain why there is none (for example, a listed parent).');
            } else {
              const total = rows.reduce((n, r) => {
                const cell = Object.entries(r).find(([k]) => /%|held|control/i.test(k));
                const m = cell ? String(cell[1]).match(/\d+(\.\d+)?/) : null;
                return n + (m ? Number(m[0]) : 0);
              }, 0);
              if (total > 100.5) add(q.id, 'medium', 'ownership inconsistency', `Declared beneficial ownership adds up to ${total}%.`, 'Please check the percentages held by each beneficial owner.');
            }
          }
        }
      }
      sectionIssues = issues.length - before;
      const penalty = issues.slice(before).reduce((n, i) => n + ({ high: 25, medium: 10, low: 4 }[i.severity]), 0);
      sections.push({ id: section.id, title: section.title, score: Math.max(0, 100 - penalty * 2), issues: sectionIssues });
    }

    // Consistency with what the employee submitted
    const nameQ = (template.sections || []).flatMap(s => s.questions).find(q => q.type === 'text' && /registered name/i.test(q.text));
    if (nameQ && answers[nameQ.id] && answers[nameQ.id].value) {
      const norm = v => String(v).toLowerCase().replace(/\b(pte|ltd|llc|inc|limited|co|corp|plc)\b|[^a-z0-9]/g, '');
      const given = norm(answers[nameQ.id].value);
      const expected = norm(request.counterparty_name);
      if (given && expected && !given.includes(expected) && !expected.includes(given)) {
        add(nameQ.id, 'medium', 'inconsistent with request', `Registered name "${answers[nameQ.id].value}" differs from the onboarding request ("${request.counterparty_name}").`, 'Please confirm the full registered name, and explain any difference from the name we hold.');
      }
    }

    // Supporting documents
    const docs = responses.documents || {};
    const missingDocs = (template.documents || []).filter((_, i) => !(docs[i] && docs[i].key));
    if (missingDocs.length) {
      add('documents', missingDocs.length >= 3 ? 'medium' : 'low', 'missing documents',
        `${missingDocs.length} of ${template.documents.length} supporting documents were not uploaded.`,
        `Please upload: ${missingDocs.join('; ')}.`);
    }

    const penalty = issues.reduce((n, i) => n + ({ high: 25, medium: 10, low: 4 }[i.severity]), 0);
    const score = Math.max(0, 100 - penalty);
    return { score, sections, issues, summary: `quality ${score}/100, ${issues.length} issue(s)` };
  }
});

// ---------------------------------------------------------------------------
// Stage 1 + 2: intake scoring and investigation
// ---------------------------------------------------------------------------

const intakeAgent = new Agent({
  name: AGENT_NAME,
  description: 'Scores a new KYC request and investigates the counterparty',
  instruction: INSTRUCTION,
  tools: [screenWatchlists, countryRisk, policyRules, riskModel, knowledgeBaseSearch, ownershipTrace],
  async plan(request, ctx) {
    const screening = await ctx.call('screen_watchlists', { name: request.counterparty_name, entity_type: request.entity_type, country: request.country }, 'Screening the counterparty');
    const country = await ctx.call('country_risk', { country: request.country }, 'Checking jurisdiction risk');
    const policy = await ctx.call('policy_rules', { request }, 'Applying SafeGlobe policy clauses');
    const risk = await ctx.call('risk_model', { request }, 'Scoring overall risk');
    const kb = await ctx.call('knowledge_base_search', { name: request.counterparty_name }, 'Digging: knowledge base');
    const ownership = await ctx.call('ownership_trace', { name: request.counterparty_name }, 'Digging: ownership graph');

    const findings = [
      // Clean results ("zero matches") are evidence in the trace, not findings
      ...(screening ? screening.findings.filter(f => /high|medium/i.test(f.risk || '')).map(f => ({ source: 'Screening', text: `${f.title}: ${f.detail}`, risk: f.risk })) : []),
      ...(kb ? kb.hits.filter(h => /high|medium/i.test(h.risk_level || '')).map(h => ({ source: h.source, text: h.summary, risk: h.risk_level })) : []),
      ...(ownership ? ownership.links.filter(l => (l.with_risk || 0) >= 70).map(l => ({ source: 'Ownership graph', text: `${l.relation} ${l.with} (risk ${l.with_risk})`, risk: 'High' })) : [])
    ];

    const score = risk ? risk.score : 20;
    const screeningResult = risk ? risk.screening_result : 'Clear';
    let recommendation = 'auto_clear';
    if (policy && policy.ddq_required) recommendation = 'require_ddq';
    if (/sanction/i.test(screeningResult) || score >= 80 || findings.some(f => /high/i.test(f.risk || ''))) recommendation = 'escalate';

    const clauses = (policy ? policy.clauses : []).map(text => ({ text, source: 'policy rules' }));
    return {
      stage: 'intake',
      score,
      level: levelFor(score),
      confidence: risk ? risk.confidence : 80,
      screening_result: screeningResult,
      ddq_required: Boolean(policy && policy.ddq_required),
      clauses,
      findings,
      recommendation,
      recommendation_label: RECOMMENDATION_LABEL[recommendation],
      rationale: [
        `${request.counterparty_name} scores ${score}/100 (${levelFor(score)} risk); screening result: ${screeningResult}.`,
        country && country.cpi !== null ? `Jurisdiction ${country.name} has a CPI of ${country.cpi}${country.high_risk ? ', below the high-risk threshold of 40' : ''}.` : '',
        clauses.length ? `Policy clauses triggered: ${clauses.map(c => c.text).join('; ')}.` : 'No policy clause is triggered.',
        findings.length ? `Investigation surfaced ${findings.length} finding(s) for review.` : 'Investigation of the knowledge base and ownership graph surfaced nothing adverse.'
      ].filter(Boolean).join(' '),
      evidence: { screening, country, knowledge_base: kb, ownership }
    };
  },
  async synthesize(draft, ctx, request) {
    const out = await ctx.llm(`Review this new counterparty onboarding request and the evidence gathered by your tools.

REQUEST: ${JSON.stringify({ name: request.counterparty_name, type: request.entity_type, country: request.country, relationship: request.relationship_type, contract_value_sgd: request.contract_value, ongoing_monitoring: request.ongoing_monitoring, attributes: request.attributes, remarks: request.remarks })}
TOOL RESULTS: ${JSON.stringify({ score: draft.score, screening_result: draft.screening_result, clauses: draft.clauses.map(c => c.text), findings: draft.findings, evidence: draft.evidence })}
CURRENT RECOMMENDATION: ${draft.recommendation}

SAFEGLOBE POLICY (the only clauses that exist):
${policyClauses().text}

Return JSON:
{
  "rationale": "<3-4 sentences explaining the score and what drives it, citing the clauses and findings above>",
  "additional_clauses": ["<e.g. 'Policy §3.6 (reason)': a clause from the policy text above that the rules missed, only if clearly supported by the request; else empty>"],
  "observations": ["<up to 3 short points an officer should check, grounded in the evidence>"],
  "recommendation": "<auto_clear | require_ddq | escalate>"
}`);
    if (!out) return draft;
    if (str(out.rationale)) draft.rationale = str(out.rationale, 1200);
    // Only clauses that exist in the policy, and that the rules have not already triggered
    const known = policyClauses().numbers;
    const already = new Set(draft.clauses.flatMap(c => (c.text.match(/\d+\.\d+/g) || [])));
    (Array.isArray(out.additional_clauses) ? out.additional_clauses : []).map(c => str(c, 200)).filter(Boolean).slice(0, 3)
      .forEach(text => {
        const number = (text.match(/\d+\.\d+/) || [])[0];
        if (!number || !known.has(number) || already.has(number)) return;
        already.add(number);
        draft.clauses.push({ text, source: 'agent' });
      });
    draft.observations = (Array.isArray(out.observations) ? out.observations : []).map(o => str(o, 300)).filter(Boolean).slice(0, 3);
    // The agent may raise the recommendation, never lower it below the rule-based floor
    if (RECOMMENDATION_RANK[out.recommendation] > RECOMMENDATION_RANK[draft.recommendation]) {
      draft.recommendation = out.recommendation;
      draft.recommendation_label = RECOMMENDATION_LABEL[out.recommendation];
      draft.raised_by_agent = true;
    }
    return draft;
  }
});

// ---------------------------------------------------------------------------
// Stage 3: DDQ review
// ---------------------------------------------------------------------------

const ddqAgent = new Agent({
  name: AGENT_NAME,
  description: 'Reviews a returned due diligence questionnaire',
  instruction: INSTRUCTION,
  tools: [ddqQualityReview, screenWatchlists],
  async plan({ request, template, responses }, ctx) {
    const review = await ctx.call('ddq_quality_review', { template, responses, request }, 'Scoring the questionnaire answers');
    const issues = review ? review.issues : [];

    // Digging: screen every declared beneficial owner
    const owners = templateService.deriveScreeningFields(template, responses).ubo_list;
    for (const owner of owners.slice(0, 6)) {
      const hit = await ctx.call('screen_watchlists', { name: owner.name, entity_type: 'Person', country: request.country }, `Digging: screening beneficial owner ${owner.name}`);
      if (hit && (hit.risk >= 60 || /alert/i.test(hit.result))) {
        const ownersQ = (template.sections || []).flatMap(s => s.questions).find(q => q.type === 'table' && /beneficial owner/i.test(q.text));
        issues.push({
          question_id: ownersQ ? ownersQ.id : 'ownership', severity: 'high', category: 'beneficial owner screening',
          reason: `Beneficial owner ${owner.name} returned ${hit.result} (risk ${hit.risk}).`, ask: '', fixable: false
        });
      }
    }

    const penalty = issues.reduce((n, i) => n + ({ high: 25, medium: 10, low: 4 }[i.severity]), 0);
    const score = Math.max(0, 100 - penalty);
    const blocking = issues.filter(i => !i.fixable && i.severity === 'high');
    const fixable = issues.filter(i => i.fixable);
    const satisfactory = score >= 70 && !blocking.length && !fixable.some(i => i.severity !== 'low');

    let recommendation = 'approve';
    if (fixable.some(i => i.severity !== 'low') || fixable.length >= 3) recommendation = 'bounce_back';
    if (blocking.length) recommendation = 'escalate';

    const bounceIssues = fixable.map(i => ({ question_id: i.question_id, note: i.ask || i.reason }));
    return {
      stage: 'ddq_review',
      score,
      level: score >= 80 ? 'Satisfactory' : score >= 60 ? 'Needs clarification' : 'Unsatisfactory',
      satisfactory,
      sections: review ? review.sections : [],
      issues,
      recommendation,
      recommendation_label: RECOMMENDATION_LABEL[recommendation],
      bounce: {
        issues: bounceIssues,
        message: bounceIssues.length
          ? `Thank you for completing the questionnaire. Before we can finish our review, please clarify ${bounceIssues.length} point${bounceIssues.length > 1 ? 's' : ''} highlighted below and resubmit.`
          : ''
      },
      rationale: [
        `The questionnaire scores ${score}/100 with ${issues.length} issue(s).`,
        blocking.length ? `${blocking.length} disclosure(s) need an officer's judgement: ${blocking.map(i => i.category).join(', ')}.` : '',
        fixable.length ? `${fixable.length} point(s) can be resolved by the counterparty: ${[...new Set(fixable.map(i => i.category))].join(', ')}.` : '',
        !issues.length ? 'Answers are complete, specific and consistent with the onboarding request.' : ''
      ].filter(Boolean).join(' ')
    };
  },
  async synthesize(draft, ctx, { request, template, responses }) {
    const answered = (template.sections || []).flatMap(s => s.questions.map(q => {
      const a = (responses.answers || {})[q.id] || {};
      if (q.type === 'table') return null;
      const value = q.type === 'yesno' ? `${a.value || ''}${a.details ? ` — ${a.details_en || a.details}` : ''}` : (a.value_en || a.value || '');
      return `${q.id} ${q.text} => ${str(value, 240)}`;
    }).filter(Boolean)).join('\n');

    const out = await ctx.llm(`Review this returned due diligence questionnaire from ${request.counterparty_name}.

ANSWERS:
${answered.slice(0, 14000)}

ISSUES ALREADY FOUND BY YOUR TOOLS: ${JSON.stringify(draft.issues)}
CURRENT RECOMMENDATION: ${draft.recommendation} (score ${draft.score}/100)

Return JSON:
{
  "rationale": "<3-4 sentences for the officer: overall quality, what is concerning, what is merely incomplete. Do not state a numeric score.>",
  "additional_issues": [ { "question_id": "<an id from the answers above>", "severity": "<low|medium>", "reason": "<what is unsatisfactory>", "ask": "<what to ask the counterparty>" } ],
  "bounce_message": "<a courteous 2-sentence note to the counterparty asking them to clarify the fixable points; empty if none>"
}
Only add an issue if the answer itself is vague, contradictory or non-responsive. Do not repeat issues already listed.`);
    if (!out) return draft;
    if (str(out.rationale)) draft.rationale = str(out.rationale, 1200).replace(/\s*\(?\b\d{1,3}\s*\/\s*100\)?/g, '');
    const validIds = new Set((template.sections || []).flatMap(s => s.questions.map(q => q.id)));
    const known = new Set(draft.issues.map(i => `${i.question_id}`));
    (Array.isArray(out.additional_issues) ? out.additional_issues : []).slice(0, 5).forEach(i => {
      const id = str(i && i.question_id, 24);
      if (!validIds.has(id) || known.has(id) || !str(i.reason)) return;
      const severity = i.severity === 'medium' ? 'medium' : 'low';
      draft.issues.push({ question_id: id, severity, category: 'agent review', reason: str(i.reason, 300), ask: str(i.ask, 300), fixable: true, source: 'agent' });
      draft.bounce.issues.push({ question_id: id, note: str(i.ask, 300) || str(i.reason, 300) });
      draft.score = Math.max(0, draft.score - (severity === 'medium' ? 10 : 4));
    });
    if (str(out.bounce_message) && draft.bounce.issues.length) draft.bounce.message = str(out.bounce_message, 600);
    if (draft.recommendation === 'approve' && draft.bounce.issues.some(b => draft.issues.find(i => i.question_id === b.question_id && i.severity !== 'low'))) {
      draft.recommendation = 'bounce_back';
      draft.recommendation_label = RECOMMENDATION_LABEL.bounce_back;
      draft.raised_by_agent = true;
    }
    draft.satisfactory = draft.satisfactory && draft.recommendation === 'approve';
    return draft;
  }
});

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

function store(requestId, patch) {
  const db = getDb();
  const request = db.getKycRequestById(requestId);
  if (!request) return null;
  const agent = Object.assign({ name: AGENT_NAME, intake: null, ddq: null, history: [] }, request.agent || {}, patch);
  db.setKycAgent(requestId, agent);
  return agent;
}

function withoutEvidence(result) {
  const { evidence, ...rest } = result; // evidence is summarised in the trace; keep the stored record small
  return rest;
}

/**
 * Stage 1 + 2. With enrich: 'background' the deterministic assessment is stored immediately
 * and the model-written explanation replaces it when it arrives.
 */
async function runIntake(requestId, { enrich = 'await' } = {}) {
  const request = getDb().getKycRequestById(requestId);
  if (!request) return null;
  const run = async useModel => {
    const result = withoutEvidence(await Runner.run(intakeAgent, request, { useModel }));
    return store(requestId, { intake: result });
  };
  if (enrich === 'background') {
    const agent = await run(false);
    run(true).catch(err => console.error(`[${AGENT_NAME}] intake enrichment failed:`, err.message));
    return agent;
  }
  return run(enrich !== 'none');
}

/**
 * Stage 3. Scores the questionnaire currently stored on the request.
 */
async function runDdqReview(requestId, { enrich = 'await' } = {}) {
  const db = getDb();
  const request = db.getKycRequestById(requestId);
  if (!request) return null;
  const responses = request.ddq_responses || {};
  const bundle = db.getKycDdqBundle(requestId) || {};
  if (responses.format !== 'template-v1' || !bundle.template) return null;

  const run = async useModel => {
    const result = await Runner.run(ddqAgent, { request, template: bundle.template, responses }, { useModel });
    result.round = (responses.bounce_history || []).length + 1;
    const current = (db.getKycRequestById(requestId) || {}).agent || {};
    const history = (current.history || []).filter(h => !(h.stage === 'ddq_review' && h.round === result.round));
    history.push({ stage: 'ddq_review', round: result.round, score: result.score, recommendation: result.recommendation, ran_at: result.ran_at });
    return store(requestId, { ddq: result, history });
  };
  if (enrich === 'background') {
    const agent = await run(false);
    run(true).catch(err => console.error(`[${AGENT_NAME}] DDQ review enrichment failed:`, err.message));
    return agent;
  }
  return run(enrich !== 'none');
}

function describe() {
  const { resolveModel } = require('./framework');
  const model = resolveModel();
  const tools = new Map();
  [intakeAgent, ddqAgent].forEach(a => a.describe().tools.forEach(t => tools.set(t.name, t)));
  return {
    name: AGENT_NAME,
    mode: model.mode,
    model: model.mode === 'gemini' ? require('../services/geminiClient').modelChain() : ['deterministic placeholder'],
    runtime: 'builtin (ADK / LangChain compatible shape)',
    stages: [
      { id: 'intake', label: 'Intake scoring', when: 'Employee submits a KYC request' },
      { id: 'investigation', label: 'Investigation', when: 'Runs with intake: knowledge base, ownership graph, beneficial owners' },
      { id: 'ddq_review', label: 'DDQ review', when: 'Counterparty returns the questionnaire (and after every bounce)' }
    ],
    recommendations: RECOMMENDATION_LABEL,
    guardrails: [
      'Policy rules are the decision floor: the agent can raise a recommendation, never lower it',
      'The agent recommends; a compliance officer approves, rejects or bounces back',
      'Every tool call is recorded in a trace shown to the officer'
    ],
    tools: [...tools.values()]
  };
}

module.exports = { AGENT_NAME, runIntake, runDdqReview, describe, RECOMMENDATION_LABEL };
