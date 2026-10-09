const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer } = require('../src/server');

const TEST_PORT = 8091;
const BASE_URL = `http://localhost:${TEST_PORT}`;

test('KYC Employee Portal Tests', async (t) => {
  await startServer(TEST_PORT);

  await t.test('GET /api/kyc should return list of seeded requests with 13 schema fields', async () => {
    const res = await fetch(`${BASE_URL}/api/kyc`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.count >= 5);
    assert.ok(Array.isArray(body.requests));

    const r = body.requests[0];
    // Verify 13 Table Schema columns exist
    assert.ok('id' in r);
    assert.ok('submission_date' in r);
    assert.ok('counterparty_name' in r);
    assert.ok('entity_type' in r);
    assert.ok('country' in r);
    assert.ok('relationship_type' in r);
    assert.ok('contract_value' in r);
    assert.ok('ongoing_monitoring' in r);
    assert.ok('request_status' in r);
    assert.ok('screening_result' in r);
    assert.ok('ai_result' in r);
    assert.ok('ddq_required' in r);
    assert.ok('ddq_status' in r);

    // Verify hidden audit fields exist
    assert.ok('created_by_user_id' in r);
    assert.ok('created_by_email' in r);
    assert.ok('created_by_department' in r);
    assert.ok('ip_address' in r);
    assert.ok('client_timestamp' in r);
    assert.ok('last_modified_by' in r);
  });

  await t.test('GET /api/kyc with filter should filter by status and search', async () => {
    const res = await fetch(`${BASE_URL}/api/kyc?status=Approved`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.requests.length >= 1);
    body.requests.forEach(r => assert.equal(r.request_status, 'Approved'));

    const searchRes = await fetch(`${BASE_URL}/api/kyc?search=Severny`);
    assert.equal(searchRes.status, 200);
    const searchBody = await searchRes.json();
    assert.ok(searchBody.requests.some(r => r.counterparty_name.includes('Severny')));
  });

  await t.test('GET /api/kyc/:id should return single hydrated request', async () => {
    const res = await fetch(`${BASE_URL}/api/kyc/KYC-2026-0001`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.request.id, 'KYC-2026-0001');
    assert.equal(body.request.counterparty_name, 'Severny Agro Export LLC');
    assert.equal(body.request.entity_type, 'Organisation');
    assert.equal(typeof body.request.attributes, 'object');
  });

  await t.test('POST /api/kyc/extract-document should parse document and suggest form attributes', async () => {
    const res = await fetch(`${BASE_URL}/api/kyc/extract-document`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: 'acra_bizfile_apex_commodities.pdf',
        fileContent: 'ACRA Business Profile: Apex Commodities Pte Ltd, UEN: 202419822K, Directors: Tan Wei Liang'
      })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.ai_suggested, true);
    assert.ok(body.data);
    assert.ok(body.data.counterparty_name);
    assert.ok(body.data.entity_type);
    assert.ok(Array.isArray(body.extracted_fields));
  });

  await t.test('POST /api/kyc should create new request and trigger DDQ for contract > 100k (Policy §2.1)', async () => {
    const res = await fetch(`${BASE_URL}/api/kyc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': 'EMP-7721',
        'x-user-email': 'marcus.lee@duedilly.internal',
        'x-user-department': 'Energy & Marine Trading'
      },
      body: JSON.stringify({
        counterparty_name: 'Pacific Bulk Shipping Pte Ltd',
        entity_type: 'Organisation',
        country: 'SGP',
        relationship_type: 'Vendor/Supplier',
        contract_value: 350000,
        ongoing_monitoring: true,
        remarks: 'Chartering supplier agreement for Q4 operations',
        attributes: {
          reg_no: '202509112E',
          directors_ubo: 'David Tan (100%)'
        },
        address: '10 Marina Boulevard, Singapore 018983'
      })
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    const created = body.request;

    assert.ok(created.id.startsWith('KYC-'));
    assert.equal(created.counterparty_name, 'Pacific Bulk Shipping Pte Ltd');
    assert.equal(created.contract_value, 350000);
    assert.equal(created.ongoing_monitoring, true);
    // Policy §2.1 must trigger DDQ because value > 100,000
    assert.equal(created.ddq_required, true);
    assert.equal(created.ddq_status, 'Triggered');
    assert.ok(created.ddq_clause.includes('§2.1'));
    // Audit trace fields
    assert.equal(created.created_by_user_id, 'EMP-7721');
    assert.equal(created.created_by_email, 'marcus.lee@duedilly.internal');
    assert.equal(created.created_by_department, 'Energy & Marine Trading');
  });

  await t.test('POST /api/kyc for Person with PEP should trigger Policy §3.6 DDQ', async () => {
    const res = await fetch(`${BASE_URL}/api/kyc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        counterparty_name: 'Sir Arthur Sterling',
        entity_type: 'Person',
        country: 'GBR',
        relationship_type: 'M&A and Investment',
        contract_value: 50000, // under 100k
        pep_declared: true,
        attributes: {
          full_name: 'Sir Arthur Sterling',
          passport: 'GB-PASS-99120',
          pep_declared: true
        }
      })
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    const created = body.request;
    assert.equal(created.ddq_required, true);
    assert.ok(created.ddq_clause.includes('§3.6'));
    assert.equal(created.screening_result, 'PEP Alert');
  });

  await t.test('POST /api/kyc for 3rd Party Broker should trigger Policy §5.2 DDQ', async () => {
    const res = await fetch(`${BASE_URL}/api/kyc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        counterparty_name: 'Geneva Marine Chartering Agents',
        entity_type: 'Organisation',
        country: 'CHE',
        relationship_type: '3rd Party Reps & Brokers',
        contract_value: 80000,
        ongoing_monitoring: false
      })
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    const created = body.request;
    assert.equal(created.ddq_required, true);
    assert.ok(created.ddq_clause.includes('§5.2'));
  });

  await t.test('PATCH /api/kyc/:id/status should update status and record modifier', async () => {
    const res = await fetch(`${BASE_URL}/api/kyc/KYC-2026-0002/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'Approved',
        last_modified_by: 'Senior Compliance Officer (Alex Wong)'
      })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.request.request_status, 'Approved');
    assert.equal(body.request.last_modified_by, 'Senior Compliance Officer (Alex Wong)');
  });

  await t.test('GET /api/kyc/export should return CSV with UTF-8 BOM and all columns', async () => {
    const res = await fetch(`${BASE_URL}/api/kyc/export`);
    assert.equal(res.status, 200);
    const arrayBuf = await res.arrayBuffer();
    const buf = Buffer.from(arrayBuf);

    // Check UTF-8 BOM bytes (EF BB BF)
    assert.equal(buf[0], 0xEF);
    assert.equal(buf[1], 0xBB);
    assert.equal(buf[2], 0xBF);

    const content = buf.toString('utf-8');

    // Check Header columns in order
    assert.ok(content.includes('KYC ID'));
    assert.ok(content.includes('Submission Date'));
    assert.ok(content.includes('Counterparty Name'));
    assert.ok(content.includes('Entity Type'));
    assert.ok(content.includes('Country of Incorporation / Flag / Nationality'));
    assert.ok(content.includes('Relationship Type'));
    assert.ok(content.includes('Anticipated Contract Value (SGD)'));
    assert.ok(content.includes('Ongoing Monitoring'));
    assert.ok(content.includes('Request Status'));
    assert.ok(content.includes('KYC Screening Result'));
    assert.ok(content.includes('AI Result'));
    assert.ok(content.includes('DDQ Required'));
    assert.ok(content.includes('DDQ Status'));

    // Check hidden audit columns
    assert.ok(content.includes('Created By User ID'));
    assert.ok(content.includes('Created By Email'));
    assert.ok(content.includes('Client IP Address'));
    assert.ok(content.includes('Triggered Policy Clause'));

    // Check presence of data
    assert.ok(content.includes('KYC-2026-0001'));
    assert.ok(content.includes('Severny Agro Export LLC'));
  });

  await stopServer();
});
