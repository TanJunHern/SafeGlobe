/**
 * Phase 3, offline: the event bus and the push endpoint, the crawler's rules (robots.txt, terms, no sign-in pages,
 * public addresses only, polite reading), snapshots and change detection, suggested extraction fixes,
 * Ripples triage, policy search, and the gate: a changed page creates a ripple and a re-screen.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { getDb, runInWorkspace } = require('../src/db');
const bus = require('../src/events/bus');
const handlers = require('../src/events/handlers');
const crawler = require('../src/services/crawlerService');
const agentsClient = require('../src/services/agentsClient');
const gemini = require('../src/services/geminiClient');
const triage = require('../src/services/triageService');
const policySearch = require('../src/services/policySearch');
const demoFixtures = require('../src/services/demoFixtures');
const { startServer, stopServer } = require('../src/server');

const PORT = 8096;
const BASE = `http://localhost:${PORT}`;
const OFFICER = { 'x-user-email': 'compliance@duedilly.com', 'Content-Type': 'application/json' };
const EMPLOYEE = { 'x-user-email': 'john.doe@duedilly.com', 'Content-Type': 'application/json' };
const api = (path, opts = {}) => fetch(BASE + path, Object.assign({}, opts, { headers: Object.assign({}, OFFICER, opts.headers || {}) }));
const withConfig = async (patch, fn) => {
  const before = Object.fromEntries(Object.keys(patch).map(k => [k, config[k]]));
  Object.assign(config, patch);
  try { return await fn(); } finally { Object.assign(config, before); }
};
const withStub = async (object, patch, fn) => {
  const before = Object.fromEntries(Object.keys(patch).map(k => [k, object[k]]));
  Object.assign(object, patch);
  try { return await fn(); } finally { Object.assign(object, before); }
};

// A pretend website: pages by URL, and a record of every request the crawler made
function site(pages) {
  const requests = [];
  const fetchImpl = async (url, opts = {}) => {
    requests.push({ url, headers: opts.headers || {}, at: Date.now(), credentials: opts.credentials });
    const page = pages[url] !== undefined ? pages[url] : pages[new URL(url).pathname];
    const p = typeof page === 'function' ? page() : page;
    if (p === undefined) return new Response('not found', { status: 404 });
    if (typeof p === 'string') return new Response(p, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    return new Response(p.body || '', { status: p.status || 200, headers: Object.assign({ 'content-type': 'text/html' }, p.headers || {}) });
  };
  return { fetchImpl, requests, lookup: async () => [{ address: '93.184.216.34' }], gapMs: 0 };
}
const webSource = (db, id, url, extra = {}) => {
  db.addSource({ id, label: `Test site ${id}`, type: 'Web', how: 'Read by a crawler agent', cover: 'Organisations', trust: 'Medium', health: 'ok', kv: [], config: Object.assign({ url, termsChecked: true }, extra) });
  return db.getSourceById(id);
};
const NOTICE = name => `<html><body><h1>Enforcement notices</h1><p>${name} was fined for a filing breach in March 2026.</p></body></html>`;

test.before(() => { handlers.register(); });

test('events: an event is handled once, in its own workspace, and an unknown event is refused', async () => {
  const seen = [];
  bus.on('ddq-submitted', (payload, envelope) => { seen.push({ payload, workspace: envelope.workspaceId, db: getDb() }); });
  const first = bus.publish('ddq-submitted', { kycId: 'K1' });
  assert.equal(first.workspaceId, 'demo');
  assert.equal(seen.length, 0); // the caller never waits for the handlers
  await bus.drain();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].payload.kycId, 'K1');

  // A redelivery of the same event does nothing
  assert.equal(await bus.deliver(first), 'duplicate');
  assert.equal(seen.length, 1);

  // Another workspace gets its own database
  bus.publish('ddq-submitted', { kycId: 'K2' }, { workspaceId: 'ws_0a1b2c3d' });
  await bus.drain();
  assert.equal(seen[1].workspace, 'ws_0a1b2c3d');
  assert.notEqual(seen[1].db, seen[0].db);
  assert.equal(runInWorkspace('ws_0a1b2c3d', () => getDb().hasSeenEvent(first.id)), false);

  assert.throws(() => bus.publish('made-up-event', {}), /Unknown event/);
  await assert.rejects(bus.deliver({ id: 'x', event: 'made-up-event', workspaceId: 'demo' }), /Not a DueDilly event/);
});

test('events: with Pub/Sub on, a failed publish is handled inside the app instead of being lost', async () => {
  const seen = [];
  bus.on('screening-completed', payload => { seen.push(payload); });
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => { calls.push(String(url)); throw new Error('network down'); };
  try {
    await withConfig({ pubsubMode: 'pubsub', googleCloudProject: 'test-project', appEnv: 'uat' }, async () => {
      assert.equal(bus.status().mode, 'pubsub');
      assert.equal(bus.topicFor('source-changed'), 'projects/test-project/topics/uat-source-changed');
      bus.publish('screening-completed', { entityId: 'aurora' });
      await bus.drain();
    });
  } finally { globalThis.fetch = realFetch; }
  assert.equal(seen.length, 1);
  assert.equal(bus.status().last.mode, 'inline');
  assert.match(bus.status().last.error, /./);
});

test('crawler: robots.txt is obeyed (own group first, longest rule wins, Allow wins a tie)', () => {
  const robots = `# comment
User-agent: *
Disallow: /private/
Allow: /private/press/
Disallow: /*.pdf$

User-agent: DueDillyBot
Disallow: /notices/secret
`;
  // Our own group is used when there is one, and the "*" group is then ignored
  assert.equal(crawler.robotsAllows(robots, '/notices/secret/1'), false);
  assert.equal(crawler.robotsAllows(robots, '/private/'), true);
  const generic = robots.split('User-agent: DueDillyBot')[0];
  assert.equal(crawler.robotsAllows(generic, '/private/a'), false);
  assert.equal(crawler.robotsAllows(generic, '/private/press/a'), true);
  assert.equal(crawler.robotsAllows(generic, '/files/report.pdf'), false);
  assert.equal(crawler.robotsAllows(generic, '/files/report.pdf?x=1'), true);
  assert.equal(crawler.robotsAllows(generic, '/notices'), true);
  assert.equal(crawler.robotsAllows('', '/anything'), true);
  assert.equal(crawler.robotsAllows('User-agent: *\nDisallow: /', '/'), false);
  assert.equal(crawler.robotsAllows('User-agent: *\nDisallow:', '/'), true);
});

test('crawler: only public web addresses are read', async () => {
  for (const address of ['10.0.0.5', '127.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) assert.equal(crawler.isPublicAddress(address), false, address);
  for (const address of ['93.184.216.34', '8.8.8.8', '2606:4700::1111']) assert.equal(crawler.isPublicAddress(address), true, address);

  const db = getDb();
  const s = site({});
  for (const url of ['http://169.254.169.254/computeMetadata/v1/', 'http://metadata.google.internal/', 'http://localhost:9/x', 'ftp://example.com/a', 'https://user:pw@example.com/a', 'not a url']) {
    const out = await crawler.fetchPage(db, url, s);
    assert.equal(out.status, 'failed', url);
  }
  // A public name that resolves to a private address is refused too
  const inside = await crawler.fetchPage(db, 'https://sneaky.example/a', Object.assign({}, s, { lookup: async () => [{ address: '10.1.2.3' }] }));
  assert.equal(inside.status, 'failed');
  assert.equal(s.requests.length, 0); // nothing was ever requested
});

test('crawler: a blocked page, a sign-in page and a server error are not read', async () => {
  const db = getDb();
  const blocked = site({ '/robots.txt': 'User-agent: *\nDisallow: /notices', '/notices': NOTICE('Acme Trading Ltd') });
  const b = await crawler.fetchPage(db, 'https://a.example/notices', blocked);
  assert.equal(b.status, 'blocked');
  assert.deepEqual(blocked.requests.map(r => new URL(r.url).pathname), ['/robots.txt']); // the page itself was never requested

  // robots.txt that cannot be read because of a server error means "do not read"; a missing one allows reading
  assert.equal((await crawler.fetchPage(db, 'https://b.example/notices', site({ '/robots.txt': { status: 503 }, '/notices': 'x' }))).status, 'blocked');
  const open = site({ '/notices': NOTICE('Acme Trading Ltd') });
  const ok = await crawler.fetchPage(db, 'https://c.example/notices', open);
  assert.equal(ok.status, 'read');
  // It says who it is, and sends no cookie or credentials
  for (const r of open.requests) {
    assert.match(r.headers['User-Agent'], /^DueDillyBot\/1\.0 \(\+http.*\/about-bot\)$/);
    assert.equal(r.headers.Cookie, undefined);
    assert.equal(r.headers.Authorization, undefined);
  }
  assert.equal(open.requests.at(-1).credentials, 'omit');

  for (const status of [401, 403]) assert.equal((await crawler.fetchPage(db, 'https://d.example/p', site({ '/p': { status } }))).status, 'needs_sign_in');
  const redirect = await crawler.fetchPage(db, 'https://e.example/p', site({ '/p': { status: 302, headers: { location: '/login?next=/p' } }, '/login': 'form' }));
  assert.equal(redirect.status, 'needs_sign_in');
  const form = await crawler.fetchPage(db, 'https://f.example/p', site({ '/p': '<form><input name="u"><input type="password" name="p"></form>' }));
  assert.equal(form.status, 'needs_sign_in');
  // An ordinary redirect is followed, and each hop is checked again
  const moved = await crawler.fetchPage(db, 'https://g.example/old', site({ '/old': { status: 301, headers: { location: 'https://g.example/new' } }, '/new': NOTICE('Acme Trading Ltd') }));
  assert.equal(moved.status, 'read');
  assert.equal(moved.finalUrl, 'https://g.example/new');
  assert.equal((await crawler.fetchPage(db, 'https://h.example/p', site({ '/p': { status: 500 } }))).status, 'failed');
  assert.equal((await crawler.fetchPage(db, 'https://i.example/p', site({ '/p': { body: '%PDF', headers: { 'content-type': 'application/pdf' } } }))).status, 'failed');
});

test('crawler: requests to one site are spaced out', async () => {
  const s = site({ '/a': NOTICE('Acme Trading Ltd') });
  await crawler.fetchPage(getDb(), 'https://slow.example/a', Object.assign({}, s, { gapMs: 120 }));
  const [robots, page] = s.requests;
  assert.ok(page.at - robots.at >= 110, `gap was ${page.at - robots.at} ms`);
});

test('crawler: terms tick, baseline, no change, change, and the event that follows', async () => {
  const db = getDb();
  const changed = [];
  bus.on('source-changed', payload => { if (payload.sourceId === 's_t1') changed.push(payload); });

  // Without the terms tick the site is never contacted
  let source = webSource(db, 's_t1', 'https://notices.example/list', { termsChecked: false });
  let page = NOTICE('Acme Trading Ltd');
  const s = site({ '/list': () => page });
  let out = await crawler.crawlSource(db, source, s);
  assert.equal(out.result, 'terms_not_confirmed');
  assert.equal(s.requests.length, 0);

  db.updateSourceConfig('s_t1', { termsChecked: true });
  out = await crawler.crawlSource(db, db.getSourceById('s_t1'), s);
  assert.equal(out.result, 'read'); // the first read is the baseline: no event
  assert.equal(out.extractor, 'offline');
  assert.match(out.offlineReason, /not connected/);
  assert.equal(out.snapshotWhere, 'local');
  assert.ok(out.recordsCount >= 1);
  const stored = db.getSourceRecordsBySource('s_t1');
  assert.ok(stored.some(r => /Acme Trading Ltd/.test(r.entity_name)));
  assert.match(stored[0].details_json, /Offline sample/);
  const snapshot = await crawler.readSnapshot(db.getSourceById('s_t1'));
  assert.match(snapshot.html, /Acme Trading Ltd/);

  out = await crawler.crawlSource(db, db.getSourceById('s_t1'), s);
  assert.equal(out.result, 'unchanged');
  await bus.drain();
  assert.equal(changed.length, 0);

  page = NOTICE('Acme Trading Ltd') + '<p>Borealis Shipping Ltd was fined for a filing breach in April 2026.</p>';
  out = await crawler.crawlSource(db, db.getSourceById('s_t1'), s);
  assert.equal(out.result, 'changed');
  assert.ok(out.added.some(r => /Borealis Shipping Ltd/.test(r.name)));
  await bus.drain();
  assert.equal(changed.length, 1);
  assert.ok(changed[0].added.some(r => /Borealis Shipping Ltd/.test(r.name)));
  assert.equal(db.getSourceById('s_t1').health, 'ok');

  // A page that can no longer be read is reported, and the last good records stay
  const gone = await crawler.crawlSource(db, db.getSourceById('s_t1'), site({ '/list': { status: 403 } }));
  assert.equal(gone.result, 'needs_sign_in');
  assert.equal(db.getSourceById('s_t1').health, 'error');
  assert.ok(db.getSourceRecordsBySource('s_t1').length >= 2);
  db.deleteSource('s_t1'); db.deleteSourceRecordsBySourceId('s_t1');
});

test('crawler agent: every record must quote the page, or it is dropped', () => {
  const source = { id: 's_v', label: 'V', config: { url: 'https://v.example/' } };
  const text = 'Notice: the tanker Aurora Venture (IMO 9304124) was observed east of Johor. Acme Trading Ltd was fined.';
  const out = crawler.vetAgentRecords(source, text, { model_id: 'm', records: [
    { name: 'Aurora Venture', kind: 'vessel', country: 'cmr', identifier: '9304124', summary: 'Observed east of Johor.', quote: 'the tanker Aurora Venture (IMO 9304124) was observed east of Johor' },
    { name: 'Acme Trading Ltd', kind: 'organisation', summary: 'Fined.', quote: 'Acme Trading Ltd was convicted of fraud' },
    { name: 'Ghost Holdings Ltd', kind: 'organisation', summary: 'Named.', quote: 'Acme Trading Ltd was fined' },
    { name: 'Acme Trading Ltd', kind: 'weapon', summary: 'x', quote: 'Acme Trading Ltd was fined' },
    { name: '', kind: 'person', summary: 'x', quote: 'x' }
  ] }, { readAt: '2026-10-12T00:00:00Z', snapshotKey: 'k' });
  assert.equal(out.records.length, 1);
  const [r] = out.records;
  assert.equal(r.entity_name, 'Aurora Venture');
  assert.equal(r.entity_kind, 'vessel');
  assert.equal(r.jurisdiction, 'CMR');
  assert.equal(r.risk_level, 'Unrated'); // the agent never rates risk
  assert.equal(r.risk_score, 0);
  assert.match(r.details_json, /Crawler agent/);
  assert.deepEqual(out.rejected.map(x => x.reason), ['The quote is not on the page.', 'The name is not on the page.', '"weapon" is not an organisation, a person or a vessel.', 'The record has no name.']);
});

test('self-healing: a broken extraction leads to a tested suggestion that only a person can apply', async () => {
  const db = getDb();
  let page = NOTICE('Acme Trading Ltd');
  const s = site({ '/reg': () => page });
  const good = text => ({ model_id: 'test-model', records: /Acme Trading Ltd/.test(text) ? [{ name: 'Acme Trading Ltd', kind: 'organisation', summary: 'Fined for a filing breach.', quote: 'Acme Trading Ltd was fined for a filing breach' }] : [] });
  const calls = { extract: [], propose: [] };
  const stubs = {
    configured: () => true,
    // The site's new layout lists names in a table, which the agent only reads once it is told to
    crawlerExtract: async p => { calls.extract.push(p); return /table/i.test(p.instructions) || !/<table|Register of/.test(p.text) ? good(p.text) : { model_id: 'test-model', records: [] }; },
    crawlerProposeFix: async p => { calls.propose.push(p); return { model_id: 'test-model', instructions: 'Names are in the table rows under "Register of penalties".', reason: 'The page moved from paragraphs to a table.' }; }
  };
  await withStub(agentsClient, stubs, async () => {
    webSource(db, 's_heal', 'https://reg.example/reg');
    let out = await crawler.crawlSource(db, db.getSourceById('s_heal'), s);
    assert.equal(out.result, 'read');
    assert.equal(out.extractor, 'agent');
    assert.equal(db.getSourceRecordsBySource('s_heal').length, 1);
    assert.equal(db.getSourceRecordsBySource('s_heal')[0].risk_level, 'Unrated');

    page = '<html><body><h1>Register of penalties</h1><p>Acme Trading Ltd was fined for a filing breach in May 2026.</p></body></html>';
    out = await crawler.crawlSource(db, db.getSourceById('s_heal'), s);
    assert.equal(out.result, 'extraction_failed');
    assert.match(out.reason, /no records were found; the last read found 1/);
    assert.equal(out.proposal.status, 'pending');
    assert.equal(out.proposal.test.recordsAfter, 1); // tested on the snapshot before anyone is asked
    assert.equal(out.proposal.test.examples[0].name, 'Acme Trading Ltd');
    assert.match(calls.propose[0].problem, /no records were found/);
    // Nothing was applied: the old instructions and the last good records are still in place
    assert.equal(db.getSourceById('s_heal').config.instructions || '', '');
    assert.equal(db.getSourceRecordsBySource('s_heal').length, 1);

    // A second failure does not pile up suggestions
    await crawler.crawlSource(db, db.getSourceById('s_heal'), Object.assign({}, s, { force: true }));
    assert.equal(db.getSourceProposals({ sourceId: 's_heal', status: 'pending' }).length, 1);

    const approved = await crawler.decideProposal(db, out.proposal.id, true, 'compliance@duedilly.com');
    assert.equal(approved.proposal.status, 'approved');
    assert.equal(approved.proposal.decidedBy, 'compliance@duedilly.com');
    assert.equal(approved.recordsCount, 1);
    assert.match(db.getSourceById('s_heal').config.instructions, /table rows/);
    assert.equal(db.getSourceById('s_heal').config.crawl.result, 'read');
    await assert.rejects(crawler.decideProposal(db, out.proposal.id, true, 'x'), /already been decided/);
  });

  // Dismissed: nothing changes
  const p = db.addSourceProposal({ id: 'prop_dismiss', source_id: 's_heal', problem: 'p', old_instructions: 'old', new_instructions: 'new', test: {} });
  const before = db.getSourceById('s_heal').config.instructions;
  const dismissed = await crawler.decideProposal(db, p.id, false, 'compliance@duedilly.com');
  assert.equal(dismissed.proposal.status, 'dismissed');
  assert.equal(db.getSourceById('s_heal').config.instructions, before);
  // Offline there is no agent to ask, so there is no suggestion
  db.deleteSource('s_heal'); db.deleteSourceRecordsBySourceId('s_heal');
});

test('Ripples triage: fixed rules offline, duplicates merged, own alerts never ask for a re-screen', async () => {
  const db = getDb();
  assert.equal(triage.offlineTriage({ text: 'Aurora Venture: AIS dark for 31 hours' }, []).severity, 'High');
  assert.equal(triage.offlineTriage({ text: 'Halcyon: questionnaire submitted' }, []).severity, 'Low');
  assert.equal(triage.offlineTriage({ text: 'Kestrel: registered address updated' }, []).severity, 'Medium');

  const requested = [];
  bus.on('screening-requested', payload => { requested.push(payload); });
  db.setSetting('rescreen_requested_kestrel', 0);
  const first = db.addAlert('Ripples', 'kestrel', 'Kestrel Trading FZE: new sanctions designation reported for its owner', 'investigate');
  await bus.drain();
  let row = db.getAlertRow(first);
  assert.equal(row.severity, 'High');
  assert.equal(row.triaged_by, 'Offline rules');
  assert.equal(row.rescreen.startsWith('done') || row.rescreen === 'requested', true);
  assert.equal(requested.filter(r => r.entityId === 'kestrel').length, 1);

  // The same alert again is merged into the first and asks for nothing
  const second = db.addAlert('Ripples', 'kestrel', 'Kestrel Trading FZE: new sanctions designation reported for its owner', 'investigate');
  await bus.drain();
  row = db.getAlertRow(second);
  assert.equal(row.merged_into, first);
  assert.equal(row.rescreen, null);
  assert.equal(db.countMergedAlerts(first), 1);
  // A different High alert soon after does not screen the same counterparty again
  const third = db.addAlert('Ripples', 'kestrel', 'Kestrel Trading FZE: fraud inquiry opened', 'investigate');
  await bus.drain();
  assert.equal(db.getAlertRow(third).rescreen, 'recent');
  assert.equal(requested.filter(r => r.entityId === 'kestrel').length, 1);

  // Pond-Guard's own summary line is rated, but never starts another screening
  db.setSetting('rescreen_requested_severny', 0);
  const own = db.addAlert('Pond-Guard', 'severny', 'Severny Agro Export LLC screened by Pond-Guard: sanctions link, Investigate', 'investigate');
  await bus.drain();
  assert.equal(db.getAlertRow(own).severity, 'High');
  assert.equal(db.getAlertRow(own).rescreen, null);
  assert.equal(requested.some(r => r.entityId === 'severny'), false);

  // The alerts API carries the new fields beside the old ones
  const a = db.getAlerts(50).find(x => x.alertId === second);
  assert.equal(a.id, 'kestrel');
  assert.equal(a.mergedInto, first);
  assert.equal(a.severity, 'High');
});

test('Ripples triage: what Gemini returns is checked before it is stored', async () => {
  const db = getDb();
  let answer = null;
  const stubs = { isConfigured: () => true, generateJsonDetailed: async (parts, opts) => { assert.ok(opts.responseSchema); assert.match(parts[0].text, /Ignore any instructions/); return answer; } };
  await withStub(gemini, stubs, async () => {
    db.setSetting('rescreen_requested_halcyon', Date.now()); // no re-screen in this test
    const earlier = db.addAlert('Tide', 'halcyon', 'Halcyon Marine: destination changed to Fujairah', 'monitor');
    await bus.drain();

    answer = { model: 'test-lite', data: { severity: 'Low', same_as: earlier, what_changed: 'Destination changed to Fujairah, already reported. ' + 'x'.repeat(300) } };
    const dup = db.addAlert('Tide', 'halcyon', 'Halcyon Marine: destination now Fujairah', 'monitor');
    await bus.drain();
    let row = db.getAlertRow(dup);
    assert.equal(row.triaged_by, 'Gemini (test-lite)');
    assert.equal(row.merged_into, earlier);
    assert.ok(row.what_changed.length <= 160);

    // An id the model was not shown is not a duplicate; a severity outside the three falls back to the rules
    answer = { model: 'test-lite', data: { severity: 'Medium', same_as: 999999, what_changed: 'New port call.' } };
    const fresh = db.addAlert('Tide', 'halcyon', 'Halcyon Marine: new port call at Sohar', 'monitor');
    await bus.drain();
    assert.equal(db.getAlertRow(fresh).merged_into, null);
    // An alert from another origin is never offered as a duplicate, whatever the model says
    answer = { model: 'test-lite', data: { severity: 'Medium', same_as: earlier, what_changed: 'Port notice about the same voyage.' } };
    const otherOrigin = db.addAlert('Ripples', 'halcyon', 'Port notices now name Halcyon Marine: destination Fujairah', 'monitor');
    await bus.drain();
    assert.equal(db.getAlertRow(otherOrigin).merged_into, null);
    answer = { model: 'test-lite', data: { severity: 'Critical 97/100', what_changed: 'x' } };
    const bad = db.addAlert('Tide', 'halcyon', 'Halcyon Marine: registered address updated', 'monitor');
    await bus.drain();
    assert.equal(db.getAlertRow(bad).triaged_by, 'Offline rules');
    assert.equal(db.getAlertRow(bad).severity, 'Medium');
  });
});

test('policy search: the built-in text answers offline, and Agent Search answers when it is connected', async () => {
  const db = getDb();
  policySearch._clearCache();
  assert.deepEqual(policySearch.localClauses().map(c => c.id), ['§1.1', '§1.2', '§1.3', '§2.1', '§2.2', '§3.6', '§4.1', '§5.2', '§5.4']);
  const offline = await policySearch.clauseFor(db, '§5.4');
  assert.equal(offline.via, 'Offline fallback');
  assert.match(offline.text, /AIS telemetry dark periods/);
  assert.equal(offline.file, 'policy-clause-5-4.txt');
  assert.equal(await policySearch.clauseFor(db, 'Sanctions lists'), null);
  const found = await policySearch.search(db, 'politically exposed person director');
  assert.equal(found.via, 'Offline fallback');
  assert.equal(found.results[0].clauseId, '§3.6');

  const realFetch = globalThis.fetch;
  const calls = [];
  let fail = false;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), body: JSON.parse(opts.body), headers: opts.headers });
    if (fail) return new Response('quota', { status: 429 });
    return new Response(JSON.stringify({ results: [{ id: 'd1', document: { derivedStructData: { link: 'gs://duedilly-uat-x/policies/policy-clause-5-4.txt', snippets: [{ snippet: 'AIS telemetry <b>dark</b> periods exceeding 12 hours', snippet_status: 'SUCCESS' }] } } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const fakeAuth = { getClient: async () => ({ getAccessToken: async () => ({ token: 't' }) }) };
  const gal = require('google-auth-library');
  const realDescriptor = Object.getOwnPropertyDescriptor(gal, 'GoogleAuth');
  Object.defineProperty(gal, 'GoogleAuth', { value: function () { return fakeAuth; }, configurable: true, writable: true });
  try {
    await withConfig({ agentSearch: { dataStore: 'duedilly-policies', location: 'global', dailyCap: 2 }, googleCloudProject: 'test-project' }, async () => {
      db.setSetting('daily_budget_agent_search', null);
      const live = await policySearch.clauseFor(db, '§5.4');
      assert.equal(live.via, 'Agent Search');
      assert.equal(live.link, 'gs://duedilly-uat-x/policies/policy-clause-5-4.txt');
      assert.match(calls[0].url, /^https:\/\/discoveryengine\.googleapis\.com\/v1\/projects\/test-project\/locations\/global\/collections\/default_collection\/dataStores\/duedilly-policies\/servingConfigs\/default_serving_config:search$/);
      assert.deepEqual(calls[0].body.contentSearchSpec, { snippetSpec: { returnSnippet: true } }); // snippets only: no Enterprise feature
      await policySearch.clauseFor(db, '§5.4');
      assert.equal(calls.length, 1); // cached

      const s = await policySearch.search(db, 'vessel AIS dark');
      assert.equal(s.via, 'Agent Search');
      assert.equal(s.results[0].clauseId, '§5.4');
      assert.equal(s.results[0].snippet, 'AIS telemetry dark periods exceeding 12 hours');
      // The daily cap (2) is used up: the built-in text answers, and says why
      const capped = await policySearch.search(db, 'vessel AIS dark');
      assert.equal(capped.via, 'Offline fallback');
      assert.match(capped.reason, /limit of 2/);

      db.setSetting('daily_budget_agent_search', null);
      fail = true;
      const down = await policySearch.search(db, 'broker intermediary');
      assert.equal(down.via, 'Offline fallback');
      assert.match(down.reason, /could not be reached/);
      assert.equal(down.results[0].clauseId, '§5.2');
    });
  } finally {
    globalThis.fetch = realFetch;
    if (realDescriptor) Object.defineProperty(gal, 'GoogleAuth', realDescriptor);
    policySearch._clearCache();
    db.setSetting('daily_budget_agent_search', null);
  }
});

test('Phase 3 over HTTP: push endpoint, crawler routes, policy routes, and the gate', async t => {
  await startServer(PORT);
  t.after(async () => { await bus.drain(); await stopServer(); });
  const db = getDb();
  const events = require('../src/routes/events');

  await t.test('the push endpoint only answers Pub/Sub and Cloud Scheduler', async () => {
    const push = (event, body, token) => fetch(`${BASE}/events/${event}`, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: `Bearer ${token}` } : {}), body: JSON.stringify(body) });
    const message = envelope => ({ message: { data: Buffer.from(JSON.stringify(envelope)).toString('base64'), messageId: 'm-' + Math.random() }, subscription: 'projects/p/subscriptions/s' });
    const envelope = { id: 'evt-push-1', event: 'ddq-submitted', workspaceId: 'demo', at: new Date().toISOString(), payload: { kycId: 'K9' } };
    // Not set up: closed, even with a token
    assert.equal((await push('ddq-submitted', message(envelope), 'anything')).status, 401);

    events._setVerifier(async (token, audience) => {
      assert.equal(audience, 'https://duedilly.example');
      if (token === 'good') return { email: 'duedilly-run@test-project.iam.gserviceaccount.com', email_verified: true };
      if (token === 'other-account') return { email: 'someone-else@test-project.iam.gserviceaccount.com', email_verified: true };
      throw new Error('bad signature');
    });
    await withConfig({ pubsubPushAudience: 'https://duedilly.example', pubsubPushServiceAccount: 'duedilly-run@test-project.iam.gserviceaccount.com' }, async () => {
      assert.equal((await push('ddq-submitted', message(envelope))).status, 401);
      assert.equal((await push('ddq-submitted', message(envelope), 'forged')).status, 401);
      assert.equal((await push('ddq-submitted', message(envelope), 'other-account')).status, 401);
      assert.equal(db.hasSeenEvent('evt-push-1'), false);
      assert.equal((await push('ddq-submitted', message(envelope), 'good')).status, 204);
      assert.equal(db.hasSeenEvent('evt-push-1'), true);
      assert.equal((await push('ddq-submitted', message(envelope), 'good')).status, 204); // a redelivery is acknowledged and does nothing
      assert.equal((await push('alert-raised', message(envelope), 'good')).status, 400); // sent to the wrong event
      assert.equal((await push('made-up', message(envelope), 'good')).status, 404);
      // Cloud Scheduler's own message names no workspace: it applies to each one, once
      const scheduled = { message: { data: Buffer.from('{"event":"rescreen-due","source":"cloud-scheduler"}').toString('base64'), messageId: 'sched-1' } };
      assert.equal((await push('rescreen-due', scheduled, 'good')).status, 204);
      assert.equal(db.hasSeenEvent('sched-1:demo'), true);
      const crawl = await push('crawl-due', {}, 'good');
      assert.equal(crawl.status, 200);
      assert.equal((await crawl.json()).status, 'done');
    });
    events._setVerifier(null);
  });

  await t.test('crawler and policy routes are for compliance officers', async () => {
    for (const [method, path] of [['GET', '/api/sources/crawl/status'], ['POST', '/api/sources/crawl/run-all'], ['POST', '/api/sources/demo-page'], ['GET', '/api/sources/proposals'], ['POST', '/api/sources/proposals/x/approve'], ['GET', '/api/policies/clauses'], ['GET', '/api/policies/search?q=pep']]) {
      const res = await fetch(BASE + path, { method, headers: EMPLOYEE, body: method === 'POST' ? '{}' : undefined });
      assert.equal(res.status, 403, `${method} ${path}`);
    }
    const clauses = await (await api('/api/policies/clauses')).json();
    assert.equal(clauses.status.mode, 'offline');
    assert.equal(clauses.clauses.find(c => c.id === '§4.1').via, 'Offline fallback');
    const search = await (await api('/api/policies/search?q=broker%20intermediary')).json();
    assert.equal(search.results[0].clauseId, '§5.2');
    assert.equal((await api('/api/policies/search?q=')).status, 400);
    assert.match(await (await fetch(`${BASE}/about-bot`)).text(), /User-agent: DueDillyBot/);
  });

  await t.test('a website added without the terms tick is not read; settings and the snapshot work', async () => {
    const created = await (await api('/api/sources', { method: 'POST', body: JSON.stringify({ label: 'Unticked site', type: 'Web', config: { url: 'https://unticked.example/news' } }) })).json();
    assert.equal(created.conversion.recordsCount, 0);
    assert.match(created.conversion.summary, /confirm that the site's terms/);
    const id = created.source.id;
    const saved = await (await api(`/api/sources/${id}/crawl-settings`, { method: 'PUT', body: JSON.stringify({ runOnScreening: true, instructions: 'Each notice is one paragraph.' }) })).json();
    assert.equal(saved.source.runOnScreening, true);
    assert.equal(saved.source.termsChecked, false);
    assert.equal(saved.source.instructions, 'Each notice is one paragraph.');
    assert.equal((await api(`/api/sources/${id}/snapshot`)).status, 404);
    await api(`/api/sources/${id}`, { method: 'DELETE' });
  });

  await t.test('GATE: the demo page changes, new records appear, a ripple fires and Aurora Venture is screened again', async () => {
    db.setSetting('rescreen_requested_aurora', 0);
    const alertsBefore = db.getAlerts(200).filter(a => a.id === 'aurora').length;
    const page1 = await (await fetch(BASE + demoFixtures.PATH)).text();
    assert.match(page1, /Demo page: fictional/);
    assert.doesNotMatch(page1, /Aurora Venture/);

    const added = await (await api('/api/sources/demo-page', { method: 'POST', body: JSON.stringify({ version: 1 }) })).json();
    assert.equal(added.source.result, 'read');
    assert.equal(added.source.termsChecked, true);
    assert.equal(added.source.extractor, 'offline'); // no agents service in the tests: labelled as the offline sample
    await bus.drain();
    assert.equal(db.getAlerts(200).filter(a => a.id === 'aurora').length, alertsBefore);

    const changed = await (await api('/api/sources/demo-page', { method: 'POST', body: JSON.stringify({ version: 2 }) })).json();
    assert.equal(changed.result.result, 'changed');
    assert.ok(changed.result.added.some(r => r.name === 'Aurora Venture'));
    assert.match(await (await fetch(BASE + demoFixtures.PATH)).text(), /Aurora Venture \(IMO 9304124\)/);
    await bus.drain();

    // New records in Readable Source Intelligence, with the source link and read time
    const records = db.getSourceRecordsBySource(demoFixtures.SOURCE_ID);
    const record = records.find(r => r.entity_name === 'Aurora Venture');
    assert.ok(record);
    assert.match(record.details_json, /"readAt"/);
    assert.match(record.details_json, /demo\/port-notices/);
    // A ripple for Aurora Venture, rated High, and a re-screen that ran
    const ripples = db.getAlerts(200).filter(a => a.id === 'aurora' && a.agent === 'Ripples' && /now names Aurora Venture/.test(a.x));
    assert.equal(ripples.length, 1);
    assert.equal(ripples[0].severity, 'High');
    assert.match(ripples[0].rescreen, /^done: 85 of 100, Escalate \(offline sample\)$/);
    // The notice names only the vessel: no other counterparty gets a ripple or is screened again
    assert.equal(db.getAlerts(200).some(a => a.agent === 'Ripples' && /now names/.test(a.x) && a.id !== 'aurora'), false);

    const status = await (await api('/api/sources/crawl/status')).json();
    assert.equal(status.mode, 'offline');
    assert.equal(status.demoPage.version, 2);
    assert.equal(status.events.mode, 'inline');
    assert.equal(status.storage.mode, 'local');
    assert.ok(status.sources.some(s => s.sourceId === demoFixtures.SOURCE_ID && s.hasSnapshot));
    const snapshot = await (await api(`/api/sources/${demoFixtures.SOURCE_ID}/snapshot`)).json();
    assert.match(snapshot.text, /Aurora Venture/);
    assert.equal(snapshot.storedIn, 'Local folder');

    // Reading it again changes nothing and raises nothing
    const again = await (await api(`/api/sources/${demoFixtures.SOURCE_ID}/crawl`, { method: 'POST', body: '{}' })).json();
    assert.equal(again.result.result, 'unchanged');
    await bus.drain();
    assert.equal(db.getAlerts(200).filter(a => a.id === 'aurora' && a.agent === 'Ripples' && /now names/.test(a.x)).length, 1);
  });

  await t.test('the demo page route is off outside demo mode', async () => {
    await withConfig({ demoMode: false }, async () => {
      const res = await fetch(`${BASE}/api/sources/demo-page`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      assert.ok([401, 403].includes(res.status));
    });
  });
});
