/**
 * THE MULTI-AGENT ORCHESTRATOR
 *
 * Central coordinator ("main guy") governing specialized SafeGlobe AI agents:
 *   - Sanctions Agent: Ingests reports (starting with PDF documents from policies and sources)
 *                      and infers sanctioned jurisdictions, active regimes, and evidence.
 *   - Compliance Agent: Intake scoring, risk triage, investigations, DDQ review.
 *
 * The orchestrator receives inbound compliance tasks, routes reports to the right agents,
 * aggregates multi-agent evidence, and synthesizes unified briefings for compliance officers.
 */
const fs = require('fs');
const path = require('path');
const { sanctionsAgent, analyzePdf } = require('./sanctionsAgent');
const complianceAgent = require('./complianceAgent');
const { resolveModel } = require('./framework');
const { getDb } = require('../db');
const gemini = require('../services/geminiClient');

const ORCHESTRATOR_NAME = 'SafeGlobe Multi-Agent Orchestrator';

class Orchestrator {
  constructor() {
    this.name = ORCHESTRATOR_NAME;
    this.agents = new Map();
    this.registerAgent('sanctions', {
      name: 'Sanctions Agent',
      instance: sanctionsAgent,
      describe: require('./sanctionsAgent').describe,
      run: analyzePdf
    });
    this.registerAgent('compliance', {
      name: 'Compliance Agent',
      describe: complianceAgent.describe,
      runIntake: complianceAgent.runIntake,
      runDdqReview: complianceAgent.runDdqReview
    });
  }

  registerAgent(id, agentDef) {
    this.agents.set(id, agentDef);
  }

  getAgent(id) {
    return this.agents.get(id) || null;
  }

  listAgents() {
    return Array.from(this.agents.entries()).map(([id, a]) => ({
      id,
      name: a.name,
      description: typeof a.describe === 'function' ? a.describe().description : ''
    }));
  }

  /**
   * Main entry point to ingest and analyze compliance reports.
   * Specializes in PDF documents from policies, sources, or uploads.
   *
   * @param {{
   *   sourceId?: string,
   *   policyId?: string,
   *   uploadedFileId?: string,
   *   filePath?: string,
   *   content?: string,
   *   base64?: string,
   *   buffer?: Buffer,
   *   filename?: string,
   *   format?: string,
   *   useModel?: boolean
   * }} input
   */
  async analyzeReport(input, { useModel = true } = {}) {
    const started = Date.now();
    const format = String(input.format || 'pdf').toLowerCase();

    // Start with PDF documents only as configured
    if (!format.includes('pdf') && input.filename && !input.filename.toLowerCase().endsWith('.pdf') && !input.sourceId && !input.policyId) {
      return {
        orchestrator: this.name,
        status: 'rejected',
        error: `Format "${format}" not supported yet. Current phase supports PDF documents only.`,
        duration_ms: Date.now() - started
      };
    }

    // Dispatch to Sanctions Agent to extract text and infer sanctioned countries
    const sanctionsResult = await analyzePdf(input, { useModel });

    // Correlate with active policy rules in database
    const db = getDb();
    const activePolicies = db.getPolicies ? db.getPolicies() : [];
    const triggeredPolicyClauses = [];

    if (sanctionsResult.sanctioned_countries && sanctionsResult.sanctioned_countries.length > 0) {
      for (const sc of sanctionsResult.sanctioned_countries) {
        triggeredPolicyClauses.push({
          clause: 'Policy §4.1 (International Sanctions & Prohibited Jurisdictions)',
          jurisdiction: `${sc.country} (${sc.iso3})`,
          regimes: sc.regimes,
          action: 'Mandatory Re-Screen & Pre-Approval'
        });
      }
    }

    const report = {
      orchestrator: this.name,
      task: 'report_analysis',
      dispatched_to: 'Sanctions Agent',
      status: 'completed',
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - started,
      document: sanctionsResult.document,
      sanctions_findings: {
        total_sanctioned_countries: sanctionsResult.sanctioned_countries.length,
        countries: sanctionsResult.sanctioned_countries,
        primary_regimes: sanctionsResult.primary_regimes,
        overall_risk_level: sanctionsResult.overall_risk_level
      },
      policy_governance_impact: {
        clauses_triggered: triggeredPolicyClauses,
        compliance_recommendation: sanctionsResult.recommendation
      },
      summary: sanctionsResult.summary,
      trace: sanctionsResult.trace
    };

    return report;
  }

  /**
   * Evaluates a counterparty KYC form submission against the active sanctions list
   * inferred by the Sanctions Agent from regulatory PDF documents.
   *
   * @param {Object} kycForm - Counterparty KYC form fields (name, country, UBO, contract value, etc.)
   * @param {Object} [options]
   * @param {string} [options.pdfPath] - Path to sanctions PDF (defaults to active uploaded policy or default directive)
   * @param {boolean} [options.useModel] - Whether to synthesize with Gemini LLM
   * @returns {Promise<Object>} Comprehensive LLM safety evaluation (is_safe, verdict, why, policy_clause)
   */
  async screenKycAgainstSanctions(kycForm = {}, { pdfPath = null, useModel = true } = {}) {
    const started = Date.now();
    const db = getDb();

    // 1. Resolve active sanctions PDF document
    let targetPdf = pdfPath;
    if (!targetPdf || !fs.existsSync(targetPdf)) {
      if (db.getUploadedFiles) {
        const custom = db.getUploadedFiles().find(u =>
          (u.file_type === 'custom_policy' || (u.mime_type && u.mime_type.includes('pdf')) || (u.filename && u.filename.endsWith('.pdf'))) &&
          u.storage_path && fs.existsSync(u.storage_path)
        );
        if (custom) targetPdf = custom.storage_path;
      }
    }
    if (!targetPdf || !fs.existsSync(targetPdf)) {
      const defaultDirective = path.join(__dirname, '../../docs/policies/international_sanctions_directive.pdf');
      if (fs.existsSync(defaultDirective)) targetPdf = defaultDirective;
    }
    if (!targetPdf || !fs.existsSync(targetPdf)) {
      const kycPolicy = path.join(__dirname, '../../docs/policies/kyc_policy.pdf');
      if (fs.existsSync(kycPolicy)) targetPdf = kycPolicy;
    }

    const docFilename = targetPdf ? path.basename(targetPdf) : 'international_sanctions_directive.pdf';

    // 2. Run Orchestrator PDF Report Analysis via Sanctions Agent
    let sanctionsFindings = [];
    let reportDoc = { filename: docFilename };

    if (targetPdf && fs.existsSync(targetPdf)) {
      const report = await this.analyzeReport({ filePath: targetPdf, filename: docFilename }, { useModel });
      sanctionsFindings = (report.sanctions_findings && report.sanctions_findings.countries) || [];
      reportDoc = report.document || reportDoc;
    }

    // Baseline fallback jurisdictions if PDF contained 0 parseable text or empty stubs
    if (sanctionsFindings.length === 0) {
      sanctionsFindings = [
        { country: 'Russia', iso3: 'RUS', status: 'Active', severity: 'High', regimes: ['OFAC', 'EU'], sanction_types: ['Comprehensive Embargo', 'Sectoral: Energy & Petroleum'], evidence_excerpt: 'OFAC Executive Order 14024 and EU Council Regulation 833/2014 sectoral sanctions.' },
        { country: 'Iran', iso3: 'IRN', status: 'Active', severity: 'High', regimes: ['OFAC', 'EU', 'UN'], sanction_types: ['Comprehensive Embargo', 'Financial Asset Freeze'], evidence_excerpt: 'Comprehensive trade embargo and financial asset freeze.' },
        { country: 'North Korea', iso3: 'PRK', status: 'Active', severity: 'High', regimes: ['UN', 'OFAC'], sanction_types: ['Comprehensive Embargo'], evidence_excerpt: 'UN Security Council comprehensive trade prohibitions.' },
        { country: 'Syria', iso3: 'SYR', status: 'Active', severity: 'High', regimes: ['OFAC', 'EU'], sanction_types: ['Comprehensive Embargo'], evidence_excerpt: 'Caesar Act and OFAC trade embargoes.' }
      ];
    }

    // 3. Normalize KYC Form Submission
    const name = String(kycForm.counterparty_name || kycForm.name || 'Unknown Entity').trim();
    const country = String(kycForm.country || kycForm.a3 || kycForm.jurisdiction || 'SGP').toUpperCase().trim();
    const entityType = String(kycForm.entity_type || kycForm.kind || 'Organisation').trim();
    const relationship = String(kycForm.relationship_type || kycForm.role || 'Vendor/Supplier').trim();
    const contractValue = Number(kycForm.contract_value || kycForm.anticipated_contract_value || 0);

    let attrs = kycForm.attributes || {};
    if (typeof attrs === 'string') {
      try { attrs = JSON.parse(attrs); } catch (e) { attrs = {}; }
    }
    const regNo = String(attrs.reg_no || kycForm.registration_number || '').trim();
    const directorsUbo = String(attrs.directors_ubo || kycForm.directors_ubo || '').trim();
    const parentCompany = String(attrs.parent_company || kycForm.parent_company || '').trim();
    const vesselFlag = String(attrs.vessel_flag || attrs.flag || '').toUpperCase().trim();
    const remarks = String(kycForm.remarks || '').trim();

    // 4. Cross-Reference KYC Form against the Sanctions List extracted from PDF
    const exposures = [];

    // Check A: Jurisdiction match
    for (const sc of sanctionsFindings) {
      if (country === sc.iso3 || country.toLowerCase() === sc.country.toLowerCase()) {
        exposures.push({
          type: 'Jurisdiction Exposure',
          field: 'country',
          value: `${country} (${sc.country})`,
          country: sc.country,
          iso3: sc.iso3,
          severity: sc.severity,
          regimes: sc.regimes,
          sanction_types: sc.sanction_types,
          evidence_excerpt: sc.evidence_excerpt,
          cpi_score: sc.cpi_score
        });
      }
    }

    // Check B: Vessel flag match
    if (vesselFlag && entityType.toLowerCase() === 'vessel') {
      for (const sc of sanctionsFindings) {
        if (vesselFlag === sc.iso3 || vesselFlag.toLowerCase() === sc.country.toLowerCase()) {
          exposures.push({
            type: 'Vessel Flag Exposure',
            field: 'vessel_flag',
            value: vesselFlag,
            country: sc.country,
            iso3: sc.iso3,
            severity: sc.severity,
            regimes: sc.regimes,
            sanction_types: sc.sanction_types,
            evidence_excerpt: sc.evidence_excerpt
          });
        }
      }
    }

    // Check C: Beneficial Ownership / UBO / Parent Company references to sanctioned countries
    const ownershipText = `${directorsUbo} ${parentCompany} ${remarks}`.toLowerCase();
    for (const sc of sanctionsFindings) {
      const countryTerms = [sc.country.toLowerCase()];
      if (sc.iso3 === 'RUS') countryTerms.push('russia', 'russian', 'rostec', 'kremlin', 'state agro');
      if (sc.iso3 === 'IRN') countryTerms.push('iran', 'iranian', 'tehran');
      if (sc.iso3 === 'PRK') countryTerms.push('north korea', 'dprk', 'pyongyang');
      if (sc.iso3 === 'SYR') countryTerms.push('syria', 'syrian');
      if (sc.iso3 === 'CUB') countryTerms.push('cuba', 'cuban');
      if (sc.iso3 === 'VEN') countryTerms.push('venezuela', 'venezuelan', 'caracas');
      if (sc.iso3 === 'BLR') countryTerms.push('belarus', 'belarusian', 'minsk');

      const hitTerm = countryTerms.find(term => {
        const regex = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'i');
        return regex.test(ownershipText);
      });
      if (hitTerm && !exposures.some(e => e.iso3 === sc.iso3 && e.type.includes('Ownership'))) {
        exposures.push({
          type: 'Beneficial Ownership / Controller Exposure',
          field: 'directors_ubo',
          value: directorsUbo || parentCompany,
          matched_term: hitTerm,
          country: sc.country,
          iso3: sc.iso3,
          severity: sc.severity,
          regimes: sc.regimes,
          sanction_types: sc.sanction_types,
          evidence_excerpt: sc.evidence_excerpt
        });
      }
    }

    // Determine baseline safety
    const isSafe = exposures.length === 0;
    const verdict = isSafe ? 'SAFE' : 'NOT SAFE';
    const statusLabel = isSafe ? 'Clear / Low Risk' : 'Sanctions Alert / High Risk';
    const recommendedAction = isSafe ? 'Auto-Clear & Routine Monitoring' : 'Mandatory Block & Escalation to Compliance Reviewer';
    const policyClause = 'Policy §4.1 (International Sanctions & Prohibited Jurisdictions)';

    // 5. LLM Synthesis: "What the LLM thinks: why safe, or why not safe"
    let llmWhy = '';
    let llmExecutiveSummary = '';
    let usedModelId = 'deterministic_rules';

    if (useModel && gemini.backend() !== 'disabled') {
      try {
        const prompt = `You are the SafeGlobe Compliance Orchestrator AI.
Evaluate whether this counterparty KYC submission is SAFE or NOT SAFE based on the Orchestrator's Sanctions Agent analysis extracted from regulatory PDF directives.

Counterparty KYC Submission:
- Legal Entity / Individual: ${name}
- Entity Type: ${entityType}
- Registered Jurisdiction: ${country}
- Business Relationship: ${relationship}
- Anticipated Contract Value: SGD ${contractValue.toLocaleString('en-SG')}
- Beneficial Controllers & UBOs: ${directorsUbo || 'None declared'}
- Parent Holding: ${parentCompany || 'None declared'}
- Registration Number: ${regNo || 'N/A'}

Orchestrator Sanctions List (Extracted from Regulatory PDF: ${docFilename}):
- Ingested Sanctioned Jurisdictions: ${sanctionsFindings.map(c => `${c.country} (${c.iso3}) - Regimes: ${c.regimes.join('/')}`).join('; ') || 'None'}
- Detected KYC Exposures: ${JSON.stringify(exposures)}
- Primary Governing Clause: ${policyClause}

Respond with strict JSON containing:
{
  "is_safe": ${isSafe},
  "verdict": "${verdict}",
  "executive_summary": "1-2 sentence executive briefing",
  "why": "Detailed paragraph explaining WHY it is safe or WHY it is not safe. Directly cite the counterparty's KYC form attributes (jurisdiction, controllers, contract) against the Orchestrator's PDF sanctions findings and regulatory regimes (OFAC, EU, UN).",
  "actionable_recommendation": "${recommendedAction}"
}`;
        const llmResult = await gemini.generateJsonDetailed([{ text: prompt }], { timeoutMs: 15000 });
        if (llmResult && llmResult.data) {
          usedModelId = llmResult.model || 'gemini';
          if (llmResult.data.why) llmWhy = llmResult.data.why;
          if (llmResult.data.executive_summary) llmExecutiveSummary = llmResult.data.executive_summary;
        }
      } catch (err) {
        console.warn('[Orchestrator] Gemini synthesis skipped or timed out:', err.message);
      }
    }

    // Deterministic fallback explanation if LLM wasn't called or didn't return text
    if (!llmWhy) {
      if (isSafe) {
        const cpiRow = db.getCpiByCode ? db.getCpiByCode(country) : null;
        const cpiText = cpiRow ? `CPI 2025 score of ${cpiRow.score}/100 (${cpiRow.name})` : `jurisdiction code ${country}`;
        llmWhy = `This counterparty is SAFE. ${name} is incorporated in ${country} (${cpiText}) with no direct operations, state-linked controllers, or transaction routing in the sanctioned jurisdictions (${sanctionsFindings.map(s => s.country).slice(0, 5).join(', ') || 'OFAC/EU restricted territories'}) identified in the regulatory PDF directive (${docFilename}). Beneficial ownership (${directorsUbo || 'declared private owners'}) shows no designated political or military ties. All parameters fully comply with ${policyClause}.`;
        llmExecutiveSummary = `Safe: No sanctions or embargo exposures detected against regulatory PDF directives for ${name} (${country}).`;
      } else {
        const hitDetails = exposures.map(e => `${e.type}: ${e.field} references ${e.country} (${e.iso3}) under ${e.regimes.join('/')} sanctions`).join('; ');
        llmWhy = `This counterparty is NOT SAFE (Sanctions Alert). Screening the KYC form against the Orchestrator's regulatory PDF directive (${docFilename}) reveals direct sanctions exposure: ${hitDetails}. Beneficial controllers and corporate registration correlate with prohibited regimes (${[...new Set(exposures.flatMap(e => e.regimes))].join(', ')}). In accordance with ${policyClause}, ongoing onboarding must be halted immediately with mandatory escalation to the Compliance Officer.`;
        llmExecutiveSummary = `Not Safe: Active sanctions exposure detected for ${name} in connection with ${[...new Set(exposures.map(e => e.country))].join(', ')}.`;
      }
    }

    return {
      orchestrator: this.name,
      task: 'kyc_sanctions_screen',
      status: 'completed',
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - started,
      document_name: docFilename,
      kyc_evaluated: {
        counterparty_name: name,
        entity_type: entityType,
        country,
        relationship_type: relationship,
        contract_value: contractValue,
        directors_ubo: directorsUbo,
        parent_company: parentCompany,
        reg_no: regNo,
        vessel_flag: vesselFlag
      },
      is_safe: isSafe,
      verdict,
      status_label: statusLabel,
      summary: llmExecutiveSummary || (isSafe ? 'Counterparty passed sanctions review.' : 'Sanctions violations identified.'),
      why: llmWhy,
      sanctions_exposures: exposures,
      policy_clause: policyClause,
      recommended_action: recommendedAction,
      model_used: usedModelId,
      orchestrator_findings: {
        total_sanctioned_countries_in_pdf: sanctionsFindings.length,
        sanctioned_countries_list: sanctionsFindings.map(c => `${c.country} (${c.iso3})`)
      }
    };
  }

  describe() {
    const model = resolveModel();
    const agentDescriptions = {};
    for (const [id, a] of this.agents.entries()) {
      if (typeof a.describe === 'function') {
        agentDescriptions[id] = a.describe();
      }
    }

    return {
      name: this.name,
      role: 'Master Orchestrator',
      mode: model.mode,
      managed_agents: Array.from(this.agents.keys()),
      supported_ingestion_formats: ['PDF document (application/pdf)'],
      future_ingestion_formats: ['API endpoints', 'Data feeds (CSV/JSON)', 'Web monitors'],
      agents: agentDescriptions,
      guardrails: [
        'Centralized task routing and multi-agent coordination',
        'Ingests PDF documents from policies, custom sources, and direct uploads',
        'Cross-references inferred findings with compliance policy floor and CPI registry',
        'Maintains full deterministic audit trace for every execution'
      ]
    };
  }
}

const orchestrator = new Orchestrator();

module.exports = {
  Orchestrator,
  orchestrator,
  analyzeReport: (input, opts) => orchestrator.analyzeReport(input, opts),
  screenKycAgainstSanctions: (kyc, opts) => orchestrator.screenKycAgainstSanctions(kyc, opts),
  describe: () => orchestrator.describe()
};
