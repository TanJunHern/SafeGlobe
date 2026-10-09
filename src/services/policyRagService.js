/**
 * SafeGlobe KYC Policy RAG Service
 * Grounds compliance rules against corporate KYC policy specification:
 * - Policy §2.1: Anticipated Contract Value > SGD 100,000
 * - Policy §3.6: Politically Exposed Persons (PEP) Self-Declaration / Associated Controllers
 * - Policy §4.1: High-Risk Jurisdiction (CPI < 40 / FATF Watchlist)
 * - Policy §5.2: 3rd Party Intermediaries, Sales Agents & Brokers
 * - Policy §5.4: Maritime High-Risk Assets / Flags of Convenience & Telemetry Anomalies
 */

const config = require('../config');
const gemini = require('./geminiClient');

const CORPORATE_POLICY_DOCUMENT = `
SAFEGLOBE ENTERPRISE COMPLIANCE & COUNTERPARTY RISK POLICY (v2026.1)

Section 1: General Principles
All counterparties onboarded by SafeGlobe employees must undergo automated screening against sanctions, watchlists, adverse media, and jurisdictional risk before contract execution.

Section 2: Contract Value & Financial Exposure Thresholds
Clause 2.1: Any proposed engagement with anticipated contract value exceeding SGD 100,000 (one hundred thousand Singapore Dollars) mandates comprehensive vendor due diligence questionnaire (DDQ) verification and beneficial ownership audit.
Clause 2.2: Contracts exceeding SGD 500,000 require senior compliance officer sign-off and enhanced audited financial verification.

Section 3: Politically Exposed Persons (PEP) & State Connections
Clause 3.6: Any counterparty where a director, senior executive, beneficial owner (>10%), or individual subject is declared as or matched to a Politically Exposed Person (PEP) requires immediate triggering of Enhanced Due Diligence (EDD) Questionnaire and source of funds declaration.

Section 4: Country & Jurisdictional Risk
Clause 4.1: Counterparties incorporated in, operating from, or flagged under jurisdictions with a Transparency International Corruption Perceptions Index (CPI) score below 40, or listed on FATF Call for Action / Increased Monitoring, trigger mandatory DDQ disclosures.

Section 5: Entity-Specific Risk Controls
Clause 5.2 (Intermediaries): All engagements categorized under "3rd Party Reps & Brokers", intermediaries, or sales agents mandate statutory due diligence questionnaires regardless of initial contract value.
Clause 5.4 (Maritime & Vessels): Maritime vessels flying flags of convenience (e.g., Panama, Liberia, Marshall Islands) or exhibiting recorded AIS telemetry dark periods exceeding 12 hours require mandatory vessel questionnaire submission, charterer verification, and IMO registry audit.
`;

/**
 * Evaluates counterparty details against Policy Document via Gemini RAG or deterministic policy rules
 */
async function evaluatePolicyRAG(counterpartyData) {
  const contractVal = Number(counterpartyData.contract_value || counterpartyData.anticipated_contract_value || 0);
  const country = (counterpartyData.country || 'SGP').toUpperCase();
  const relType = counterpartyData.relationship_type || '';
  const entityType = counterpartyData.entity_type || 'Organisation';
  const attrs = counterpartyData.attributes || {};
  const cpiScore = counterpartyData.cpiScore !== undefined ? counterpartyData.cpiScore : 55;

  const apiKey = (config.geminiApiKey || '').trim();
  const isRealKey = apiKey && apiKey !== 'YOUR_GOOGLE_AI_STUDIO_API_KEY' && apiKey.length > 15;

  // 1. Try Gemini RAG Evaluation if API key configured
  if (isRealKey) {
    try {
      let model = config.geminiModel;
      const prompt = `You are the SafeGlobe Compliance Policy Auditor.
Evaluate the following counterparty onboarding request against the corporate policy document provided below.

POLICY DOCUMENT:
${CORPORATE_POLICY_DOCUMENT}

COUNTERPARTY DATA:
- Name: ${counterpartyData.counterparty_name}
- Entity Type: ${entityType}
- Country/Flag: ${country} (CPI Score: ${cpiScore})
- Relationship Type: ${relType}
- Anticipated Contract Value (SGD): ${contractVal}
- Attributes: ${JSON.stringify(attrs)}
- Remarks: ${counterpartyData.remarks || 'None'}

RULES TO AUDIT:
1. Clause 2.1: Contract Value > SGD 100,000 -> DDQ Required.
2. Clause 3.6: PEP declared or detected -> DDQ Required.
3. Clause 4.1: Jurisdiction CPI < 40 or high-risk -> DDQ Required.
4. Clause 5.2: 3rd Party Reps & Brokers -> DDQ Required.
5. Clause 5.4: Vessel flag of convenience / AIS anomaly -> DDQ Required.

Respond strictly in valid JSON matching this schema:
{
  "ddq_required": <boolean>,
  "triggered_clauses": ["<exact clause citation, e.g. Policy §2.1 (Contract Value > SGD 100,000)>"],
  "primary_clause": "<short string summarizing triggered clauses>",
  "policy_rationale": "<thorough compliance audit explanation citing exact clauses>"
}`;

      const result = await gemini.generateJsonDetailed(prompt, { timeoutMs: 15000 });
      if (result) {
        model = result.model;
        {
          const parsed = result.data;
          return {
            ddq_required: Boolean(parsed.ddq_required),
            ddq_clause: parsed.primary_clause || (parsed.triggered_clauses || []).join(' & '),
            triggered_clauses: parsed.triggered_clauses || [],
            policy_rationale: parsed.policy_rationale || '',
            model: model
          };
        }
      }
    } catch (err) {
      console.warn('[Policy RAG] Gemini RAG check fell back to deterministic engine:', err.message);
    }
  }

  // 2. Deterministic exact policy evaluator
  const triggered = [];
  if (contractVal > 100000) {
    triggered.push('Policy §2.1 (Contract Value > SGD 100,000)');
  }

  const isPep = Boolean(attrs.pep_declared || counterpartyData.pep_declared || /pep/i.test(counterpartyData.remarks || ''));
  if (isPep) {
    triggered.push('Policy §3.6 (Politically Exposed Persons & Beneficial Ownership Ties)');
  }

  if (cpiScore < 40 || ['RUS', 'IRN', 'PRK', 'SYR', 'MMR', 'VEN', 'CUB', 'YEM', 'LBY', 'SDN', 'SOM'].includes(country)) {
    triggered.push(`Policy §4.1 (High-Risk Jurisdiction / CPI ${cpiScore} < 40)`);
  }

  if (relType === '3rd Party Reps & Brokers' || /broker|intermediary|agent/i.test(relType)) {
    triggered.push('Policy §5.2 (Third-Party Representatives, Agents & Intermediary Risk)');
  }

  if (entityType === 'Vessel') {
    const vesselFlag = (attrs.vessel_flag || country).toUpperCase();
    if (['PAN', 'LBR', 'MHL', 'RUS', 'IRN', 'PRK'].includes(vesselFlag) || /dark|sts|transshipment|anomaly/i.test(counterpartyData.remarks || '')) {
      triggered.push('Policy §5.4 (Maritime High-Risk Flags & AIS Telemetry Controls)');
    }
  }

  const ddqRequired = triggered.length > 0;
  return {
    ddq_required: ddqRequired,
    ddq_clause: triggered.join(' & ') || 'No mandatory DDQ triggered by corporate policy',
    triggered_clauses: triggered,
    policy_rationale: ddqRequired
      ? `Mandatory compliance questionnaire triggered under SafeGlobe KYC Policy: ${triggered.join('; ')}.`
      : 'Counterparty satisfies baseline thresholds. Contract value within standard operational tier; no elevated jurisdictional or PEP flags.',
    model: 'SafeGlobe-Policy-Engine'
  };
}

module.exports = {
  CORPORATE_POLICY_DOCUMENT,
  evaluatePolicyRAG
};
