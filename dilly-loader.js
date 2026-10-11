/* DillyLoader: Dilly's loading, error and result states.
   - createLoadTimer  timing rules, no DOM (unit tested with fake timers)
   - poseForRoute     case route -> result pose
   - run              shows the loader over or inside a region while a real request runs
   Loaded as a plain <script> in the browser (window.DillyLoader) and with require() in Node.
   The SVGs animate themselves and stop when the user has reduced motion turned on. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DillyLoader = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SHOW_AFTER_MS = 300;    // faster requests never flash a loader
  const MIN_VISIBLE_MS = 600;   // once shown, stay long enough to read
  const SLOW_AFTER_MS = 8000;   // then say it is taking longer than usual
  const MASCOT = '/assets/mascot/';

  const TASKS = {
    document: { image: 'dilly_reading.svg', text: 'Dilly is reading the document' },
    screen: { image: 'dilly_loading.svg', text: 'Dilly is screening' },
    policy: { image: 'dilly_loading.svg', text: 'Dilly is checking the policies' },
    source: { image: 'dilly_loading.svg', text: 'Dilly is reading the source' }
  };
  const SLOW_TEXT = 'This is taking longer than usual.';

  /**
   * Timing only. hooks: { onShow, onSlow, onHide }. clock: { setTimeout, clearTimeout, now }.
   * start()      begin timing a request
   * finish(done) the request settled; `done` runs once the loader may be removed
   */
  function createLoadTimer(hooks, clock) {
    const h = hooks || {};
    const c = clock || { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id), now: () => Date.now() };
    let shown = false, shownAt = 0, finished = false, showTimer = null, slowTimer = null, hideTimer = null;
    return {
      start() {
        showTimer = c.setTimeout(() => { shown = true; shownAt = c.now(); if (h.onShow) h.onShow(); }, SHOW_AFTER_MS);
        slowTimer = c.setTimeout(() => { if (!finished && h.onSlow) h.onSlow(); }, SLOW_AFTER_MS);
      },
      finish(done) {
        if (finished) return;
        finished = true;
        c.clearTimeout(showTimer);
        c.clearTimeout(slowTimer);
        const end = () => { if (shown && h.onHide) h.onHide(); if (done) done(); };
        const wait = shown ? MIN_VISIBLE_MS - (c.now() - shownAt) : 0;
        if (wait > 0) hideTimer = c.setTimeout(end, wait);
        else end();
      },
      cancel() {
        finished = true;
        [showTimer, slowTimer, hideTimer].forEach(t => c.clearTimeout(t));
      },
      get shown() { return shown; }
    };
  }

  /**
   * Result pose for a case route, or null when Dilly must not be shown.
   * route: 'monitor' (Auto-clear), 'investigate', 'escalate', 'gaps' (Fill the gaps) or nothing.
   * sanctionsMatch: true only when the escalation is caused by a sanctions list match.
   * dilly_medium and dilly_sanctions are risk results; a system error uses dilly_error instead.
   */
  function poseForRoute(route, sanctionsMatch) {
    const r = String(route || '').toLowerCase().replace(/[\s_]+/g, '-');
    if (r === 'monitor' || r === 'auto-clear' || r === 'clear' || r === 'auto-cleared') return 'dilly_done.svg';
    if (r === 'investigate') return 'dilly_medium.svg';
    if (r === 'escalate') return sanctionsMatch ? 'dilly_sanctions.svg' : 'dilly_medium.svg';
    return null;
  }

  function poseImg(route, sanctionsMatch, size) {
    const file = poseForRoute(route, sanctionsMatch);
    const px = size || 56;
    return file ? `<img class="dilly-pose" src="${MASCOT}${file}" width="${px}" height="${px}" alt="">` : '';
  }

  /* ---------- DOM (browser only) ---------- */
  const CSS = `
.dl-box{display:flex;align-items:center;gap:12px;color:var(--fg-3,#6B6573);font:13px/1.4 var(--f-body,system-ui,sans-serif)}
.dl-box img{flex:none}
.dl-lines{display:flex;flex-direction:column;gap:2px;text-align:left}
.dl-dots{display:inline-block;overflow:hidden;vertical-align:bottom;white-space:nowrap;width:0;animation:dl-dots 1.2s steps(4,jump-none) infinite}
@keyframes dl-dots{from{width:0}to{width:3ch}}
.dl-slow{font-size:12px}
.dl-overlay{position:absolute;left:0;top:0;right:0;z-index:20;display:flex;justify-content:center;background:color-mix(in srgb,var(--surface,#FFFDF7) 85%,transparent)}
.dl-overlay .dl-box{position:sticky;top:0;flex-direction:column;justify-content:center;text-align:center;height:min(100%,320px);padding:24px}
.dl-overlay .dl-lines{text-align:center;align-items:center}
.dl-error{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:12px;border:1px solid var(--line-2,#D9CBA8);background:var(--surface,#FFFDF7);color:var(--fg,#2E2A33);font:13px/1.4 var(--f-body,system-ui,sans-serif);text-align:left}
.dl-error img{flex:none}
.dl-error span{flex:1}
.dl-retry{height:30px;padding:0 14px;border-radius:999px;border:1px solid var(--line-2,#D9CBA8);background:var(--surface,#FFFDF7);color:inherit;font:500 12.5px var(--f-body,system-ui,sans-serif);cursor:pointer;white-space:nowrap}
.dl-retry:hover{border-color:var(--accent,#1F6F6B);color:var(--accent,#1F6F6B)}
.dilly-pose{flex:none;display:block}
@media (prefers-reduced-motion: reduce){.dl-dots{animation:none;width:auto}}`;

  function ensureCss() {
    if (document.getElementById('dl-css')) return;
    const s = document.createElement('style');
    s.id = 'dl-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  function loaderEl(task, variant) {
    const t = TASKS[task] || TASKS.screen;
    const px = variant === 'overlay' ? 96 : 72;
    const box = document.createElement('div');
    box.className = 'dl-box';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    box.innerHTML = `<img src="${MASCOT}${t.image}" width="${px}" height="${px}" alt="">
      <div class="dl-lines"><span>${esc(t.text)}<span class="dl-dots" aria-hidden="true">...</span></span></div>`;
    if (variant !== 'overlay') return { node: box, box };
    const wrap = document.createElement('div');
    wrap.className = 'dl-overlay';
    wrap.appendChild(box);
    return { node: wrap, box };
  }

  /**
   * Runs `request` and shows Dilly while it is pending.
   * @param region  element being loaded (gets aria-busy; the overlay covers only this element)
   * @param opts    { task, variant: 'inline' | 'overlay', request: () => Promise, host, errorHost }
   *                host: where the inline loader goes (default: region)
   *                errorHost: where the error and "Try again" go (default: host)
   * @returns Promise of the request result. On failure it shows the error with "Try again" and
   *          stays pending until a retry succeeds, so callers only handle the success path.
   */
  function run(region, opts) {
    ensureCss();
    const o = opts || {};
    const variant = o.variant === 'overlay' ? 'overlay' : 'inline';
    const host = o.host || region;
    const errorHost = o.errorHost || host;

    return new Promise(resolve => {
      const attempt = () => {
        [host, errorHost, region].forEach(n => n.querySelectorAll(':scope > .dl-box, :scope > .dl-overlay, :scope > .dl-error').forEach(x => x.remove()));
        const { node, box } = loaderEl(o.task, variant);
        region.setAttribute('aria-busy', 'true');
        const timer = createLoadTimer({
          onShow() {
            if (variant === 'overlay') {
              if (getComputedStyle(region).position === 'static') region.style.position = 'relative';
              node.style.height = `${region.scrollHeight}px`;
              region.appendChild(node);
            } else {
              host.appendChild(node);
            }
          },
          onSlow() {
            const line = document.createElement('span');
            line.className = 'dl-slow';
            line.textContent = SLOW_TEXT;
            box.querySelector('.dl-lines').appendChild(line);
          },
          onHide() { node.remove(); }
        });
        timer.start();
        const settle = after => timer.finish(() => { region.removeAttribute('aria-busy'); after(); });
        Promise.resolve().then(o.request).then(
          result => settle(() => resolve(result)),
          err => settle(() => {
            const el = document.createElement('div');
            el.className = 'dl-error';
            el.setAttribute('role', 'alert');
            el.innerHTML = `<img src="${MASCOT}dilly_error.svg" width="56" height="56" alt=""><span>${esc((err && err.message) || 'Something went wrong.')}</span><button type="button" class="dl-retry">Try again</button>`;
            el.querySelector('.dl-retry').addEventListener('click', attempt);
            errorHost.appendChild(el);
            if (typeof o.onError === 'function') o.onError(err);
          })
        );
      };
      attempt();
    });
  }

  return { createLoadTimer, poseForRoute, poseImg, run, TASKS, SLOW_TEXT, SHOW_AFTER_MS, MIN_VISIBLE_MS, SLOW_AFTER_MS };
});
