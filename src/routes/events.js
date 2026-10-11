/**
 * Where Pub/Sub and Cloud Scheduler deliver events (PUBSUB_MODE=pubsub). Not behind the user sign-in: the caller
 * proves who it is with a Google-signed token made for this app, from the service account named in the settings.
 * An answer of 2xx is only sent after the work is saved; anything else makes Pub/Sub deliver the event again.
 *
 *   POST /events/<event>      a Pub/Sub push: { message: { data: base64(JSON), messageId }, subscription }
 *   POST /events/crawl-due    Cloud Scheduler, once a day: every website source is read by its crawler agent
 */
const express = require('express');
const router = express.Router();
const config = require('../config');
const bus = require('../events/bus');
const { getDb, runInWorkspace } = require('../db');

let verifier = null; // tests replace Google's check
let oauthClient = null;

async function verifiedCaller(req) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !config.pubsubPushAudience || !config.pubsubPushServiceAccount) return false;
  try {
    let claims;
    if (verifier) claims = await verifier(token, config.pubsubPushAudience);
    else {
      if (!oauthClient) oauthClient = new (require('google-auth-library').OAuth2Client)();
      claims = (await oauthClient.verifyIdToken({ idToken: token, audience: config.pubsubPushAudience })).getPayload();
    }
    return Boolean(claims && claims.email_verified && String(claims.email || '').toLowerCase() === config.pubsubPushServiceAccount);
  } catch (err) {
    return false;
  }
}

const workspaceIds = () => require('../accounts/accountsStore').getAccountsStore().listWorkspaceIds();

router.post('/:event', async (req, res) => {
  if (!(await verifiedCaller(req))) return res.status(401).json({ error: 'Only Pub/Sub and Cloud Scheduler may call this, with a token for this app' });
  const event = req.params.event;
  try {
    if (event === 'crawl-due') {
      const crawler = require('../services/crawlerService');
      const results = [];
      for (const workspaceId of workspaceIds()) results.push(...await runInWorkspace(workspaceId, () => crawler.crawlAll(getDb())));
      return res.json({ status: 'done', sourcesRead: results.length });
    }
    if (!bus.EVENTS.includes(event)) return res.status(404).json({ error: 'Unknown event' });
    const message = (req.body && req.body.message) || {};
    let envelope = {};
    try { envelope = JSON.parse(Buffer.from(String(message.data || ''), 'base64').toString('utf8') || '{}'); } catch (err) { return res.status(400).json({ error: 'The message is not JSON' }); }
    if (envelope.event && envelope.event !== event) return res.status(400).json({ error: 'The message is for another event' });
    const messageId = message.messageId || message.message_id || '';
    if (envelope.id && envelope.workspaceId) {
      await bus.deliver(envelope);
    } else {
      // Published by Cloud Scheduler, not by the app: it names no workspace, so it applies to each one
      if (!messageId) return res.status(400).json({ error: 'The message has no id' });
      for (const workspaceId of workspaceIds()) await bus.deliver({ id: `${messageId}:${workspaceId}`, event, workspaceId, at: message.publishTime || new Date().toISOString(), payload: envelope });
    }
    res.status(204).end();
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error(`[Events] ${event} failed, Pub/Sub will deliver it again:`, err.message);
    res.status(500).json({ error: 'The event could not be handled' });
  }
});

module.exports = router;
module.exports._setVerifier = fn => { verifier = fn; };
