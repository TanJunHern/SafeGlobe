const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer } = require('../src/server');
const vesselFinder = require('../src/services/vesselFinderService');
const kycService = require('../src/services/kycService');
const { getDb } = require('../src/db');

const TEST_PORT = 8099;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const EMPLOYEE = { 'Content-Type': 'application/json', 'x-user-email': 'john.doe@duedilly.com', 'x-user-role': 'employee' };
const LOCATION = { address: 'Tuas Mega Port Terminal, Tuas South Avenue 14, Singapore', lat: 1.258, lng: 103.635, place_id: 'sg_tuas' };

// A cut-down copy of the public vessel page
const PAGE = `<html><head><title>EVER GIVEN, Container Ship - Details and current position - IMO 9811000 - VesselFinder</title></head><body>
<div id="djson" data-json='{ "v":true,"lrpd":"41 hours ago ","mmsi":636026627,"ship_lat":-35,"ship_lon":19,"ship_cog":106.3,"ship_sog":17.8}'></div>
<p>The current position of <strong>EVER GIVEN</strong> is at South Africa reported 41 hours ago by AIS. The vessel is en route to the port of
<a href="/ports/SGSIN001">Singapore, Singapore</a>, sailing at a speed of 17.8 knots and expected to arrive there on <strong>Oct 23, 17:00</strong>.
The vessel EVER GIVEN (IMO 9811000, MMSI 636026627) is a Container Ship built in 2018 and currently sailing under the flag of <strong>Liberia</strong>.</p></body></html>`;

const found = (extra = {}) => Object.assign({
  status: 'found', imo: '9811000', source: 'VesselFinder', source_url: vesselFinder.sourceUrl('9811000'), via: 'public page', checked_at: new Date().toISOString(),
  name: 'EVER GIVEN', type: 'Container Ship', flag: 'Liberia', mmsi: '636026627', lat: -35, lng: 19, course: 106.3, speed: 17.8,
  reported: '41 hours ago', precision: 'approximate', destination: 'Singapore, Singapore', eta: 'Oct 23, 17:00', destination_ll: [103.8, 1.27]
}, extra);

test('IMO numbers are checked by their check digit', () => {
  assert.equal(vesselFinder.isValidImo('9811000'), true);
  assert.equal(vesselFinder.isValidImo('IMO 9811000'), true);
  assert.equal(vesselFinder.isValidImo('9823411'), false);
  assert.equal(vesselFinder.isValidImo('981100'), false);
  assert.equal(vesselFinder.isValidImo(''), false);
});

test('the public vessel page is read into identity, position and destination', () => {
  const v = vesselFinder.parsePage(PAGE, '9811000');
  assert.equal(v.name, 'EVER GIVEN');
  assert.equal(v.type, 'Container Ship');
  assert.equal(v.flag, 'Liberia');
  assert.equal(v.mmsi, '636026627');
  assert.equal(v.destination, 'Singapore, Singapore');
  assert.equal(v.eta, 'Oct 23, 17:00');
  assert.deepEqual([v.lng, v.lat], [19, -35]);
  // A page for another vessel, or not a vessel page at all, is not accepted
  assert.equal(vesselFinder.parsePage(PAGE, '9876543'), null);
  assert.equal(vesselFinder.parsePage('<html><title>Just a moment</title></html>', '9811000'), null);
  // 91 / 181 means "no position"
  const none = vesselFinder.parsePage(PAGE.replace('"ship_lat":-35,"ship_lon":19', '"ship_lat":91,"ship_lon":181'), '9811000');
  assert.equal(none.lat, null);
  assert.equal(none.lng, null);
});

test('declared details are compared with the registry', () => {
  const v = found();
  assert.deepEqual(vesselFinder.compare({ name: 'MV Ever Given', flag: 'Liberia', type: 'Container vessel' }, v), []);
  const diff = vesselFinder.compare({ name: 'MV Celadon Star', flag: 'Panama', type: 'Bulk carrier' }, v);
  assert.deepEqual(diff.map(d => d.field), ['Name', 'Flag', 'Type']);
  assert.deepEqual(diff[0], { field: 'Name', declared: 'MV Celadon Star', registry: 'EVER GIVEN' });
});

test('Vessel screening by IMO', async (t) => {
  await startServer(TEST_PORT);
  const submit = body => fetch(`${BASE_URL}/api/kyc/submit`, { method: 'POST', headers: EMPLOYEE, body: JSON.stringify(Object.assign({ entity_type: 'Vessel', country: 'LBR', relationship_type: 'Customer/Trading Partner', contract_value: 50000 }, body)) });
  const onGlobe = async id => (await (await fetch(`${BASE_URL}/api/entities`)).json()).entities.find(e => e.id === `kyc-${id.toLowerCase()}`);

  await t.test('a vessel without an IMO number, or with a wrong one, is not accepted', async () => {
    const missing = await submit({ counterparty_name: 'MV No Number' });
    assert.equal(missing.status, 400);
    assert.match((await missing.json()).message, /IMO number is required/);

    const wrong = await submit({ counterparty_name: 'MV Wrong Digit', attributes: { imo: 'IMO 9823411' } });
    assert.equal(wrong.status, 400);
    const body = await wrong.json();
    assert.equal(body.imo_check, 'invalid');
    assert.match(body.message, /not a valid IMO number/);
  });

  await t.test('with the lookup switched off a valid IMO is accepted as not verified, and a forged registry record is dropped', async () => {
    const res = await submit({ counterparty_name: 'MV Offline', ongoing_monitoring: true, location: LOCATION, attributes: { imo: '9811000', ais: { status: 'found', name: 'FORGED', lat: 0, lng: 0, mismatches: [] } } });
    assert.equal(res.status, 201);
    const { request } = await res.json();
    assert.equal(request.attributes.ais.status, 'unavailable');
    assert.equal(request.attributes.ais.name, undefined);
    const pin = await onGlobe(request.id);
    assert.deepEqual(pin.ll, [103.635, 1.258], 'falls back to the intake location');
    assert.equal(pin.route, undefined);
    assert.ok(pin.factors.some(f => /IMO not verified/.test(f[1])));
  });

  await t.test('a verified vessel is drawn from its last position to its destination', () => {
    const saved = kycService.createKycRequest(
      { counterparty_name: 'Ever Given', entity_type: 'Vessel', country: 'LBR', relationship_type: 'Customer/Trading Partner', contract_value: 50000, ongoing_monitoring: true, attributes: { imo: '9811000', vessel_type: 'Container ship' } },
      {}, { vessel: found() });
    assert.equal(saved.attributes.ais.destination, 'Singapore, Singapore');
    assert.deepEqual(saved.attributes.ais.mismatches, []);
    const pin = getDb().getEntityById(`kyc-${saved.id.toLowerCase()}`);
    assert.equal(pin.kind, 'vessel');
    assert.deepEqual(pin.ll, [19, -35]);
    assert.deepEqual(pin.route, [[19, -35], [103.8, 1.27]]);
    assert.equal(pin.dest, 'Singapore, Singapore');
    assert.equal(pin.ais.source, 'VesselFinder');
  });

  await t.test('a vessel with no destination has a position but no route', () => {
    const saved = kycService.createKycRequest(
      { counterparty_name: 'Ever Given', entity_type: 'Vessel', country: 'LBR', relationship_type: 'Customer/Trading Partner', contract_value: 50000, ongoing_monitoring: true, attributes: { imo: '9811000' } },
      {}, { vessel: found({ destination: '', eta: '', destination_ll: null }) });
    const pin = getDb().getEntityById(`kyc-${saved.id.toLowerCase()}`);
    assert.deepEqual(pin.ll, [19, -35]);
    assert.equal(pin.route, undefined);
  });

  await t.test('a registry mismatch is a finding: higher risk, never auto-cleared', () => {
    const base = { entity_type: 'Vessel', country: 'SGP', relationship_type: 'Vendor/Supplier', contract_value: 20000, attributes: { imo: '9811000', vessel_type: 'Container ship' } };
    const clean = kycService.createKycRequest(Object.assign({ counterparty_name: 'Ever Given' }, base), {}, { vessel: found({ flag: 'Singapore' }) });
    assert.equal(clean.request_status, 'Approved');

    const odd = kycService.createKycRequest(Object.assign({ counterparty_name: 'MV Celadon Star' }, base), {}, { vessel: found({ flag: 'Singapore' }) });
    assert.deepEqual(odd.attributes.ais.mismatches.map(m => m.field), ['Name']);
    assert.equal(odd.request_status, 'Pending DDQ');
    assert.ok(odd.ai_score >= 65);
    assert.match(odd.ai_rationale, /VesselFinder registry mismatch for IMO 9811000: name declared "MV Celadon Star", registry "EVER GIVEN"/);
    assert.match(odd.ddq_clause, /Vessel registry mismatch/);
  });

  await t.test('VesselFinder is a built-in public website source that cannot be removed or re-parsed', async () => {
    const list = async () => (await (await fetch(`${BASE_URL}/api/sources`)).json()).sources;
    const src = (await list()).find(s => s.id === 'vesselfinder');
    assert.ok(src, 'VesselFinder should be listed');
    assert.equal(src.type, 'Web');
    assert.equal(src.config.locked, true);
    assert.equal(src.config.default_for, 'IMO');
    assert.equal(src.config.url, 'https://www.vesselfinder.com');
    assert.equal((await fetch(`${BASE_URL}/api/sources/vesselfinder`, { method: 'DELETE' })).status, 403);
    assert.equal((await fetch(`${BASE_URL}/api/sources/vesselfinder/convert`, { method: 'POST' })).status, 403);
    assert.ok((await list()).some(s => s.id === 'vesselfinder'));
  });

  await stopServer();
});
