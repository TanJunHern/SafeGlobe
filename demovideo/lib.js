/**
 * Helpers for record.js: numbered clips, a visible pointer, human-paced clicks and typing.
 * A clip is only recorded while something is happening on screen. Waiting (an agent thinking, a document being
 * read) happens between clips, so no clip is longer than about 20 seconds.
 */
const fs = require('fs');
const path = require('path');

const SIZE = { width: 1920, height: 1080 };
const MAX_CLIP_SECONDS = 20;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Drawn inside the page, because a screen recording of a headless browser has no mouse pointer of its own
const POINTER = `(() => {
  if (window.__ddPointer) return;
  try { for (const id of ['employee-portal', 'ddq-portal', 'compliance-workspace']) localStorage.setItem('duedilly.tour.' + id, 'done'); } catch (e) {}
  const make = () => {
    if (!document.body || document.getElementById('__dd_pointer')) return;
    const p = document.createElement('div');
    p.id = '__dd_pointer';
    p.style.cssText = 'position:fixed;left:0;top:0;width:28px;height:28px;z-index:2147483647;pointer-events:none;transform:translate(-200px,-200px);transition:transform 40ms linear';
    p.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24"><path d="M4 2l15 9.5-6.6 1.6L16 20l-3 1.4-3.5-6.8L5 19z" fill="#14202b" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.body.appendChild(p);
    const move = e => { p.style.transform = 'translate(' + (e.clientX - 3) + 'px,' + (e.clientY - 2) + 'px)'; };
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mousedown', e => {
      const r = document.createElement('div');
      r.style.cssText = 'position:fixed;left:' + (e.clientX - 22) + 'px;top:' + (e.clientY - 22) + 'px;width:44px;height:44px;border-radius:50%;border:3px solid #e0a42a;background:rgba(224,164,42,.25);z-index:2147483646;pointer-events:none;transition:transform .45s ease-out,opacity .45s ease-out';
      document.body.appendChild(r);
      requestAnimationFrame(() => { r.style.transform = 'scale(1.9)'; r.style.opacity = '0'; });
      setTimeout(() => r.remove(), 500);
    }, true);
  };
  window.__ddPointer = true;
  if (document.body) make(); else document.addEventListener('DOMContentLoaded', make);
  document.addEventListener('readystatechange', make);
})();`;

class Recorder {
  constructor(outDir) {
    this.outDir = outDir;
    this.n = 0;
    this.clips = [];
    fs.mkdirSync(outDir, { recursive: true });
    fs.mkdirSync(path.join(outDir, '..', '.data', 'shots'), { recursive: true });
  }

  /** Records one numbered clip while fn runs. */
  async clip(page, name, fn) {
    this.n += 1;
    const file = `${String(this.n).padStart(2, '0')}-${name}.webm`;
    const target = path.join(this.outDir, file);
    await page.bringToFront().catch(() => {});
    await page.screencast.start({ path: target, size: SIZE, quality: 90 });
    const started = Date.now();
    let error = null, stopped = false;
    const stop = async () => {
      if (stopped) return;
      stopped = true;
      // A still of the last frame, for checking a take without playing the video
      await page.screenshot({ path: path.join(this.outDir, '..', '.data', 'shots', file.replace('.webm', '.png')) }).catch(() => {});
      await page.screencast.stop();
    };
    // No clip runs past the limit: if the action is still going, the recording stops and the action finishes off camera
    const cap = setTimeout(() => { stop().catch(() => {}); }, (MAX_CLIP_SECONDS - 0.3) * 1000);
    try { await fn(); } catch (err) { error = err; }
    clearTimeout(cap);
    const capped = stopped;
    if (!stopped) await sleep(400); // let the last frame land
    const filmed = Math.round((Date.now() - started) / 100) / 10; // saving the file afterwards takes a second or two and is not on the video
    if (!stopped) await stop();
    const seconds = capped ? MAX_CLIP_SECONDS - 0.3 : filmed;
    const bytes = fs.existsSync(target) ? fs.statSync(target).size : 0;
    this.clips.push({ file, seconds, kb: Math.round(bytes / 1024), tooLong: seconds > MAX_CLIP_SECONDS, cutAtLimit: capped, error: error ? error.message.split('\n')[0] : null });
    console.log(`${capped ? 'CUT  ' : '     '}${file}  ${seconds}s  ${Math.round(bytes / 1024)} KB${error ? '  ERROR: ' + error.message.split('\n')[0] : ''}`);
    if (error) throw error;
  }

  writeIndex(extra = {}) {
    fs.writeFileSync(path.join(this.outDir, 'clips.json'), JSON.stringify(Object.assign({ recordedAt: new Date().toISOString(), size: SIZE, clips: this.clips }, extra), null, 2));
  }
}

async function newContext(browser) {
  const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, reducedMotion: 'no-preference', locale: 'en-GB', timezoneId: 'Asia/Singapore' });
  await context.addInitScript(POINTER);
  return context;
}

/** Moves the pointer to the middle of an element, the way a hand would. */
async function moveTo(page, locator, { steps = 16, settle = 140 } = {}) {
  const el = typeof locator === 'string' ? page.locator(locator).first() : locator;
  await el.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
  const box = await el.boundingBox();
  if (!box) throw new Error('Element is not on screen: ' + locator);
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 300), { steps });
  await sleep(settle);
  return el;
}

async function click(page, locator, opts = {}) {
  const el = await moveTo(page, locator, opts);
  // The pointer is already there; the element itself is clicked, so a page that re-draws under the pointer cannot make the click miss
  // (if the element is partly covered, as a table cell under a sticky header can be, the pointer clicks where it is)
  await el.click({ delay: 70, timeout: 2500 }).catch(async () => { await page.mouse.down(); await sleep(70); await page.mouse.up(); });
  await sleep(opts.after === undefined ? 300 : opts.after);
  return el;
}

/** Types into a field at a readable pace. Long text is typed faster. */
async function type(page, locator, text) {
  const el = await click(page, locator, { after: 100 });
  await el.fill('');
  await el.pressSequentially(text, { delay: text.length > 40 ? 5 : 16 });
  await sleep(150);
}

/** Scrolls a scrollable element (or the page) smoothly, so the eye can follow. */
async function scrollBy(page, locator, pixels, { ms = 900 } = {}) {
  const el = typeof locator === 'string' ? page.locator(locator).first() : locator;
  const stepCount = Math.max(1, Math.round(ms / 40));
  for (let i = 0; i < stepCount; i++) {
    await el.evaluate((node, dy) => { (node === document.body ? document.scrollingElement : node).scrollBy(0, dy); }, pixels / stepCount);
    await sleep(40);
  }
}

module.exports = { Recorder, newContext, moveTo, click, type, scrollBy, sleep, SIZE, MAX_CLIP_SECONDS };
