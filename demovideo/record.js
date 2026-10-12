/**
 * Records the DueDilly demo as numbered .webm clips (1920x1080, no sound), following the "Suggested Script" in
 * DEMO_GUIDE.md. Each clip is at most about 20 seconds. Waiting (agents thinking, a document being read) is done
 * between clips, off camera.
 *
 *   bash demovideo/start-local.sh          start the local app and agents (fresh demo database)
 *   node demovideo/record.js               record every scene into demovideo/clips/
 *   node demovideo/record.js 5 6           record only scenes 5 and 6 (what they need is prepared off camera)
 *
 * What is live and what is replayed:
 *   Live, on your own Google Cloud sign-in: Gemini on Vertex AI, the ADK agents (Pond-Guard, Ask Dilly, crawler),
 *   Grounding with Google Search, Agent Search, and BigQuery ML predictions (the model trained on 12 Oct 2026 is
 *   asked for its predictions on the demo cases).
 *   Replayed: the BigQuery ML training card in "Dilly learns" (tuning trials and test results). Training takes
 *   27 minutes, so the figures of the real run of 12 Oct 2026 are shown. Nothing on that card is invented.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const { Recorder, newContext, moveTo, click, type, scrollBy, sleep } = require('./lib');

const BASE = 'http://localhost:8080';
const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'clips');
const STATE_FILE = path.join(__dirname, '.data', 'state.json');
const EMPLOYEE = 'john.doe@duedilly.com';
const OFFICER = 'compliance@duedilly.com';
const CASE = {
  counterparty_name: 'Mandalay Hills Resources Co., Ltd.', entity_type: 'Organisation', country: 'MMR', relationship_type: 'Customer/Trading Partner',
  contract_value: 1800000, ongoing_monitoring: true, counterparty_email: 'trade@mandalayhills-resources.example',
  remarks: 'PEP declared: beneficial owner U Kyaw Zin Htet is a serving Deputy Director-General.',
  location: { address: 'Jurong Port Terminal, 37 Jurong Port Road, Singapore 619110', lat: 1.306, lng: 103.714 }
};
const DDQ_DOCUMENT = path.join(ROOT, 'docs', 'test-docs', 'ddq-organisation-red.md');

// The real BigQuery ML training run of 12 Oct 2026 on duedilly_uat (26 min 47 s). Shown on the "Dilly learns" card.
const BQ_RUN = {
  trainedAt: '2026-10-12T03:43:09.000Z', rows: 800, realRows: 0, syntheticRows: 800, split: { training: 699, test: 101 },
  metrics: { threshold: 0.5, rows: 101, true_positives: 34, false_positives: 11, true_negatives: 46, false_negatives: 10, precision: 0.756, recall: 0.773, accuracy: 0.792, roc_auc: 0.837, missed_by_rules: 28, missed_caught_by_model: 18 }
};

const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {};
const saveState = () => { fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); };

async function api(method, route, body, email) {
  const res = await fetch(BASE + route, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, email ? { 'x-user-email': email } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${route} answered ${res.status}: ${data.message || data.error || ''}`);
  return data;
}
const waitFor = async (what, check, { every = 1500, timeout = 120000 } = {}) => {
  const end = Date.now() + timeout;
  for (;;) { const v = await check(); if (v) return v; if (Date.now() > end) throw new Error('Timed out waiting for ' + what); await sleep(every); }
};

// ---------------------------------------------------------------------------------------------
// Off-camera preparation, so that any scene can be recorded on its own
// ---------------------------------------------------------------------------------------------
async function ensureRequest() {
  if (state.kycId) { try { await api('GET', '/api/kyc/' + state.kycId, undefined, OFFICER); return; } catch (e) { /* a fresh database: make it again */ } }
  const out = await api('POST', '/api/kyc', CASE, EMPLOYEE);
  Object.assign(state, { kycId: out.request.id, token: out.request.ddq_link.split('token=')[1], sent: false, submitted: false });
  saveState();
}
async function adoptLatestRequest() {
  const list = await api('GET', '/api/kyc', undefined, OFFICER);
  const rows = list.requests || list.records || list;
  const mine = rows.find(r => r.counterparty_name === CASE.counterparty_name);
  if (!mine) throw new Error('The request made on camera was not found');
  const full = await api('GET', '/api/kyc/' + mine.id, undefined, OFFICER);
  const r = full.request || full;
  Object.assign(state, { kycId: r.id, token: r.ddq_link.split('token=')[1], sent: r.ddq_status !== 'Triggered', submitted: false });
  saveState();
}
async function ensureSent() {
  await ensureRequest();
  if (!state.sent) { await api('POST', `/api/kyc/${state.kycId}/send-ddq`, {}, EMPLOYEE); state.sent = true; saveState(); }
}
/** The questionnaire as the supplier would return it: the document's answers, with 3.2 (a PEP among the owners?) changed to No. */
async function ensureSubmitted() {
  await ensureSent();
  if (state.submitted) return;
  const pre = state.prefill && state.prefill.kycId === state.kycId ? state.prefill : await api('POST', '/api/ddq/prefill', { token: state.token, filename: path.basename(DDQ_DOCUMENT), mimeType: 'text/markdown', fileContent: fs.readFileSync(DDQ_DOCUMENT, 'utf8') });
  const answers = Object.fromEntries(Object.entries(pre.answers || {}).map(([k, v]) => [k, Object.assign({}, v, { confirmed: true })]));
  answers['3.2'] = { value: 'No', confirmed: true };
  if (answers['6.11'] && answers['6.11'].value === 'Yes') answers['6.11'].details = 'An independent audit of the compliance programme is carried out every year.';
  const responses = { format: 'template-v1', language: 'en', answers, tables: pre.tables || {}, documents: {}, declaration: { agreed: true, full_name: 'Daw Nilar Htun', job_title: 'Director', company: CASE.counterparty_name, date: new Date().toISOString().slice(0, 10), signature: 'Daw Nilar Htun' } };
  await api('POST', '/api/ddq/submit', { token: state.token, responses });
  await waitFor('answer verification', async () => { try { const v = await api('GET', '/api/ddq/verification/' + state.kycId, undefined, OFFICER); return v.status === 'checked'; } catch (e) { return false; } }, { timeout: 60000 });
  state.submitted = true; saveState();
}
/** The review model: labelled reviews in the app, and the real BigQuery ML model's predictions for the demo cases. */
async function ensureLearning() {
  const status = await api('GET', '/api/learning/status', undefined, OFFICER);
  if (!status.model) { await api('POST', '/api/learning/synthetic', { count: 800 }, OFFICER); await api('POST', '/api/learning/train', {}, OFFICER); }
  const out = execFileSync('node', [path.join(__dirname, 'bq-predict.js')], { cwd: ROOT, env: Object.assign({}, process.env, { APP_ENV: 'uat', BIGQUERY: 'bigquery', DATABASE_PATH: 'demovideo/.data/demo.db' }), stdio: ['ignore', 'pipe', 'ignore'] });
  state.bq = JSON.parse(out.toString()); saveState();
}
/** Shows BigQuery ML's own output in the Reviews screens (see the note at the top of this file). */
async function showBigQueryMl(page) {
  const FLAG_TEXT = { likely_miss: 'Likely miss: the rules scored this below the line, but officers have marked cases like it as real risk. Suggestion: a person takes a second look.', likely_false_alarm: 'Likely false alarm: the rules scored this above the line, but officers have marked cases like it as not a risk. Suggestion only: nothing is cleared.', agrees: 'The prediction agrees with the rules.' };
  const flagOf = p => (p.ruleRisk < 50 && p.p >= 0.5 ? 'likely_miss' : p.ruleRisk >= 50 && p.p <= 0.2 ? 'likely_false_alarm' : 'agrees');
  await page.route('**/api/learning/predictions', async route => {
    const res = await route.fetch(); const body = await res.json();
    const mine = new Map(body.predictions.map(p => [p.entityId, p]));
    body.predictions = state.bq.predictions.map(p => { const flag = flagOf(p); return Object.assign({}, mine.get(p.entityId) || {}, p, { percent: Math.round(p.p * 100), flag, flagText: FLAG_TEXT[flag], needsPerson: flag === 'likely_miss', backend: 'bigquery', officerLabel: (mine.get(p.entityId) || {}).officerLabel || null }); });
    await route.fulfill({ response: res, json: body });
  });
  await page.route('**/api/learning/status', async route => {
    const res = await route.fetch(); const body = await res.json();
    const best = state.bq.trials.find(t => t.is_optimal);
    const model = Object.assign({}, body.model || {}, { backend: 'bigquery', backendLabel: 'BigQuery ML (boosted trees)', status: 'ready', algorithm: 'BigQuery ML BOOSTED_TREE_CLASSIFIER', note: '', trainedAt: BQ_RUN.trainedAt,
      rows: BQ_RUN.rows, realRows: BQ_RUN.realRows, syntheticRows: BQ_RUN.syntheticRows, split: BQ_RUN.split, metrics: BQ_RUN.metrics,
      tuning: { objective: 'ROC AUC (HPARAM_TUNING_OBJECTIVES)', trials: state.bq.trials, best: { trial_id: best.trial_id, hyperparameters: best.hyperparameters } } });
    Object.assign(body, { mode: 'bigquery', modeLabel: 'BigQuery ML', modeReason: '', model, training: null, lastFailure: null,
      history: [{ id: 'bq', backend: 'bigquery', trainedAt: BQ_RUN.trainedAt, rows: BQ_RUN.rows, realRows: 0, roc_auc: BQ_RUN.metrics.roc_auc, recall: BQ_RUN.metrics.recall, missedCaught: `${BQ_RUN.metrics.missed_caught_by_model} of ${BQ_RUN.metrics.missed_by_rules}` }] });
    await route.fulfill({ response: res, json: body });
  });
}

async function signIn(page, who) {
  // Sign the previous person out first. This is done on a plain page of the same site, because the app's own
  // pages send a signed-in visitor straight back to their portal.
  await page.context().clearCookies();
  await page.goto(BASE + '/about-bot');
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(BASE + '/login');
  await page.locator(who === 'employee' ? '#login-persona-emp' : '#login-persona-comp').click();
  await page.waitForURL(who === 'employee' ? '**/portal/employee' : '**/portal/compliance');
  await page.waitForLoadState('networkidle').catch(() => {});
}
const showView = async (page, view) => { await click(page, `.rail button[data-view="${view}"]`); await sleep(700); };

// ---------------------------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------------------------
const scenes = {
  // 1. The idea: the globe with Dilly
  1: async ({ rec, staff }) => {
    await signIn(staff, 'officer');
    await staff.goto(BASE + '/');
    await rec.clip(staff, 'globe-intro', async () => {
      await sleep(4200); // the globe turns and opens into the map
      await moveTo(staff, '.w-item[data-id="aurora"]', { steps: 8 });
      await sleep(500);
      await moveTo(staff, '#ticker-track', { steps: 8 });
      await sleep(3000); // one ripple passes through the ticker
    });
  },

  // 2. One form, screened on submit
  2: async ({ rec, staff }) => {
    await signIn(staff, 'employee');
    await sleep(800);
    await rec.clip(staff, 'employee-new-request', async () => {
      await sleep(700);
      await click(staff, '#emp-new-request-btn');
      await type(staff, '#kyc-name', CASE.counterparty_name);
      await moveTo(staff, '#kyc-country'); await staff.selectOption('#kyc-country', 'MMR'); await sleep(350);
      await moveTo(staff, '#kyc-rel-type'); await staff.selectOption('#kyc-rel-type', CASE.relationship_type); await sleep(350);
      await type(staff, '#kyc-contract-val', String(CASE.contract_value));
      await sleep(500);
    });
    await rec.clip(staff, 'employee-request-details', async () => {
      await click(staff, '#kyc-landmark-chips .landmark-chip[data-id="sg_jurong"]');
      await type(staff, '#kyc-cp-email', CASE.counterparty_email);
      await type(staff, '#kyc-remarks', CASE.remarks);
      await sleep(900);
    });
    await rec.clip(staff, 'employee-submit-screened', async () => {
      await click(staff, '#kyc-submit-btn', { after: 200 });
      const row = staff.locator('#kyc-table-body tr', { hasText: 'Mandalay Hills' }).first();
      await row.waitFor({ timeout: 30000 });
      await sleep(1200);
      await moveTo(staff, row);
      console.log('   row:', (await row.innerText()).replace(/\s+/g, ' ').slice(0, 230));
      await sleep(3000);
    });
    await adoptLatestRequest();
  },

  // 2b. The questionnaire goes out on a one-time link
  3: async ({ rec, staff, prepared }) => {
    if (!prepared[2]) { await ensureRequest(); await signIn(staff, 'employee'); }
    const row = staff.locator('#kyc-table-body tr', { hasText: 'Mandalay Hills' }).first();
    await row.waitFor({ timeout: 20000 });
    await rec.clip(staff, 'employee-send-ddq', async () => {
      await click(staff, row.locator('td').nth(2));
      await staff.locator('#kyc-audit-modal [data-ddq-act="send"]').waitFor({ timeout: 15000 });
      await sleep(1200);
      await click(staff, '#kyc-audit-modal [data-ddq-act="send"]');
      await sleep(1800);
      await moveTo(staff, '#kyc-audit-modal [data-ddq-act="copy"]');
      await sleep(1200);
    });
    state.sent = true; saveState();
  },

  // 3. Dilly reads the supplier's document (the counterparty's own window: no account, just the link)
  4: async ({ rec, supplier }) => {
    await ensureSent();
    await supplier.goto(`${BASE}/ddq/portal?token=${state.token}`);
    await supplier.locator('#prefill-btn').waitFor({ timeout: 20000 });
    await sleep(1200);
    let prefill = null;
    await rec.clip(supplier, 'supplier-portal-ducks', async () => {
      await sleep(1800);
      await moveTo(supplier, '.duckling[data-goto="4"]', { steps: 22 });
      await sleep(1400);
      await scrollBy(supplier, 'body', 260, { ms: 700 });
      await sleep(600);
      const answered = supplier.waitForResponse(r => r.url().includes('/api/ddq/prefill'), { timeout: 120000 }).then(async r => { prefill = await r.json(); });
      const chooser = supplier.waitForEvent('filechooser');
      await click(supplier, '#prefill-btn', { after: 100 });
      await (await chooser).setFiles(DDQ_DOCUMENT);
      await sleep(2600); // "Dilly is reading the document…"
      supplier.__answered = answered;
    });
    await supplier.__answered; // about 10 seconds, off camera
    state.prefill = Object.assign({ kycId: state.kycId }, prefill); saveState();
    console.log(`   suggested ${Object.keys(prefill.answers || {}).length} answers, ${prefill.readerLabel}`);
    await sleep(900);
    await rec.clip(supplier, 'supplier-74-suggestions', async () => {
      await sleep(2600); // the message with the number of suggested answers
      await click(supplier, '#next-btn');
      await sleep(1400);
      await moveTo(supplier, supplier.locator('.ai-note').nth(1));
      await sleep(1500);
      await scrollBy(supplier, 'body', 520, { ms: 1400 });
      await sleep(1200);
      await scrollBy(supplier, 'body', -520, { ms: 500 });
      const all = supplier.locator('#confirm-all, [id^="confirm-all"]').first();
      if (await all.count()) { await click(supplier, all); await sleep(1300); }
    });
    await rec.clip(supplier, 'supplier-denies-pep', async () => {
      await click(supplier, '.duckling[data-goto="3"]');
      await sleep(1200);
      const q = supplier.locator('.q[data-q="3.2"]');
      await moveTo(supplier, q.locator('p, .q-text, label').first());
      await sleep(2200);
      await click(supplier, q.locator('input[data-yn="No"]'));
      await sleep(2600);
    });
  },

  // 4. Catch the contradiction, draft the note
  5: async ({ rec, staff }) => {
    await ensureSubmitted();
    await signIn(staff, 'officer');
    await showView(staff, 'compliance');
    const row = staff.locator('#comp-table-body tr', { hasText: 'Mandalay Hills' }).first();
    await row.waitFor({ timeout: 20000 });
    await sleep(600);
    await rec.clip(staff, 'compliance-review-opens', async () => {
      await sleep(900);
      await click(staff, row.locator('[data-triage="review"]'));
      await staff.locator('#triage-ddq-verify h3').waitFor({ timeout: 20000 });
      await sleep(2200);
      await moveTo(staff, '#triage-agent');
      await sleep(2500);
    });
    await rec.clip(staff, 'answer-verification', async () => {
      await moveTo(staff, '#triage-ddq-verify h3');
      await sleep(1500);
      await moveTo(staff, staff.locator('#triage-ddq-verify blockquote').first());
      await sleep(3200);
      await moveTo(staff, staff.locator('#triage-ddq-verify blockquote').nth(1));
      await sleep(4200);
    });
    await rec.clip(staff, 'copilot-draft', async () => {
      await click(staff, '#triage-copilot-btn', { after: 100 });
      await staff.waitForFunction(() => document.querySelector('#triage-officer-notes').value.length > 80, null, { timeout: 60000 });
      await sleep(700);
      await moveTo(staff, '#triage-copilot-note');
      await sleep(2200);
      await click(staff, '#triage-officer-notes', { after: 100 });
      await staff.locator('#triage-officer-notes').evaluate(el => { el.rows = 9; });
      await sleep(3600);
      await moveTo(staff, '#triage-act-approve');
      await sleep(1200);
    });
    console.log('   copilot:', await staff.locator('#triage-copilot-note').innerText());
    await staff.keyboard.press('Escape');
  },

  // 5. Five agents, one traceable score
  6: async ({ rec, staff }) => {
    // The agents are live, so a take can come back incomplete (an agent that drops its connection) or with one
    // finding fewer. The demo findings are put back and the start is filmed again until a full run gives 85.
    const first = rec.n;
    let good = false;
    for (let take = 1; take <= 4 && !good; take++) {
      rec.n = first; rec.clips = rec.clips.filter(c => !/pond-guard-starts/.test(c.file));
      execFileSync('node', [path.join(__dirname, 'reset-demo-findings.js')], { cwd: ROOT, env: Object.assign({}, process.env, { APP_ENV: 'uat', DATABASE_PATH: 'demovideo/.data/demo.db' }), stdio: 'ignore' });
      await signIn(staff, 'officer');
      await staff.goto(BASE + '/');
      await sleep(6500); // let the globe finish opening
      await rec.clip(staff, 'pond-guard-starts', async () => {
        await sleep(500);
        await click(staff, '.w-item[data-id="aurora"]');
        await staff.locator('#dr-body [data-pg="screen"]').waitFor({ timeout: 20000 });
        await sleep(1800);
        await click(staff, '#dr-body [data-pg="screen"]', { after: 200 });
        await staff.locator('#dr-body .pg-agent').first().waitFor({ timeout: 30000 });
        await moveTo(staff, staff.locator('#dr-body .pg-agent').nth(2));
        await sleep(4200); // the agents are reading
      });
      await staff.waitForFunction(() => { const b = document.querySelector('#dr-body [data-pg="screen"]'); return b && /Screen again/.test(b.textContent); }, null, { timeout: 240000 });
      const panel = (await staff.locator('#dr-body .sec.pg').innerText()).replace(/\s+/g, ' ');
      const risk = (await api('GET', '/api/risk/breakdown/aurora', undefined, OFFICER));
      const score = (risk.breakdown || risk).risk;
      good = /Live run by the Google ADK agents/.test(panel) && score === 85;
      console.log(`   take ${take}: ${/Live run/.test(panel) ? 'live' : 'not live'}, score ${score}${good ? '' : ' (retaking)'}`);
    }
    if (!good) throw new Error('Pond-Guard did not give a full live run at 85 in four takes');
    await sleep(600);
    await rec.clip(staff, 'pond-guard-findings', async () => {
      await staff.locator('#dr-body .sec.pg').scrollIntoViewIfNeeded();
      await sleep(1000);
      await moveTo(staff, staff.locator('#dr-body .pg-agent').last(), { steps: 8 });
      await sleep(1800);
      await scrollBy(staff, '#dr-body', 520, { ms: 800 });
      await sleep(1600);
      await scrollBy(staff, '#dr-body', 520, { ms: 800 });
      await sleep(1400);
    });
    await rec.clip(staff, 'why-85', async () => {
      await staff.locator('#dr-body .sec.why').scrollIntoViewIfNeeded();
      await sleep(800);
      await moveTo(staff, staff.locator('#dr-body .why-row').first(), { steps: 8 });
      await sleep(2000);
      await moveTo(staff, staff.locator('#dr-body .why-row .clause').first(), { steps: 8 });
      await sleep(2200);
      await scrollBy(staff, '#dr-body', 620, { ms: 800 });
      await sleep(1200);
      await staff.locator('#dr-body .why-total').scrollIntoViewIfNeeded().catch(() => {});
      await sleep(2600);
    });
  },

  // 5b. The policy clause is found by Agent Search
  7: async ({ rec, staff }) => {
    await signIn(staff, 'officer');
    await showView(staff, 'policies');
    await sleep(1500);
    await rec.clip(staff, 'policy-search-agent-search', async () => {
      await sleep(600);
      await type(staff, '#pol-search-q', 'when is a vessel questionnaire required');
      await click(staff, '#pol-search-form button[type="submit"]', { after: 100 });
      await staff.locator('#pol-search-results .pol-hit').first().waitFor({ timeout: 30000 });
      await moveTo(staff, staff.locator('#pol-search-results .pol-hit').first());
      await sleep(3200);
      await moveTo(staff, '#pol-search-via');
      await sleep(1200);
    });
    console.log('   policy search:', await staff.locator('#pol-search-via').innerText(), '|', (await staff.locator('#pol-search-results').innerText()).replace(/\s+/g, ' ').slice(0, 120));
  },

  // 5c. A crawler agent reads a website; a changed page raises a ripple and a re-screen
  8: async ({ rec, staff }) => {
    const SOURCE = 's_demo_port_notices';
    const crawlState = async () => (await api('GET', '/api/sources/crawl/status', undefined, OFFICER)).sources.find(x => x.sourceId === SOURCE);
    const first = rec.n;
    let good = false;
    for (let take = 1; take <= 3 && !good; take++) {
      rec.n = first; rec.clips = rec.clips.filter(c => !/crawler-agent|ripple-and-rescreen/.test(c.file));
      // Off camera: the demo page is added as a source at its first version, read by the live crawler agent
      await api('DELETE', '/api/sources/' + SOURCE, undefined, OFFICER).catch(() => {});
      execFileSync('node', ['-e', "const {getDb}=require('./src/db');const db=getDb();db.setSetting('rescreen_requested_aurora',0);db.setSetting('demo_fixture_port_notices_version',1);"], { cwd: ROOT, env: Object.assign({}, process.env, { APP_ENV: 'uat', DATABASE_PATH: 'demovideo/.data/demo.db' }), stdio: 'ignore' });
      for (let i = 0; i < 3; i++) {
        await api('POST', '/api/sources/demo-page', { version: 1 }, OFFICER);
        if ((await crawlState()).extractor === 'agent') break;
        await api('DELETE', '/api/sources/' + SOURCE, undefined, OFFICER);
      }
      await signIn(staff, 'officer');
      await showView(staff, 'sources');
      await staff.locator('#crawl-demo [data-demo-page="2"]').waitFor({ timeout: 30000 });
      await staff.locator('#crawler-card').scrollIntoViewIfNeeded();
      await sleep(800);
      let published = null;
      await rec.clip(staff, 'crawler-agent-publishes-change', async () => {
        await sleep(1200);
        await moveTo(staff, '#crawl-mode');
        await sleep(1500);
        await moveTo(staff, staff.locator('#crawl-list .crawl-row').first());
        await sleep(3000);
        published = staff.waitForResponse(r => r.url().includes('/api/sources/demo-page') && r.request().method() === 'POST', { timeout: 150000 });
        await click(staff, '#crawl-demo [data-demo-page="2"]', { after: 100 });
        await sleep(2500);
      });
      // The crawler agent reads the new page, Gemini rates the alert, Pond-Guard screens again: off camera
      await published;
      let ripple = null;
      try {
        ripple = await waitFor('the re-screen', async () => { const a = await api('GET', '/api/alerts?limit=20', undefined, OFFICER); return a.alerts.find(x => x.agent === 'Ripples' && x.id === 'aurora' && /^done/.test(x.rescreen || '')); }, { timeout: 150000, every: 3000 });
      } catch (e) { /* retake */ }
      const src = await crawlState();
      good = Boolean(ripple) && src.extractor === 'agent' && (take === 3 || !/offline/.test(ripple.rescreen));
      console.log(`   take ${take}: crawler ${src.extractor}, page "${src.resultLabel}", ripple ${ripple ? ripple.severity + ', ' + ripple.rescreen : 'none'}${good ? '' : ' (retaking)'}`);
    }
    if (!good) throw new Error('The changed page did not lead to a ripple and a re-screen in three takes');
    await staff.reload(); await showView(staff, 'sources'); await staff.locator('#crawler-card').scrollIntoViewIfNeeded(); await sleep(1500);
    await rec.clip(staff, 'ripple-and-rescreen', async () => {
      await moveTo(staff, staff.locator('#crawl-list .crawl-row').first());
      await sleep(2500);
      await click(staff, '#bell, #bell-btn, [aria-label="Alerts"]', { after: 300 }).catch(() => {});
      await staff.locator('#alerts-list .alert-item').first().waitFor({ timeout: 10000 });
      await moveTo(staff, staff.locator('#alerts-list .alert-item', { hasText: 'Ripples' }).first());
      await sleep(6000);
    });
  },

  // 6. Dilly learns from the officers
  9: async ({ rec, staff }) => {
    await ensureLearning();
    await showBigQueryMl(staff);
    await signIn(staff, 'officer');
    await showView(staff, 'reviews');
    const halcyon = staff.locator('#cases tr[data-id="halcyon"]');
    await halcyon.waitFor({ timeout: 20000 });
    await sleep(900);
    await rec.clip(staff, 'reviews-likely-miss', async () => {
      await sleep(1500);
      await moveTo(staff, staff.locator('#cases thead th').nth(6));
      await sleep(1800);
      await moveTo(staff, halcyon.locator('.ml-flag'));
      await sleep(3200);
      await click(staff, halcyon.locator('.ml-btn.red'));
      await sleep(3000);
    });
    await rec.clip(staff, 'dilly-learns-bigquery-ml', async () => {
      await click(staff, '#rev-tabs button[data-pane="learning"]');
      await sleep(1800);
      await moveTo(staff, staff.locator('#learn-body .card').nth(1).locator('.pill'));
      await sleep(1800);
      await moveTo(staff, staff.locator('#learn-body .trial-t tr.best'));
      await sleep(2600);
      await moveTo(staff, staff.locator('#learn-body .card').nth(2).locator('dd').nth(1));
      await sleep(2600);
      await moveTo(staff, staff.locator('#learn-body .card').nth(3).locator('.sugg').first());
      await sleep(3000);
    });
    await rec.clip(staff, 'risk-confidence-prediction', async () => {
      await staff.locator('#rev-tabs').scrollIntoViewIfNeeded();
      await click(staff, '#rev-tabs button[data-pane="matrix"]');
      await sleep(1500);
      await moveTo(staff, '#matrix .mx-ring');
      await sleep(3000);
      await moveTo(staff, '#mx-ml-hint');
      await sleep(4500);
    });
  },

  // 7. Close: back to the globe with Dilly
  10: async ({ rec, staff }) => {
    await signIn(staff, 'officer');
    await staff.goto(BASE + '/');
    await rec.clip(staff, 'close-globe', async () => {
      await sleep(4200);
      await click(staff, staff.locator('#mode-seg button').first(), { steps: 8 });
      await sleep(4200);
    });
  }
};

async function main() {
  const wanted = process.argv.slice(2).filter(a => /^\d+$/.test(a)).map(Number);
  const order = Object.keys(scenes).map(Number).sort((a, b) => a - b).filter(n => !wanted.length || wanted.includes(n));
  if (!wanted.length) fs.rmSync(OUT, { recursive: true, force: true });
  const rec = new Recorder(OUT);
  // A partial run continues the numbering from --from=N (the last clip to keep), or uses its own range
  const from = (process.argv.find(a => a.startsWith('--from=')) || '').split('=')[1];
  if (wanted.length) rec.n = from ? Number(from) : (Math.min(...wanted) - 1) * 10;
  const browser = await chromium.launch();
  const staffContext = await newContext(browser);
  const staff = await staffContext.newPage();
  staff.on('pageerror', e => console.log('   page error:', e.message));
  const supplierContext = await newContext(browser); // a clean browser profile: the counterparty has no account
  const supplier = await supplierContext.newPage();
  supplier.on('pageerror', e => console.log('   page error (supplier):', e.message));
  const prepared = {};
  let failed = null;
  for (const n of order) {
    console.log(`Scene ${n}`);
    try { await scenes[n]({ rec, staff, supplier, prepared }); prepared[n] = true; }
    catch (err) { failed = { scene: n, message: err.message.split('\n')[0] }; console.log(`   Scene ${n} failed: ${failed.message}`); await staff.screenshot({ path: path.join(__dirname, '.data', `failed-scene-${n}.png`) }).catch(() => {}); break; }
  }
  rec.writeIndex({ failed });
  await browser.close();
  const total = rec.clips.reduce((s, c) => s + c.seconds, 0);
  console.log(`\n${rec.clips.length} clips, ${Math.round(total)} seconds in all, ${rec.clips.filter(c => c.tooLong).length} over 20 seconds.`);
  if (failed) process.exitCode = 1;
}

module.exports = { scenes, api, state, saveState, ensureRequest, ensureSent, ensureSubmitted, ensureLearning, showBigQueryMl, signIn, showView, waitFor, BASE, CASE, DDQ_DOCUMENT, OFFICER, EMPLOYEE };
if (require.main === module) main();
