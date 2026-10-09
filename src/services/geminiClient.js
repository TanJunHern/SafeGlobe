/**
 * Minimal Gemini REST client shared by the DDQ assistant features.
 * Every caller must handle a null result: no key, timeout and bad output all return null
 * so the feature can fall back to its offline behaviour.
 */
const config = require('../config');

function isConfigured() {
  const key = config.geminiApiKey || '';
  return key.length > 20 && !/^YOUR_/i.test(key);
}

// Model names are retired and quotas differ per model, so a rejected model falls through to the next
function modelChain() {
  const chain = [config.geminiModel, ...(config.geminiFallbackModels || [])].filter(Boolean);
  return [...new Set(chain)];
}

// Models that just failed are skipped for a while so every call does not pay for the same dead ends
const cooldownUntil = new Map();
const COOLDOWN_MS = { 404: 60 * 60 * 1000, 429: 5 * 60 * 1000, 503: 60 * 1000, timeout: 60 * 1000 };
function coolDown(model, reason) {
  cooldownUntil.set(model, Date.now() + (COOLDOWN_MS[reason] || 60 * 1000));
}

async function generate(parts, { json = false, temperature = 0.2, timeoutMs = 20000, systemInstruction = '', withModel = false } = {}) {
  if (!isConfigured()) return null;
  // Each model gets one retry on 503 (overloaded) before moving on
  const chain = modelChain();
  const healthy = chain.filter(m => (cooldownUntil.get(m) || 0) < Date.now());
  // If everything is cooling down, try the whole chain again rather than giving up outright
  const attempts = (healthy.length ? healthy : chain).flatMap(m => [m, m]);
  let skip = null;
  for (let i = 0; i < attempts.length; i++) {
    const model = attempts[i];
    if (model === skip) continue;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.geminiApiKey}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({
          contents: [{ parts }],
          generationConfig: Object.assign({ temperature }, json ? { responseMimeType: 'application/json' } : {})
        }, systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}))
      });
      if (!resp.ok) {
        console.error(`[Gemini] ${model}: ${resp.status} ${resp.statusText}`);
        if (resp.status === 503 && attempts[i + 1] === model) { await new Promise(r => setTimeout(r, 800)); continue; }
        if ([404, 429, 503].includes(resp.status)) { skip = model; coolDown(model, resp.status); continue; } // retired, over quota or overloaded
        return null;
      }
      const body = await resp.json();
      const text = (body?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
      if (!text) return null;
      return withModel ? { text, model } : text;
    } catch (err) {
      console.error(`[Gemini] ${model}: request failed:`, err.name === 'AbortError' ? 'timeout' : err.message);
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
    console.error('[Gemini] could not parse JSON output');
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
    console.error('[Gemini] could not parse JSON output');
    return null;
  }
}

module.exports = { isConfigured, generateText, generateJson, generateJsonDetailed, modelChain };
