/**
 * Client for the ADK agents service (agents/, Cloud Run service duedilly-agents-<env>).
 * Service-to-service authentication: every call carries the shared token, and on Cloud Run also an identity
 * token for the agents service, which is deployed without public access.
 * Every caller must handle a failure: the app then runs its offline fallback.
 */
const config = require('../config');

const configured = () => Boolean(config.agentsServiceUrl && config.agentsInternalToken);

let idTokenClient = null;
async function headers() {
  const out = { 'Content-Type': 'application/json', 'x-internal-token': config.agentsInternalToken };
  // A local agents service (http://localhost:8090) has no IAM in front of it
  if (/^https:\/\//.test(config.agentsServiceUrl)) {
    if (!idTokenClient) {
      const { GoogleAuth } = require('google-auth-library');
      idTokenClient = await new GoogleAuth().getIdTokenClient(config.agentsServiceUrl);
    }
    const auth = await idTokenClient.getRequestHeaders();
    auth.forEach((value, key) => { out[key] = value; });
  }
  return out;
}

async function post(path, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(config.agentsServiceUrl + path, { method: 'POST', headers: await headers(), body: JSON.stringify(body), signal: controller.signal });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const err = new Error(`Agents service answered ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
      err.status = res.status;
      throw err;
    }
    return { res, done: () => clearTimeout(timer) };
  } catch (err) {
    clearTimeout(timer);
    throw err.name === 'AbortError' ? new Error('The agents service did not answer in time') : err;
  }
}

/** Runs Pond-Guard. Calls onEvent for each progress event (one JSON object per line from the service). */
async function screen(payload, onEvent, { timeoutMs = 150000 } = {}) {
  const { res, done } = await post('/pond-guard/screen', payload, timeoutMs);
  try {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) await onEvent(JSON.parse(line));
      }
    }
    if (buffer.trim()) await onEvent(JSON.parse(buffer));
  } finally {
    done();
  }
}

async function ask(payload, { timeoutMs = 45000 } = {}) {
  const { res, done } = await post('/ask', payload, timeoutMs);
  try { return await res.json(); } finally { done(); }
}

/** Crawler agent (feature 3): the records one page names. { records: [{ name, kind, country, identifier, summary, quote }], note, model_id } */
async function crawlerExtract(payload, { timeoutMs = 60000 } = {}) {
  const { res, done } = await post('/crawler/extract', payload, timeoutMs);
  try { return await res.json(); } finally { done(); }
}

/** Crawler agent (feature 9): new extraction instructions for a source whose extraction broke. { instructions, reason, model_id } */
async function crawlerProposeFix(payload, { timeoutMs = 60000 } = {}) {
  const { res, done } = await post('/crawler/propose-fix', payload, timeoutMs);
  try { return await res.json(); } finally { done(); }
}

/** Country risk agent: the countries one page names, each with a category and a quote. { countries: [{ name, category, evidence_quote }], note, model_id } */
async function countryRiskExtract(payload, { timeoutMs = 150000 } = {}) {
  const { res, done } = await post('/country-risk/extract', payload, timeoutMs);
  try { return await res.json(); } finally { done(); }
}

async function health({ timeoutMs = 5000 } = {}) {
  if (!config.agentsServiceUrl) return null;
  try {
    const res = await fetch(config.agentsServiceUrl + '/health', { headers: await headers(), signal: AbortSignal.timeout(timeoutMs) });
    return res.ok ? await res.json() : null;
  } catch (err) {
    return null;
  }
}

module.exports = { configured, screen, ask, crawlerExtract, crawlerProposeFix, countryRiskExtract, health };
