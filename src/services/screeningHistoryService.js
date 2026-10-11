/**
 * Ask Dilly about past screenings: counts, lists and look-ups over the KYC requests
 * already in the database ("how many have been screened?", "which are high risk?",
 * "what happened with Lion City Packaging?").
 *
 * Deterministic first. A question it does not recognise goes to the shared Gemini client
 * with the same records as context, when a key is configured; otherwise it is left to the
 * caller (the Ask panel then screens the text as a counterparty name).
 */

const { getDb } = require('../db');
const gemini = require('./geminiClient');

const OPEN = r => !['Approved', 'Rejected'].includes(r.request_status);
const FLAGGED = r => r.screening_result && r.screening_result !== 'Clear';
const DDQ_OUT = r => ['Sent to Counterparty', 'Returned to Counterparty'].includes(r.ddq_status);

const row = r => ({
  id: r.id,
  name: r.counterparty_name,
  status: r.request_status,
  sub: `${r.id} · ${r.entity_type} · ${r.country} · ${r.screening_result} · ${r.request_status}${r.ddq_status && r.ddq_status !== 'N/A' ? ` · DDQ ${r.ddq_status}` : ''}`
});
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const tally = (list, key) => Object.entries(list.reduce((m, r) => { const k = key(r) || 'Unknown'; m[k] = (m[k] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]);
const breakdown = pairs => pairs.map(([k, n]) => `${n} ${k}`).join(', ');

function reply(sum, list, all, step) {
  return {
    answered: true,
    sum,
    rows: list.slice(0, 12).map(row),
    more: Math.max(0, list.length - 12),
    steps: [`Read the question: ${step}`, `Looked through ${plural(all.length, 'screening request', 'screening requests')} on record`],
    src: `Screening history · ${plural(all.length, 'request', 'requests')}`
  };
}

// The request whose counterparty name the question mentions, if any
function findNamed(q, all) {
  const clean = s => s.toLowerCase().replace(/\b(pte|ltd|llc|inc|sdn|bhd|co|corp|limited|company|the|fze|plc)\b\.?/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const cq = ` ${clean(q)} `;
  return all
    .map(r => ({ r, key: clean(r.counterparty_name) }))
    .filter(x => x.key.length >= 4 && cq.includes(` ${x.key} `))
    .sort((a, b) => b.key.length - a.key.length)
    .map(x => x.r);
}

/**
 * @param question text typed into Ask Dilly
 * @param options  { email: only this employee's requests, or null for all }
 * @returns { answered: true, sum, rows, steps, src } or { answered: false }
 */
function answerFromHistory(question, { email = null } = {}) {
  const q = String(question || '').toLowerCase().trim();
  if (!q) return { answered: false };
  const all = getDb().getAllKycRequests(email ? { created_by_email: email } : {});
  const asksCount = /\bhow many\b|\bnumber of\b|\bcount\b|\btotal\b/.test(q);
  const asksList = /\b(which|list|show|what are|who are|give me)\b/.test(q);
  const aboutScreening = /screen|request|counterpart|kyc|onboard|supplier|vendor|compan|check/.test(q);

  // A named counterparty: what happened the last time it was screened
  const named = findNamed(q, all);
  if (named.length) {
    const r = named[0];
    const agent = r.agent && (r.agent.ddq || r.agent.intake);
    const parts = [
      `${r.counterparty_name} was screened on ${String(r.submission_date || '').slice(0, 10)} (${r.id}).`,
      `Screening result: ${r.screening_result}. AI risk: ${r.ai_result}.`,
      `Status: ${r.request_status}${r.ddq_status && r.ddq_status !== 'N/A' ? `, questionnaire ${r.ddq_status.toLowerCase()}` : ''}.`,
      agent && agent.recommendation_label ? `Compliance Agent recommends: ${agent.recommendation_label}.` : '',
      r.ongoing_monitoring ? 'Ongoing monitoring is on.' : '',
      r.re_screening_result ? r.re_screening_result : ''
    ].filter(Boolean);
    return reply(parts.join(' '), named, all, `previous screening of ${r.counterparty_name}`);
  }

  if (/ongoing|monitor|re-?screen/.test(q)) {
    const list = all.filter(r => r.ongoing_monitoring);
    const active = list.filter(r => r.request_status === 'Approved');
    let cost = '';
    try {
      const totals = require('./monitoringService').listMonitoring({ email }).totals;
      if (totals.per_year > 0) cost = ` Re-screening them costs about SGD ${totals.per_year.toLocaleString('en-SG')} a year.`;
    } catch (e) {}
    return reply(`${plural(list.length, 'counterparty has', 'counterparties have')} ongoing monitoring switched on; ${active.length} ${active.length === 1 ? 'is' : 'are'} approved and being re-screened.${cost}`, list, all, 'ongoing monitoring');
  }
  if (/sanction|pep\b|watchlist|high[- ]risk|flag|alert|risky|escalat|hit/.test(q)) {
    const list = all.filter(FLAGGED);
    return reply(list.length ? `${plural(list.length, 'screening', 'screenings')} came back with a hit: ${breakdown(tally(list, r => r.screening_result))}.` : 'No screening on record came back with a sanctions, PEP or watchlist hit.', list, all, 'screenings with a hit');
  }
  if (/questionnaire|ddq/.test(q)) {
    const list = all.filter(r => r.ddq_required || (r.ddq_status && r.ddq_status !== 'N/A'));
    const out = list.filter(DDQ_OUT);
    return reply(`${plural(list.length, 'request needs', 'requests need')} a questionnaire: ${breakdown(tally(list, r => r.ddq_status))}. ${out.length} ${out.length === 1 ? 'is' : 'are'} with the counterparty now.`, asksCount && !asksList ? out : list, all, 'questionnaires');
  }
  if (/reject|declin|denied/.test(q)) {
    const list = all.filter(r => r.request_status === 'Rejected');
    return reply(`${plural(list.length, 'request has', 'requests have')} been rejected.`, list, all, 'rejected requests');
  }
  if (/approv|clear(ed)?\b|passed|onboarded/.test(q)) {
    const list = all.filter(r => r.request_status === 'Approved');
    return reply(`${plural(list.length, 'request has', 'requests have')} been approved, ${list.filter(r => !r.ddq_required).length} of them without a questionnaire.`, list, all, 'approved requests');
  }
  if (/pending|open|waiting|outstanding|in progress|under review|to do|backlog/.test(q)) {
    const list = all.filter(OPEN);
    return reply(`${plural(list.length, 'request is', 'requests are')} still open: ${breakdown(tally(list, r => r.request_status)) || 'none'}.`, list, all, 'open requests');
  }
  if (/vessel|ship/.test(q) && (asksCount || asksList)) {
    const list = all.filter(r => r.entity_type === 'Vessel');
    return reply(`${plural(list.length, 'vessel has', 'vessels have')} been screened.`, list, all, 'vessels screened');
  }
  if (/\b(person|people|individual)s?\b/.test(q) && (asksCount || asksList)) {
    const list = all.filter(r => r.entity_type === 'Person');
    return reply(`${plural(list.length, 'person has', 'people have')} been screened.`, list, all, 'people screened');
  }
  if (/countr|jurisdiction|where/.test(q) && aboutScreening) {
    return reply(`Screened counterparties by country: ${breakdown(tally(all, r => r.country))}.`, all, all, 'countries screened');
  }
  if (/who (submitted|requested|raised)|by (employee|department|submitter)|submitted by/.test(q)) {
    return reply(`Requests by submitter: ${breakdown(tally(all, r => r.created_by_email))}.`, all, all, 'who submitted');
  }
  if (/latest|recent|last|newest/.test(q) && aboutScreening) {
    const list = [...all].sort((a, b) => String(b.submission_date).localeCompare(String(a.submission_date))).slice(0, 5);
    return reply(`The most recent screening is ${list[0] ? `${list[0].counterparty_name} on ${String(list[0].submission_date).slice(0, 10)}` : 'not on record yet'}.`, list, all, 'most recent screenings');
  }
  if ((asksCount || asksList) && aboutScreening) {
    return reply(
      `${plural(all.length, 'counterparty has', 'counterparties have')} been screened: ${breakdown(tally(all, r => r.entity_type))}. ` +
      `By status: ${breakdown(tally(all, r => r.request_status))}. ${all.filter(FLAGGED).length} came back with a hit.`,
      all, all, 'how many have been screened');
  }
  return { answered: false, records: all };
}

// Unrecognised question: let the model answer strictly from the same records
async function answerWithModel(question, all) {
  if (!gemini.isConfigured() || !/\?|^(how|what|which|who|when|why|is|are|do|does|did|list|show|tell)\b/i.test(question.trim())) return { answered: false };
  const lines = all.map(r => `${r.id} | ${r.counterparty_name} | ${r.entity_type} | ${r.country} | screening: ${r.screening_result} | AI: ${r.ai_result} | status: ${r.request_status} | DDQ: ${r.ddq_status} | monitoring: ${r.ongoing_monitoring ? 'on' : 'off'} | submitted ${String(r.submission_date).slice(0, 10)} by ${r.created_by_email}`);
  const text = await gemini.generateText(
    `You are Dilly, the DueDilly compliance assistant. Answer the question using ONLY the screening records below. ` +
    `If the records do not contain the answer, reply exactly: NOT_IN_RECORDS. Answer in at most 3 plain sentences, no markdown.\n\n` +
    `Screening records (${all.length}):\n${lines.join('\n')}\n\nQuestion: ${question}`);
  if (!text || /NOT_IN_RECORDS/.test(text)) return { answered: false };
  return { answered: true, sum: String(text).trim(), rows: [], more: 0, steps: ['Read the question', `Looked through ${all.length} screening requests on record`], src: `Screening history · ${all.length} requests · model-written answer` };
}

async function answer(question, options = {}) {
  const first = answerFromHistory(question, options);
  if (first.answered) return first;
  try { return await answerWithModel(String(question || ''), first.records || []); } catch (e) { return { answered: false }; }
}

module.exports = { answer, answerFromHistory };
