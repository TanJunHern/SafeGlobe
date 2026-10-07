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

  await t.test('POST /api/intake with attachments should store uploaded files in DB & disk', async () => {
    const res = await fetch(`${BASE_URL}/api/intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Baltic Grain Carriers OU',
        type: 'org',
        country: 'EST',
        role: 'Grain Shipper',
        attachedFeed: {
          filename: 'baltic_intake_feed.csv',
          size: 140,
          records: 2,
          content: 'name,reg,country\nBaltic Grain Carriers OU,14981123,EST'
        },
        attachedPolicy: {
          filename: 'baltic_deal_covenant.pdf',
          size: 256,
          content: 'data:application/pdf;base64,JVBERi0xLjQKJcTl8uXrp...'
        }
      })
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.ok(data.entity.id);

    // Verify uploads endpoint
    const upRes = await fetch(`${BASE_URL}/api/uploads?entity_id=${data.entity.id}`);
    assert.equal(upRes.status, 200);
    const upData = await upRes.json();
    assert.equal(upData.total, 2);
    assert.ok(upData.uploads.some(u => u.file_type === 'data_feed' && u.filename === 'baltic_intake_feed.csv'));
    assert.ok(upData.uploads.some(u => u.file_type === 'custom_policy' && u.filename === 'baltic_deal_covenant.pdf'));
  });

  await t.test('POST /api/policies/compile should persist policy document to uploaded_files', async () => {
    const res = await fetch(`${BASE_URL}/api/policies/compile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Maritime_Covenants_2026.pdf',
        filename: 'Maritime_Covenants_2026.pdf',
        size: 512,
        content: 'data:application/pdf;base64,JVBERi0xLjQKJcTl8uXrp...'
      })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'compiled');
    assert.ok(data.uploadedFile);
    assert.equal(data.uploadedFile.filename, 'Maritime_Covenants_2026.pdf');
  });

  await t.test('POST /api/sources with PDF document should store source & file in DB and disk', async () => {
    const res = await fetch(`${BASE_URL}/api/sources`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: 'MAS Enforcement Gazette Oct 2026',
        type: 'PDF document',
        how: 'Parsed PDF document, entity extraction active',
        cover: 'Organisations, people',
        trust: 'High',
        category: 'Regulatory enforcement gazette',
        filename: 'mas_enforcement_oct2026.pdf',
        fileSize: 1024,
        mimeType: 'application/pdf',
        content: 'data:application/pdf;base64,JVBERi0xLjQKJcTl8uXrp...'
      })
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.status, 'created');
    assert.ok(data.source.id);
    assert.equal(data.source.label, 'MAS Enforcement Gazette Oct 2026');
    assert.equal(data.source.type, 'PDF document');
    assert.ok(data.uploadedFile);
    assert.equal(data.uploadedFile.filename, 'mas_enforcement_oct2026.pdf');

    // Test GET /api/sources returns the new source
    const getRes = await fetch(`${BASE_URL}/api/sources`);
    assert.equal(getRes.status, 200);
    const getData = await getRes.json();
    assert.ok(getData.sources.some(s => s.id === data.source.id));
  });

  await t.test('POST /api/sources/test should simulate PDF entity extraction probe', async () => {
    const res = await fetch(`${BASE_URL}/api/sources/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'PDF document',
        filename: 'sanctions_gazette_2026.pdf'
      })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.logs.some(l => l.includes('PDF document structure')));
    assert.ok(data.logs.some(l => l.includes('AI entity extractor')));
  });

  // Clean up transient test entities, sources, and uploads
  const { getDb } = require('../src/db');
  const db = getDb();
  const baseIds = ['halcyon', 'kestrel', 'severny', 'aurora', 'zemtsov'];
  const baseSourceIds = ['s1', 's2', 's3', 's4'];
  const placeholders = baseIds.map(() => '?').join(',');
  const srcPlaceholders = baseSourceIds.map(() => '?').join(',');
  try {
    db.db.prepare('DELETE FROM uploaded_files').run();
    db.db.prepare('DELETE FROM sources WHERE id NOT IN (' + srcPlaceholders + ')').run(...baseSourceIds);
    db.db.prepare('DELETE FROM cases WHERE entity_id NOT IN (' + placeholders + ')').run(...baseIds);
    db.db.prepare('DELETE FROM alerts WHERE entity_id NOT IN (' + placeholders + ')').run(...baseIds);
    db.db.prepare('DELETE FROM entities WHERE id NOT IN (' + placeholders + ')').run(...baseIds);
  } catch (e) {}

  await stopServer();
});
