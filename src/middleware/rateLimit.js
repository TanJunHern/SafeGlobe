/**
 * Per-IP rate limit for every endpoint that calls Gemini, Document AI, Agent Search or the agents service.
 * In memory: the app runs as one instance (docs/CLOUD_PLAN.md decision 3a), so there is nothing to share.
 * AI_RATE_LIMIT_MAX=0 switches it off.
 */
const config = require('../config');

const hits = new Map();

function aiRateLimit(req, res, next) {
  const { max, windowMinutes } = config.aiRateLimit;
  if (!max) return next();
  const windowMs = windowMinutes * 60 * 1000;
  const key = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
  const now = Date.now();
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
  const entry = hits.get(key);
  if (!entry || now - entry.start > windowMs) {
    hits.set(key, { start: now, count: 1 });
    return next();
  }
  if (++entry.count > max) {
    const wait = Math.max(1, Math.ceil((entry.start + windowMs - now) / 60000));
    res.set('Retry-After', String(wait * 60));
    return res.status(429).json({
      error: 'Too many AI requests',
      message: `Dilly needs a short rest. This demo allows ${max} AI requests every ${windowMinutes} minutes per visitor. Please try again in about ${wait} minute${wait === 1 ? '' : 's'}.`
    });
  }
  next();
}

/**
 * A daily budget shared by all users, kept in app_settings so it survives a restart of the same instance.
 * Returns true and counts the use when there is budget left; false when the cap is reached.
 */
function takeDailyBudget(db, name, cap) {
  if (!cap) return true;
  const today = new Date().toISOString().slice(0, 10);
  const key = `daily_budget_${name}`;
  const state = db.getSetting(key, null);
  const used = state && state.day === today ? state.used : 0;
  if (used >= cap) return false;
  db.setSetting(key, { day: today, used: used + 1 });
  return true;
}

function dailyBudgetLeft(db, name, cap) {
  if (!cap) return null;
  const state = db.getSetting(`daily_budget_${name}`, null);
  const today = new Date().toISOString().slice(0, 10);
  return Math.max(0, cap - (state && state.day === today ? state.used : 0));
}

module.exports = { aiRateLimit, takeDailyBudget, dailyBudgetLeft, _reset: () => hits.clear() };
