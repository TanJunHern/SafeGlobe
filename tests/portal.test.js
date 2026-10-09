const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { startServer, stopServer } = require('../src/server');

const TEST_PORT = 8093;
const BASE_URL = `http://localhost:${TEST_PORT}`;

const EMPLOYEE = { 'x-user-email': 'john.doe@safeglobe.com', 'x-user-role': 'employee' };
const COMPLIANCE = { 'x-user-email': 'compliance@safeglobe.com', 'x-user-role': 'compliance_officer' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

test('Tri-Party Portal Tests', async (t) => {
  await startServer(TEST_PORT);
  let kycId;
  let token;

  await t.test('portal routes serve the single-page app', async () => {
    for (const route of ['/login', '/portal/compliance']) {
      const res = await fetch(`${BASE_URL}${route}`);
      assert.equal(res.status, 200);
      assert.ok((await res.text()).includes('id="view-login"'));
    }
  });

  await t.test('/portal/employee serves the table-only page without globe, reviews, sources or policies', async () => {
    const res = await fetch(`${BASE_URL}/portal/employee`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('id="kyc-table"'));
    for (const forbidden of ['id="view-globe"', 'id="view-reviews"', 'id="view-sources"', 'id="view-policies"', 'id="view-compliance"', 'class="rail"']) {
      assert.ok(!html.includes(forbidden), `employee page must not contain ${forbidden}`);
    }
  });

  await t.test('the database, uploads, source and config are not downloadable', async () => {
    const blocked = [
      '/data/safe_globe.db', '/data/test_safe_globe.db', '/data/uploads/.gitkeep', '/data/uploads/ddq/KYC-2026-0001/0-x.pdf',
      '/src/server.js', '/src/config.js', '/package.json', '/.env', '/.env.example', '/GEMINI.md', '/tests/portal.test.js',
      '/demo-data/DEMO-LINKS.md', '/scripts/demo-reset.js', '/node_modules/express/package.json', '/..%2f.env', '/data/..%2fpackage.json'
    ];
    for (const url of blocked) {
      const res = await fetch(`${BASE_URL}${url}`);
      assert.notEqual(res.status, 200, `${url} must not be served`);
    }
    for (const url of ['/portal-shared.css', '/portal-shared.js', '/safe-globe.html']) {
      assert.equal((await fetch(`${BASE_URL}${url}`)).status, 200, `${url} should still be served`);
    }
  });

  await t.test('GET /api/config/public exposes only non-secret client config', async () => {
    const res = await fetch(`${BASE_URL}/api/config/public`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(Object.keys(body).sort(), ['googleClientId', 'googleMapsApiKey', 'mapsEnabled']);
  });

  await t.test('employee persona is seeded and only sees own rows, even with scope=all', async () => {
    const mine = await (await fetch(`${BASE_URL}/api/kyc/my-requests`, { headers: EMPLOYEE })).json();
    assert.ok(mine.count >= 3);
    mine.requests.forEach(r => assert.equal(r.created_by_email, 'john.doe@safeglobe.com'));

    const all = await (await fetch(`${BASE_URL}/api/kyc?scope=all`, { headers: EMPLOYEE })).json();
    all.requests.forEach(r => assert.equal(r.created_by_email, 'john.doe@safeglobe.com'));

    const other = await fetch(`${BASE_URL}/api/kyc/KYC-2026-0001`, { headers: EMPLOYEE });
    assert.equal(other.status, 403);
  });

  await t.test('compliance officer sees the global queue', async () => {
    const body = await (await fetch(`${BASE_URL}/api/kyc?scope=all`, { headers: COMPLIANCE })).json();
    const owners = new Set(body.requests.map(r => r.created_by_email));
    assert.ok(owners.size > 1);
  });

  await t.test('POST /api/kyc/submit issues a signed DDQ link when policy triggers', async () => {
    const res = await fetch(`${BASE_URL}/api/kyc/submit`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, ...EMPLOYEE },
      body: JSON.stringify({
        counterparty_name: 'Harbourline Logistics Pte Ltd',
        entity_type: 'Organisation',
        country: 'SGP',
        relationship_type: 'Vendor/Supplier',
        contract_value: 180000,
        counterparty_email: 'kyc@harbourline.example'
      })
    });
    assert.equal(res.status, 201);
    const { request } = await res.json();
    kycId = request.id;
    assert.equal(request.created_by_email, 'john.doe@safeglobe.com');
    assert.equal(request.request_status, 'Pending DDQ');
    assert.equal(request.ddq_status, 'Triggered');
    assert.ok(request.ddq_link.startsWith('/ddq/portal?token='));
    token = request.ddq_link.split('token=')[1];
  });

  await t.test('POST /api/kyc/:id/send-ddq marks the DDQ as sent', async () => {
    const res = await fetch(`${BASE_URL}/api/kyc/${kycId}/send-ddq`, { method: 'POST', headers: EMPLOYEE });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).request.ddq_status, 'Sent to Counterparty');
  });

  await t.test('GET /api/ddq/verify-token accepts the signed token and rejects tampering', async () => {
    const ok = await fetch(`${BASE_URL}/api/ddq/verify-token?token=${token}`);
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.valid, true);
    assert.equal(body.readOnly, false);
    assert.equal(body.kyc_id, kycId);

    const bad = await fetch(`${BASE_URL}/api/ddq/verify-token?token=${token}x`);
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).valid, false);
  });

  await t.test('POST /api/ddq/submit locks the questionnaire and moves it to DDQ Under Review', async () => {
    const payload = {
      token,
      responses: {
        ubo_list: [{ name: 'Ong Bee Lian', ownership: 60, nationality: 'SGP' }],
        pep_declared: false,
        litigation_declared: true,
        audited_financials_filename: 'fy2025_audited.pdf'
      }
    };
    const res = await fetch(`${BASE_URL}/api/ddq/submit`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(payload) });
    assert.equal(res.status, 200);

    const state = await (await fetch(`${BASE_URL}/api/ddq/verify-token?token=${token}`)).json();
    assert.equal(state.readOnly, true);
    assert.equal(state.status, 'DDQ Under Review');
    assert.equal(state.existing_responses.ubo_list[0].name, 'Ong Bee Lian');

    const again = await fetch(`${BASE_URL}/api/ddq/submit`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(payload) });
    assert.equal(again.status, 400);
  });

  await t.test('POST /api/kyc/:id/triage is restricted to compliance officers', async () => {
    const denied = await fetch(`${BASE_URL}/api/kyc/${kycId}/triage`, {
      method: 'POST', headers: { ...JSON_HEADERS, ...EMPLOYEE }, body: JSON.stringify({ action: 'Approve' })
    });
    assert.equal(denied.status, 403);

    const invalid = await fetch(`${BASE_URL}/api/kyc/${kycId}/triage`, {
      method: 'POST', headers: { ...JSON_HEADERS, ...COMPLIANCE }, body: JSON.stringify({ action: 'Escalate' })
    });
    assert.equal(invalid.status, 400);
  });

  await t.test('triage: Request More Info re-opens the DDQ, Approve completes it', async () => {
    const triage = async (action) => (await (await fetch(`${BASE_URL}/api/kyc/${kycId}/triage`, {
      method: 'POST', headers: { ...JSON_HEADERS, ...COMPLIANCE }, body: JSON.stringify({ action, notes: 'test' })
    })).json()).request;

    const info = await triage('Request More Info');
    assert.equal(info.request_status, 'Pending DDQ');
    assert.equal(info.ddq_status, 'Returned to Counterparty');
    const reopened = await (await fetch(`${BASE_URL}/api/ddq/verify-token?token=${token}`)).json();
    assert.equal(reopened.readOnly, false);

    await fetch(`${BASE_URL}/api/ddq/submit`, {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ token, responses: { ubo_list: [{ name: 'Ong Bee Lian', ownership: 60 }] } })
    });
    const approved = await triage('Approve');
    assert.equal(approved.request_status, 'Approved');
    assert.equal(approved.ddq_status, 'Completed');
    assert.equal(approved.compliance_notes, 'test');
  });

  await t.test('GET /api/kyc/export-excel streams a real .xlsx with hidden audit metadata', async () => {
    const res = await fetch(`${BASE_URL}/api/kyc/export-excel`, { headers: EMPLOYEE });
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type').includes('spreadsheetml'));

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await res.arrayBuffer()));
    const main = workbook.getWorksheet('KYC Requests');
    const headers = main.getRow(1).values.filter(Boolean);
    assert.equal(headers[0], 'KYC ID');
    assert.equal(main.columns.filter(c => !c.hidden).length, 13);
    assert.ok(main.columns.filter(c => c.hidden).length >= 5);
    assert.ok(headers.includes('Created By Email'));
    assert.ok(headers.includes('Triggered Policy Clause'));
    assert.equal(workbook.getWorksheet('Audit & Traceability').state, 'hidden');

    // Row scoping applies to the export as well
    const emailCol = headers.indexOf('Created By Email') + 1;
    for (let i = 2; i <= main.rowCount; i++) {
      assert.equal(main.getRow(i).getCell(emailCol).value, 'john.doe@safeglobe.com');
    }
  });

  await t.test('Ongoing Monitoring requires a location', async () => {
    const res = await fetch(`${BASE_URL}/api/kyc/submit`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, ...EMPLOYEE },
      body: JSON.stringify({ counterparty_name: 'No Pin Trading Pte Ltd', entity_type: 'Organisation', country: 'SGP', relationship_type: 'Vendor/Supplier', contract_value: 20000, ongoing_monitoring: true })
    });
    assert.equal(res.status, 400);
    assert.ok((await res.json()).message.includes('location is required'));
  });

  await t.test('approved requests with Ongoing Monitoring are pinned on the globe', async () => {
    const onGlobe = async id => (await (await fetch(`${BASE_URL}/api/entities`)).json()).entities.find(e => e.id === `kyc-${id.toLowerCase()}`);
    const submit = async body => (await (await fetch(`${BASE_URL}/api/kyc/submit`, {
      method: 'POST', headers: { ...JSON_HEADERS, ...EMPLOYEE }, body: JSON.stringify(body)
    })).json()).request;
    const triage = (id, action) => fetch(`${BASE_URL}/api/kyc/${id}/triage`, {
      method: 'POST', headers: { ...JSON_HEADERS, ...COMPLIANCE }, body: JSON.stringify({ action })
    });
    const location = { address: 'Jurong Port Terminal, 37 Jurong Port Road, Singapore 619110', lat: 1.306, lng: 103.714, place_id: 'sg_jurong' };

    // Green straight away: low value, no policy trigger -> auto-approved -> pinned
    const green = await submit({ counterparty_name: 'Greenlight Supplies Pte Ltd', entity_type: 'Organisation', country: 'SGP', relationship_type: 'Vendor/Supplier', contract_value: 40000, ongoing_monitoring: true, location });
    assert.equal(green.request_status, 'Approved');
    const pin = await onGlobe(green.id);
    assert.ok(pin, 'auto-approved monitored request should be on the globe');
    assert.equal(pin.name, 'Greenlight Supplies Pte Ltd');
    assert.equal(pin.kind, 'org');
    assert.deepEqual(pin.ll, [103.714, 1.306]);
    assert.ok(pin.trigger.includes(green.id));

    // Monitoring off: approved but never pinned
    const unmonitored = await submit({ counterparty_name: 'Quiet Supplies Pte Ltd', entity_type: 'Organisation', country: 'SGP', relationship_type: 'Vendor/Supplier', contract_value: 40000, ongoing_monitoring: false });
    assert.equal(unmonitored.request_status, 'Approved');
    assert.equal(await onGlobe(unmonitored.id), undefined);

    // DDQ required: only pinned once compliance approves, removed again if rejected
    const pending = await submit({ counterparty_name: 'Pending Marine Pte Ltd', entity_type: 'Organisation', country: 'SGP', relationship_type: 'Vendor/Supplier', contract_value: 300000, ongoing_monitoring: true, location });
    assert.equal(pending.request_status, 'Pending DDQ');
    assert.equal(await onGlobe(pending.id), undefined);
    await triage(pending.id, 'Approve');
    assert.ok(await onGlobe(pending.id), 'approved after review should be on the globe');
    await triage(pending.id, 'Reject');
    assert.equal(await onGlobe(pending.id), undefined);
  });

  await stopServer();
});
