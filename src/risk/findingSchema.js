/**
 * The findings format (CLAUDE.md section 4.8) and its validation.
 * A finding is one sourced fact. It is checked here before it is saved; a rejected finding is still stored,
 * with the reason, so the user can audit what was left out.
 */
const crypto = require('crypto');

const QUOTE_MAX = 300;
const FIELDS = ['id', 'category', 'subject', 'summary', 'evidence_quote', 'source_name', 'source_url', 'source_trust',
  'read_at', 'match_basis', 'corroborating_sources', 'agent', 'model_id', 'prompt_version'];

// JSON schema handed to Gemini as the response schema (used from Phase 2). `category` is filled from the rules in force.
function responseSchema(rules) {
  return {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: rules.rows.map(r => r.id) },
        subject: { type: 'string' },
        summary: { type: 'string' },
        evidence_quote: { type: 'string', maxLength: QUOTE_MAX },
        source_name: { type: 'string' },
        source_url: { type: 'string' },
        match_basis: { type: 'string', enum: rules.matchBases },
        corroborating_sources: { type: 'array', items: { type: 'string' } }
      },
      required: ['category', 'subject', 'summary', 'evidence_quote', 'source_name', 'source_url', 'match_basis']
    }
  };
}

const text = v => (typeof v === 'string' ? v.trim() : '');
// A source link is a web address or a page inside this app (source records, KYC requests)
const isLink = v => /^https?:\/\/[^\s]+$/i.test(v) || /^\/[^\s]*$/.test(v);

/**
 * Returns { ok: true, finding } or { ok: false, finding, reason }.
 * `finding` is always the normalised record, so a rejected one can be stored as it was read.
 */
function validateFinding(raw, rules) {
  const f = raw && typeof raw === 'object' ? raw : {};
  const finding = {
    id: text(f.id) || 'F-' + crypto.randomBytes(5).toString('hex'),
    category: text(f.category),
    subject: text(f.subject),
    summary: text(f.summary),
    evidence_quote: text(f.evidence_quote),
    source_name: text(f.source_name),
    source_url: text(f.source_url),
    source_trust: text(f.source_trust),
    read_at: text(f.read_at),
    match_basis: text(f.match_basis),
    corroborating_sources: Array.isArray(f.corroborating_sources) ? f.corroborating_sources.map(text).filter(Boolean) : [],
    agent: text(f.agent),
    model_id: text(f.model_id) || 'none',
    prompt_version: text(f.prompt_version) || 'none'
  };
  if (text(f.ddq_answer_id)) finding.ddq_answer_id = text(f.ddq_answer_id);
  if (f.demo) finding.demo = true;

  const reject = reason => ({ ok: false, finding, reason });
  const row = rules.rowById[finding.category];
  if (!row) return reject(finding.category ? `Unknown category "${finding.category}": it is not a row in the points table.` : 'No category.');
  // No source, no points. The one exception is a DDQ fact, which cites the DDQ answer it came from.
  if (!finding.source_url) {
    if (!(row.ddqFact && finding.ddq_answer_id)) return reject('No source, no points: the finding has no source link.');
  } else if (!isLink(finding.source_url)) {
    return reject('The source link is not a web address or a page in DueDilly.');
  }
  if (!finding.source_name) return reject('No source name.');
  if (!finding.subject) return reject('No subject.');
  if (!finding.summary) return reject('No summary.');
  if (!finding.evidence_quote) return reject('No quote from the source.');
  if (finding.evidence_quote.length > QUOTE_MAX) return reject(`The quote is longer than ${QUOTE_MAX} characters.`);
  if (!rules.sourceTrusts.includes(finding.source_trust)) return reject('Source trust must be High, Medium or Low.');
  if (!rules.matchBases.includes(finding.match_basis)) return reject(`Match basis must be one of: ${rules.matchBases.join(', ')}.`);
  if (!finding.read_at || Number.isNaN(Date.parse(finding.read_at))) return reject('No valid time the source was read.');
  if (!finding.agent) return reject('No agent name.');
  // Only a second identifier confirms a sanctions match; a name alone never does (section 4.5)
  if (finding.category === 'sanctions_confirmed' && finding.match_basis !== 'second_identifier') {
    return reject('A confirmed sanctions match needs a second identifier (date of birth, registration number or IMO).');
  }
  return { ok: true, finding };
}

module.exports = { validateFinding, responseSchema, FIELDS, QUOTE_MAX };
