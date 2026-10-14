/**
 * Minimal Gemini REST client shared by the DDQ assistant features.
 * Every caller must handle a null result: no key, timeout and bad output all return null
 * so the feature can fall back to its offline behaviour.
 */
const config = require('../config');

/**
 * Which backend answers Gemini calls right now: 'aistudio', 'vertex' or 'disabled'.
 * GEMINI_BACKEND=vertex needs a project, a location and a model chosen from the models the project can use
 * (VERTEX_GEMINI_MODEL). Without them it reports 'disabled' rather than quietly using the AI Studio key in an
 * environment meant for Vertex AI.
 */
function backend() {
  if (config.geminiBackend === 'vertex') {
    return config.googleCloudProject && config.googleCloudLocation && config.vertexModel ? 'vertex' : 'disabled';
  }
  const key = config.geminiApiKey || '';
  return key.length > 20 && !/^YOUR_/i.test(key) ? 'aistudio' : 'disabled';
}

// Vertex AI signs requests with Application Default Credentials: your gcloud sign-in locally, the service account on Cloud Run
let vertexAuth = null;
async function vertexHeaders() {
  if (!vertexAuth) {
    const { GoogleAuth } = require('google-auth-library');
    vertexAuth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  }
  const headers = await vertexAuth.getRequestHeaders();
  const out = { 'Content-Type': 'application/json' };
  headers.forEach((value, key) => { out[key] = value; });
  return out;
}

/** Where a generateContent call goes, for the backend in use. Exported for tests. */
function endpointFor(model, which = backend()) {
  if (which === 'vertex') {
    const loc = config.googleCloudLocation;
    const host = loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`;
    return `https://${host}/v1/projects/${config.googleCloudProject}/locations/${loc}/publishers/google/models/${model}:generateContent`;
  }
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.geminiApiKey}`;
}

/** The request body both backends accept. responseSchema makes the model return JSON in that shape. Exported for tests. */
function buildBody(parts, { json = false, temperature = 0.2, systemInstruction = '', responseSchema = null } = {}) {
  const generationConfig = Object.assign({ temperature }, json || responseSchema ? { responseMimeType: 'application/json' } : {}, responseSchema ? { responseSchema } : {});
  return Object.assign({ contents: [{ role: 'user', parts }], generationConfig },
    systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {});
}

function isConfigured() {
  return backend() !== 'disabled';
}

// Model names are retired and quotas differ per model, so a rejected model falls through to the next
function modelChain() {
  const chain = backend() === 'vertex'
    ? [config.vertexModel, ...(config.vertexFallbackModels || [])].filter(Boolean)
    : [config.geminiModel, ...(config.geminiFallbackModels || [])].filter(Boolean);
  return [...new Set(chain)];
}

// Models that just failed are skipped for a while so every call does not pay for the same dead ends
const cooldownUntil = new Map();
const COOLDOWN_MS = { 404: 60 * 60 * 1000, 429: 5 * 60 * 1000, 503: 60 * 1000, timeout: 60 * 1000 };
function coolDown(model, reason) {
  cooldownUntil.set(model, Date.now() + (COOLDOWN_MS[reason] || 60 * 1000));
}

async function generate(parts, { json = false, temperature = 0.2, timeoutMs = 20000, systemInstruction = '', withModel = false, responseSchema = null } = {}) {
  if (!isConfigured()) return null;
  const which = backend();
  // Each model gets one retry on 503 (overloaded) before moving on
  const chain = modelChain();
  const healthy = chain.filter(m => (cooldownUntil.get(m) || 0) < Date.now());
  // If everything is cooling down, try the whole chain again rather than giving up outright
  const attempts = (healthy.length ? healthy : chain).flatMap(m => [m, m]);
  let skip = null;
  for (let i = 0; i < attempts.length; i++) {
    const model = attempts[i];
    if (model === skip) continue;
    const url = endpointFor(model, which);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: which === 'vertex' ? await vertexHeaders() : { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody(parts, { json, temperature, systemInstruction, responseSchema }))
      });
      if (!resp.ok) {
        console.error(`[Feather-Weight] ${model}: ${resp.status} ${resp.statusText}`);
        if (resp.status === 503 && attempts[i + 1] === model) { await new Promise(r => setTimeout(r, 800)); continue; }
        if ([404, 429, 503].includes(resp.status)) { skip = model; coolDown(model, resp.status); continue; } // retired, over quota or overloaded
        return null;
      }
      const body = await resp.json();
      const text = (body?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
      if (!text) return null;
      return withModel ? { text, model } : text;
    } catch (err) {
      console.error(`[Feather-Weight] ${model}: request failed:`, err.name === 'AbortError' ? 'timeout' : err.message);
      skip = model;
      coolDown(model, 'timeout');
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

async function generateText(prompt, opts = {}) {
  return generate([{ text: prompt }], opts);
}

async function generateJson(parts, opts = {}) {
  const text = await generate(Array.isArray(parts) ? parts : [{ text: parts }], Object.assign({ temperature: 0.1 }, opts, { json: true }));
  if (!text) return null;
  try {
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch (err) {
    console.error('[Feather-Weight] could not parse JSON output');
    return null;
  }
}

/**
 * Like generateJson, but also reports which model in the fallback chain answered.
 * Returns { data, model } or null.
 */
async function generateJsonDetailed(parts, opts = {}) {
  const out = await generate(Array.isArray(parts) ? parts : [{ text: parts }], Object.assign({ temperature: 0.1 }, opts, { json: true, withModel: true }));
  if (!out) return null;
  try {
    return { data: JSON.parse(out.text.replace(/^```(?:json)?\s*|\s*```$/g, '')), model: out.model };
  } catch (err) {
    console.error('[Feather-Weight] could not parse JSON output');
    return null;
  }
}

module.exports = { isConfigured, backend, generateText, generateJson, generateJsonDetailed, modelChain, endpointFor, buildBody };
