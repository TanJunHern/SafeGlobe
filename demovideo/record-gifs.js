/**
 * Records the ten pitch-deck GIFs as short .webm clips (1920x1080, no sound). A GIF is made of one to three clips;
 * waiting (Gemini reading a document, the agents screening) happens between clips, off camera.
 *
 *   node demovideo/record-gifs.js            every scene, into demovideo/.data/gif-clips/
 *   node demovideo/record-gifs.js 7 9        only scenes 7 and 9 (each prepares what it needs off camera)
 *   BASE=http://localhost:8197 ...           the app to record (default 8197: not a port the tests or npm start use)
 *
 * Nothing is replayed or injected: what the app returns is what is filmed. With the UAT settings Gemini on
 * Vertex AI and the ADK agents are live; the review model is the app's own (labelled "Offline model").
 * The supplier, Pelican Quay Marine Supplies Pte Ltd, and its documents are fictional (docs/test-docs/pelican-quay-*).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const { Recorder, newContext, moveTo, click, type, scrollBy, sleep } = require('./lib');

const BASE = process.env.BASE || 'http://localhost:8197';
const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, '.data', 'gif-clips');
const STATE_FILE = path.join(__dirname, '.data', 'gif-state.json');
const OFFICER = 'compliance@duedilly.com';
const NAME = 'Pelican Quay';
const INTAKE_PDF = path.join(ROOT, 'docs', 'test-docs', 'pelican-quay-intake.pdf');
const DDQ_PDF = path.join(ROOT, 'docs', 'test-docs', 'pelican-quay-ddq.pdf');
const QUESTION = 'Who counts as a beneficial owner in question 2.8?';

const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {};
const saveState = () => { fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); };

async function api(method, route, body, email = OFFICER) {
  const res = await fetch(BASE + route, { method, headers: { 'Content-Type': 'application/json', 'x-user-email': email }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${route} answered ${res.status}: ${data.message || data.error || ''}`);
  return data;
}
const waitFor = async (what, check, { every = 500, timeout = 180000 } = {}) => {
  const end = Date.now() + timeout;
  for (;;) { const v = await check(); if (v) return v; if (Date.now() > end) throw new Error('Timed out waiting for ' + what); await sleep(every); }
};
/** The Pelican Quay request, as the officer sees it. */
async function findRequest() {
  const list = await api('GET', '/api/kyc');
  const rows = list.requests || list.records || list;
  const r = rows.find(x => (x.counterparty_name || '').includes(NAME));
  if (!r) return null;
  const full = await api('GET', '/api/kyc/' + r.id);
  return full.request || full;
}
async function remember() {
  const r = await waitFor('the Pelican Quay request', findRequest, { timeout: 30000 });
  Object.assign(state, { kycId: r.id, token: r.ddq_link ? r.ddq_link.split('token=')[1] : null, status: r.request_status, ddq: r.ddq_status });
  saveState();
  return r;
}

async function signOut(page) {
  await page.context().clearCookies();
  await page.goto(BASE + '/about-bot');
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
}
async function signIn(page, who) {
  await signOut(page);
  await page.goto(BASE + '/login');
  await page.locator(who === 'employee' ? '#login-persona-emp' : '#login-persona-comp').click();
  await page.waitForURL(who === 'employee' ? '**/portal/employee' : '**/portal/compliance');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => { for (const b of document.querySelectorAll('button')) if (b.textContent.trim() === 'Skip tour') b.click(); });
}
const showView = async (page, view) => { await click(page, `.rail button[data-view="${view}"]`); await sleep(900); };
const portal = page => page.goto(`${BASE}/ddq/portal?token=${state.token}`);

const scenes = {
  // GIF 1. Landing page, in as the employee
  1: async ({ rec, staff }) => {
    await signOut(staff);
    await staff.goto(BASE + '/login');
    await staff.locator('#login-persona-emp').waitFor();
    await sleep(1500);
    await rec.clip(staff, 'g01-landing-employee', async () => {
      await sleep(2600); // the sign-in globe turns
      await moveTo(staff, '#login-persona-comp', { steps: 18 });
      await sleep(600);
      await click(staff, '#login-persona-emp', { after: 200 });
      await staff.waitForURL('**/portal/employee');
      await staff.waitForLoadState('networkidle').catch(() => {});
      await staff.evaluate(() => { for (const b of document.querySelectorAll('button')) if (b.textContent.trim() === 'Skip tour') b.click(); });
      await sleep(2500);
    });
  },

  // GIF 2. The employee uploads the intake form, Dilly fills it in, the request is screened and the DDQ is sent
  2: async ({ rec, staff }) => {
    if (await findRequest()) throw new Error('Pelican Quay already exists: start from a fresh demo database');
    await signIn(staff, 'employee');
    await sleep(800);
    await rec.clip(staff, 'g02a-upload-intake', async () => {
      await click(staff, '#emp-new-request-btn');
      await sleep(900);
      await moveTo(staff, '#kyc-dropzone', { steps: 18 });
      await sleep(500);
      await staff.locator('#kyc-doc-file').setInputFiles(INTAKE_PDF);
      await sleep(2400); // "Dilly is reading the document"
    });
    await waitFor('the form to fill in', () => staff.locator('#kyc-name').inputValue().then(v => v.includes('Pelican')), { timeout: 90000 });
    await sleep(1500);
    await rec.clip(staff, 'g02b-form-filled', async () => {
      await moveTo(staff, '#kyc-name'); await sleep(1100);
      await moveTo(staff, '#kyc-country'); await sleep(900);
      await moveTo(staff, '#kyc-contract-val'); await sleep(900);
      if (!(await staff.locator('#kyc-cp-email').inputValue())) await type(staff, '#kyc-cp-email', 'compliance@pelicanquay.example');
      await click(staff, '#kyc-landmark-chips .landmark-chip[data-id="sg_jurong"]');
      await sleep(600);
      await click(staff, '#kyc-submit-btn', { after: 200 });
      const row = staff.locator('#kyc-table-body tr', { hasText: NAME }).first();
      await row.waitFor({ timeout: 30000 });
      await sleep(1200);
      await moveTo(staff, row);
      await sleep(1800);
    });
    await remember();
    await rec.clip(staff, 'g02c-send-ddq', async () => {
      const row = staff.locator('#kyc-table-body tr', { hasText: NAME }).first();
      await click(staff, row.locator('td').nth(2));
      await staff.locator('#kyc-audit-modal [data-ddq-act="send"]').waitFor({ timeout: 15000 });
      await sleep(1600);
      await scrollBy(staff, '#kyc-audit-modal .sheet-body', 260, { ms: 800 });
      await sleep(1200);
      await click(staff, '#kyc-audit-modal [data-ddq-act="send"]', { after: 200 });
      await sleep(2600); // the paper plane, then the toast
    });
    await remember();
  },

  // GIF 3. The counterparty opens the one-time link and asks Dilly
  3: async ({ rec, supplier }) => {
    if (!state.token) await remember();
    await portal(supplier);
    await supplier.locator('#guide-fab').waitFor({ timeout: 20000 });
    await sleep(1200);
    let before = 0;
    await rec.clip(supplier, 'g03a-ask-dilly', async () => {
      await sleep(1200);
      await click(supplier, '.duckling[data-goto="2"]');
      await sleep(1000);
      await click(supplier, '#guide-fab');
      await supplier.locator('#guide').waitFor({ state: 'visible' });
      await sleep(700);
      before = await supplier.locator('#guide-log > *').count();
      await type(supplier, '#guide-text', QUESTION);
      await supplier.keyboard.press('Enter');
      await sleep(2200);
    });
    await waitFor('Dilly to answer', () => supplier.locator('#guide-log > *').count().then(n => n >= before + 2), { timeout: 90000 });
    await sleep(1500);
    await rec.clip(supplier, 'g03b-dilly-answers', async () => {
      await moveTo(supplier, supplier.locator('#guide-log > *').last(), { steps: 14 });
      await sleep(5200);
    });
  },

  // GIF 4. The counterparty uploads the completed DDQ, Dilly fills it in, it is signed and submitted
  4: async ({ rec, supplier }) => {
    if (!state.token) await remember();
    await portal(supplier);
    await supplier.locator('#prefill-btn').waitFor({ timeout: 20000 });
    await supplier.evaluate(() => { const g = document.getElementById('guide'); if (g && !g.hidden) document.getElementById('guide-close').click(); });
    await sleep(1000);
    let answered = null;
    await rec.clip(supplier, 'g04a-upload-ddq', async () => {
      await sleep(900);
      answered = supplier.waitForResponse(r => r.url().includes('/api/ddq/prefill'), { timeout: 180000 });
      const chooser = supplier.waitForEvent('filechooser');
      await click(supplier, '#prefill-btn', { after: 100 });
      await (await chooser).setFiles(DDQ_PDF);
      await sleep(2600); // "Dilly is reading the document"
    });
    await answered;
    await sleep(2500);
    await rec.clip(supplier, 'g04b-answers-filled', async () => {
      await sleep(1500);
      await click(supplier, '.duckling[data-goto="1"]');
      await sleep(1200);
      await moveTo(supplier, supplier.locator('.ai-note').first());
      await sleep(1200);
      await scrollBy(supplier, 'body', 420, { ms: 1200 });
      await sleep(800);
      await scrollBy(supplier, 'body', -420, { ms: 500 });
      const all = supplier.locator('#confirm-all');
      if (await all.count()) { await click(supplier, all); await sleep(1400); }
    });
    // Off camera: the remaining sections' suggestions are confirmed, and the declaration is ticked and named
    for (let s = 2; s <= 7; s++) {
      await supplier.locator(`.duckling[data-goto="${s}"]`).click();
      await sleep(500);
      const all = supplier.locator('#confirm-all');
      if (await all.count()) { await all.click(); await sleep(500); }
    }
    await supplier.locator('#next-btn').click().catch(() => {});
    for (let i = 0; i < 4 && !(await supplier.locator('#decl-agree').count()); i++) { await supplier.locator('#next-btn').click().catch(() => {}); await sleep(600); }
    await supplier.locator('#decl-agree').check();
    await supplier.locator('[data-decl="full_name"]').fill('Rachel Ong Li Ting');
    await supplier.locator('[data-decl="job_title"]').fill('Managing Director');
    await sleep(800);
    await rec.clip(supplier, 'g04c-sign-submit', async () => {
      // The signature is drawn on camera
      // Centred first: the portal's fixed bottom bar covers the lowest part of the screen
      await supplier.locator('#sig').evaluate(el => el.scrollIntoView({ block: 'center' }));
      await sleep(500);
      const b = await supplier.locator('#sig').boundingBox();
      const x0 = b.x + b.width * 0.18, y0 = b.y + b.height * 0.55;
      await supplier.mouse.move(x0, y0, { steps: 10 });
      await supplier.mouse.down();
      for (let i = 0; i <= 40; i++) await supplier.mouse.move(x0 + i * b.width * 0.015, y0 - Math.sin(i / 3) * b.height * 0.22, { steps: 2 });
      await supplier.mouse.up();
      await sleep(700);
      await click(supplier, '#next-btn');
      await sleep(1500);
      await moveTo(supplier, '.duck-line, #duck-row', { steps: 14 });
      await sleep(900);
      await click(supplier, '#submit-btn', { after: 200 });
      await sleep(3200); // mommy duck waddles in with the envelope
    });
  },

  // GIF 5. Compliance reviews the returned DDQ and approves
  5: async ({ rec, staff }) => {
    const r = await remember();
    if (!/submitted|review|returned/i.test(r.ddq_status || '')) console.log('   note: DDQ status is', r.ddq_status);
    await signIn(staff, 'officer');
    await showView(staff, 'compliance');
    const row = staff.locator('#comp-table-body tr', { hasText: NAME }).first();
    await row.waitFor({ timeout: 20000 });
    await sleep(800);
    await rec.clip(staff, 'g05a-review', async () => {
      await moveTo(staff, row);
      await sleep(900);
      await click(staff, row.locator('[data-triage="review"]'));
      await staff.locator('#comp-triage-modal').waitFor({ state: 'visible' });
      await sleep(2400);
      const verify = staff.locator('#triage-ddq-verify h3');
      if (await verify.count()) { await moveTo(staff, verify); await sleep(2000); }
      await moveTo(staff, '#triage-agent');
      await sleep(2200);
    });
    await rec.clip(staff, 'g05b-approve', async () => {
      await click(staff, '#triage-act-approve', { after: 200 });
      await sleep(2600); // the APPROVED stamp
      await moveTo(staff, staff.locator('#comp-table-body tr', { hasText: NAME }).first());
      await sleep(1800);
    });
  },

  // GIF 6. On the globe: the approved supplier is now monitored
  6: async ({ rec, staff }) => {
    await signIn(staff, 'officer');
    await staff.goto(BASE + '/');
    await sleep(7000); // the globe opens into the map
    await rec.clip(staff, 'g06-globe-new-supplier', async () => {
      const item = staff.locator('.w-item', { hasText: NAME }).first();
      await item.waitFor({ timeout: 15000 });
      await moveTo(staff, item, { steps: 18 });
      await sleep(900);
      await click(staff, item, { after: 200 });
      await sleep(4200); // the map flies to the pin and the drawer opens
      await moveTo(staff, '#dr-body', { steps: 12 });
      await sleep(1500);
    });
  },

  // GIF 7. Pond-Guard screens Aurora Venture in the big popup. The agents are live, so a run can come back with a
  // finding fewer (an agent that drops its connection). The demo findings are put back and the screening is run
  // again, at most three times; every take is a real live run and the one kept is the first full one.
  7: async ({ rec, staff }) => {
    // The reset must only touch the recording database, never data/safe_globe.db
    if (!process.env.GIF_DB) throw new Error('Set GIF_DB to the recording database (the DATABASE_PATH of the app on 8197)');
    const first = rec.n;
    for (let take = 1; take <= 3; take++) {
      rec.n = first; rec.clips = rec.clips.filter(c => !/-g07/.test(c.file));
      for (const f of fs.readdirSync(OUT)) if (f.includes('-g07')) fs.rmSync(path.join(OUT, f));
      execFileSync('node', [path.join(__dirname, 'reset-demo-findings.js')], { cwd: ROOT, env: Object.assign({}, process.env, { APP_ENV: 'uat', DATABASE_PATH: process.env.GIF_DB }), stdio: 'ignore' });
      await signIn(staff, 'officer');
      await staff.goto(BASE + '/');
      await sleep(7000);
      await rec.clip(staff, 'g07a-pond-guard-starts', async () => {
        await click(staff, '.w-item[data-id="aurora"]', { after: 200 });
        await sleep(2200);
        await click(staff, '#dr-body [data-pg="screen"]', { after: 200 });
        await staff.locator('#bigview').waitFor({ state: 'visible' });
        await sleep(6000); // packets go out, rings spin
      });
      // Off camera until every agent has answered, so the score is filmed as it lands
      await waitFor('all six agents', () => staff.locator('#pgb-line').innerText().then(t => /6 of 6|Adding|Writing|Done/.test(t)).catch(() => false), { timeout: 240000, every: 200 });
      await rec.clip(staff, 'g07b-score-lands', async () => {
        await waitFor('the score', () => staff.locator('#pgb-res [data-count]').count(), { timeout: 15000, every: 200 }).catch(() => {});
        await sleep(4200); // findings travel to the ring, the number counts up, the route and Dilly's pose arrive
        await moveTo(staff, '#pgb-res', { steps: 12 });
        await sleep(1500);
      });
      await waitFor('the run to finish', () => staff.locator('#pgb-line').innerText().then(t => t.startsWith('Done')), { timeout: 120000 }).catch(() => {});
      const score = await staff.locator('#pgb-res [data-count]').getAttribute('data-count').catch(() => null);
      console.log(`   take ${take}: score ${score}`);
      await rec.clip(staff, 'g07c-read-review', async () => {
        await scrollBy(staff, '#bv-body', 520, { ms: 1600 });
        await sleep(2200);
        await scrollBy(staff, '#bv-body', 520, { ms: 1600 });
        await sleep(2600);
      });
      if (score === '85') return;
    }
    console.log('   no take reached 85; the last take is kept as it is');
  },

  // GIF 8. Reviews: the case queue, then each tab in turn
  8: async ({ rec, staff }) => {
    await signIn(staff, 'officer');
    await staff.goto(BASE + '/');
    await sleep(5000);
    await rec.clip(staff, 'g08-reviews-tabs', async () => {
      await showView(staff, 'reviews');
      await sleep(1400);
      for (const pane of ['queue', 'matrix', 'calibration', 'rules', 'monitoring']) {
        await click(staff, `#rev-tabs button[data-pane="${pane}"]`, { after: 200 });
        await sleep(2300);
      }
    });
  },

  // GIF 9. Dilly learns: train, the stages, the predictions, one case
  9: async ({ rec, staff }) => {
    await signIn(staff, 'officer');
    await staff.goto(BASE + '/');
    await sleep(5000);
    await showView(staff, 'reviews');
    await click(staff, '#rev-tabs button[data-pane="learning"]');
    await sleep(1200);
    // Off camera: the synthetic demo reviews the model learns from (labelled as synthetic on screen)
    const syn = staff.locator('[data-learn="synthetic"]');
    if (await syn.count()) { await syn.click(); await staff.locator('[data-learn="train"]:not([disabled])').waitFor({ timeout: 30000 }); await sleep(1200); }
    await rec.clip(staff, 'g09a-train', async () => {
      await moveTo(staff, '#learn-body', { steps: 10 });
      await sleep(900);
      await click(staff, '[data-learn="train"]', { after: 200 });
      await staff.locator('#bigview').waitFor({ state: 'visible' });
      await waitFor('the stages', () => staff.locator('[data-bv-ml="refresh-view"]').count(), { timeout: 60000, every: 250 });
      await sleep(3200);
    });
    await rec.clip(staff, 'g09b-predictions', async () => {
      await click(staff, '[data-bv-ml="refresh-view"]', { after: 200 });
      await sleep(2600);
      await click(staff, staff.locator('#bv-body .mlb-card').first(), { after: 200 });
      await sleep(4200);
    });
  },

  // GIF 10. Sources: connect a fictional third-party API
  10: async ({ rec, staff }) => {
    await signIn(staff, 'officer');
    await staff.goto(BASE + '/');
    await sleep(5000);
    await showView(staff, 'governance');
    await rec.clip(staff, 'g10a-add-source', async () => {
      await click(staff, '#gov-tab-seg button[data-gov-tab="sources"]');
      await sleep(1400);
      await click(staff, '#add-src');
      await sleep(900);
      await click(staff, '#src-body .conn-types button[data-type="API"]');
      await sleep(500);
      await click(staff, '#src-foot [data-next]');
      await sleep(700);
      await type(staff, '#src-label', 'Harbourline KYC API (fictional demo)');
      await type(staff, '#src-url', 'https://api.harbourline-kyc.example/v1/screen');
      const key = staff.locator('#src-key');
      if (await key.count()) await type(staff, '#src-key', 'demo-key-0000');
      await sleep(600);
    });
    await rec.clip(staff, 'g10b-test-save', async () => {
      await click(staff, '#src-foot [data-next]');
      await staff.locator('#src-foot [data-save]:not([disabled])').waitFor({ timeout: 15000 });
      await sleep(1200);
      await click(staff, '#src-foot [data-save]', { after: 300 });
      await sleep(1500);
      const card = staff.locator('.src-grid > *', { hasText: 'Harbourline' }).first();
      if (await card.count()) { await moveTo(staff, card); await sleep(2200); }
    });
  }
};

async function main() {
  const only = process.argv.slice(2).map(Number).filter(Boolean);
  const list = only.length ? only : Object.keys(scenes).map(Number);
  const browser = await chromium.launch();
  const staffCtx = await newContext(browser), supplierCtx = await newContext(browser);
  const staff = await staffCtx.newPage(), supplier = await supplierCtx.newPage();
  const rec = new Recorder(OUT);
  try {
    for (const n of list) {
      // A retake replaces the scene's earlier clips, so make-gifs.js never joins an old take into a GIF
      const tag = `-g${String(n).padStart(2, '0')}`;
      if (fs.existsSync(OUT)) for (const f of fs.readdirSync(OUT)) if (f.includes(tag) && f.endsWith('.webm')) fs.rmSync(path.join(OUT, f));
      console.log(`scene ${n}`);
      await scenes[n]({ rec, staff, supplier });
    }
  } finally {
    rec.writeIndex({ base: BASE });
    await browser.close();
  }
}
main().catch(err => { console.error(err); process.exit(1); });
