/**
 * The checks every country risk view passes before the map may use it.
 *
 *   - Every country has an evidence quote, and the quote stands word for word in the saved snapshot.
 *   - The country is found in the fixed ISO 3166-1 list (src/countryRisk/iso3166.js), by code here and never by a model.
 *   - The category is one the view defines; a score lies on the view's scale.
 * Anything that fails is rejected with its reason and kept out of the data.
 */
const iso = require('./iso3166');

const QUOTE_MAX = 300;
const squeeze = text => String(text || '').replace(/\s+/g, ' ').trim();
const LEVEL_ORDER = { low: 0, mid: 1, high: 2 };

/**
 * candidates: [{ name, iso3?, category, score?, evidence_quote, programme? }] from a parser or from the agent.
 * Returns { countries, rejected: [{ name, reason }] }.
 */
function validateCountries(view, candidates, snapshotText) {
  const snapshot = String(snapshotText || '');
  let squeezed = null;
  const inSnapshot = quote => snapshot.includes(quote) || (squeezed === null ? (squeezed = squeeze(snapshot)) : squeezed).includes(quote);
  const categories = new Map((view.categories || []).map(c => [c.id, c]));
  const kept = new Map();
  const rejected = [];

  for (const c of Array.isArray(candidates) ? candidates : []) {
    const name = squeeze(c && c.name).slice(0, 120);
    const label = name || (c && c.iso3) || '(no name)';
    const quote = squeeze(c && c.evidence_quote).slice(0, QUOTE_MAX);
    if (!quote) { rejected.push({ name: label, reason: 'No evidence quote.' }); continue; }
    if (!inSnapshot(quote)) { rejected.push({ name: label, reason: 'The evidence quote is not in the saved snapshot word for word.' }); continue; }
    // A parser may give the code the file itself uses; a name is looked up in the fixed list
    const country = c.iso3 ? iso.byAlpha3(c.iso3) : iso.byName(name);
    if (!country) { rejected.push({ name: label, reason: c.iso3 ? 'The code is not in the ISO country list.' : 'The name is not in the ISO country list.' }); continue; }

    let category = null;
    let score = null;
    if (view.kind === 'score') {
      score = typeof c.score === 'number' && Number.isFinite(c.score) ? c.score : null;
      const { min, max } = view.scale || {};
      if (score === null || score < min || score > max) { rejected.push({ name: label, reason: 'The score is missing or outside the scale of the source.' }); continue; }
    } else {
      category = String((c && c.category) || '');
      if (!categories.has(category)) { rejected.push({ name: label, reason: `"${category}" is not a category of this view.` }); continue; }
    }

    const entry = { iso3: country.a3, name: country.name, category, score, evidence_quote: quote };
    if (c.programme) entry.programme = squeeze(c.programme).slice(0, 200);
    const before = kept.get(country.a3);
    if (!before) { kept.set(country.a3, entry); continue; }
    // Named twice: the riskier category wins, and the other quote is kept beside it
    const riskier = view.kind !== 'score' && LEVEL_ORDER[categories.get(category).level] > LEVEL_ORDER[categories.get(before.category).level];
    const [main, other] = riskier ? [entry, before] : [before, entry];
    const more = [...(before.other_evidence || []), other.evidence_quote].filter((q, i, all) => q !== main.evidence_quote && all.indexOf(q) === i).slice(0, 8);
    kept.set(country.a3, Object.assign({}, main, more.length ? { other_evidence: more } : {}));
  }
  return { countries: [...kept.values()].sort((a, b) => a.name.localeCompare(b.name)), rejected };
}

/** The shape of a view's JSON file. Returns a list of what is wrong; empty when the document is valid. */
function documentErrors(doc, view) {
  const errors = [];
  const text = key => typeof doc[key] === 'string' && doc[key].trim() !== '';
  if (!doc || typeof doc !== 'object') return ['The document is not an object.'];
  if (doc.view_id !== view.id) errors.push('view_id does not match the view.');
  for (const key of ['source_name', 'source_url', 'licence_note']) if (!text(key)) errors.push(`${key} is missing.`);
  if (!text('fetched_at') || Number.isNaN(Date.parse(doc.fetched_at))) errors.push('fetched_at is not a date.');
  if (!/^[0-9a-f]{64}$/.test(doc.content_hash || '')) errors.push('content_hash is not a sha256.');
  if (!['structured', 'llm', 'upload'].includes(doc.method)) errors.push('method is not structured, llm or upload.');
  if (doc.method === 'llm' && !text('model_id')) errors.push('model_id is missing for an AI extracted view.');
  if (!Array.isArray(doc.countries) || !doc.countries.length) errors.push('countries is empty.');
  const categories = new Set((view.categories || []).map(c => c.id));
  for (const c of Array.isArray(doc.countries) ? doc.countries : []) {
    const where = (c && c.iso3) || '(no code)';
    if (!c || !/^[A-Z]{3}$/.test(c.iso3 || '') || !iso.byAlpha3(c.iso3)) { errors.push(`${where}: not an ISO 3166-1 alpha-3 code.`); continue; }
    if (typeof c.name !== 'string' || !c.name) errors.push(`${where}: no name.`);
    if (typeof c.evidence_quote !== 'string' || !c.evidence_quote.trim()) errors.push(`${where}: no evidence quote.`);
    if (view.kind === 'score') { if (typeof c.score !== 'number') errors.push(`${where}: no score.`); } else if (!categories.has(c.category)) errors.push(`${where}: unknown category.`);
    if (c.score !== null && typeof c.score !== 'number') errors.push(`${where}: score is neither a number nor null.`);
  }
  return errors;
}

module.exports = { validateCountries, documentErrors, squeeze, QUOTE_MAX };
