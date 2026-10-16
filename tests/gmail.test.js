const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Must be set before the server reads its config
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';

const { startServer, stopServer } = require('../src/server');
const gmailService = require('../src/services/gmailService');

const TEST_PORT = 8097;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const EMPLOYEE = { 'x-user-email': 'john.doe@duedilly.com', 'x-user-name': 'John Doe', 'Content-Type': 'application/json' };
const SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

// Stand-in for Google: tokeninfo answers from TOKENS, Gmail send records what it was given
const TOKENS = {
  good: { aud: 'test-client.apps.googleusercontent.com', email: 'john.doe@duedilly.com', scope: `email ${SEND_SCOPE}` },
  otherApp: { aud: 'someone-else.apps.googleusercontent.com', email: 'john.doe@duedilly.com', scope: SEND_SCOPE },
  otherPerson: { aud: 'test-client.apps.googleusercontent.com', email: 'mallory@example.com', scope: SEND_SCOPE },
  noSend: { aud: 'test-client.apps.googleusercontent.com', email: 'john.doe@duedilly.com', scope: 'email' }
};
const sent = [];
const fake = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/tokeninfo') {
    const info = TOKENS[url.searchParams.get('access_token')];
    res.writeHead(info ? 200 : 400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(info || { error: 'invalid_token' }));
  }
  if (url.pathname === '/gmail/v1/users/me/messages/send') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      sent.push({ auth: req.headers.authorization, raw: Buffer.from(JSON.parse(body).raw, 'base64url').toString() });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'msg-123', threadId: 't-1' }));
    });
    return;
  }
  res.writeHead(404); res.end();
});

const decodeParts = raw => raw.split(/\r\n--dd_[^\r\n]+/).map(part => {
  const [head, ...rest] = part.split('\r\n\r\n');
  return /base64/.test(head) ? Buffer.from(rest.join('').replace(/\s/g, ''), 'base64').toString() : part;
}).join('\n');

test('DDQ by Gmail', async (t) => {
  await new Promise(r => fake.listen(0, r));
  const base = `http://localhost:${fake.address().port}`;
  gmailService.endpoints.tokenInfo = `${base}/tokeninfo`;
  gmailService.endpoints.gmail = base;
  await startServer(TEST_PORT);

  const newRequest = async (email = 'kyc@harbourline.example') => {
    const res = await fetch(`${BASE_URL}/api/kyc/submit`, {
      method: 'POST', headers: EMPLOYEE,
      body: JSON.stringify({ counterparty_name: 'Harbourline Logistics Pte Ltd', entity_type: 'Organisation', country: 'SGP',
        relationship_type: 'Vendor/Supplier', contract_value: 180000, counterparty_email: email })
    });
    assert.equal(res.status, 201);
    const { request } = await res.json();
    assert.equal(request.ddq_status, 'Triggered');
    return request;
  };
  const sendDdq = (id, body) => fetch(`${BASE_URL}/api/kyc/${id}/send-ddq`, { method: 'POST', headers: EMPLOYEE, body: JSON.stringify(body) });

  try {
    await t.test('emails the DDQ link with the note from the signed-in person\'s Gmail', async () => {
      const request = await newRequest();
      const res = await sendDdq(request.id, { accessToken: 'good', note: 'Hi team,\nplease reply by Friday. <b>Thanks</b>' });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.delivery.sent, true);
      assert.equal(data.delivery.from, 'john.doe@duedilly.com');
      assert.equal(data.delivery.to, 'kyc@harbourline.example');
      assert.equal(data.delivery.messageId, 'msg-123');
      assert.equal(data.request.ddq_status, 'Sent to Counterparty');
      assert.equal(data.request.ddq_email.messageId, 'msg-123');
      assert.equal(data.request.ddq_email.note, 'Hi team,\nplease reply by Friday. <b>Thanks</b>');

      const mail = sent.at(-1);
      assert.equal(mail.auth, 'Bearer good');
      assert.match(mail.raw, /^From: "John Doe" <john\.doe@duedilly\.com>\r\nTo: "Harbourline Logistics Pte Ltd" <kyc@harbourline\.example>\r\n/);
      const body = decodeParts(mail.raw);
      assert.ok(body.includes(`${BASE_URL}${request.ddq_link}`), 'the link is absolute and points at this server');
      assert.ok(body.includes('please reply by Friday. &lt;b&gt;Thanks&lt;/b&gt;'), 'the note is escaped in the HTML part');
      assert.ok(body.includes('please reply by Friday. <b>Thanks</b>'), 'the note is as typed in the text part');
    });

    await t.test('refuses a token for another app, another person, or without gmail.send, and sends nothing', async () => {
      for (const [token, status, code] of [['otherApp', 403, 'gmail_token_wrong_app'], ['otherPerson', 403, 'gmail_wrong_account'],
        ['noSend', 403, 'gmail_scope_missing'], ['unknown', 400, 'gmail_token_invalid']]) {
        const request = await newRequest();
        const before = sent.length;
        const res = await sendDdq(request.id, { accessToken: token });
        assert.equal(res.status, status, token);
        assert.equal((await res.json()).code, code);
        assert.equal(sent.length, before, `${token}: nothing sent`);
        const after = await (await fetch(`${BASE_URL}/api/kyc/${request.id}`, { headers: EMPLOYEE })).json();
        assert.equal((after.request || after).ddq_status, 'Triggered', `${token}: still waiting to be sent`);
      }
    });

    await t.test('without a token the DDQ is only marked as sent, and says so', async () => {
      const request = await newRequest();
      const res = await sendDdq(request.id, {});
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.delivery.sent, false);
      assert.equal(data.request.ddq_status, 'Sent to Counterparty');
      assert.equal(data.request.ddq_email, null);
    });

    await t.test('a header cannot be injected through the note or the names', () => {
      const raw = gmailService.buildMessage({ from: 'a@b.co', fromName: 'Eve\r\nBcc: x@evil.example', to: 'c@d.co', toName: 'C', subject: 'S\r\nBcc: y@evil.example', note: 'n', link: 'https://x', organisation: 'O' });
      const headers = raw.split('\r\n\r\n')[0];
      assert.ok(!/^Bcc:/mi.test(headers));
    });
  } finally {
    await stopServer();
    fake.close();
  }
});
