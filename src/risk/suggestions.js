/**
 * Recommended changes to the scoring rules, raised when a policy or a source is added.
 *
 * This compares the policy text with the rules in force and proposes a change where they differ: a threshold
 * the policy states differently, a clause a row should cite, or a policy clause no row scores.
 * The comparison is rule-based, so it works offline. A suggestion is only ever applied by a person
 * (Reviews > Scoring rules); nothing here changes a rule.
 */
const crypto = require('crypto');
const { getRules } = require('./rulesStore');

const SETTING = 'risk_suggestions';
const LIMIT = 100;

const num = s => Number(String(s).replace(/[,\s]/g, ''));
const sentences = text => String(text || '').replace(/\s+/g, ' ').split(/(?<=[.;!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
const sectionOf = s => (s.match(/§\s?\d+(?:\.\d+)*/) || [''])[0].replace(/\s/g, '');

// A threshold a policy sentence can state, and how to read the number out of it
const THRESHOLD_PATTERNS = [
  { key: 'cpiLow', re: /\b(?:below|under|less than|lower than)\s+(\d{1,2})\b[^.]{0,30}\bCPI\b|\bCPI\b[^.]{0,40}?\b(?:below|under|less than|lower than)\s+(\d{1,2})\b/i },
  { key: 'aisDarkHours', re: /\bAIS\b[^.]{0,40}?\b(?:over|more than|longer than|exceed\w*|above)\s+(\d{1,3})\s*hours?/i },
  { key: 'aisWindowDays', re: /\bAIS\b[^.]{0,80}?\b(?:last|past|previous)\s+(\d{1,3})\s*days/i },
  { key: 'contractValueSgd', re: /\b(?:contract|transaction|deal)\b[^.]{0,60}?\b(?:above|over|exceed\w*|more than|greater than)\s+(?:SGD|S\$)\s*([\d,]+)/i },
  { key: 'flagChanges', re: /\b(\d{1,2})\s+or more flag changes?/i },
  { key: 'flagWindowYears', re: /\bflag changes?\b[^.]{0,30}?\b(\d{1,2})\s*years?/i },
  { key: 'ddqOverdueDays', re: /\b(?:DDQ|questionnaire)\b[^.]{0,60}?\b(?:after|within)\s+(\d{1,3})\s*(?:calendar |working |business )?days/i },
  { key: 'adverseMediaMonths', re: /\badverse media\b[^.]{0,40}?\b(?:last|past|previous)\s+(\d{1,3})\s*months/i }
];

// Words that tie a policy sentence to a row, used to propose the clause a row should cite
const ROW_KEYWORDS = {
  sanctions_possible: /\bsanction/i,
  pep_owner: /\bpolitically exposed|\bPEP\b/i,
  pep_associate: /\b(?:family|associate)[^.]{0,30}(?:politically exposed|PEP)|(?:politically exposed|PEP)[^.]{0,30}(?:family|associate)/i,
  country_cpi_low: /\bCPI\b|\bcorruption perceptions/i,
  adverse_media_severe: /\badverse media\b|\bnegative news\b/i,
  ownership_unclear: /\bbeneficial owner|\bnominee|\bbearer share|\bownership\b/i,
  broker_intermediary: /\bbroker|\bintermediar|\bagent\b/i,
  vessel_ais_dark: /\bAIS\b/i,
  vessel_sts_transfer: /\bship-to-ship|\bSTS\b/i,
  vessel_flag_changes: /\bflag change/i,
  contract_value_high: /\bcontract value|\bcontract\b[^.]{0,40}SGD/i,
  ddq_not_returned: /\b(?:DDQ|questionnaire)\b[^.]{0,60}\bdays\b/i
};

/** Uploaded content arrives as text, or as base64 (optionally a data URL). Returns readable text, or '' for a binary file such as a PDF. */
function readableText(content) {
  let text = String(content || '');
  if (!text) return '';
  const dataUrl = text.match(/^data:[^;,]*;base64,(.*)$/s);
  if (dataUrl) text = dataUrl[1];
  if (/^[A-Za-z0-9+/=\s]+$/.test(text) && text.replace(/\s/g, '').length % 4 === 0 && text.length > 40) {
    try { text = Buffer.from(text, 'base64').toString('utf8'); } catch (e) { return ''; }
  }
  if (text.startsWith('%PDF')) return '';
  const sample = text.slice(0, 2000);
  const odd = (sample.match(/[\u0000-\u0008\u000E-\u001F�]/g) || []).length;
  return odd > sample.length * 0.02 ? '' : text;
}

/** Compares policy clauses with the rules. clauses: [{ section, text, origin }]. Returns suggestions without ids. */
function compare(clauses, rules) {
  const out = [];
  const cited = new Set(rules.rows.map(r => r.policy).filter(Boolean));

  for (const clause of clauses) {
    for (const sentence of sentences(clause.text)) {
      const section = sectionOf(sentence) || clause.section || '';
      let matchedThreshold = false;

      for (const p of THRESHOLD_PATTERNS) {
        const m = sentence.match(p.re);
        if (!m) continue;
        matchedThreshold = true;
        const value = num(m.slice(1).find(Boolean));
        const meta = rules.thresholdMeta[p.key];
        if (!Number.isInteger(value) || value === meta.value || value < meta.min || value > meta.max) continue;
        out.push({
          key: `threshold:${p.key}:${value}`, kind: 'threshold', target: p.key,
          title: `${meta.label}: change ${meta.value.toLocaleString('en-SG')} to ${value.toLocaleString('en-SG')}`,
          why: `${section ? `Policy ${section}` : 'The policy'} states ${value.toLocaleString('en-SG')} ${meta.unit}. The scoring rules use ${meta.value.toLocaleString('en-SG')}.`,
          quote: sentence.slice(0, 300), section, origin: clause.origin, patch: { thresholds: { [p.key]: value } }
        });
      }

      if (!section) continue;
      let matchedRow = false;
      for (const [rowId, re] of Object.entries(ROW_KEYWORDS)) {
        if (!re.test(sentence)) continue;
        matchedRow = true;
        const row = rules.rowById[rowId];
        // Only fill a row that cites nothing yet: an existing citation is the user's or the default policy's choice
        if (!row || row.policy) continue;
        out.push({
          key: `policy:${rowId}:${section}`, kind: 'policy', target: rowId,
          title: `"${row.short}": cite policy ${section}`,
          why: `Policy ${section} covers this row, and the row cites no clause yet.`,
          quote: sentence.slice(0, 300), section, origin: clause.origin, patch: { policy: { [rowId]: section } }
        });
      }

      if (!matchedRow && !matchedThreshold && !cited.has(section)) {
        out.push({
          key: `row:${section}`, kind: 'row', target: section,
          title: `No scoring row covers policy ${section}`,
          why: `Nothing in the points table scores this clause. Add a row if it should add risk points. It starts at 0 points: you set the number.`,
          quote: sentence.slice(0, 300), section, origin: clause.origin,
          patch: { addRows: [{ label: sentence.replace(/§\s?\d+(?:\.\d+)*[:.]?\s*/g, '').slice(0, 150), points: 0, policy: section }] }
        });
      }
    }
  }
  const seen = new Set();
  return out.filter(s => (seen.has(s.key) ? false : seen.add(s.key)));
}

const list = db => db.getSetting(SETTING, []) || [];
const openSuggestions = db => list(db).filter(s => s.status === 'open');

/**
 * Called after a policy or a source is added. Compares the stored policies plus the new text with the rules
 * and stores any new suggestion. Returns the suggestions that are new this time.
 */
function raiseFor(db, { type, name, text = '', section = '', source = null }) {
  const rules = getRules(db);
  const origin = { type, name: String(name || '').slice(0, 120) };
  const clauses = db.getPolicies().map(p => ({ section: p.sec, text: `${p.sec} ${p.t}`, origin: { type: 'policy', name: `${p.id} ${p.sec}` } }));
  const readable = readableText(text);
  if (readable) clauses.push({ section, text: readable, origin });

  const found = compare(clauses, rules);

  // A source's trust level feeds the confidence formula; say so once per new source
  if (source && source.trust && rules.sourceTrusts.includes(source.trust)) {
    const weight = rules.confidence.sourceTrust[source.trust];
    found.push({
      key: `source:${source.id || source.label}`, kind: 'source', target: 'sourceTrust',
      title: `"${source.label}" is rated ${source.trust} trust`,
      why: `Findings read from it are weighted ${weight} in the confidence formula. Check the source-trust weights still suit your sources.`,
      quote: '', section: '', origin, patch: null
    });
  }

  const all = list(db);
  const known = new Set(all.map(s => s.key));
  const fresh = found.filter(s => !known.has(s.key)).map(s => Object.assign({
    id: 'SG-' + crypto.randomBytes(4).toString('hex'), status: 'open', createdAt: new Date().toISOString()
  }, s));
  if (fresh.length) db.setSetting(SETTING, [...fresh, ...all].slice(0, LIMIT));
  return fresh;
}

function setStatus(db, id, status, by = '') {
  const all = list(db);
  const s = all.find(x => x.id === id);
  if (!s) return null;
  Object.assign(s, { status, decidedAt: new Date().toISOString(), decidedBy: by });
  db.setSetting(SETTING, all);
  return s;
}

module.exports = { compare, raiseFor, list, openSuggestions, setStatus, readableText, THRESHOLD_PATTERNS };
