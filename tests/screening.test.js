const test = require('node:test');
const assert = require('node:assert/strict');
const { screenCounterparty, calculateQuadrant } = require('../src/services/screening');
const { verifyStatement } = require('../src/services/truthCheck');
const { generateDDQ } = require('../src/services/ddqService');

test('Screening Engine - calculateQuadrant', () => {
  assert.equal(calculateQuadrant(85, 90, 80), 'escalate', 'High risk + High conf => Escalate');
  assert.equal(calculateQuadrant(85, 60, 80), 'investigate', 'High risk + Low conf => Investigate');
  assert.equal(calculateQuadrant(20, 60, 80), 'gaps', 'Low risk + Low conf => Fill the gaps');
  assert.equal(calculateQuadrant(15, 95, 80), 'monitor', 'Low risk + High conf => Auto-clear & monitor');
});

test('Screening Engine - screenCounterparty clean counterparty in high CPI jurisdiction', () => {
  const result = screenCounterparty({
    name: 'Singapore Clean Trading Pte Ltd',
    entity: 'organisation',
    jurisdiction: 'SGP'
  });

  assert.equal(result.status, 'screened');
  assert.equal(result.autoCleared, true);
  assert.equal(result.quadrant, 'monitor');
  assert.ok(result.risk < 50);
  assert.ok(result.confidence >= 80);
  assert.ok(result.findings.length > 0);
});

test('Screening Engine - screenCounterparty flagged entity', () => {
  const result = screenCounterparty({
    name: 'Kestrel Trading FZE',
    entity: 'organisation',
    jurisdiction: 'ARE'
  });

  assert.equal(result.status, 'screened');
  assert.ok(result.risk >= 50);
  assert.equal(result.quadrant, 'investigate');
  assert.equal(result.autoCleared, false);
});

test('Truth Check AI - verifyStatement detects contradiction with state-owned entity', () => {
  const statement = 'We have ended all business with designated entities since 2024.';
  const claims = verifyStatement(statement, { id: 'severny', risk: 88 });

  assert.ok(claims.length > 0);
  const contradictedClaim = claims.find(c => c.tc === 'contradicted');
  assert.ok(contradictedClaim, 'Should detect contradiction with majority owner');
  assert.ok(contradictedClaim.why.includes('conflicts') || contradictedClaim.why.includes('Conflicts'));
});

test('Smart DDQ - generateDDQ for entity', () => {
  const questions = generateDDQ({
    id: 'halcyon',
    findings: [{ title: 'Managed vessel went dark', agent: 'Tide', conf: 94, status: 'Open' }],
    raise: 'Request ship management agreement'
  });

  assert.ok(Array.isArray(questions));
  assert.ok(questions.length >= 2);
});
