const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer } = require('../src/server');
const monitoring = require('../src/services/monitoringService');

// Routes that used to be open now need a signed-in compliance officer (Accounts phase).
// A call that names no persona acts as the demo compliance officer, except on routes that already checked the caller.
const OFFICER_DEFAULT = { 'x-user-email': 'compliance@duedilly.com' };
const fetch = (url, opts = {}) => globalThis.fetch(url, Object.assign({}, opts, {
  headers: Object.assign(/\/api\/(kyc|monitoring|ddq-templates|config|health|auth)|\/v1\/|\/internal\//.test(url) ? {} : OFFICER_DEFAULT, opts.headers || {})
}));

const TEST_PORT = 8096;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const EMPLOYEE = { 'x-user-email': 'john.doe@duedilly.com', 'x-user-role': 'employee' };
const OTHER = { 'x-user-email': 'someone.else@duedilly.com', 'x-user-role': 'employee' };
const COMPLIANCE = { 'x-user-email': 'compliance@duedilly.com', 'x-user-role': 'compliance_officer' };

async function call(method, url, body, headers = {}) {
  const res = await fetch(`${BASE_URL}${url}`, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

test('Ongoing monitoring: schedule maths (no server)', () => {
  const sources = [{ id: 'a', label: 'A', type: 'API', cost_per_screen: 0.5 }, { id: 'b', label: 'B', type: 'Web', cost_per_screen: 2 }, { id: 'c', label: 'C', type: 'PDF', cost_per_screen: 0 }];
  const s = monitoring.normalizeSchedule({ frequency: 'Weekly', start_date: '2026-01-01', end_date: '2026-01-29', source_ids: ['a', 'b', 'a'] }, sources);
  assert.deepEqual(s, { frequency: 'weekly', start_date: '2026-01-01', end_date: '2026-01-29', source_ids: ['a', 'b'] });
  assert.equal(monitoring.runsInWindow(s), 5);                       // 1, 8, 15, 22, 29 Jan
  const cost = monitoring.costEstimate(s, sources);
  assert.equal(cost.per_run, 2.5);
  assert.equal(cost.per_year, 130);                                  // 52 x 2.50
  assert.equal(cost.total, 12.5);                                    // 5 runs
  assert.equal(monitoring.costEstimate(Object.assign({}, s, { end_date: null }), sources).total, null);
  assert.deepEqual(monitoring.costEstimate(Object.assign({}, s, { source_ids: ['c'] }), sources).unpriced_sources, ['C']);

  assert.equal(monitoring.nextRunDate(s), '2026-01-01');
  assert.equal(monitoring.nextRunDate(Object.assign({}, s, { last_run_at: '2026-01-08T09:00:00Z' })), '2026-01-15');
  assert.equal(monitoring.nextRunDate(Object.assign({}, s, { last_run_at: '2026-01-29T09:00:00Z' })), null);   // schedule ended
  assert.equal(monitoring.nextRunDate({ frequency: 'monthly', start_date: '2026-01-31', last_run_at: '2026-01-31' }).slice(0, 7) >= '2026-02', true);

  assert.throws(() => monitoring.normalizeSchedule({ frequency: 'hourly' }, sources), /daily, weekly, monthly or yearly/);
  assert.throws(() => monitoring.normalizeSchedule({ frequency: 'daily', start_date: '2026-02-01', end_date: '2026-01-01' }, sources), /before the start/);
  assert.throws(() => monitoring.normalizeSchedule({ frequency: 'daily', source_ids: ['nope'] }, sources), /Unknown source/);
});

test('Ongoing monitoring, stats and Ask Dilly history (API)', async (t) => {
  await startServer(TEST_PORT);
  let sourceId, monitoredId;
  const place = { address: 'One Raffles Place, Singapore 048616', lat: 1.2844, lng: 103.851, place_id: 'sg_raffles' };

  await t.test('only compliance can set what a source costs per screen', async () => {
    sourceId = (await call('GET', '/api/sources')).body.sources[0].id;
    assert.equal((await call('PUT', `/api/sources/${sourceId}/cost`, { cost_per_screen: 0.75 }, EMPLOYEE)).status, 403);
    assert.equal((await call('PUT', `/api/sources/${sourceId}/cost`, { cost_per_screen: -1 }, COMPLIANCE)).status, 400);
    assert.equal((await call('PUT', `/api/sources/${sourceId}/cost`, { cost_per_screen: 0.75 }, COMPLIANCE)).status, 200);
    assert.equal((await call('GET', '/api/sources')).body.sources.find(s => s.id === sourceId).cost_per_screen, 0.75);
  });

  await t.test('an employee can price a schedule before submitting', async () => {
    const res = await call('POST', '/api/monitoring/estimate', { frequency: 'monthly', source_ids: [sourceId] }, EMPLOYEE);
    assert.equal(res.status, 200);
    assert.equal(res.body.cost.per_run, 0.75);
    assert.equal(res.body.cost.per_year, 9);
  });

  await t.test('the schedule chosen on intake is saved with the request', async () => {
    const res = await call('POST', '/api/kyc/submit', {
      counterparty_name: 'Monitor Me Trading Pte Ltd', entity_type: 'Organisation', country: 'SGP', relationship_type: 'Vendor/Supplier',
      contract_value: 20000, ongoing_monitoring: true, location: place,
      monitoring: { frequency: 'weekly', start_date: '2026-01-05', source_ids: [sourceId] }
    }, EMPLOYEE);
    assert.equal(res.status, 201);
    monitoredId = res.body.request.id;
    assert.equal(res.body.request.monitoring.frequency, 'weekly');
    assert.deepEqual(res.body.request.monitoring.source_ids, [sourceId]);

    const bad = await call('POST', '/api/kyc/submit', {
      counterparty_name: 'Bad Schedule Pte Ltd', entity_type: 'Organisation', country: 'SGP', relationship_type: 'Vendor/Supplier',
      contract_value: 20000, ongoing_monitoring: true, location: place, monitoring: { frequency: 'hourly' }
    }, EMPLOYEE);
    assert.equal(bad.status, 400);
  });

  await t.test('employees see only their own monitored requests, with the cost', async () => {
    const mine = (await call('GET', '/api/monitoring', null, EMPLOYEE)).body;
    const item = mine.items.find(i => i.id === monitoredId);
    assert.equal(item.cost.per_year, 39);                            // 52 x 0.75
    assert.equal(item.schedule.frequency, 'weekly');
    assert.ok(!(await call('GET', '/api/monitoring', null, OTHER)).body.items.some(i => i.id === monitoredId));
    assert.ok((await call('GET', '/api/monitoring', null, COMPLIANCE)).body.items.some(i => i.id === monitoredId));
  });

  await t.test('only compliance can change a schedule, set defaults or run re-screens', async () => {
    assert.equal((await call('PUT', `/api/monitoring/${monitoredId}`, { frequency: 'daily' }, EMPLOYEE)).status, 403);
    assert.equal((await call('PUT', '/api/monitoring/defaults', { frequency: 'yearly' }, EMPLOYEE)).status, 403);
    assert.equal((await call('POST', '/api/monitoring/run', {}, EMPLOYEE)).status, 403);

    const res = await call('PUT', `/api/monitoring/${monitoredId}`, { frequency: 'monthly', end_date: '2030-12-31' }, COMPLIANCE);
    assert.equal(res.status, 200);
    assert.equal(res.body.item.schedule.frequency, 'monthly');
    assert.equal(res.body.item.schedule.end_date, '2030-12-31');
    assert.equal(res.body.item.schedule.updated_by, 'compliance@duedilly.com');
    assert.deepEqual(res.body.item.schedule.source_ids, [sourceId]); // untouched fields are kept
  });

  await t.test('re-screening runs only for approved requests that are due', async () => {
    // A request still waiting on its questionnaire is not approved, so nothing runs for it
    const pending = (await call('POST', '/api/kyc/submit', {
      counterparty_name: 'Not Yet Approved Pte Ltd', entity_type: 'Organisation', country: 'SGP', relationship_type: 'Vendor/Supplier',
      contract_value: 300000, ongoing_monitoring: true, location: place, monitoring: { frequency: 'daily', start_date: '2026-01-05' }
    }, EMPLOYEE)).body.request;
    assert.notEqual(pending.request_status, 'Approved');
    assert.equal((await call('POST', '/api/monitoring/run', { ids: [pending.id], force: true }, COMPLIANCE)).body.ran, 0);

    assert.equal((await call('GET', `/api/kyc/${monitoredId}`, null, COMPLIANCE)).body.request.request_status, 'Approved');
    const run = await call('POST', '/api/monitoring/run', { ids: [monitoredId] }, COMPLIANCE);
    assert.equal(run.body.ran, 1);                                   // start date is in the past, so it is due
    assert.equal(run.body.results[0].cost, 0.75);
    assert.equal(run.body.results[0].changed, false);

    const item = (await call('GET', '/api/monitoring', null, COMPLIANCE)).body.items.find(i => i.id === monitoredId);
    assert.equal(item.schedule.run_count, 1);
    assert.ok(item.schedule.last_run_at);
    assert.equal(item.due, false);                                   // next run is a month away
    const request = (await call('GET', `/api/kyc/${monitoredId}`, null, COMPLIANCE)).body.request;
    assert.match(request.re_screening_result, /^Re-screened \d{4}-\d{2}-\d{2} \(monthly; .*\): Clear, no change$/);
    assert.equal(request.screening_result, 'Clear');                 // a re-screen never rewrites the original result

    assert.equal((await call('POST', '/api/monitoring/run', { ids: [monitoredId] }, COMPLIANCE)).body.ran, 0);
  });

  await t.test('compliance defaults can be applied to every monitored request', async () => {
    const saved = await call('PUT', '/api/monitoring/defaults', { frequency: 'yearly', source_ids: [sourceId] }, COMPLIANCE);
    assert.equal(saved.body.defaults.frequency, 'yearly');
    const applied = await call('POST', '/api/monitoring/apply-all', {}, COMPLIANCE);
    assert.ok(applied.body.updated >= 1);
    const item = (await call('GET', '/api/monitoring', null, COMPLIANCE)).body.items.find(i => i.id === monitoredId);
    assert.equal(item.schedule.frequency, 'yearly');
    assert.equal(item.schedule.run_count, 1);                        // run history survives
  });

  await t.test('switching monitoring off removes the request from the list', async () => {
    assert.equal((await call('PUT', `/api/monitoring/${monitoredId}`, { enabled: false }, COMPLIANCE)).status, 200);
    assert.ok(!(await call('GET', '/api/monitoring', null, COMPLIANCE)).body.items.some(i => i.id === monitoredId));
    await call('PUT', `/api/monitoring/${monitoredId}`, { enabled: true }, COMPLIANCE);
  });

  await t.test('GET /api/stats counts from the requests on record', async () => {
    const all = (await call('GET', '/api/kyc?scope=all', null, COMPLIANCE)).body.requests;
    const k = (await call('GET', '/api/stats')).body.kpis;
    assert.equal(k.screened.total, all.length);
    assert.equal(k.monitored.total, all.filter(r => r.ongoing_monitoring && r.request_status === 'Approved').length);
    assert.equal(k.openReviews.total, all.filter(r => !['Approved', 'Rejected'].includes(r.request_status)).length);
    assert.equal(k.decided.approved, all.filter(r => r.request_status === 'Approved').length);
  });

  await t.test('Ask Dilly answers questions from previous screenings', async () => {
    const all = (await call('GET', '/api/kyc?scope=all', null, COMPLIANCE)).body.requests;
    const count = await call('POST', '/api/ask/history', { query: 'How many screened are there?' }, COMPLIANCE);
    assert.equal(count.body.answered, true);
    assert.ok(count.body.sum.startsWith(`${all.length} counterpart`));

    const named = await call('POST', '/api/ask/history', { query: 'What happened with Monitor Me Trading?' }, COMPLIANCE);
    assert.equal(named.body.answered, true);
    assert.equal(named.body.rows[0].id, monitoredId);
    assert.match(named.body.sum, /Status: Approved/);

    const flagged = await call('POST', '/api/ask/history', { query: 'which ones are high risk?' }, COMPLIANCE);
    assert.equal(flagged.body.rows.length, Math.min(12, all.filter(r => r.screening_result !== 'Clear').length));

    const monitored = await call('POST', '/api/ask/history', { query: 'how many are on ongoing monitoring' }, COMPLIANCE);
    assert.match(monitored.body.sum, /ongoing monitoring switched on/);

    // An employee is only told about their own requests
    const other = await call('POST', '/api/ask/history', { query: 'how many requests have been screened?' }, OTHER);
    assert.ok(other.body.sum.startsWith('0 counterparties'));

    // Something that is not a question about history is left for the screening path
    assert.equal((await call('POST', '/api/ask/history', { query: 'Brand New Counterparty Ltd' }, COMPLIANCE)).body.answered, false);
  });

  await stopServer();
});
