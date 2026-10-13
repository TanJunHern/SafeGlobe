/**
 * EU consolidated financial sanctions list (CSV, ";" separated): the regimes, by country.
 *
 * How the country view is derived. Every row of the file is one listed person or entity and carries the code of
 * the regime it is listed under (column Entity_Regulation_Programme). Where that code is an ISO 3166-1 alpha-3
 * country code, the country is in the view. Codes that are not a country code (thematic regimes) are left out and
 * reported. Nothing is counted: one listed entry is enough, and the number of entries is not shown as a score.
 *
 * The quote for a country is the regulation and the regime code exactly as they stand next to each other in the
 * file, taken from that regime's most recently published regulation.
 */
const iso = require('../iso3166');

const COLUMNS = { programme: 'Entity_Regulation_Programme', title: 'Entity_Regulation_NumberTitle', published: 'Entity_Regulation_PublicationDate' };

/** Calls onRow(fields) for every record of a CSV text. Quoted fields may hold the separator and line breaks. */
function eachCsvRow(text, separator, onRow) {
  let field = '';
  let row = [];
  let quoted = false;
  let i = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === separator) { row.push(field); field = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') onRow(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); onRow(row); }
}

// dd/mm/yyyy as the file writes dates; anything else sorts first
const sortable = date => { const m = String(date || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}${m[2]}${m[1]}` : ''; };

/** { countries: [{ name, iso3, category, score, evidence_quote, programme }], rejected: [{ name, reason }] } */
function parse(text, view) {
  let index = null;
  const regimes = new Map();
  eachCsvRow(text, ';', row => {
    if (!index) {
      index = Object.fromEntries(Object.entries(COLUMNS).map(([key, column]) => [key, row.indexOf(column)]));
      return;
    }
    const code = (row[index.programme] || '').trim();
    if (!code) return;
    const title = (row[index.title] || '').trim();
    const published = sortable(row[index.published]);
    const known = regimes.get(code);
    if (!known || published > known.published) regimes.set(code, { title, published });
  });
  if (!index) throw new Error('The file is empty.');
  const missing = Object.entries(index).filter(([, at]) => at < 0).map(([key]) => COLUMNS[key]);
  if (missing.length) throw new Error(`The file has no column ${missing.join(', ')}: its layout has changed.`);
  // The quote below is only word for word when the two columns stand next to each other
  if (index.programme !== index.title + 1) throw new Error('The regulation and regime columns are no longer next to each other: the layout has changed.');

  const category = view.categories[0].id;
  const countries = [];
  const rejected = [];
  for (const [code, regime] of regimes) {
    const country = iso.byAlpha3(code);
    if (!country) { rejected.push({ name: code, reason: 'The regime code is not a country code (a thematic regime).' }); continue; }
    countries.push({ iso3: country.a3, name: country.name, category, score: null, evidence_quote: `${regime.title};${code}`, programme: code });
  }
  return { countries, rejected };
}

module.exports = { parse, eachCsvRow };
