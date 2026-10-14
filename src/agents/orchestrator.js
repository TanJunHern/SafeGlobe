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
const { sanctionsAgent, analyzePdf } = require('./sanctionsAgent');
const complianceAgent = require('./complianceAgent');
const { resolveModel } = require('./framework');
const { getDb } = require('../db');

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
  describe: () => orchestrator.describe()
};
