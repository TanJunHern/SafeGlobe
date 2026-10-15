/* DillyMotion: small, intentional animations in Dilly's style.
   Each animation marks one moment and says one thing:
   - fly       Send DDQ / invite: a paper plane flies away (sent) or loops back (only a link was made)
   - stamp     Approve / Reject / Request more info: a person signed this decision
   - tally     "Why <score>?": the rules add the points up, row by row
   - pop       the route's Dilly pose arrives; one short shake for a sanctions escalation
   - hop       a duckling joins the row (a Pond-Guard agent or a DDQ section is done)
   - waddle    the questionnaire is on its way
   - packet    big report: an agent is sent out, or a finding comes back to the score
   - rise      big report: new cards drop in one after another
   Rules: plays only after a user action or a real result, at most 900 ms, never blocks the request,
   transform and opacity only, skipped under prefers-reduced-motion. The page always renders the final
   state first, so nothing depends on the motion.
   Loaded as a plain <script> in the browser (window.DillyMotion) and with require() in Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DillyMotion = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Material 3 motion tokens (m3.material.io, easing and duration); spring is the cartoon overshoot
  const EASE = {
    emph: 'cubic-bezier(.2,0,0,1)',
    decel: 'cubic-bezier(.05,.7,.1,1)',
    accel: 'cubic-bezier(.3,0,.8,.15)',
    spring: 'cubic-bezier(.34,1.56,.64,1)'
  };

  /* ---------- pure helpers (unit tested) ---------- */

  /** Returns a function that is true the first time it sees a key, so a re-render never replays an animation. */
  function createOnce() {
    const seen = new Set();
    return key => {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    };
  }

  /** 'away' when the message went out, 'back' when the server says it was not sent (link only). */
  function planeOutcome(data) {
    return data && data.delivery && data.delivery.sent === false ? 'back' : 'away';
  }

  /** The stamp for an officer's action or a request status, or null when there is none. */
  function stampFor(action) {
    const a = String(action || '').trim().toLowerCase();
    if (a === 'approve' || a === 'approved') return { word: 'Approved', tone: 'low' };
    if (a === 'reject' || a === 'rejected') return { word: 'Rejected', tone: 'high' };
    if (a === 'bounce back' || a === 'request more info' || a === 'more info') return { word: 'More info', tone: 'mid' };
    if (a === 'signed' || a === 'sign') return { word: 'Signed', tone: 'accent' };
    return null;
  }

  /** Count-up value at progress t (0 to 1), easing out so it slows as it lands on the total. */
  function countAt(to, t) {
    const p = Math.max(0, Math.min(1, t));
    return Math.round(to * (1 - Math.pow(1 - p, 3)));
  }

  /** Points along a cubic Bezier from p0 to p3. */
  function bezierPoints(p0, p1, p2, p3, n) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      out.push([0, 1].map(k => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]));
    }
    return out;
  }

  /** The plane's loop-the-loop path: out, one full loop, then back to where it started. */
  function loopPoints() {
    const out = bezierPoints([0, 0], [30, -10], [60, -40], [90, -50], 6);
    const cx = 90, cy = -76, r = 26;
    for (let i = 1; i <= 12; i++) {
      const phi = (90 - (360 * i) / 12) * Math.PI / 180;
      out.push([cx + r * Math.cos(phi), cy + r * Math.sin(phi)]);
    }
    return out.concat(bezierPoints([90, -50], [60, -40], [20, 10], [0, 0], 6).slice(1));
  }

  /** An arc from (0,0) to (dx,dy) that lifts above the straight line, so a packet visibly travels. */
  function arcPoints(dx, dy, n) {
    const lift = Math.min(80, 30 + Math.hypot(dx, dy) * .12);
    return bezierPoints([0, 0], [dx * .25, dy * .25 - lift], [dx * .75, dy * .75 - lift], [dx, dy], n || 12);
  }

  /** Keyframes that move a nose-right shape along points, turned to face its direction of travel.
      Angles are unwrapped so the shape never spins the long way round. */
  function pathFrames(points, scaleAt, opacityAt) {
    let prev = null;
    return points.map((p, i) => {
      const a0 = points[Math.max(i - 1, 0)], a1 = points[Math.min(i + 1, points.length - 1)];
      let a = Math.atan2(a1[1] - a0[1], a1[0] - a0[0]) * 180 / Math.PI;
      if (prev !== null) {
        while (a - prev > 180) a -= 360;
        while (a - prev < -180) a += 360;
      }
      prev = a;
      const t = points.length > 1 ? i / (points.length - 1) : 1;
      return {
        offset: t,
        transform: `translate(${p[0].toFixed(1)}px,${p[1].toFixed(1)}px) rotate(${a.toFixed(1)}deg) scale(${scaleAt(t)})`,
        opacity: opacityAt(t)
      };
    });
  }

  /* ---------- DOM (browser only) ---------- */
  const once = createOnce();

  function reduced() {
    return typeof window === 'undefined' || !window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  const canAnimate = el => !!(el && typeof el.animate === 'function' && el.isConnected);

  const CSS = `
.dm-fx{position:fixed;left:0;top:0;z-index:10001;pointer-events:none}
.dm-plane{width:30px;height:30px;margin:-15px 0 0 -15px}
.dm-plane svg{display:block;width:100%;height:100%;overflow:visible}
.dm-dot{width:5px;height:5px;margin:-2.5px 0 0 -2.5px;border-radius:50%;background:var(--accent,#1F6F6B);opacity:0}
.dm-packet{width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:var(--accent,#1F6F6B);box-shadow:0 0 0 3px color-mix(in srgb,var(--surface,#FFFDF7) 70%,transparent)}
.dm-packet.low{background:var(--low,#6E9F6A)}.dm-packet.mid{background:var(--mid,#E0A23A)}.dm-packet.high{background:var(--high,#D9604F)}.dm-packet.slate{background:var(--slate,#54657A)}
.dm-stamp{padding:7px 18px;border:3px solid currentColor;border-radius:10px;font:600 26px/1 var(--f-display,"Fredoka",system-ui,sans-serif);letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;background:color-mix(in srgb,var(--surface,#FFFDF7) 86%,transparent);box-shadow:inset 0 0 0 2px var(--surface,#FFFDF7),inset 0 0 0 4px currentColor;opacity:0}
.dm-stamp.low{color:var(--low-ink,#3F7140)}.dm-stamp.high{color:var(--high-ink,#B5412F)}.dm-stamp.mid{color:var(--mid-ink,#8F5E0B)}.dm-stamp.accent{color:var(--accent,#1F6F6B)}
.dm-bob{animation:dm-bob 1s ease-in-out infinite;transform-origin:50% 100%}
@keyframes dm-bob{50%{transform:translateY(-3px) rotate(-5deg)}}
@media (prefers-reduced-motion: reduce){.dm-bob{animation:none}}`;

  // Nose-right paper plane, drawn with Dilly's ink outline and yellow
  const PLANE = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M2 6 L30 16 L2 26 L8 16 Z" fill="#FFFDF7" stroke="#3A3541" stroke-width="2.2" stroke-linejoin="round"/><path d="M8 16 L13 23 L30 16 Z" fill="#F6DD8E" stroke="#3A3541" stroke-width="2" stroke-linejoin="round"/><path d="M8 16 H30" stroke="#3A3541" stroke-width="1.6" stroke-linecap="round"/></svg>`;

  function ensureCss() {
    if (document.getElementById('dm-css')) return;
    const s = document.createElement('style');
    s.id = 'dm-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // A fixed effect layer at a viewport point; removed when its animation ends
  function fx(cls, x, y, html) {
    ensureCss();
    const el = document.createElement('div');
    el.className = `dm-fx ${cls}`;
    el.setAttribute('aria-hidden', 'true');
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    if (html) el.innerHTML = html;
    document.body.appendChild(el);
    return el;
  }
  const centre = el => {
    const r = el.getBoundingClientRect();
    return r.width || r.height ? [r.left + r.width / 2, r.top + r.height / 2] : null;
  };
  const done = (anim, el) => { anim.onfinish = anim.oncancel = () => el.remove(); };

  // Every public DOM helper is safe: a motion problem must never break the action it decorates
  const safe = fn => (...args) => {
    try { if (!reduced()) fn(...args); } catch (err) { if (typeof console !== 'undefined') console.warn('DillyMotion:', err); }
  };

  /** Paper plane from a button. outcome 'away' (700 ms) or 'back' (900 ms, then the button pops). */
  const fly = safe((btn, outcome) => {
    const c = btn && centre(btn);
    if (!c) return;
    const plane = fx('dm-plane', c[0], c[1], PLANE);
    if (outcome === 'back') {
      const pts = loopPoints();
      const anim = plane.animate(pathFrames(pts, t => (t < .15 ? .5 + t * 3.3 : t > .85 ? 1 - (t - .85) * 4.6 : 1).toFixed(2), t => (t > .92 ? 0 : 1)),
        { duration: 900, easing: 'ease-in-out', fill: 'forwards' });
      done(anim, plane);
      anim.addEventListener('finish', () => { if (canAnimate(btn)) btn.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], { duration: 260, easing: EASE.spring }); });
      return;
    }
    const w = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const dx = Math.max(160, Math.min(340, w - c[0] + 40));
    const dy = -Math.max(140, Math.min(280, c[1] + 40));
    const pts = bezierPoints([0, 0], [14, 26], [dx * .45, dy * .1], [dx, dy], 14);
    const anim = plane.animate(pathFrames(pts, t => (t < .3 ? .5 + t * 2 : 1.1 - (t - .3) * .5).toFixed(2), t => (t > .8 ? +(1 - (t - .8) * 5).toFixed(2) : 1)),
      { duration: 700, easing: EASE.accel, fill: 'forwards' });
    done(anim, plane);
    // A dotted trail, dropped behind the plane as it climbs
    [.3, .45, .6, .75].forEach(t => {
      const p = pts[Math.round(t * (pts.length - 1))];
      const dot = fx('dm-dot', c[0] + p[0], c[1] + p[1]);
      done(dot.animate([{ opacity: 0 }, { opacity: .7, offset: .2 }, { opacity: 0 }], { duration: 520, delay: t * 560, fill: 'both' }), dot);
    });
  });

  /** Rubber stamp over an element for an officer's decision. */
  const stamp = safe((anchor, action) => {
    const s = stampFor(action), c = anchor && centre(anchor);
    if (!s || !c) return;
    const el = fx(`dm-stamp ${s.tone}`, c[0], c[1]);
    el.textContent = s.word;
    const at = (rot, sc) => `translate(-50%,-50%) rotate(${rot}deg) scale(${sc})`;
    done(el.animate([
      { transform: at(-20, 2.2), opacity: 0, easing: EASE.accel },
      { transform: at(-11, .9), opacity: 1, offset: .32 },
      { transform: at(-12, 1.05), opacity: 1, offset: .44 },
      { transform: at(-12, 1), opacity: 1, offset: .54 },
      { transform: at(-12, 1), opacity: 1, offset: .82 },
      { transform: at(-12, 1), opacity: 0 }
    ], { duration: 900, fill: 'forwards' }), el);
  });

  /** Counts an element's number up from 0 to `to` over `ms`. */
  const countUp = safe((el, to, ms) => {
    if (!el || !Number.isFinite(to)) return;
    const start = performance.now();
    const step = now => {
      const t = (now - start) / ms;
      el.textContent = String(t >= 1 ? to : countAt(to, t));
      if (t < 1) requestAnimationFrame(step);
    };
    el.textContent = '0';
    requestAnimationFrame(step);
  });

  /** "Why <score>?": rows drop in one by one while every [data-count] counts up. Plays once per key. */
  const tally = safe((root, key) => {
    if (!root || !root.querySelector('[data-count]') || !once(key)) return;
    const rows = Array.from(root.querySelectorAll('.why-row'));
    const gap = rows.length > 6 ? 60 : 90;
    rows.forEach((row, i) => {
      if (!canAnimate(row)) return;
      row.animate([{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }], { duration: 280, delay: i * gap, easing: EASE.decel, fill: 'backwards' });
      const pts = row.querySelector('.why-pts');
      if (canAnimate(pts)) pts.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.3)' }, { transform: 'scale(1)' }], { duration: 300, delay: i * gap + 180, easing: EASE.spring });
    });
    const ms = Math.min(900, Math.max(400, rows.length * gap + 300));
    root.querySelectorAll('[data-count]').forEach(el => countUp(el, Number(el.dataset.count), ms));
  });

  /** Dilly's pose arrives with a little squash and stretch; `shake` adds one short shake. Plays once per key. */
  const pop = safe((img, key, shake) => {
    if (!canAnimate(img) || !once(key)) return;
    const anim = img.animate([
      { opacity: 0, transform: 'scale(.6,.6)' },
      { opacity: 1, transform: 'scale(1.1,.92)', offset: .55 },
      { opacity: 1, transform: 'scale(.96,1.05)', offset: .8 },
      { opacity: 1, transform: 'none' }
    ], { duration: 420, easing: EASE.emph });
    if (shake) anim.addEventListener('finish', () => {
      if (canAnimate(img)) img.animate([0, -4, 4, -3, 3, 0].map(x => ({ transform: `translateX(${x}px)` })), { duration: 320, easing: 'ease-in-out' });
    });
  });

  /** A duckling hops into the row: crouch, jump, land. Plays once per key (or every time without one). */
  const hop = safe((el, key) => {
    if (!canAnimate(el) || (key && !once(key))) return;
    el.style.transformOrigin = '50% 100%';
    el.animate([
      { transform: 'none' },
      { transform: 'translateY(2px) scale(1.08,.9)', offset: .15 },
      { transform: 'translateY(-12px) scale(.95,1.06)', offset: .45 },
      { transform: 'translateY(0) scale(1.08,.92)', offset: .75 },
      { transform: 'none' }
    ], { duration: 520, easing: 'ease-out' });
  });

  /** A packet travels from one element to another along an arc. tone: '', 'low', 'mid', 'high' or 'slate'. */
  const packet = safe((from, to, tone, delay) => {
    const a = from && centre(from), b = to && centre(to);
    if (!a || !b) return;
    const dot = fx(`dm-packet ${tone || ''}`, a[0], a[1]);
    const frames = arcPoints(b[0] - a[0], b[1] - a[1]).map((p, i, all) => ({
      transform: `translate(${p[0].toFixed(1)}px,${p[1].toFixed(1)}px)`,
      opacity: i === 0 || i === all.length - 1 ? 0 : 1
    }));
    done(dot.animate(frames, { duration: 560, delay: delay || 0, easing: EASE.emph, fill: 'both' }), dot);
  });

  /** New cards drop in one after another, starting after `start` ms (hidden until then). */
  const rise = safe((els, gap, start) => {
    Array.from(els || []).forEach((el, i) => {
      if (canAnimate(el)) el.animate([{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }], { duration: 280, delay: (start || 0) + i * (gap || 80), easing: EASE.decel, fill: 'backwards' });
    });
  });

  /** Mommy duck waddles in with the envelope. Plays once per key. */
  const waddle = safe((el, key) => {
    if (!canAnimate(el) || !once(key)) return;
    el.style.transformOrigin = '50% 100%';
    const steps = [0, 1, 2, 3, 4, 5].map(i => ({ transform: `translateX(${-90 + i * 18}px) rotate(${i % 2 ? 7 : -7}deg)`, opacity: i ? 1 : 0, offset: i / 6 }));
    el.animate(steps.concat([{ transform: 'none', opacity: 1 }]), { duration: 900, easing: 'linear' });
  });

  // The bob class is used in page markup, so its CSS is in place before any animation runs
  if (typeof document !== 'undefined' && document.head) ensureCss();

  return { EASE, createOnce, planeOutcome, stampFor, countAt, bezierPoints, arcPoints, loopPoints, pathFrames, reduced, fly, stamp, countUp, tally, pop, hop, waddle, packet, rise };
});
