// Tests for Sanctions Agent and Multi-Agent Orchestrator
process.env.GEMINI_API_KEY = '';
process.env.GOOGLE_API_KEY = '';
process.env.GOOGLE_GENAI_API_KEY = '';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer } = require('../src/server');
const sanctionsAgent = require('../src/agents/sanctionsAgent');
const orchestrator = require('../src/agents/orchestrator');

const TEST_PORT = 8098;
const BASE_URL = `http://localhost:${TEST_PORT}`;

const call = async (method, url, body) => {
  const res = await fetch(`${BASE_URL}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test('Sanctions Agent & Multi-Agent Orchestrator', async (t) => {
  try {
    await startServer(TEST_PORT);

    await t.test('GET /api/agent/sanctions describes the Sanctions Agent', async () => {
      const res = await call('GET', '/api/agent/sanctions');
      assert.equal(res.status, 200);
      assert.equal(res.body.name, 'Sanctions Agent');
      assert.equal(res.body.mode, 'placeholder');
      assert.ok(res.body.supported_formats.includes('PDF document'));
      const toolNames = res.body.tools.map(t => t.name);
      assert.ok(toolNames.includes('extract_pdf_document'));
      assert.ok(toolNames.includes('detect_sanctioned_jurisdictions'));
      assert.ok(toolNames.includes('correlate_cpi_risk'));
    });

    await t.test('GET /api/agent/orchestrator describes master orchestrator and managed agents', async () => {
      const res = await call('GET', '/api/agent/orchestrator');
      assert.equal(res.status, 200);
      assert.equal(res.body.name, 'SafeGlobe Multi-Agent Orchestrator');
      assert.equal(res.body.role, 'Master Orchestrator');
      assert.ok(res.body.managed_agents.includes('sanctions'));
      assert.ok(res.body.managed_agents.includes('compliance'));
      assert.ok(res.body.agents.sanctions);
      assert.ok(res.body.agents.compliance);
    });

    await t.test('Sanctions Agent ingests PDF and infers sanctioned countries from text', async () => {
      // Simulate PDF document content with realistic regulatory sanctions text
      const pdfText = `
        REGULATORY ENFORCEMENT & MARITIME SANCTIONS DIRECTIVE 2026
        Issued by the US Department of the Treasury (OFAC) and European Union Council.

        Section 1: General Prohibitions on the Russian Federation.
        In accordance with Executive Order 14024 and EU Council Regulation 833/2014, comprehensive
        maritime oil price cap restrictions and export controls are active on the Russian Federation.
        All vessels engaged in dark fleet or ship-to-ship (STS) transfers of crude oil originating in Russia
        are strictly prohibited from entering sovereign territorial waters.

        Section 2: Islamic Republic of Iran.
        Full comprehensive trade embargo remains in force against Iran. Assets belonging to designated
        state-owned entities and shipping corporations are subject to mandatory asset freeze.

        Section 3: Standard Port Operations.
        All cargo vessels arriving from Singapore and Netherlands must submit standard customs manifests.
      `;

      // Pass simulated PDF document
      const result = await sanctionsAgent.analyzePdf({
        text: pdfText,
        filename: 'ofac_eu_sanctions_maritime_directive_2026.pdf'
      });

      assert.equal(result.stage, 'sanctions_analysis');
      assert.equal(result.overall_risk_level, 'High');
      assert.ok(result.high_risk_jurisdictions_count >= 2);
      assert.ok(result.primary_regimes.includes('OFAC'));
      assert.ok(result.primary_regimes.includes('EU'));

      // Check detected countries
      const rus = result.sanctioned_countries.find(c => c.iso3 === 'RUS');
      assert.ok(rus, 'Russia (RUS) must be identified as a sanctioned country');
      assert.equal(rus.status, 'Active');
      assert.equal(rus.severity, 'High');
      assert.ok(rus.sanction_types.some(t => t.includes('Maritime') || t.includes('Sectoral')));
      assert.ok(rus.evidence_excerpt.toLowerCase().includes('russia'));
      assert.ok(rus.cpi_score !== undefined);

      const irn = result.sanctioned_countries.find(c => c.iso3 === 'IRN');
      assert.ok(irn, 'Iran (IRN) must be identified as a sanctioned country');
      assert.equal(irn.severity, 'High');
      assert.ok(irn.sanction_types.some(t => t.includes('Embargo') || t.includes('Freeze')));

      // Singapore and Netherlands should NOT be marked as sanctioned
      assert.ok(!result.sanctioned_countries.some(c => c.iso3 === 'SGP'), 'Singapore should not be flagged as sanctioned');
      assert.ok(!result.sanctioned_countries.some(c => c.iso3 === 'NLD'), 'Netherlands should not be flagged as sanctioned');

      // Verify trace
      assert.ok(result.trace.length >= 3);
      assert.ok(result.trace.some(e => e.tool === 'extract_pdf_document'));
      assert.ok(result.trace.some(e => e.tool === 'detect_sanctioned_jurisdictions'));
      assert.ok(result.trace.some(e => e.tool === 'correlate_cpi_risk'));
    });

    await t.test('Sanctions Agent returns Clear for non-sanctioned clean document', async () => {
      const cleanDoc = `
        TECHNICAL SPECIFICATIONS REPORT
        Commercial grain silo inspection for Singapore terminal operations.
        All equipment complies with international ISO standards.
      `;

      const result = await sanctionsAgent.analyzePdf({
        text: cleanDoc,
        filename: 'grain_silo_specs.pdf'
      });

      assert.equal(result.overall_risk_level, 'Low');
      assert.equal(result.sanctioned_countries.length, 0);
      assert.ok(result.recommendation.toLowerCase().includes('clear'));
    });

    await t.test('POST /api/agent/sanctions/analyze endpoint processes PDF base64 payload', async () => {
      // Create mock PDF buffer with PDF header and text chunks
      const samplePdfContent = '%PDF-1.4\n1 0 obj\n<< /Length 80 >>\nstream\n(OFAC comprehensive embargo against North Korea and Syria remains enforced.) Tj\nendstream\nendobj\n';
      const base64Pdf = Buffer.from(samplePdfContent).toString('base64');

      const res = await call('POST', '/api/agent/sanctions/analyze', {
        filename: 'sanctions_dprk_syria.pdf',
        content: `data:application/pdf;base64,${base64Pdf}`
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.stage, 'sanctions_analysis');
      assert.ok(res.body.sanctioned_countries.length >= 1);
      const prk = res.body.sanctioned_countries.find(c => c.iso3 === 'PRK' || c.iso3 === 'SYR');
      assert.ok(prk, 'Must identify North Korea or Syria from PDF stream chunks');
    });

    await t.test('POST /api/agent/orchestrator/analyze runs orchestrated report analysis', async () => {
      const reportText = `
        CUSTOMS ENFORCEMENT CIRCULAR 2026:
        Prohibitions on Venezuelan crude oil shipments under US OFAC sanctions.
        Financial institutions must block transactions involving Caracas state oil entities.
      `;

      const res = await call('POST', '/api/agent/orchestrator/analyze', {
        format: 'pdf',
        filename: 'venezuela_crude_ofac_notice.pdf',
        text: reportText
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.orchestrator, 'SafeGlobe Multi-Agent Orchestrator');
      assert.equal(res.body.dispatched_to, 'Sanctions Agent');
      assert.equal(res.body.status, 'completed');
      assert.ok(res.body.sanctions_findings);
      assert.equal(res.body.sanctions_findings.total_sanctioned_countries, 1);
      assert.equal(res.body.sanctions_findings.countries[0].iso3, 'VEN');
      assert.ok(res.body.policy_governance_impact.clauses_triggered.length > 0);
      assert.ok(res.body.policy_governance_impact.clauses_triggered[0].clause.includes('Policy §4.1'));
    });

    await t.test('Orchestrator rejects unsupported formats gracefully', async () => {
      const res = await call('POST', '/api/agent/orchestrator/analyze', {
        format: 'mp4',
        filename: 'video_recording.mp4'
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'rejected');
      assert.ok(res.body.error.includes('PDF documents only'));
    });

    await t.test('Orchestrator screens KYC form against PDF sanctions list and explains why not safe', async () => {
      const badKyc = {
        counterparty_name: 'Severny Agro Export LLC',
        entity_type: 'Organisation',
        country: 'RUS',
        relationship_type: 'Customer/Trading Partner',
        contract_value: 1450000,
        attributes: {
          reg_no: 'RU-104779601',
          directors_ubo: 'Russian State Agricultural Holding (51%)'
        }
      };

      const result = await orchestrator.screenKycAgainstSanctions(badKyc, { useModel: false });
      assert.equal(result.is_safe, false);
      assert.equal(result.verdict, 'NOT SAFE');
      assert.equal(result.status_label, 'Sanctions Alert / High Risk');
      assert.ok(result.why.toLowerCase().includes('not safe'));
      assert.ok(result.why.includes('Russia (RUS)'));
      assert.ok(result.sanctions_exposures.length >= 1);
      assert.ok(result.policy_clause.includes('Policy §4.1'));
      assert.ok(result.recommended_action.includes('Mandatory Block'));
    });

    await t.test('Orchestrator screens KYC form against PDF sanctions list and explains why safe', async () => {
      const safeKyc = {
        counterparty_name: 'Apex Global Trading Pte Ltd',
        entity_type: 'Organisation',
        country: 'SGP',
        relationship_type: 'Vendor/Supplier',
        contract_value: 250000,
        attributes: {
          reg_no: 'UEN 20210012A',
          directors_ubo: 'Tan Wei Liang (60%), Chua Mei Ling (40%)'
        }
      };

      const result = await orchestrator.screenKycAgainstSanctions(safeKyc, { useModel: false });
      assert.equal(result.is_safe, true);
      assert.equal(result.verdict, 'SAFE');
      assert.equal(result.status_label, 'Clear / Low Risk');
      assert.ok(result.why.toLowerCase().includes('safe'));
      assert.ok(result.why.includes('Singapore'));
      assert.equal(result.sanctions_exposures.length, 0);
      assert.ok(result.recommended_action.includes('Auto-Clear'));
    });

    await t.test('POST /api/agent/orchestrator/screen-kyc evaluates entity by entityId', async () => {
      const res = await call('POST', '/api/agent/orchestrator/screen-kyc', {
        entityId: 'severny',
        useModel: false
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.task, 'kyc_sanctions_screen');
      assert.equal(res.body.is_safe, false);
      assert.equal(res.body.verdict, 'NOT SAFE');
      assert.ok(res.body.why);
    });

  } finally {
    await stopServer();
  }
});
