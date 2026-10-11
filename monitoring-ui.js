/* MonitoringUI: ongoing-monitoring controls shared by the compliance app and the employee portal.
   - scheduleFields  how often, start / end date, sources, with the cost worked out by the server
   - panel           Reviews: default schedule, apply to all, run due re-screens, edit each request
   - costTable       Sources: what one screen against each source costs (compliance sets it)
   - label           one-line summary of a monitored request, e.g. "Weekly · SGD 39.00 / year"
   Every call takes `api(url, options)`, the page's own fetch wrapper that adds the signed-in identity. */
(function () {
  'use strict';
  const FREQ = [['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['yearly', 'Yearly']];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => `SGD ${Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const freqWord = f => (FREQ.find(x => x[0] === f) || [f, f])[1];
  const json = (api, url, method, body) => api(url, { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.message || d.error || 'Request failed'); return d; });

  const CSS = `
.mon-fields{display:flex;flex-direction:column;gap:10px;padding:12px;border-radius:12px;border:1px solid var(--line);background:var(--surface-2)}
.mon-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.mon-row label,.mon-sources>span{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:500;color:var(--fg-2)}
.mon-row select,.mon-row input,.mon-cost-input{height:34px;padding:0 10px;border-radius:9px;border:1px solid var(--line-2);background:var(--surface);color:var(--fg);font:inherit;font-size:13px;min-width:0}
.mon-sources{display:flex;flex-direction:column;gap:6px}
.mon-src-list{display:flex;flex-wrap:wrap;gap:6px}
.mon-src{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;border:1px solid var(--line-2);background:var(--surface);font-size:12px;cursor:pointer}
.mon-src:has(input:checked){border-color:var(--accent);background:var(--accent-soft)}
.mon-src small{color:var(--fg-3)}
.mon-note{font-size:11.5px;color:var(--fg-3)}
.mon-cost{font-size:13px;font-weight:500;color:var(--fg)}
.mon-cost small{display:block;font-weight:400;color:var(--fg-3);font-size:11.5px}
.mon-panel .mon-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.mon-panel .mon-body{padding:14px 16px;display:flex;flex-direction:column;gap:12px}
.mon-table{width:100%;border-collapse:collapse;font-size:12.5px}
.mon-table th{text-align:left;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--fg-3);font-weight:500;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
.mon-table td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
.mon-table tr.edit td{background:var(--surface-2)}
.mon-tag{display:inline-flex;padding:2px 7px;border-radius:999px;font-size:11px;font-weight:500;background:var(--surface-2);border:1px solid var(--line);white-space:nowrap}
.mon-tag.due{color:var(--mid-ink);background:var(--mid-soft);border-color:var(--mid)}
.mon-tag.off{color:var(--fg-3)}
.mon-empty{padding:18px;text-align:center;color:var(--fg-3);font-size:12.5px}
.mon-cost-input{width:110px;text-align:right}
@media (max-width:700px){.mon-row{grid-template-columns:1fr}}`;
  function ensureCss() {
    if (document.getElementById('mon-css')) return;
    const s = document.createElement('style');
    s.id = 'mon-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function costLine(cost) {
    if (!cost) return '';
    if (!cost.sources.length) return `<span>${money(0)} per re-screen</span><small>Built-in sanctions and PEP lists only. Add a source to see its cost.</small>`;
    const total = cost.total === null ? '' : ` · ${money(cost.total)} for ${cost.runs_total} run${cost.runs_total === 1 ? '' : 's'} until the end date`;
    const unpriced = cost.unpriced_sources.length ? `<small>No cost has been set yet for: ${esc(cost.unpriced_sources.join(', '))}.</small>` : '';
    return `<span>${money(cost.per_run)} per re-screen · about ${money(cost.per_year)} a year${total}</span>${unpriced}`;
  }

  /**
   * Schedule fields with a live cost. Returns { get(): schedule, set(schedule) }.
   * opts: { api, value, sources (optional, fetched when absent), disabled }
   */
  function scheduleFields(container, opts) {
    ensureCss();
    const o = opts || {};
    const v = Object.assign({ frequency: 'monthly', start_date: '', end_date: '', source_ids: [] }, o.value || {});
    let sources = o.sources || [];
    let timer = null;
    const dis = o.disabled ? 'disabled' : '';

    function draw() {
      container.innerHTML = `<div class="mon-fields">
        <div class="mon-row">
          <label>How often<select data-m="frequency" ${dis}>${FREQ.map(([k, l]) => `<option value="${k}" ${v.frequency === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label>Start date<input type="date" data-m="start_date" value="${esc(v.start_date || '')}" ${dis}></label>
          <label>End date (optional)<input type="date" data-m="end_date" value="${esc(v.end_date || '')}" ${dis}></label>
        </div>
        <div class="mon-sources"><span>Re-screen against</span>
          <div class="mon-src-list">${sources.map(s => `<label class="mon-src"><input type="checkbox" data-src="${esc(s.id)}" ${v.source_ids.includes(s.id) ? 'checked' : ''} ${dis}>${esc(s.label)} <small>${esc(s.type)} · ${Number(s.cost_per_screen) > 0 ? money(s.cost_per_screen) : 'no cost set'}</small></label>`).join('') || '<span class="mon-note">No custom sources have been added yet.</span>'}</div>
          <span class="mon-note" style="font-weight:400">Built-in sanctions and PEP lists are always included at no charge.</span>
        </div>
        <div class="mon-cost" role="status" aria-live="polite"></div>
      </div>`;
      estimate();
    }
    function read() {
      const q = sel => container.querySelector(sel);
      if (!q('[data-m="frequency"]')) return v;
      v.frequency = q('[data-m="frequency"]').value;
      v.start_date = q('[data-m="start_date"]').value || '';
      v.end_date = q('[data-m="end_date"]').value || '';
      v.source_ids = [...container.querySelectorAll('[data-src]:checked')].map(c => c.dataset.src);
      return v;
    }
    const clean = () => { const s = read(); return { frequency: s.frequency, start_date: s.start_date || undefined, end_date: s.end_date || null, source_ids: s.source_ids.slice() }; };
    function estimate() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const box = container.querySelector('.mon-cost');
        if (!box) return;
        json(o.api, '/api/monitoring/estimate', 'POST', clean())
          .then(d => { box.innerHTML = costLine(d.cost); if (o.onCost) o.onCost(d.cost); })
          .catch(err => { box.innerHTML = `<span style="color:var(--high-ink)">${esc(err.message)}</span>`; });
      }, 150);
    }
    container.addEventListener('change', e => { if (e.target.closest('.mon-fields')) { read(); estimate(); } });

    if (o.sources) draw();
    else json(o.api, '/api/sources').then(d => { sources = d.sources || []; draw(); }).catch(() => draw());
    return { get: clean, set(next) { Object.assign(v, { start_date: '', end_date: '', source_ids: [] }, next || {}); draw(); } };
  }

  /** One-line summary for tables: "Weekly · SGD 39.00 / year". */
  function label(item) {
    if (!item) return '';
    const s = item.schedule;
    return `${freqWord(s.frequency)} · ${money(item.cost.per_year)} / year`;
  }

  /**
   * Reviews panel. opts: { api, canEdit, toast, onChange }
   */
  function panel(container, opts) {
    ensureCss();
    const o = opts || {};
    const say = m => (o.toast ? o.toast(m) : null);
    let data = null, editing = null, defaultsUi = null, rowUi = null;

    const dates = s => `${esc(s.start_date || '—')} → ${s.end_date ? esc(s.end_date) : 'no end date'}`;
    function rowHtml(i) {
      const srcs = i.cost.sources.map(s => esc(s.label)).join(', ') || 'Built-in lists only';
      const state = !i.active ? `<span class="mon-tag off" title="Re-screening starts once the request is approved">Waiting for approval</span>`
        : i.ended ? '<span class="mon-tag off">Ended</span>'
        : i.due ? '<span class="mon-tag due">Due now</span>' : `<span class="mon-tag">Next ${esc(i.next_run_date)}</span>`;
      const last = i.schedule.last_run_at ? `${esc(String(i.schedule.last_run_at).slice(0, 10))} · ${esc(i.schedule.last_result || '')}` : 'Not run yet';
      const main = `<tr data-mon="${esc(i.id)}"><td><b style="font-weight:500">${esc(i.counterparty_name)}</b><br><span class="mono" style="font-size:11px;color:var(--fg-3)">${esc(i.id)} · ${esc(i.request_status)}</span></td>
        <td>${esc(freqWord(i.schedule.frequency))}<br><span style="font-size:11px;color:var(--fg-3)">${dates(i.schedule)}</span></td>
        <td>${srcs}</td><td>${state}</td><td>${last}</td>
        <td class="mono" style="white-space:nowrap">${money(i.cost.per_year)}</td>
        <td>${o.canEdit ? `<button class="btn sm" type="button" data-mon-edit="${esc(i.id)}">${editing === i.id ? 'Close' : 'Change'}</button>` : ''}</td></tr>`;
      if (editing !== i.id) return main;
      return `${main}<tr class="edit"><td colspan="7"><div data-mon-editor></div>
        <div class="mon-actions" style="margin-top:10px"><button class="btn primary sm" type="button" data-mon-save="${esc(i.id)}">Save schedule</button>
        <button class="btn sm" type="button" data-mon-run="${esc(i.id)}" ${i.active ? '' : 'disabled'}>Re-screen now</button>
        <button class="btn sm" type="button" data-mon-off="${esc(i.id)}" style="color:var(--high-ink);border-color:var(--high)">Stop monitoring</button>
        ${i.schedule.updated_by ? `<span class="mon-note">Last changed by ${esc(i.schedule.updated_by)}</span>` : ''}</div></td></tr>`;
    }
    function draw() {
      const t = data.totals;
      container.innerHTML = `<div class="card mon-panel" id="mon-panel">
        <div class="card-h"><h2>Ongoing monitoring</h2><span class="faint" style="font-size:12px">${t.monitored} monitored · ${t.active} being re-screened · ${t.due} due now · ${money(t.per_year)} a year</span></div>
        <div class="mon-body">
          ${o.canEdit ? `<div><b style="font-size:13px">Default schedule</b><p class="mon-note" style="margin:2px 0 8px">How often monitored counterparties are re-screened unless a request has its own schedule.</p>
            <div data-mon-defaults></div>
            <div class="mon-actions" style="margin-top:10px">
              <button class="btn primary sm" type="button" data-mon-act="save-defaults">Save default</button>
              <button class="btn sm" type="button" data-mon-act="apply-all">Apply to all ${t.monitored} monitored</button>
              <button class="btn sm" type="button" data-mon-act="run-due">Run due re-screens now (${t.due})</button>
            </div></div>` : ''}
          ${data.items.length ? `<div class="table-wrap"><table class="mon-table"><thead><tr><th>Counterparty</th><th>How often</th><th>Sources</th><th>Next run</th><th>Last run</th><th>Cost / year</th><th></th></tr></thead>
            <tbody>${data.items.map(rowHtml).join('')}</tbody></table></div>` : '<div class="mon-empty">No request has ongoing monitoring switched on yet.</div>'}
        </div></div>`;
      const defaultsHost = container.querySelector('[data-mon-defaults]');
      if (defaultsHost) defaultsUi = scheduleFields(defaultsHost, { api: o.api, value: data.defaults, sources: data.sources });
      const editorHost = container.querySelector('[data-mon-editor]');
      const item = data.items.find(i => i.id === editing);
      rowUi = editorHost && item ? scheduleFields(editorHost, { api: o.api, value: item.schedule, sources: data.sources }) : null;
    }
    function load() {
      return json(o.api, '/api/monitoring').then(d => { data = d; draw(); if (o.onChange) o.onChange(d); })
        .catch(err => { container.innerHTML = `<div class="card"><div class="mon-empty">Ongoing monitoring could not be loaded: ${esc(err.message)}</div></div>`; });
    }
    const act = (promise, done) => promise.then(d => { say(done(d)); return load(); }).catch(err => say(err.message));

    container.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b || !data) return;
      if (b.dataset.monEdit) { editing = editing === b.dataset.monEdit ? null : b.dataset.monEdit; draw(); return; }
      if (b.dataset.monSave) return act(json(o.api, `/api/monitoring/${encodeURIComponent(b.dataset.monSave)}`, 'PUT', rowUi.get()), () => { editing = null; return 'Schedule saved'; });
      if (b.dataset.monOff) return act(json(o.api, `/api/monitoring/${encodeURIComponent(b.dataset.monOff)}`, 'PUT', { enabled: false }), () => { editing = null; return 'Ongoing monitoring stopped for this request'; });
      if (b.dataset.monRun) return act(json(o.api, '/api/monitoring/run', 'POST', { ids: [b.dataset.monRun], force: true }), d => (d.ran ? `Re-screened: ${d.results[0].result}${d.results[0].changed ? ' (changed)' : ', no change'}` : 'Nothing to re-screen'));
      if (b.dataset.monAct === 'save-defaults') return act(json(o.api, '/api/monitoring/defaults', 'PUT', defaultsUi.get()), () => 'Default schedule saved');
      if (b.dataset.monAct === 'apply-all') return act(json(o.api, '/api/monitoring/defaults', 'PUT', defaultsUi.get()).then(() => json(o.api, '/api/monitoring/apply-all', 'POST', {})), d => `Default schedule applied to ${d.updated} monitored request${d.updated === 1 ? '' : 's'}`);
      if (b.dataset.monAct === 'run-due') return act(json(o.api, '/api/monitoring/run', 'POST', {}), d => (d.ran ? `${d.ran} re-screen${d.ran === 1 ? '' : 's'} run · ${money(d.cost)}` : 'Nothing is due yet'));
    });
    load();
    return { reload: load };
  }

  /** Sources page: cost of one screen per source. opts: { api, canEdit, toast } */
  function costTable(container, opts) {
    ensureCss();
    const o = opts || {};
    function load() {
      return json(o.api, '/api/sources').then(d => {
        const list = d.sources || [];
        container.innerHTML = `<div class="card"><div class="card-h"><h2>Cost per screen</h2><span class="faint" style="font-size:12px">Used to show employees what ongoing monitoring costs</span></div>
          ${list.length ? `<div class="table-wrap"><table class="mon-table"><thead><tr><th>Source</th><th>Type</th><th style="text-align:right">Cost per screen (SGD)</th></tr></thead><tbody>
            ${list.map(s => `<tr><td><b style="font-weight:500">${esc(s.label)}</b></td><td>${esc(s.type)}</td><td style="text-align:right">${o.canEdit
              ? `<input class="mon-cost-input" type="number" min="0" step="0.01" value="${Number(s.cost_per_screen) || 0}" data-cost="${esc(s.id)}" aria-label="Cost per screen for ${esc(s.label)}">`
              : `<span class="mono">${money(s.cost_per_screen)}</span>`}</td></tr>`).join('')}
          </tbody></table></div>` : '<div class="mon-empty">No custom sources yet.</div>'}</div>`;
      }).catch(err => { container.innerHTML = `<div class="card"><div class="mon-empty">${esc(err.message)}</div></div>`; });
    }
    container.addEventListener('change', e => {
      const inp = e.target.closest('[data-cost]');
      if (!inp) return;
      json(o.api, `/api/sources/${encodeURIComponent(inp.dataset.cost)}/cost`, 'PUT', { cost_per_screen: Number(inp.value) })
        .then(d => { inp.value = d.cost_per_screen; if (o.toast) o.toast(`Cost saved: ${money(d.cost_per_screen)} per screen`); if (o.onChange) o.onChange(); })
        .catch(err => { if (o.toast) o.toast(err.message); });
    });
    load();
    return { reload: load };
  }

  window.MonitoringUI = { scheduleFields, panel, costTable, label, money };
})();

/* Intake form helpers, shared by both pages that carry the KYC request form */
(function () {
  'use strict';
  const M = window.MonitoringUI;
  let kycUi = null;

  /** Shows the schedule fields under the "Ongoing Monitoring" tick box of the KYC request form. */
  M.attachToKycForm = function (opts) {
    const box = document.getElementById('kyc-ongoing-mon');
    if (!box) return;
    let host = document.getElementById('kyc-mon-schedule');
    if (!host) {
      host = document.createElement('div');
      host.id = 'kyc-mon-schedule';
      box.closest('.field').parentElement.after(host);
      box.addEventListener('change', () => { host.hidden = !box.checked; });
    }
    host.hidden = !box.checked;
    host.innerHTML = '<label style="display:block;font-size:12px;font-weight:500;margin-bottom:6px">Ongoing monitoring: how often, and against which sources</label><div data-fields></div>';
    kycUi = null;
    const today = new Date().toISOString().slice(0, 10);
    opts.api('/api/monitoring').then(r => r.json()).then(d => {
      const defaults = d.defaults || {};
      kycUi = M.scheduleFields(host.querySelector('[data-fields]'), {
        api: opts.api, sources: d.sources || [],
        value: { frequency: defaults.frequency || 'monthly', start_date: defaults.start_date && defaults.start_date > today ? defaults.start_date : today, end_date: defaults.end_date || '', source_ids: defaults.source_ids || [] }
      });
    }).catch(() => { kycUi = M.scheduleFields(host.querySelector('[data-fields]'), { api: opts.api }); });
  };

  /** The schedule to send with the request, or undefined when monitoring is not ticked. */
  M.kycSchedule = function () {
    const box = document.getElementById('kyc-ongoing-mon');
    return box && box.checked && kycUi ? kycUi.get() : undefined;
  };

  /** Adds a grip to the bottom edge of a modal sheet so it can be dragged taller or shorter. */
  M.resizableSheet = function (sheet) {
    if (!sheet || sheet.querySelector(':scope > .sheet-grip')) return;
    if (!document.getElementById('grip-css')) {
      const s = document.createElement('style');
      s.id = 'grip-css';
      // The modal starts 12vh down, so a sheet with a grip must end above the bottom edge to keep the grip in reach
      s.textContent = '.modal .sheet:has(> .sheet-grip){max-height:calc(88vh - 28px)!important}' +
        '.sheet-grip{flex:none;height:14px;cursor:ns-resize;display:grid;place-items:center;border-top:1px solid var(--line);touch-action:none}' +
        '.sheet-grip::before{content:"";width:44px;height:4px;border-radius:999px;background:var(--line-2)}' +
        '.sheet-grip:hover::before,.sheet-grip:focus-visible::before{background:var(--accent)}';
      document.head.appendChild(s);
    }
    const grip = document.createElement('div');
    grip.className = 'sheet-grip';
    grip.tabIndex = 0;
    grip.setAttribute('role', 'separator');
    grip.setAttribute('aria-orientation', 'horizontal');
    grip.setAttribute('aria-label', 'Drag to make the form taller or shorter');
    grip.title = 'Drag to resize';
    sheet.appendChild(grip);
    const setHeight = h => {
      sheet.style.setProperty('max-height', 'none', 'important');
      sheet.style.height = `${Math.max(320, Math.min(innerHeight - sheet.getBoundingClientRect().top - 8, h))}px`;
    };
    // Pin the top edge first, otherwise a centred sheet grows in both directions while dragging
    const pin = () => {
      const top = sheet.getBoundingClientRect().top;
      sheet.style.alignSelf = 'start';
      sheet.style.marginTop = '0px';
      sheet.style.marginTop = `${top - sheet.getBoundingClientRect().top}px`;
      return top;
    };
    grip.addEventListener('pointerdown', e => {
      e.preventDefault();
      const top = pin();
      grip.setPointerCapture(e.pointerId);
      const move = ev => setHeight(ev.clientY - top);
      const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
    });
    grip.addEventListener('keydown', e => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      pin();
      setHeight(sheet.getBoundingClientRect().height + (e.key === 'ArrowDown' ? 40 : -40));
    });
  };
})();
