const config = require('../config');

// Sending a DDQ from the signed-in person's own Gmail.
// The browser asks Google for a short-lived access token with the gmail.send scope (send only, no reading) and passes
// it with the request. The token is used for this one send and is never stored or logged. Before sending, Google is
// asked who the token belongs to: it must be made for this app and for the person who is signed in.
// No error here is a 401: the pages treat a 401 as a sign-in that ended.

const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
// Tests point these at a local stand-in
const endpoints = {
  tokenInfo: 'https://oauth2.googleapis.com/tokeninfo',
  gmail: 'https://gmail.googleapis.com'
};

const fail = (status, message, code) => Object.assign(new Error(message), { status, code });
const oneLine = s => String(s || '').replace(/[\r\n]+/g, ' ').trim(); // a header can never gain a second line
const validEmail = e => /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/.test(e) && e.length <= 200;
const escHtml = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const encodeWord = s => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`);
const b64 = s => Buffer.from(s).toString('base64').replace(/.{76}/g, '$&\r\n');
const address = (name, email) => (name ? `"${encodeWord(oneLine(name).replace(/["\\]/g, ''))}" <${email}>` : email);

/** Who the access token belongs to. Throws unless it is this app's, carries gmail.send, and is the signed-in person's. */
async function checkToken(accessToken, user) {
  const res = await fetch(`${endpoints.tokenInfo}?access_token=${encodeURIComponent(accessToken)}`);
  if (!res.ok) throw fail(400, 'Google did not accept the Gmail permission. Please try again.', 'gmail_token_invalid');
  const info = await res.json();
  if (!config.googleClientId || info.aud !== config.googleClientId) throw fail(403, 'This Gmail permission was not given to DueDilly.', 'gmail_token_wrong_app');
  if (!String(info.scope || '').split(' ').includes(GMAIL_SEND_SCOPE)) throw fail(403, 'Gmail permission to send email was not given.', 'gmail_scope_missing');
  const email = String(info.email || '').toLowerCase();
  if (!email || email !== String(user.email || '').toLowerCase()) {
    throw fail(403, `Choose the Google account you are signed in with (${user.email}) in the Gmail pop-up.`, 'gmail_wrong_account');
  }
  return email;
}

/** The DDQ invitation as a MIME message (plain text and HTML). */
function buildMessage({ from, fromName, to, toName, subject, note, link, organisation }) {
  const greeting = `Dear ${toName || 'Sir or Madam'},`;
  const intro = `${organisation || 'We'} would like you to complete a due diligence questionnaire (DDQ). The link below is for your organisation only and can be used to submit once.`;
  const sign = [fromName || from, organisation].filter(Boolean).join('\n');
  const text = [greeting, '', note ? `${note}\n` : null, intro, '', link, '', 'Thank you,', sign].filter(v => v !== null).join('\n');
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#1d2433">
<p>${escHtml(greeting)}</p>
${note ? `<p style="white-space:pre-wrap">${escHtml(note)}</p>` : ''}
<p>${escHtml(intro)}</p>
<p><a href="${escHtml(link)}" style="display:inline-block;padding:10px 18px;background:#1d4ed8;color:#fff;border-radius:6px;text-decoration:none">Open the questionnaire</a></p>
<p style="font-size:12px;color:#5b6475">Or paste this link into your browser: ${escHtml(link)}</p>
<p>Thank you,<br>${escHtml(sign).replace(/\n/g, '<br>')}</p>
</div>`;
  const boundary = `dd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  return [
    `From: ${address(fromName, from)}`,
    `To: ${address(toName, to)}`,
    `Subject: ${encodeWord(oneLine(subject))}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(text),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(html),
    `--${boundary}--`,
    ''
  ].join('\r\n');
}

/**
 * Send the DDQ link from the signed-in person's Gmail.
 * Returns { sent: true, from, to, messageId, sentAt, note }.
 */
async function sendDdqEmail({ accessToken, user, request, link, note }) {
  const to = String(request.counterparty_email || '').trim().toLowerCase();
  if (!validEmail(to)) throw fail(400, 'This request has no valid counterparty email to send to.', 'no_counterparty_email');
  const cleanNote = String(note || '').trim().slice(0, 2000);
  const from = await checkToken(String(accessToken), user);
  const organisation = user.workspace && !user.workspace.isDemo ? user.workspace.name : (user.department || '');
  const raw = buildMessage({
    from, fromName: user.name, to, toName: request.counterparty_name, note: cleanNote, link, organisation,
    subject: `Due diligence questionnaire for ${request.counterparty_name || 'your organisation'}`
  });
  const res = await fetch(`${endpoints.gmail}/gmail/v1/users/me/messages/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: Buffer.from(raw).toString('base64url') })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = (body.error && body.error.message) || `Gmail answered ${res.status}`;
    throw fail(502, `Gmail did not send the email: ${reason}`, 'gmail_send_failed');
  }
  return { sent: true, from, to, messageId: body.id || null, sentAt: new Date().toISOString(), note: cleanNote };
}

module.exports = { GMAIL_SEND_SCOPE, endpoints, buildMessage, sendDdqEmail };
