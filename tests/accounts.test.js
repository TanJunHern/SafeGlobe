const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { startServer, stopServer } = require('../src/server');
const { getDb, runInWorkspace } = require('../src/db');
const { setGoogleVerifier } = require('../src/middleware/auth');
const { getAccountsStore } = require('../src/accounts/accountsStore');
const accounts = require('../src/accounts/accountsService');

const TEST_PORT = 8100;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const JSON_HEADERS = { 'Content-Type': 'application/json' };

// A stand-in for Google: the "ID token" google:<email>:<name> is accepted as that person. Anything else is rejected.
setGoogleVerifier(async token => {
  const m = /^google:([^:]+):(.*)$/.exec(token);
  return m ? { email: m[1].toLowerCase(), name: m[2], sub: `sub-${m[1]}` } : null;
});
const google = (email, name = '') => `google:${email}:${name}`;

async function call(method, url, { token, headers = {}, body } = {}) {
  const res = await fetch(`${BASE_URL}${url}`, {
    method,
    headers: Object.assign({}, JSON_HEADERS, token ? { Authorization: `Bearer ${token}` } : {}, headers),
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json().catch(() => ({})), headers: res.headers };
}
const withConfig = async (patch, fn) => {
  const before = Object.fromEntries(Object.keys(patch).map(k => [k, config[k]]));
  Object.assign(config, patch);
  try { return await fn(); } finally { Object.assign(config, before); }
};
const signUp = (email, name, organisation) => call('POST', '/api/auth/signup', { body: { credential: google(email, name), name, organisation } });
const signIn = (email, name) => call('POST', '/api/auth/google', { body: { credential: google(email, name) } });
const demo = account => call('POST', '/api/auth/demo', { body: { account } });
const count = (workspaceId, table) => runInWorkspace(workspaceId, () => getDb().db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);

test('Accounts, roles and workspaces', async (t) => {
  await startServer(TEST_PORT);
  let ada, adaWs, ben;

  await t.test('demo sign-in: one click, no Google, role from the account, only in DEMO_MODE', async () => {
    const officer = await demo('compliance');
    assert.equal(officer.status, 200);
    assert.equal(officer.body.user.role, 'compliance_officer');
    assert.equal(officer.body.user.workspace.isDemo, true);
    assert.equal(officer.body.user.demoAccount, true);
    const session = await call('GET', '/api/auth/session', { token: officer.body.token });
    assert.equal(session.body.user.email, 'compliance@duedilly.com');

    // The caller cannot pick a role: the employee demo account stays an employee whatever is asked for
    const employee = await call('POST', '/api/auth/demo', { body: { account: 'employee', role: 'compliance_officer' } });
    assert.equal(employee.body.user.role, 'employee');
    const viaHeader = await call('GET', '/api/auth/session', { headers: { 'x-user-email': 'john.doe@duedilly.com', 'x-user-role': 'compliance_officer' } });
    assert.equal(viaHeader.body.user.role, 'employee');
    assert.equal((await call('GET', '/api/settings/accounts', { headers: { 'x-user-email': 'john.doe@duedilly.com', 'x-user-role': 'compliance_officer' } })).status, 403);

    assert.equal((await demo('nobody')).status, 404);
    await withConfig({ demoMode: false }, async () => {
      assert.equal((await demo('compliance')).status, 403);
      // A demo session stops working when demo mode is off
      assert.equal((await call('GET', '/api/auth/session', { token: officer.body.token })).status, 401);
    });
  });

  await t.test('a Google user with no account and no invitation is refused, and no account is created', async () => {
    const res = await signIn('stranger@example.com', 'Sam Stranger');
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'no_access');
    assert.equal(res.body.message, "You don't have access yet. Ask your compliance officer to invite you, or create your own workspace.");
    assert.equal(res.body.token, undefined);
    assert.equal(getAccountsStore().getAccountByEmail('stranger@example.com'), null);
    // A token Google does not vouch for is refused too
    assert.equal((await call('POST', '/api/auth/google', { body: { credential: 'not-a-google-token' } })).status, 401);
  });

  await t.test('"Create an account" makes a new workspace whose first compliance officer is that person', async () => {
    assert.equal((await signUp('ada@example.com', 'Ada Tan', '')).status, 400);
    const res = await signUp('ada@example.com', 'Ada Tan', 'Northwind Shipping');
    assert.equal(res.status, 201);
    ada = res.body.token;
    adaWs = res.body.user.workspace.id;
    assert.equal(res.body.user.role, 'compliance_officer');
    assert.equal(res.body.user.workspace.name, 'Northwind Shipping');
    assert.equal(res.body.user.workspace.isDemo, false);
    assert.notEqual(adaWs, 'demo');
    // One email, one workspace
    const again = await signUp('ada@example.com', 'Ada Tan', 'Second Company');
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'already_registered');
    // A demo email can never create or join a workspace
    assert.equal((await signUp('compliance@duedilly.com', 'Grace Teo', 'Sneaky')).status, 409);
  });

  await t.test('a new workspace starts with no data, and still has the reference data', async () => {
    for (const table of ['entities', 'ownership_edges', 'statements', 'claims', 'cases', 'alerts', 'ddq_records', 'uploaded_files', 'source_records', 'kyc_requests', 'findings', 'risk_checks']) {
      assert.equal(count(adaWs, table), 0, `${table} should be empty in a new workspace`);
    }
    // Sources: only the built-in vessel lookup, none of the demo's custom sources
    const sources = (await call('GET', '/api/sources', { token: ada })).body.sources;
    assert.deepEqual(sources.map(s => s.id), ['vesselfinder']);
    assert.deepEqual((await call('GET', '/api/entities', { token: ada })).body.entities, []);
    assert.deepEqual((await call('GET', '/api/kyc?scope=all', { token: ada })).body.requests, []);
    // No settings carried over: only the marker that this workspace has no demo data
    assert.deepEqual(runInWorkspace(adaWs, () => getDb().db.prepare('SELECT key FROM app_settings').all().map(r => r.key)), ['placeholder_data']);

    // Reference data: CPI scores, policy rules (without the demo counterparties), default scoring rules, default questionnaire
    assert.ok(count(adaWs, 'cpi') > 0);
    assert.equal(count(adaWs, 'cpi'), count('demo', 'cpi'));
    const policies = (await call('GET', '/api/policies', { token: ada })).body.policies;
    assert.equal(policies.length, 4);
    assert.ok(policies.every(p => p.hits.length === 0));
    const rules = (await call('GET', '/api/risk/rules', { token: ada })).body;
    assert.ok(JSON.stringify(rules).includes('vessel_ais_dark') || Object.keys(rules).length > 0);
    assert.ok(runInWorkspace(adaWs, () => require('../src/services/ddqTemplateService').getActiveTemplate()));

    // The Demo workspace is untouched and still has its demo data
    const officer = (await demo('compliance')).body.token;
    assert.ok((await call('GET', '/api/entities', { token: officer })).body.entities.length > 0);
  });

  await t.test('invite and accept: the invitation is accepted by signing in with Google using the same email', async () => {
    assert.equal((await call('POST', '/api/settings/invites', { token: ada, body: { email: 'not-an-email' } })).status, 400);
    const invited = await call('POST', '/api/settings/invites', { token: ada, body: { email: 'Ben@Example.com', role: 'compliance_officer' } });
    assert.equal(invited.status, 201);
    assert.equal(invited.body.account.role, 'employee');            // always invited as Employee
    assert.equal(invited.body.account.status, 'invited');
    assert.equal(invited.body.delivery.sent, false);                // the Gmail path is not live: copy-link fallback
    assert.ok(invited.body.delivery.link.includes('/login?invite=ben%40example.com'));
    assert.equal((await call('POST', '/api/settings/invites', { token: ada, body: { email: 'ben@example.com' } })).status, 409);

    let list = (await call('GET', '/api/settings/accounts', { token: ada })).body;
    const row = list.accounts.find(a => a.email === 'ben@example.com');
    assert.equal(row.statusLabel, 'Invited');
    assert.ok(row.inviteLink);
    assert.equal((await call('POST', `/api/settings/invites/${row.id}/resend`, { token: ada })).status, 200);
    // Someone invited to one workspace cannot create another
    assert.equal((await signUp('ben@example.com', 'Ben Koh', 'Other Co')).status, 409);

    const accepted = await signIn('ben@example.com', 'Ben Koh');
    assert.equal(accepted.status, 200);
    ben = accepted.body.token;
    assert.equal(accepted.body.user.role, 'employee');
    assert.equal(accepted.body.user.workspace.id, adaWs);

    list = (await call('GET', '/api/settings/accounts', { token: ada })).body;
    const active = list.accounts.find(a => a.email === 'ben@example.com');
    assert.equal(active.statusLabel, 'Active');
    assert.equal(active.name, 'Ben Koh');
    assert.ok(active.lastSignInAt);
    assert.deepEqual(list.log.map(l => l.action).reverse(), ['Workspace created', 'Invited', 'Invitation resent', 'Invitation accepted']);
    assert.ok(list.log.every(l => l.at && l.actorEmail));

    // An invitation can be cancelled before it is accepted
    const tmp = (await call('POST', '/api/settings/invites', { token: ada, body: { email: 'cara@example.com' } })).body.account;
    assert.equal((await call('DELETE', `/api/settings/invites/${tmp.id}`, { token: ada })).status, 200);
    assert.equal((await signIn('cara@example.com', 'Cara')).status, 403);
  });

  await t.test('employees are blocked from Settings and officer-only actions on the server', async () => {
    const blocked = [
      ['GET', '/api/settings/accounts'], ['POST', '/api/settings/invites'], ['PUT', '/api/settings/accounts/x/role'], ['DELETE', '/api/settings/accounts/x'],
      ['POST', '/api/cases/RV-1/decision'], ['POST', '/api/kyc/KYC-1/triage'], ['POST', '/api/kyc/KYC-1/agent/run'],
      ['GET', '/api/entities'], ['POST', '/api/intake'], ['GET', '/api/cases'], ['GET', '/api/alerts'], ['POST', '/api/alerts'],
      ['GET', '/api/sources'], ['POST', '/api/sources'], ['DELETE', '/api/sources/s1'], ['POST', '/api/policies/compile'],
      ['POST', '/api/statements'], ['POST', '/api/claim'], ['POST', '/api/ddq/send'], ['POST', '/api/ddq/answer'],
      ['GET', '/api/uploads'], ['GET', '/api/stats'], ['POST', '/api/ai/screen'], ['POST', '/api/pond-guard/aurora/screen'],
      ['PUT', '/api/risk/rules'], ['GET', '/api/risk/scores'], ['GET', '/api/ddq-templates'], ['PUT', '/api/monitoring/defaults']
    ];
    for (const [method, url] of blocked) {
      assert.equal((await call(method, url, { token: ben, body: method === 'GET' ? undefined : {} })).status, 403, `${method} ${url} must refuse an employee`);
      assert.equal((await call(method, url, { headers: { 'x-user-email': 'john.doe@duedilly.com' }, body: method === 'GET' ? undefined : {} })).status, 403, `${method} ${url} must refuse the demo employee`);
    }
    // Day-to-day work is still open to an employee
    assert.equal((await call('GET', '/api/kyc/my-requests', { token: ben })).status, 200);
    assert.equal((await call('POST', '/api/ask', { token: ben, body: { query: 'CPI scores' } })).status, 200);
    // And every one of those routes needs a sign-in at all once demo mode is off
    await withConfig({ demoMode: false }, async () => {
      for (const [method, url] of blocked) assert.equal((await call(method, url, { body: method === 'GET' ? undefined : {} })).status, 401, `${method} ${url} must need a sign-in`);
      assert.equal((await call('GET', '/api/kyc/my-requests')).status, 401);
    });
  });

  await t.test('workspaces cannot see each other, and a DDQ link opens the right workspace', async () => {
    const submitted = await call('POST', '/api/kyc/submit', { token: ben, body: {
      counterparty_name: 'Harbourline Logistics Pte Ltd', entity_type: 'Organisation', country: 'SGP',
      relationship_type: 'Vendor/Supplier', contract_value: 180000, counterparty_email: 'kyc@harbourline.example'
    } });
    assert.equal(submitted.status, 201);
    const request = submitted.body.request;
    assert.equal(request.created_by_email, 'ben@example.com');
    assert.equal(count(adaWs, 'kyc_requests'), 1);

    const other = (await signUp('dee@example.com', 'Dee Ong', 'Southbank Metals')).body;
    assert.deepEqual((await call('GET', '/api/kyc?scope=all', { token: other.token })).body.requests, []);
    assert.equal((await call('GET', `/api/kyc/${request.id}`, { token: other.token })).status, 404);
    const demoOfficer = (await demo('compliance')).body.token;
    assert.ok(!(await call('GET', '/api/kyc?scope=all', { token: demoOfficer })).body.requests.some(r => r.counterparty_email === 'kyc@harbourline.example'));

    // The counterparty has no account: the signed link carries the workspace
    const token = request.ddq_link.split('token=')[1];
    const state = await call('GET', `/api/ddq/verify-token?token=${token}`);
    assert.equal(state.status, 200);
    assert.equal(state.body.valid, true);
    assert.equal(state.body.kyc_id, request.id);

    // A demo header can never reach a created workspace
    assert.equal((await call('GET', '/api/auth/session', { headers: { 'x-user-email': 'ada@example.com' } })).status, 401);
    // An email that belongs to one workspace cannot be invited to another
    assert.equal((await call('POST', '/api/settings/invites', { token: other.token, body: { email: 'ben@example.com' } })).status, 409);
    // An officer cannot change an account of another workspace
    const benId = getAccountsStore().getAccountByEmail('ben@example.com').id;
    assert.equal((await call('PUT', `/api/settings/accounts/${benId}/role`, { token: other.token, body: { role: 'compliance_officer' } })).status, 404);
  });

  await t.test('the last compliance officer cannot be removed or deleted', async () => {
    const adaId = getAccountsStore().getAccountByEmail('ada@example.com').id;
    const benId = getAccountsStore().getAccountByEmail('ben@example.com').id;

    const demote = await call('PUT', `/api/settings/accounts/${adaId}/role`, { token: ada, body: { role: 'employee' } });
    assert.equal(demote.status, 409);
    assert.equal(demote.body.code, 'last_officer');
    assert.match(demote.body.message, /at least one compliance officer/);
    const remove = await call('DELETE', `/api/settings/accounts/${adaId}`, { token: ada });
    assert.equal(remove.status, 409);
    assert.equal(remove.body.code, 'last_officer');
    assert.equal(getAccountsStore().getAccountById(adaId).role, 'compliance_officer');

    // With a second officer the change is allowed, and it takes effect on the very next request
    assert.equal((await call('PUT', `/api/settings/accounts/${benId}/role`, { token: ada, body: { role: 'compliance_officer' } })).status, 200);
    assert.equal((await call('GET', '/api/settings/accounts', { token: ben })).status, 200);
    assert.equal((await call('PUT', `/api/settings/accounts/${adaId}/role`, { token: ben, body: { role: 'employee' } })).status, 200);
    assert.equal((await call('GET', '/api/settings/accounts', { token: ada })).status, 403);
    // Ben is now the only officer
    assert.equal((await call('DELETE', `/api/settings/accounts/${benId}`, { token: ben })).status, 409);
    assert.equal((await call('PUT', `/api/settings/accounts/${benId}/role`, { token: ben, body: { role: 'employee' } })).status, 409);
    assert.equal((await call('PUT', `/api/settings/accounts/${adaId}/role`, { token: ben, body: { role: 'owner' } })).status, 400);
  });

  await t.test('deleting removes access but keeps the person in the records under their name', async () => {
    const adaId = getAccountsStore().getAccountByEmail('ada@example.com').id;
    assert.equal((await call('DELETE', `/api/settings/accounts/${adaId}`, { token: ben })).status, 200);
    assert.equal((await call('GET', '/api/auth/session', { token: ada })).status, 401);
    assert.equal((await signIn('ada@example.com', 'Ada Tan')).status, 403);
    const list = (await call('GET', '/api/settings/accounts', { token: ben })).body;
    assert.ok(!list.accounts.some(a => a.email === 'ada@example.com'));
    const names = list.log.map(l => `${l.actorName}|${l.action}|${l.targetName}`);
    assert.ok(names.includes('Ben Koh|Account deleted|Ada Tan'));
    assert.ok(names.includes('Ada Tan|Workspace created|Ada Tan'));
    assert.ok(names.includes('Ada Tan|Role changed|Ben Koh'));
    // Ben's own KYC request still carries his email as its creator
    assert.equal(runInWorkspace(adaWs, () => getDb().getAllKycRequests({})[0].created_by_email), 'ben@example.com');
  });

  await t.test('Demo workspace Settings: invite and role changes work, delete is blocked', async () => {
    const officer = (await demo('compliance')).body.token;
    const list = (await call('GET', '/api/settings/accounts', { token: officer })).body;
    assert.equal(list.workspace.isDemo, true);
    assert.equal(list.deleteAllowed, false);
    assert.equal(list.deleteNote, 'Not available in the demo');
    assert.deepEqual(list.accounts.map(a => a.email).sort(), ['compliance@duedilly.com', 'john.doe@duedilly.com']);
    assert.ok(list.accounts.every(a => a.isDemo));

    assert.equal((await call('POST', '/api/settings/invites', { token: officer, body: { email: 'guest@example.com' } })).status, 201);
    assert.equal((await call('PUT', '/api/settings/accounts/EMP-1042/role', { token: officer, body: { role: 'compliance_officer' } })).status, 200);
    const del = await call('DELETE', '/api/settings/accounts/EMP-1042', { token: officer });
    assert.equal(del.status, 403);
    assert.equal(del.body.message, 'Not available in the demo');
    assert.equal(del.body.code, 'not_in_demo');
    assert.ok(getAccountsStore().getAccountById('EMP-1042'));

    // Demo changes reset when the app starts again
    getAccountsStore().resetDemoWorkspace();
    assert.equal(getAccountsStore().getAccountById('EMP-1042').role, 'employee');
    assert.equal(getAccountsStore().getAccountByEmail('guest@example.com'), null);
    assert.equal(accounts.listForWorkspace('demo').log.length, 0);
  });

  await stopServer();
});
