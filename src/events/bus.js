/**
 * Events: screening-requested, screening-completed, ddq-submitted, alert-raised, rescreen-due, source-changed.
 *
 * PUBSUB_MODE=inline (the default, and what dev and the tests use): an event is handled inside the app, right
 * after the request that raised it. PUBSUB_MODE=pubsub: it is published to the Pub/Sub topic <env>-<event> and
 * handled when Pub/Sub pushes it back to POST /events/<event>. If publishing fails, the event is handled inline,
 * so a network error never loses one.
 *
 * Every event carries its own id and the workspace it belongs to. A handler runs once per id: a redelivery
 * does nothing.
 */
const crypto = require('crypto');
const config = require('../config');
const { getDb, runInWorkspace, currentWorkspaceId } = require('../db');

const EVENTS = ['screening-requested', 'screening-completed', 'ddq-submitted', 'alert-raised', 'rescreen-due', 'source-changed'];
const DEMO_WORKSPACE = 'demo';

const handlers = new Map();
const pending = new Set();
const running = new Set();
let last = { mode: config.pubsubMode, at: null, event: null, error: null };

function on(event, handler) {
  if (!handlers.has(event)) handlers.set(event, []);
  handlers.get(event).push(handler);
}

const topicFor = event => `projects/${config.googleCloudProject || config.gcpProjectId}/topics/${config.appEnv || 'dev'}-${event}`;
const live = () => config.pubsubMode === 'pubsub' && Boolean(config.googleCloudProject || config.gcpProjectId);

let authClient = null;
async function accessToken() {
  if (!authClient) {
    const { GoogleAuth } = require('google-auth-library');
    authClient = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/pubsub'] }).getClient();
  }
  const token = await authClient.getAccessToken();
  return token.token || token;
}

/** POST https://pubsub.googleapis.com/v1/{topic}:publish with the event as base64 JSON in messages[].data */
async function publishToPubSub(envelope) {
  const res = await fetch(`https://pubsub.googleapis.com/v1/${topicFor(envelope.event)}:publish`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ data: Buffer.from(JSON.stringify(envelope)).toString('base64'), attributes: { event: envelope.event, workspace: envelope.workspaceId } }] }),
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw new Error(`Pub/Sub answered ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
}

/**
 * Runs the handlers for one event in its workspace. Returns 'handled', 'duplicate' or throws when a handler
 * failed (the push endpoint then answers 500 and Pub/Sub delivers it again).
 */
async function deliver(envelope) {
  if (!envelope || !EVENTS.includes(envelope.event) || !envelope.id) throw Object.assign(new Error('Not a DueDilly event'), { status: 400 });
  const key = `${envelope.workspaceId}:${envelope.id}`;
  if (running.has(key)) return 'duplicate';
  running.add(key);
  try {
    return await runInWorkspace(envelope.workspaceId || DEMO_WORKSPACE, async () => {
      const db = getDb();
      if (db.hasSeenEvent(envelope.id)) return 'duplicate';
      for (const handler of handlers.get(envelope.event) || []) await handler(envelope.payload || {}, envelope);
      db.markEventSeen(envelope.id, envelope.event);
      return 'handled';
    });
  } finally {
    running.delete(key);
  }
}

function deliverInline(envelope) {
  const run = new Promise(resolve => setImmediate(resolve))
    .then(() => deliver(envelope))
    .catch(err => { console.error(`[Events] ${envelope.event} was not handled:`, err.message); })
    .finally(() => pending.delete(run));
  pending.add(run);
}

/** Raises an event. Never throws and never makes the caller wait for the handlers. */
function publish(event, payload = {}, { workspaceId } = {}) {
  if (!EVENTS.includes(event)) throw new Error(`Unknown event "${event}"`);
  const envelope = { id: crypto.randomUUID(), event, workspaceId: workspaceId || currentWorkspaceId() || DEMO_WORKSPACE, at: new Date().toISOString(), payload };
  last = { mode: live() ? 'pubsub' : 'inline', at: envelope.at, event, error: null };
  if (!live()) {
    deliverInline(envelope);
    return envelope;
  }
  const sent = publishToPubSub(envelope)
    .catch(err => {
      console.error(`[Events] Pub/Sub publish failed for ${event}, handling it inside the app:`, err.message);
      last = { mode: 'inline', at: envelope.at, event, error: err.message };
      deliverInline(envelope);
    })
    .finally(() => pending.delete(sent));
  pending.add(sent);
  return envelope;
}

/** Waits until every event raised so far, and every event those raised, has been handled. For tests and scripts. */
async function drain() {
  while (pending.size) await Promise.allSettled([...pending]);
}

const status = () => ({ mode: live() ? 'pubsub' : 'inline', configuredMode: config.pubsubMode, topicPrefix: `${config.appEnv || 'dev'}-`, last });

module.exports = { EVENTS, on, publish, deliver, drain, status, topicFor, _handlers: handlers };
