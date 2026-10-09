/* DuckTour: small pop-up guide. Dilly points at one thing on the page at a time and says what it is for.
   Used by the DDQ portal, the employee portal and the compliance workspace.

   DuckTour.start({ id, steps: [{ sel, title, text }], force })   runs once per browser unless force is true
   DuckTour.seen(id)                                              has this tour been finished or skipped?

   A step whose element is missing or hidden is skipped. A step without `sel` is shown centred. */
(function () {
  'use strict';
  const KEY = id => `duedilly.tour.${id}`;
  const store = {
    get(id) { try { return localStorage.getItem(KEY(id)); } catch (e) { return null; } },
    set(id) { try { localStorage.setItem(KEY(id), 'done'); } catch (e) {} }
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const CSS = `
.dt-hole{position:fixed;z-index:9998;border-radius:12px;box-shadow:0 0 0 9999px rgba(20,24,26,.48);pointer-events:none;transition:all .25s ease}
.dt-block{position:fixed;inset:0;z-index:9997}
.dt-card{position:fixed;z-index:9999;width:min(340px,calc(100vw - 24px));background:var(--surface,#FFFDF7);color:var(--fg,#2E2A33);border:1px solid var(--line-2,#D9CBA8);border-radius:14px;box-shadow:var(--shadow-lg,0 24px 60px rgba(0,0,0,.2));padding:14px 16px 12px;font:13px/1.5 var(--f-body,system-ui,sans-serif)}
.dt-head{display:flex;align-items:center;gap:10px;margin-bottom:6px}
.dt-head img{flex:none}
.dt-head b{font:600 16px/1.2 var(--f-display,system-ui,sans-serif)}
.dt-card p{margin:0 0 12px;color:var(--fg-2,#4A4552)}
.dt-foot{display:flex;align-items:center;gap:8px}
.dt-dots{display:flex;gap:4px;flex:1}
.dt-dots i{width:6px;height:6px;border-radius:50%;background:var(--line-2,#D9CBA8)}
.dt-dots i.on{background:var(--accent,#1F6F6B)}
.dt-btn{height:30px;padding:0 14px;border-radius:999px;border:1px solid var(--line-2,#D9CBA8);background:var(--surface,#FFFDF7);color:inherit;font:500 12.5px var(--f-body,system-ui,sans-serif);cursor:pointer}
.dt-btn.primary{background:var(--accent,#1F6F6B);border-color:var(--accent,#1F6F6B);color:var(--on-accent,#FFFDF7)}
.dt-btn.link{border-color:transparent;background:none;color:var(--fg-3,#6B6573);padding:0 6px}
.dt-btn:focus-visible{outline:2px solid var(--brand-orange,#EE8B3A);outline-offset:2px}
@media (prefers-reduced-motion: reduce){.dt-hole{transition:none}}
.dt-help{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 12px;border-radius:999px;border:1px solid var(--line-2,#D9CBA8);background:var(--surface,#FFFDF7);color:var(--fg-2,#4A4552);font:500 12.5px var(--f-body,system-ui,sans-serif);cursor:pointer;white-space:nowrap}
.dt-help:hover{border-color:var(--accent,#1F6F6B);color:var(--accent,#1F6F6B)}
.dt-help img{flex:none}`;

  let active = null;

  function ensureCss() {
    if (document.getElementById('dt-css')) return;
    const s = document.createElement('style');
    s.id = 'dt-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  const visible = el => Boolean(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');

  function stop(markDone) {
    if (!active) return;
    const a = active;
    active = null;
    [a.hole, a.block, a.card].forEach(n => n.remove());
    document.removeEventListener('keydown', a.onKey, true);
    window.removeEventListener('resize', a.place);
    window.removeEventListener('scroll', a.place, true);
    if (markDone) store.set(a.id);
    if (a.returnFocus && a.returnFocus.focus) a.returnFocus.focus();
    if (typeof a.onEnd === 'function') a.onEnd();
  }

  function start(opts) {
    const o = opts || {};
    if (!o.id || !Array.isArray(o.steps)) return false;
    if (!o.force && store.get(o.id)) return false;
    if (active) stop(false);
    ensureCss();

    const L = Object.assign({ next: 'Next', back: 'Back', done: 'Got it', skip: 'Skip tour' }, o.labels || {});
    const steps = o.steps.filter(s => !s.sel || visible(document.querySelector(s.sel)));
    if (!steps.length) return false;

    const hole = document.createElement('div'); hole.className = 'dt-hole';
    const block = document.createElement('div'); block.className = 'dt-block';
    const card = document.createElement('div'); card.className = 'dt-card';
    card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-live', 'polite');
    document.body.append(block, hole, card);

    let i = 0;
    function place() {
      const s = steps[i];
      const target = s.sel ? document.querySelector(s.sel) : null;
      const cw = card.offsetWidth, ch = card.offsetHeight, pad = 6, gap = 12;
      if (!target || !visible(target)) {
        Object.assign(hole.style, { left: '50%', top: '50%', width: '0px', height: '0px' });
        card.style.left = `${Math.max(12, (innerWidth - cw) / 2)}px`;
        card.style.top = `${Math.max(12, (innerHeight - ch) / 2)}px`;
        return;
      }
      const r = target.getBoundingClientRect();
      Object.assign(hole.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
      const below = r.bottom + gap + ch <= innerHeight - 8;
      const above = r.top - gap - ch >= 8;
      const top = below ? r.bottom + gap : above ? r.top - gap - ch : Math.max(8, innerHeight - ch - 8);
      const left = Math.min(Math.max(12, r.left + r.width / 2 - cw / 2), innerWidth - cw - 12);
      card.style.left = `${left}px`;
      card.style.top = `${top}px`;
    }
    function show() {
      const s = steps[i];
      const last = i === steps.length - 1;
      card.setAttribute('aria-label', s.title || 'Guide');
      card.innerHTML = `<div class="dt-head"><img src="/assets/mascot/dilly_v3_three_quarter.svg" width="40" height="40" alt=""><b>${esc(s.title)}</b></div>
        <p>${esc(s.text)}</p>
        <div class="dt-foot"><span class="dt-dots" aria-hidden="true">${steps.map((_, n) => `<i class="${n === i ? 'on' : ''}"></i>`).join('')}</span>
          ${last ? '' : `<button class="dt-btn link" type="button" data-dt="skip">${esc(L.skip)}</button>`}
          ${i > 0 ? `<button class="dt-btn" type="button" data-dt="back">${esc(L.back)}</button>` : ''}
          <button class="dt-btn primary" type="button" data-dt="next">${esc(last ? L.done : L.next)}</button></div>`;
      const target = s.sel ? document.querySelector(s.sel) : null;
      if (target && target.scrollIntoView) target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      place();
      requestAnimationFrame(place);
      card.querySelector('[data-dt="next"]').focus();
    }
    card.addEventListener('click', e => {
      const b = e.target.closest('[data-dt]');
      if (!b) return;
      if (b.dataset.dt === 'skip') return stop(true);
      if (b.dataset.dt === 'back') { i = Math.max(0, i - 1); return show(); }
      if (i === steps.length - 1) return stop(true);
      i += 1; show();
    });
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); stop(true); }
      // Keep Tab inside the card while the guide is open
      if (e.key === 'Tab') {
        const f = [...card.querySelectorAll('button')];
        const at = f.indexOf(document.activeElement);
        e.preventDefault();
        f[(at + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);

    active = { id: o.id, hole, block, card, onKey, place, returnFocus: document.activeElement, onEnd: o.onEnd };
    show();
    return true;
  }

  // A "How it works" button that replays a tour
  function helpButton(label, onClick) {
    ensureCss();
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dt-help';
    b.innerHTML = `<img src="/assets/mascot/dilly_v3_three_quarter.svg" width="18" height="18" alt=""><span>${esc(label || 'How it works')}</span>`;
    b.addEventListener('click', onClick);
    return b;
  }

  window.DuckTour = { start, stop: () => stop(false), seen: id => Boolean(store.get(id)), helpButton };
})();
