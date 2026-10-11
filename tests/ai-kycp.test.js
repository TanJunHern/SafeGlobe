const test = require('node:test');
const assert = require('node:assert');
const { runKycpCheck, tools, KYCP_INSTRUCTIONS } = require('../src/services/aiKycpService');

test('AI KYCP - Instructions and Tools schema', () => {
  assert(KYCP_INSTRUCTIONS.includes('DueDilly Senior Compliance AI Analyst'));
  assert(typeof tools.searchKnowledgeBase === 'function');
  assert(typeof tools.searchEntities === 'function');
  assert(typeof tools.getOwnershipGraph === 'function');
  assert(typeof tools.getCountryRisk === 'function');
  assert(typeof tools.getVesselSignals === 'function');
});

test('AI KYCP - Screen Organisation with Sanctions & State Ownership (Severny)', async () => {
  const result = await runKycpCheck({
    query: 'Severny Agro Export LLC',
    type: 'organisation'
  });

  assert.strictEqual(result.status, 'completed');
  assert.strictEqual(result.target, 'Severny Agro Export LLC');
  assert.strictEqual(result.entityType, 'organisation');
  assert(result.overallRisk.score >= 70, 'Risk score must be high');
  assert.strictEqual(result.overallRisk.level, 'High');
  assert.strictEqual(result.overallRisk.quadrant, 'escalate');
  assert.strictEqual(result.knowYourCounterparty.ownershipAndUbo.status, 'Flagged');
  assert(['Designated / High Risk', 'Possible Match', 'Designated'].includes(result.knowYourCounterparty.sanctionsAndWatchlists.status));
  assert(result.findings.length > 0);
  assert(result.sourcesUsed.length > 0);
});

test('AI KYCP - Screen Vessel with AIS Dark Period (Aurora Venture)', async () => {
  const result = await runKycpCheck({
    query: 'Aurora Venture',
    type: 'vessel'
  });

  assert.strictEqual(result.status, 'completed');
  assert.strictEqual(result.entityType, 'vessel');
  assert(result.overallRisk.score >= 70, 'Vessel with dark period must have elevated risk');
  assert(result.findings.some(f => /dark|ais|sts/i.test(f.title + ' ' + f.detail)));
  assert.strictEqual(result.knowYourCounterparty.adverseMediaAndTelemetry.status, 'Flagged');
});

test('AI KYCP - Screen Person with Beneficial Ownership Links (Arkady Zemtsov)', async () => {
  const result = await runKycpCheck({
    query: 'Arkady Zemtsov',
    type: 'person'
  });

  assert.strictEqual(result.status, 'completed');
  assert.strictEqual(result.entityType, 'person');
  assert.strictEqual(result.overallRisk.level, 'High');
  assert(['Designated / High Risk', 'Designated', 'Possible Match'].includes(result.knowYourCounterparty.sanctionsAndWatchlists.status));
});

test('AI KYCP - Screen Clean Counterparty in High CPI Jurisdiction', async () => {
  const result = await runKycpCheck({
    query: 'Apex Global Trading Pte Ltd',
    type: 'organisation',
    jurisdiction: 'SGP'
  });

  assert.strictEqual(result.status, 'completed');
  assert(result.overallRisk.score < 50, 'Clean entity must have low to moderate baseline risk');
  assert(['monitor', 'gaps'].includes(result.overallRisk.quadrant));
  assert(['Verified', 'Pending', 'Unverified'].includes(result.knowYourCounterparty.identityVerification.status));
  assert.strictEqual(result.knowYourCounterparty.sanctionsAndWatchlists.status, 'Clean');
});

