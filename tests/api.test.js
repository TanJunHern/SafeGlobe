const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer } = require('../src/server');

const TEST_PORT = 8089;
const BASE_URL = `http://localhost:${TEST_PORT}`;

test('API Integration Tests', async (t) => {
  await startServer(TEST_PORT);

  await t.test('GET /api/health should return status healthy', async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'healthy');
    assert.equal(data.service, 'Safe Globe Compliance Platform');
  });

  await t.test('POST /v1/screen should screen counterparty', async () => {
    const res = await fetch(`${BASE_URL}/v1/screen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entity: 'organisation',
        name: 'Kestrel Trading FZE',
        jurisdiction: 'ARE',
        watch: true
      })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.name, 'Kestrel Trading FZE');
    assert.ok(data.risk >= 50);
    assert.ok(data.sources.length > 0);
  });

  await t.test('GET /api/entities should return list of counterparties', async () => {
    const res = await fetch(`${BASE_URL}/api/entities`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.total > 0);
    assert.ok(Array.isArray(data.entities));
    const halcyon = data.entities.find(e => e.id === 'halcyon');
    assert.ok(halcyon);
    assert.equal(halcyon.role, 'Ship manager');
  });

  await t.test('POST /api/intake should register new counterparty', async () => {
    const res = await fetch(`${BASE_URL}/api/intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Pacific Grain Suppliers Pte Ltd',
        type: 'org',
        country: 'SGP',
        role: 'Grain Supplier'
      })
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.ok(data.entity.id);
    assert.equal(data.entity.name, 'Pacific Grain Suppliers Pte Ltd');
  });

  await t.test('POST /api/claim should verify and claim organization profile (PRD 2.1)', async () => {
    const res = await fetch(`${BASE_URL}/api/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'halcyon',
        email: 'compliance@halcyonmarine.com',
        signatory: 'Maria Chen, Compliance Director',
        role: 'Ship manager'
      })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'claimed');
    assert.equal(data.entity.claimed, true);
  });

  await t.test('POST /api/statements should publish clarification statement & run Truth check (PRD 2.2, 2.3)', async () => {
    const res = await fetch(`${BASE_URL}/api/statements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'halcyon',
        text: 'Halcyon Marine has operated since 2018 in full compliance with international maritime laws. We have appointed external legal counsel to review vessel management procedures.',
        remediation: 'External legal audit initiated.'
      })
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.status, 'published');
    assert.ok(data.claimsCount > 0);
    assert.ok(data.statement.claims.length > 0);
  });

  await t.test('POST /api/ddq/answer should verify DDQ answers and elevate confidence (PRD 2.4)', async () => {
    const res = await fetch(`${BASE_URL}/api/ddq/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'kestrel',
        answers: { 'q1': 'Certified registry extract provided.' }
      })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'verified');
    assert.ok(data.newConfidence > 60);
  });

  await t.test('POST /api/ask should solve queries using graph reasoning (PRD B.8)', async () => {
    const res = await fetch(`${BASE_URL}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'Show suppliers within two ownership hops of a Russian state-owned company'
      })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.found, true);
    assert.ok(data.steps.length > 0);
    assert.ok(data.res.length > 0);
  });

  await t.test('POST /api/sources/test should simulate live connector probe (PRD 1.8)', async () => {
    const res = await fetch(`${BASE_URL}/api/sources/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'API', url: 'https://api.example.com/kyc' })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.logs.length > 0);
  });

  await t.test('POST /api/cases/:id/decision should record compliance decision memo (PRD B.7)', async () => {
    const res = await fetch(`${BASE_URL}/api/cases/halcyon/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decision: 'Approved with conditions',
        reasons: 'Vessel management charter verified by Sofia Lim',
        reviewer: 'Grace Teo',
        evidence: 'Certified registry extract'
      })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'recorded');
  });

  await t.test('GET / safe-globe.html serves static HTML UI', async () => {
    const res = await fetch(`${BASE_URL}/`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('Safe Globe'));
    assert.ok(text.includes('id="map"'));
  });

  await stopServer();
});
