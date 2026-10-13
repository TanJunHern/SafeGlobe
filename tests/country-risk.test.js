/**
 * Country risk views on the Globe, offline: the ISO list, the checks on every country, the JSON shape, the EU
 * file parser, reading and change detection with a pretend website and a pretend agent, "Needs upload", "Stale",
 * the refresh setting and who may change it, the colour rule, and the guardrail that no score changes.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { getDb } = require('../src/db');
const iso = require('../src/countryRisk/iso3166');
const registry = require('../src/countryRisk/views.config');
const { validateCountries, documentErrors } = require('../src/countryRisk/validate');
const euRegimes = require('../src/countryRisk/parsers/euRegimes');
const countryRisk = require('../src/countryRisk/countryRiskService');
const agentsClient = require('../src/services/agentsClient');
const riskService = require('../src/risk/riskService');
const handlers = require('../src/events/handlers');
const bus = require('../src/events/bus');
const colours = require('../country-risk-views.js');
const { startServer, stopServer } = require('../src/server');

const PORT = 8097;
const BASE = `http://localhost:${PORT}`;
const OFFICER = { 'x-user-email': 'compliance@duedilly.com', 'Content-Type': 'application/json' };
const EMPLOYEE = { 'x-user-email': 'john.doe@duedilly.com', 'Content-Type': 'application/json' };
const withStub = async (object, patch, fn) => {
  const before = Object.fromEntries(Object.keys(patch).map(k => [k, object[k]]));
  Object.assign(object, patch);
  try { return await fn(); } finally { Object.assign(object, before); }
};

const OFAC = registry.byId('ofac_programmes');
const FATF = registry.byId('fatf_lists');
const EU = registry.byId('eu_regimes');

// A pretend website: pages by full URL or by path, and a record of every request
function site(pages) {
  const requests = [];
  const fetchImpl = async url => {
    requests.push(url);
    const page = pages[url] !== undefined ? pages[url] : pages[new URL(url).pathname];
    const p = typeof page === 'function' ? page() : page;
    if (p === undefined) return new Response('not found', { status: 404 });
    if (typeof p === 'string') return new Response(p, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    return new Response(p.body || '', { status: p.status || 200, headers: { 'content-type': p.type || 'text/html' } });
  };
  return { deps: { fetchImpl, lookup: async () => [{ address: '93.184.216.34' }], gapMs: 0 }, requests };
}
// A pretend country risk agent: answers from a function of the page text, and counts its calls
function agent(answer) {
  const calls = [];
  return { calls, stub: { configured: () => true, countryRiskExtract: async payload => { calls.push(payload); return Object.assign({ model_id: 'test-model', note: '' }, answer(payload)); } } };
}
const programmes = names => `<html><body><h1>Sanctions programmes</h1><ul>${names.map(n => `<li><a href="/x">${n}</a></li>`).join('')}</ul></body></html>`;
// The pretend agent "reads" the programme names off the page: Fictionland is not a country and must be rejected in code
const readProgrammes = payload => ({
  countries: [...payload.text.matchAll(/(\w[\w' -]*?) Sanctions/g)].map(m => ({ name: m[1].replace(/^.*programmes /, '').replace(/-Related$/i, ''), category: 'sanctions_programme', evidence_quote: `${m[1].replace(/^.*programmes /, '')} Sanctions` }))
});
const clear = (db, id) => { db.saveCountryRiskView(id, { data: null, contentHash: '', lastCheckedAt: null, lastOkAt: null, lastChangedAt: null, problem: '', problemKind: '', enabled: true }); countryRisk._reset(); };

test.before(() => { handlers.register(); });

test('ISO list: names, other spellings and codes map to alpha-3 in code; unknown names do not', () => {
  assert.equal(iso.byName('Iraq').a3, 'IRQ');
  assert.equal(iso.byName('  the  Democratic People\'s Republic of Korea ').a3, 'PRK');
  assert.equal(iso.byName('North Korea').a3, 'PRK');
  assert.equal(iso.byName('Burma').a3, 'MMR');
  assert.equal(iso.byName('Turkey').a3, 'TUR');
  assert.equal(iso.byName('Türkiye').a3, 'TUR');
  assert.equal(iso.byName("Cote d'Ivoire").a3, 'CIV');
  assert.equal(iso.byName('Russia').a3, 'RUS');
  assert.equal(iso.byName('Atlantis'), null);
  assert.equal(iso.byName('IRQ'), null, 'a code is not accepted as a name');
  assert.equal(iso.byAlpha3('IRQ').name, 'Iraq');
  assert.equal(iso.byAlpha3('TERR'), null);
  assert.equal(iso.byAlpha3('irq'), null);
  assert.equal(new Set(iso.COUNTRIES.map(c => c.a3)).size, iso.COUNTRIES.length);
  assert.equal(iso.COUNTRIES.length, 249);
});

test('checks: a country with no quote, a quote that is not in the snapshot, an unknown name or category is rejected', () => {
  const snapshot = 'Jurisdictions under increased monitoring: Iraq and Atlantis. Call for action: Iran.';
  const out = validateCountries(FATF, [
    { name: 'Iraq', category: 'increased_monitoring', evidence_quote: 'increased monitoring: Iraq' },
    { name: 'Iran', category: 'call_for_action', evidence_quote: '' },
    { name: 'Syria', category: 'call_for_action', evidence_quote: 'Call for action: Syria' },
    { name: 'Atlantis', category: 'increased_monitoring', evidence_quote: 'Iraq and Atlantis' },
    { name: 'Iran', category: 'very_bad', evidence_quote: 'Call for action: Iran' }
  ], snapshot);
  assert.deepEqual(out.countries.map(c => c.iso3), ['IRQ']);
  assert.equal(out.countries[0].score, null);
  const why = Object.fromEntries(out.rejected.map(r => [r.name + '|' + r.reason.slice(0, 12), r.reason]));
  assert.equal(out.rejected.length, 4);
  assert.match(out.rejected.find(r => r.name === 'Iran' && /No evidence/.test(r.reason)).reason, /No evidence quote/);
  assert.match(out.rejected.find(r => r.name === 'Syria').reason, /not in the saved snapshot/);
  assert.match(out.rejected.find(r => r.name === 'Atlantis').reason, /not in the ISO country list/);
  assert.ok(Object.values(why).some(r => /not a category/.test(r)));
});

test('checks: a country named twice keeps the riskier category and both quotes', () => {
  const out = validateCountries(FATF, [
    { name: 'Iran', category: 'increased_monitoring', evidence_quote: 'monitoring: Iran' },
    { name: 'Iran', category: 'call_for_action', evidence_quote: 'action: Iran' }
  ], 'monitoring: Iran. action: Iran.');
  assert.equal(out.countries.length, 1);
  assert.equal(out.countries[0].category, 'call_for_action');
  assert.deepEqual(out.countries[0].other_evidence, ['monitoring: Iran']);
});

test('JSON shape: the shipped samples are valid, and a broken document is refused', () => {
  for (const view of [OFAC, EU]) {
    const sample = countryRisk.loadSample(view.id);
    assert.ok(sample, `${view.id} has a sample`);
    assert.deepEqual(documentErrors(sample, view), []);
    assert.equal(sample.sample, true);
  }
  const good = countryRisk.loadSample('ofac_programmes');
  const broken = patch => documentErrors(Object.assign({}, good, patch), OFAC);
  assert.ok(broken({ content_hash: 'abc' }).length);
  assert.ok(broken({ method: 'guess' }).length);
  assert.ok(broken({ model_id: '' }).length, 'an AI extracted view names its model');
  assert.ok(broken({ fetched_at: 'yesterday' }).length);
  assert.ok(broken({ countries: [] }).length);
  assert.ok(broken({ countries: [{ iso3: 'IRQ', name: 'Iraq', category: 'sanctions_programme', score: null, evidence_quote: '' }] }).length);
  assert.ok(broken({ countries: [{ iso3: 'XXX', name: 'Nowhere', category: 'sanctions_programme', score: null, evidence_quote: 'q' }] }).length);
});

const EU_CSV = [
  '﻿fileGenerationDate;Entity_LogicalId;Entity_Regulation_PublicationDate;Entity_Regulation_NumberTitle;Entity_Regulation_Programme;Entity_Remark',
  '01/10/2026;1;01/02/2020;10/2020 (OJ L1);IRQ;"a remark; with a separator\nand a line break"',
  '01/10/2026;2;05/03/2024;22/2024 (OJ L9);IRQ;',
  '01/10/2026;3;01/01/2019;7/2019 (OJ L3);TERR;',
  '01/10/2026;4;01/01/2021;3/2021 (OJ L5);SYR;'
].join('\n');

test('EU file: regimes whose code is a country code become countries; thematic regimes are left out and reported', () => {
  const parsed = euRegimes.parse(EU_CSV, EU);
  assert.deepEqual(parsed.countries.map(c => c.iso3).sort(), ['IRQ', 'SYR']);
  // The quote is the newest regulation of the regime, exactly as it stands in the file
  const irq = parsed.countries.find(c => c.iso3 === 'IRQ');
  assert.equal(irq.evidence_quote, '22/2024 (OJ L9);IRQ');
  assert.ok(EU_CSV.includes(irq.evidence_quote));
  assert.deepEqual(parsed.rejected.map(r => r.name), ['TERR']);
  assert.throws(() => euRegimes.parse('a;b\n1;2', EU), /layout has changed/);
});

test('reading is off by default: no website is contacted and the samples colour the map', async () => {
  const db = getDb();
  clear(db, 'ofac_programmes');
  assert.equal(config.countryRiskFetch, 'off');
  const result = await countryRisk.refreshView(db, 'ofac_programmes');
  assert.equal(result.result, 'offline');
  assert.deepEqual(await countryRisk.checkViews(db), []);
  const shown = countryRisk.viewData(db, 'ofac_programmes');
  assert.equal(shown.view.status, 'sample');
  assert.match(shown.view.sampleNote, /^Sample data, may be out of date \(\d{4}-\d{2}-\d{2}\)$/);
  assert.equal(shown.data.sample, true);
  assert.equal(countryRisk.overview(db).agent.status, 'Offline fallback');
});

test('a page view: the agent is called once, an unchanged page makes no call, and a change is picked up', async () => {
  const db = getDb();
  clear(db, 'ofac_programmes');
  let names = ['Iran Sanctions', 'Cuba Sanctions', 'Counter Terrorism Sanctions', 'Fictionland Sanctions'];
  const web = site({ [OFAC.sourceUrl]: () => programmes(names) });
  const dilly = agent(readProgrammes);
  await withStub(agentsClient, dilly.stub, async () => {
    const first = await countryRisk.refreshView(db, 'ofac_programmes', { deps: web.deps });
    assert.equal(first.result, 'updated');
    assert.equal(first.llmCalls, 1);
    const doc = countryRisk.viewData(db, 'ofac_programmes').data;
    assert.deepEqual(doc.countries.map(c => c.iso3), ['CUB', 'IRN']);
    assert.equal(doc.method, 'llm');
    assert.equal(doc.model_id, 'test-model');
    assert.match(doc.content_hash, /^[0-9a-f]{64}$/);
    assert.equal(doc.sample, undefined);
    assert.deepEqual(documentErrors(doc, OFAC), []);
    // Rejected in code and kept for the audit: not countries
    assert.ok(doc.rejected.some(r => r.name === 'Fictionland' && /ISO country list/.test(r.reason)));
    // robots.txt was asked before the page
    assert.ok(web.requests[0].endsWith('/robots.txt'));

    countryRisk._reset();
    const second = await countryRisk.refreshView(db, 'ofac_programmes', { deps: web.deps });
    assert.equal(second.result, 'unchanged');
    assert.equal(dilly.calls.length, 1, 'an unchanged hash makes no LLM call');

    names = [...names, 'Libya Sanctions'];
    const third = await countryRisk.refreshView(db, 'ofac_programmes', { deps: web.deps });
    assert.equal(third.result, 'updated');
    assert.equal(dilly.calls.length, 2);
    assert.deepEqual(countryRisk.viewData(db, 'ofac_programmes').data.countries.map(c => c.iso3), ['CUB', 'IRN', 'LBY']);
  });
  assert.equal(db.countCountryRiskLlmCalls('2000-01-01'), db.getCountryRiskLog({ limit: 100 }).reduce((n, l) => n + l.llmCalls, 0));
});

test('a failed refresh keeps the last good data and shows "Stale since"', async () => {
  const db = getDb();
  clear(db, 'ofac_programmes');
  let page = programmes(['Iran Sanctions', 'Cuba Sanctions', 'Libya Sanctions', 'Mali Sanctions']);
  let status = 200;
  const web = site({ [OFAC.sourceUrl]: () => ({ status, body: page }) });
  const good = agent(readProgrammes);
  await withStub(agentsClient, good.stub, () => countryRisk.refreshView(db, 'ofac_programmes', { deps: web.deps }));
  const before = countryRisk.viewData(db, 'ofac_programmes').data;
  assert.equal(before.countries.length, 4);

  // 1. The site answers an error
  status = 500;
  let r = await countryRisk.refreshView(db, 'ofac_programmes', { deps: web.deps });
  assert.equal(r.result, 'failed');
  let shown = countryRisk.viewData(db, 'ofac_programmes');
  assert.equal(shown.view.status, 'stale');
  assert.ok(shown.view.staleSince);
  assert.match(shown.view.problem, /500/);
  assert.deepEqual(shown.data, before, 'the map still has the last good version');

  // 2. The page changed and the agent invents quotes: nothing passes, nothing is saved
  status = 200;
  page = programmes(['Iran Sanctions', 'Cuba Sanctions', 'Libya Sanctions', 'Mali Sanctions', 'Yemen Sanctions']);
  const liar = agent(() => ({ countries: [{ name: 'Yemen', category: 'sanctions_programme', evidence_quote: 'Yemen is under full embargo' }] }));
  r = await withStub(agentsClient, liar.stub, () => countryRisk.refreshView(db, 'ofac_programmes', { deps: web.deps }));
  assert.equal(r.result, 'failed');
  assert.match(r.reason, /No country passed the checks/);
  assert.deepEqual(countryRisk.viewData(db, 'ofac_programmes').data, before);

  // 3. A half-read page (most countries gone) is not trusted on a scheduled check
  page = programmes(['Iran Sanctions']);
  r = await withStub(agentsClient, good.stub, () => countryRisk.refreshView(db, 'ofac_programmes', { trigger: 'schedule', deps: web.deps }));
  assert.equal(r.result, 'failed');
  assert.match(r.reason, /half-read/);
  assert.deepEqual(countryRisk.viewData(db, 'ofac_programmes').data, before);

  // 4. No agents service: the reason is said, and the hash is not stored, so the next check tries again
  page = programmes(['Iran Sanctions', 'Cuba Sanctions', 'Libya Sanctions', 'Mali Sanctions', 'Sudan Sanctions']);
  r = await withStub(agentsClient, { configured: () => false }, () => countryRisk.refreshView(db, 'ofac_programmes', { deps: web.deps }));
  assert.equal(r.result, 'failed');
  assert.match(r.reason, /not connected/);
  // A failed check is tried again the next day, not a week later
  const row = db.getCountryRiskView('ofac_programmes');
  assert.ok(new Date(countryRisk.nextCheckAt(db, row)).getTime() - Date.now() < 25 * 3600 * 1000);

  // 5. It recovers
  r = await withStub(agentsClient, good.stub, () => countryRisk.refreshView(db, 'ofac_programmes', { deps: web.deps }));
  assert.equal(r.result, 'updated');
  shown = countryRisk.viewData(db, 'ofac_programmes');
  assert.equal(shown.view.status, 'ok');
  assert.equal(shown.view.staleSince, null);
  assert.equal(shown.data.countries.length, 5);
});

test('a site that refuses robots is not worked around: "Needs upload", then an officer\'s upload is read once', async () => {
  const db = getDb();
  clear(db, 'fatf_lists');
  const web = site({ '/robots.txt': { status: 403, body: 'Just a moment...' }, [FATF.sourceUrl]: { status: 403, body: 'Just a moment...' } });
  const dilly = agent(payload => ({ countries: [
    { name: 'Iraq', category: 'increased_monitoring', evidence_quote: 'Jurisdictions under Increased Monitoring: Iraq' },
    { name: 'Iran', category: 'call_for_action', evidence_quote: 'subject to a Call for Action: Iran' },
    { name: 'Narnia', category: 'call_for_action', evidence_quote: 'subject to a Call for Action' }
  ] }));
  await withStub(agentsClient, dilly.stub, async () => {
    const blocked = await countryRisk.refreshView(db, 'fatf_lists', { deps: web.deps });
    assert.equal(blocked.result, 'needs_upload');
    assert.match(blocked.reason, /does not get around/);
    assert.equal(dilly.calls.length, 0);
    assert.equal(countryRisk.describeView(db, FATF).status, 'needs_upload');
    assert.equal(countryRisk.viewData(db, 'fatf_lists').data, null, 'no data: the map stays grey, never coloured from a guess');

    const page = '<html><body><p>High-Risk Jurisdictions subject to a Call for Action: Iran</p><p>Jurisdictions under Increased   Monitoring: Iraq</p></body></html>';
    await assert.rejects(countryRisk.refreshView(db, 'fatf_lists', { upload: { filename: 'fatf.pdf', content: page } }), /Upload one of/);
    await assert.rejects(countryRisk.refreshView(db, 'eu_regimes', { upload: { filename: 'x.html', content: page } }), /does not take an upload/);
    const up = await countryRisk.refreshView(db, 'fatf_lists', { trigger: 'upload', upload: { filename: 'FATF.html', content: page } });
    assert.equal(up.result, 'updated');
    const doc = countryRisk.viewData(db, 'fatf_lists').data;
    assert.equal(doc.method, 'upload');
    assert.deepEqual(doc.countries.map(c => [c.iso3, c.category]), [['IRN', 'call_for_action'], ['IRQ', 'increased_monitoring']]);
    assert.deepEqual(dilly.calls[0].categories.map(c => c.id), ['call_for_action', 'increased_monitoring']);

    const again = await countryRisk.refreshView(db, 'fatf_lists', { trigger: 'upload', upload: { filename: 'FATF.html', content: page } });
    assert.equal(again.result, 'unchanged');
    assert.equal(dilly.calls.length, 1);

    // The weekly check is still refused by the site. The uploaded data stays, and is not called stale for that.
    await countryRisk.refreshView(db, 'fatf_lists', { deps: web.deps });
    const view = countryRisk.describeView(db, FATF);
    assert.equal(view.status, 'ok');
    assert.equal(view.needsUpload, true);
    assert.equal(view.methodLabel, 'Uploaded');
  });
});

test('a file view: the dataset record names the file, the file is parsed in code, and no agent is called', async () => {
  const db = getDb();
  clear(db, 'eu_regimes');
  const fileUrl = 'https://webgate.ec.europa.eu/files/list_1_1?token=public';
  const record = { result: { distributions: [
    { title: { en: 'Sanctions File 1.0' }, format: { id: 'CSV' }, download_url: ['https://webgate.ec.europa.eu/files/list_1_0'] },
    { title: { en: 'Sanctions File 1.1' }, format: { id: 'CSV' }, download_url: [fileUrl], license: { label: 'Reuse notice', resource: 'http://example.eu/notice' } },
    { title: { en: 'Sanctions File 1.1' }, format: { id: 'XML' }, download_url: ['https://webgate.ec.europa.eu/files/list.xml'] }
  ] } };
  const web = site({ [EU.fetch.catalogueUrl]: { type: 'application/json', body: JSON.stringify(record) }, [fileUrl]: { type: 'text/plain', body: EU_CSV } });
  const dilly = agent(() => ({ countries: [] }));
  await withStub(agentsClient, dilly.stub, async () => {
    const r = await countryRisk.refreshView(db, 'eu_regimes', { deps: web.deps });
    assert.equal(r.result, 'updated');
    assert.equal(r.llmCalls, 0);
    assert.equal(dilly.calls.length, 0);
  });
  const doc = countryRisk.viewData(db, 'eu_regimes').data;
  assert.equal(doc.method, 'structured');
  assert.equal(doc.model_id, undefined);
  assert.equal(doc.read_url, fileUrl, 'the newest CSV file was chosen');
  assert.match(doc.licence_note, /Reuse notice/);
  assert.deepEqual(doc.countries.map(c => c.iso3), ['IRQ', 'SYR']);
  assert.deepEqual(documentErrors(doc, EU), []);

  // A file on another site than the dataset record is not read
  clear(db, 'eu_regimes');
  record.result.distributions = [{ title: { en: 'File' }, format: { id: 'CSV' }, download_url: ['https://elsewhere.example.com/list.csv'] }];
  const off = site({ [EU.fetch.catalogueUrl]: { type: 'application/json', body: JSON.stringify(record) } });
  const refused = await countryRisk.refreshView(db, 'eu_regimes', { deps: off.deps });
  assert.equal(refused.result, 'failed');
  assert.match(refused.reason, /another site/);
});

test('refresh setting: weekly by default, what is due for each choice, and the fallback when the tick did not come', async () => {
  const db = getDb();
  db.setSetting('country_risk_refresh', null);
  assert.equal(countryRisk.getRefresh(db), 'weekly');
  assert.equal(registry.REFRESH.default, 'weekly');
  assert.throws(() => countryRisk.setRefresh(db, 'hourly'), /Refresh must be one of/);
  const daysAgo = n => ({ enabled: true, lastCheckedAt: new Date(Date.now() - n * 86400000).toISOString() });
  const due = { manual: [false, false, false], daily: [true, true, true], weekly: [false, true, true], monthly: [false, false, true] };
  for (const [choice, expected] of Object.entries(due)) {
    countryRisk.setRefresh(db, choice);
    assert.deepEqual([2, 8, 31].map(n => countryRisk.isDue(db, daysAgo(n))), expected, choice);
    assert.equal(countryRisk.isDue(db, Object.assign(daysAgo(40), { enabled: false })), false, 'a view switched off is never due');
  }
  countryRisk.setRefresh(db, 'weekly');
  assert.equal(countryRisk.isDue(db, null), true, 'never checked: due');

  // Scheduled tick: only the views that are due and switched on are read
  for (const view of registry.VIEWS) clear(db, view.id);
  db.saveCountryRiskView('fatf_lists', { enabled: false });
  db.saveCountryRiskView('eu_regimes', { lastCheckedAt: new Date().toISOString() });
  const web = site({ [OFAC.sourceUrl]: programmes(['Iran Sanctions']) });
  const dilly = agent(readProgrammes);
  await withStub(agentsClient, dilly.stub, async () => {
    const results = await countryRisk.checkViews(db, { deps: web.deps });
    assert.deepEqual(results.map(r => [r.viewId, r.result]), [['ofac_programmes', 'updated']]);
    assert.deepEqual(await countryRisk.checkViews(db, { deps: web.deps }), [], 'nothing is due straight after');

    // Fallback: a view overdue by more than the grace starts a background check when the Globe is opened
    assert.equal(countryRisk.checkIfOverdue(db, web.deps), false);
    db.saveCountryRiskView('ofac_programmes', { lastCheckedAt: new Date(Date.now() - 8 * 86400000).toISOString() });
    assert.equal(countryRisk.checkIfOverdue(db, web.deps), true);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(db.getCountryRiskLog({ viewId: 'ofac_programmes', limit: 1 })[0].trigger, 'fallback');
    assert.equal(dilly.calls.length, 1, 'the page had not changed, so the fallback check called no model');
  });
  // Reading switched off: opening the Globe starts nothing
  db.saveCountryRiskView('ofac_programmes', { lastCheckedAt: new Date(Date.now() - 60 * 86400000).toISOString() });
  assert.equal(countryRisk.checkIfOverdue(db), false);
});

test('colours: in every view higher risk is redder, and no data is grey, never green', () => {
  const tokens = { high: 'RED', 'high-soft': 'red', mid: 'AMBER', 'mid-soft': 'amber', low: 'GREEN', 'low-soft': 'green', 'land-none': 'GREY' };
  const order = { low: 0, mid: 1, high: 2 };
  const tokenOf = { low: 'GREEN', mid: 'AMBER', high: 'RED' };
  for (const view of registry.VIEWS) {
    assert.equal(colours.colour(view, null, tokens), 'GREY', `${view.id}: no data`);
    assert.equal(colours.colour(view, { category: 'not_a_category' }, tokens), 'GREY');
    const cats = [...view.categories].sort((a, b) => order[a.level] - order[b.level]);
    for (let i = 0; i < cats.length; i++) {
      assert.equal(colours.colour(view, { category: cats[i].id }, tokens), tokenOf[cats[i].level], `${view.id}: ${cats[i].id}`);
      if (i) assert.ok(colours.redness(view, { category: cats[i].id }) >= colours.redness(view, { category: cats[i - 1].id }));
      assert.ok(colours.redness(view, { category: cats[i].id }) > colours.redness(view, null));
    }
  }
  assert.equal(colours.colour(FATF, { category: 'call_for_action' }, tokens), 'RED');
  assert.equal(colours.colour(FATF, { category: 'increased_monitoring' }, tokens), 'AMBER');
  // Score views: the source's own number on its own scale; a "low is bad" score (CPI style) is turned round
  const mix = (a, b) => t => `${a}>${b}@${t.toFixed(2)}`;
  const highBad = { kind: 'score', scale: { min: 0, max: 10, lowIsBad: false } };
  const lowBad = { kind: 'score', scale: { min: 0, max: 100, lowIsBad: true } };
  const reds = (view, scores) => scores.map(score => colours.redness(view, { score }));
  assert.deepEqual(reds(highBad, [1, 5, 9]).slice().sort((a, b) => a - b), reds(highBad, [1, 5, 9]));
  assert.deepEqual(reds(lowBad, [90, 50, 10]).slice().sort((a, b) => a - b), reds(lowBad, [90, 50, 10]));
  assert.deepEqual([90, 50, 10].map(score => colours.band(colours.risk(lowBad, { score }))), ['low', 'mid', 'high']);
  assert.match(colours.colour(lowBad, { score: 5 }, tokens, mix), /^red>RED/);
  assert.match(colours.colour(highBad, { score: 1 }, tokens, mix), /^green>GREEN/);
  assert.equal(colours.colour(lowBad, { score: null }, tokens, mix), 'GREY');
});

test('display only: reading a view changes no risk score, confidence or route', async () => {
  const db = getDb();
  const snapshot = () => JSON.stringify(db.getScoredEntityIds().map(id => { const b = riskService.assessEntity(db, id); return b && [id, b.risk, b.confidence, b.route]; }));
  const before = snapshot();
  assert.ok(db.getScoredEntityIds().length > 0);
  clear(db, 'ofac_programmes');
  const web = site({ [OFAC.sourceUrl]: programmes(['Iran Sanctions', 'Cameroon Sanctions', 'Russia Sanctions']) });
  await withStub(agentsClient, agent(readProgrammes).stub, () => countryRisk.refreshView(db, 'ofac_programmes', { deps: web.deps }));
  assert.equal(snapshot(), before);
});

test('over HTTP: everyone signed in can see and switch views; only a compliance officer can change anything', async t => {
  await startServer(PORT);
  t.after(async () => { await bus.drain(); await stopServer(); });
  const db = getDb();
  for (const view of registry.VIEWS) clear(db, view.id);
  countryRisk.setRefresh(db, 'weekly');
  const call = (who, path, method = 'GET', body) => fetch(BASE + '/api/country-risk' + path, { method, headers: who, body: body ? JSON.stringify(body) : undefined });

  for (const who of [EMPLOYEE, OFFICER]) {
    const list = await (await call(who, '/views')).json();
    assert.deepEqual(list.views.map(v => v.id), registry.VIEWS.map(v => v.id));
    assert.equal(list.refresh.value, 'weekly');
    assert.equal(list.canEdit, who === OFFICER);
    assert.equal(typeof list.llmCallsThisMonth, 'number');
    assert.equal(list.live, false);
    assert.match(list.offlineNote, /Offline sample/);
    assert.equal(list.agent.technology, 'Google ADK');
    const one = await (await call(who, '/views/eu_regimes')).json();
    assert.equal(one.data.sample, true);
    assert.ok(one.data.countries.length > 0);
    assert.ok(one.data.countries.every(c => /^[A-Z]{3}$/.test(c.iso3) && c.evidence_quote));
  }
  assert.equal((await call(EMPLOYEE, '/views/nope')).status, 404);

  // An employee can change nothing
  assert.equal((await call(EMPLOYEE, '/settings', 'PUT', { refresh: 'daily' })).status, 403);
  assert.equal((await call(EMPLOYEE, '/views/eu_regimes', 'PUT', { enabled: false })).status, 403);
  assert.equal((await call(EMPLOYEE, '/refresh', 'POST', {})).status, 403);
  assert.equal((await call(EMPLOYEE, '/views/fatf_lists/upload', 'POST', { filename: 'a.html', content: '<p>x</p>' })).status, 403);
  assert.equal(countryRisk.getRefresh(db), 'weekly');

  // A compliance officer can
  const saved = await call(OFFICER, '/settings', 'PUT', { refresh: 'monthly' });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).refresh.value, 'monthly');
  assert.equal((await call(OFFICER, '/settings', 'PUT', { refresh: 'hourly' })).status, 400);
  const off = await (await call(OFFICER, '/views/eu_regimes', 'PUT', { enabled: false })).json();
  assert.equal(off.views.find(v => v.id === 'eu_regimes').enabled, false);
  assert.equal(off.views.find(v => v.id === 'eu_regimes').nextCheckAt, null);
  // "Refresh now" with reading switched off: nothing is contacted, and it says so
  const now = await (await call(OFFICER, '/refresh', 'POST', { viewId: 'ofac_programmes' })).json();
  assert.equal(now.results[0].result, 'offline');
  // An upload with no agents service connected is not used, and says why
  const up = await (await call(OFFICER, '/views/fatf_lists/upload', 'POST', { filename: 'fatf.html', content: '<p>Call for Action: Iran</p>' })).json();
  assert.equal(up.success, false);
  assert.match(up.result.reason, /not connected/);
  assert.equal((await call(OFFICER, '/views/eu_regimes/upload', 'POST', { filename: 'a.html', content: 'x' })).status, 400);

  // Not signed in at all outside demo mode
  const before = config.demoMode;
  config.demoMode = false;
  try { assert.equal((await fetch(BASE + '/api/country-risk/views')).status, 401); } finally { config.demoMode = before; }
  countryRisk.setRefresh(db, 'weekly');
  db.saveCountryRiskView('eu_regimes', { enabled: true });
});
