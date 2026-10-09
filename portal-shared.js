/* Shared helpers for the standalone portal pages (DDQ guest portal, DDQ Manager, printable DDQ). */
(function () {
  'use strict';
  const SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<symbol id="i-policy" viewBox="0 0 24 24"><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6L12 3z"/><path d="M9 12l2 2 4-4"/></symbol>
<symbol id="i-spark" viewBox="0 0 24 24"><path d="M12 3.5c.5 4.1 2.4 6 6.5 6.5-4.1.5-6 2.4-6.5 6.5-.5-4.1-2.4-6-6.5-6.5 4.1-.5 6-2.4 6.5-6.5zM18.5 15.5c.2 1.6 1 2.4 2.5 2.5-1.5.2-2.3 1-2.5 2.5-.2-1.5-1-2.3-2.5-2.5 1.5-.1 2.3-.9 2.5-2.5z"/></symbol>
<symbol id="i-moon" viewBox="0 0 24 24"><path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z"/></symbol>
<symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></symbol>
<symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
<symbol id="i-close" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></symbol>
<symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></symbol>
<symbol id="i-check" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></symbol>
<symbol id="i-alert" viewBox="0 0 24 24"><path d="M12 4 2.5 20h19L12 4zM12 10v4.5M12 17.2v.3"/></symbol>
<symbol id="i-link" viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></symbol>
<symbol id="i-doc" viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6V3zM14 3v4h4M9 12h6M9 15.5h6M9 9h2"/></symbol>
<symbol id="i-send" viewBox="0 0 24 24"><path d="M20.5 3.5 10 14M20.5 3.5 14 20.5l-4-6.5-6.5-4 17-6.5z"/></symbol>
<symbol id="i-chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></symbol>
<symbol id="i-down" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></symbol>
<symbol id="i-list" viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.5M4.5 12h.5M4.5 18h.5"/></symbol>
<symbol id="i-lock" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9.5" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></symbol>
<symbol id="i-refresh" viewBox="0 0 24 24"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4h-4"/></symbol>
<symbol id="i-upload" viewBox="0 0 24 24"><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4.5 15v4.5h15V15"/></symbol>
<symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></symbol>
</defs></svg>`;
  document.addEventListener('DOMContentLoaded', () => document.body.insertAdjacentHTML('afterbegin', SPRITE));

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (id, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;

  let toastTimer = null;
  function toast(msg) {
    let t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), 3400);
  }

  function isDark() {
    const a = document.documentElement.getAttribute('data-theme');
    return a ? a === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function initTheme(button) {
    if (!button) return;
    const sync = () => { button.innerHTML = icon(isDark() ? 'sun' : 'moon'); };
    button.addEventListener('click', () => { document.documentElement.setAttribute('data-theme', isDark() ? 'light' : 'dark'); sync(); });
    sync();
  }

  // Staff session shared with safe-globe.html / employee-portal.html
  const SESSION_KEY = 'safeglobe.session';
  function loadSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; }
  }
  function apiFetch(url, opts = {}) {
    const session = loadSession();
    const headers = Object.assign({}, opts.headers || {});
    if (session) {
      if (session.idToken) headers['Authorization'] = `Bearer ${session.idToken}`;
      else {
        headers['x-user-email'] = session.email;
        headers['x-user-name'] = session.name;
        headers['x-user-id'] = session.userId;
        headers['x-user-department'] = session.department;
        headers['x-user-role'] = session.role;
      }
    }
    return fetch(url, Object.assign({}, opts, { headers }));
  }

  window.SG = { $, $$, esc, icon, toast, isDark, initTheme, loadSession, apiFetch };
})();
