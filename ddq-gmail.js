/* Send DDQ from the signed-in person's own Gmail (safe-globe.html and employee-portal.html).
 * DdqGmail.send({ request, session, clientId, apiFetch }) shows a note box, asks Google once for permission to send
 * email (gmail.send: send only, no reading), and posts the short-lived token with the note to
 * POST /api/kyc/:id/send-ddq. The token stays in this page's memory until it expires and is never saved.
 * Resolves with the API answer, or null when the person cancels. Demo accounts (no Google) only mark the DDQ as sent.
 */
(function () {
  const SCOPE = 'email https://www.googleapis.com/auth/gmail.send';
  let cached = null; // { token, email, expires }
  let gisLoading = null;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function loadGis() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    if (!gisLoading) {
      gisLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => { gisLoading = null; reject(new Error('Google sign-in could not load. Check the connection.')); };
        document.head.appendChild(s);
      });
    }
    return gisLoading;
  }

  /** Must run inside the click, or the browser blocks Google's pop-up. */
  function getToken(clientId, email) {
    if (cached && cached.email === email && cached.expires > Date.now() + 60000) return Promise.resolve(cached.token);
    return new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        hint: email,
        callback: resp => {
          if (resp.error) return reject(new Error(resp.error_description || resp.error));
          if (!google.accounts.oauth2.hasGrantedAllScopes(resp, 'https://www.googleapis.com/auth/gmail.send')) {
            return reject(new Error('Permission to send email was not given.'));
          }
          cached = { token: resp.access_token, email, expires: Date.now() + Number(resp.expires_in || 3600) * 1000 };
          resolve(resp.access_token);
        },
        error_callback: err => reject(new Error(err && err.type === 'popup_closed' ? 'The Google pop-up was closed.' : 'Google pop-up blocked or failed. Allow pop-ups and try again.'))
      });
      client.requestAccessToken();
    });
  }

  function dialog() {
    let d = document.getElementById('ddq-gmail-dialog');
    if (d) return d;
    d = document.createElement('dialog');
    d.id = 'ddq-gmail-dialog';
    d.style.cssText = 'max-width:460px;width:calc(100% - 32px);border:1px solid rgba(127,127,127,.35);border-radius:12px;padding:20px;background:Canvas;color:CanvasText';
    document.body.appendChild(d);
    return d;
  }

  function send({ request, session, clientId, apiFetch }) {
    const email = session && session.email;
    const canGmail = Boolean(clientId && email && !session.demoAccount && request.counterparty_email);
    const why = !request.counterparty_email ? 'This request has no counterparty email.'
      : !clientId ? 'Google sign-in is not set up on this server.'
      : 'Demo accounts have no Gmail. Sign in with Google to email it.';
    if (canGmail) loadGis().catch(() => {}); // ready before the click, so the pop-up is allowed

    const d = dialog();
    d.innerHTML = `
      <form method="dialog" style="display:flex;flex-direction:column;gap:12px;margin:0">
        <h3 style="margin:0;font-size:16px">Send DDQ to ${esc(request.counterparty_name || 'counterparty')}</h3>
        <div style="font-size:13px;line-height:1.5">
          <div><b>To:</b> ${esc(request.counterparty_email || 'no email on this request')}</div>
          <div><b>From:</b> ${canGmail ? `${esc(email)} (your Gmail)` : 'not emailed'}</div>
        </div>
        ${canGmail
          ? `<label style="font-size:13px;display:flex;flex-direction:column;gap:6px">Note to include in the email (optional)
               <textarea name="note" rows="4" maxlength="2000" style="font:inherit;padding:8px;border-radius:8px;border:1px solid rgba(127,127,127,.45);background:transparent;color:inherit;resize:vertical"></textarea></label>
             <p style="margin:0;font-size:12px;opacity:.75">The first time, Google asks you to allow DueDilly to send email for you. It cannot read your inbox.</p>`
          : `<p style="margin:0;font-size:13px">${esc(why)} The DDQ will be marked as sent and you can copy the link.</p>`}
        <p data-status style="margin:0;font-size:13px;color:#c0392b" hidden></p>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn sm" value="cancel" type="submit">Cancel</button>
          <button class="btn sm primary" value="send" type="button" data-go>${canGmail ? 'Send from my Gmail' : 'Mark as sent'}</button>
        </div>
      </form>`;
    const status = d.querySelector('[data-status]');
    const go = d.querySelector('[data-go]');
    const show = msg => { status.textContent = msg; status.hidden = !msg; };

    return new Promise(resolve => {
      let done = false;
      const finish = v => { if (!done) { done = true; resolve(v); } };
      d.addEventListener('close', () => finish(null), { once: true });
      go.addEventListener('click', async () => {
        show('');
        go.disabled = true;
        try {
          const body = {};
          if (canGmail) {
            await loadGis();
            go.textContent = 'Waiting for Google…';
            body.accessToken = await getToken(clientId, email);
            body.note = d.querySelector('textarea[name="note"]').value;
            go.textContent = 'Sending…';
          }
          const res = await apiFetch(`/api/kyc/${encodeURIComponent(request.id)}/send-ddq`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
          });
          const data = await res.json();
          if (!res.ok) {
            if (/^gmail_/.test(data.code || '')) cached = null;
            throw new Error(data.message || data.error);
          }
          finish(data);
          d.close();
        } catch (err) {
          show(err.message);
          go.disabled = false;
          go.textContent = canGmail ? 'Send from my Gmail' : 'Mark as sent';
        }
      });
      d.showModal();
    });
  }

  window.DdqGmail = { send };
})();
