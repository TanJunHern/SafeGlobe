/**
 * AI guide for the counterparty DDQ portal: plain-language explanations, document
 * suggestions, progress tracking, prefill from an uploaded document, and translation.
 * Every feature degrades to a deterministic answer when Gemini is unavailable.
 */
const gemini = require('./geminiClient');
const { getDb } = require('../db');
const { computeProgress, templateHash } = require('./ddqTemplateService');

const isEnglish = lang => !lang || /^(en|eng|english)$/i.test(String(lang).trim());

function findQuestion(template, questionId) {
  for (const section of template.sections || []) {
    const q = section.questions.find(x => x.id === questionId);
    if (q) return { section, question: q };
  }
  return null;
}

function glossaryMatches(template, text = '') {
  const hay = text.toLowerCase();
  return (template.glossary || []).filter(g => {
    const term = g.term.toLowerCase();
    const short = (term.match(/\(([^)]+)\)/) || [])[1];
    return hay.includes(term.replace(/\s*\(.*\)/, '')) || (short && new RegExp(`\\b${short}\\b`, 'i').test(text));
  });
}

// Which checklist documents back up a given section / question
function suggestDocuments(template, section, question) {
  const context = `${section ? section.title : ''} ${question ? question.text : ''}`.toLowerCase();
  const rules = [
    [/incorporat|registration|registered name|legal form|address/, /incorporation|registration/],
    [/owner|shareholder|parent|nominee|trust|control/, /shareholder|ownership/],
    [/beneficial owner|director|senior management|pep|government official/, /identity/],
    [/policy|procedure|code of conduct|training|whistleblow|certification|audit/, /polic/],
    [/revenue|financial|bank|insolvency/, /financial/]
  ];
  const docs = template.documents || [];
  const picked = new Set();
  for (const [when, docRe] of rules) {
    if (when.test(context)) docs.filter(d => docRe.test(d.toLowerCase())).forEach(d => picked.add(d));
  }
  return [...picked];
}

function progressSummary(progress) {
  const open = progress.sections.filter(s => s.answered < s.total);
  const parts = [`You have answered ${progress.answered} of ${progress.total} questions.`];
  if (open.length) {
    parts.push('Still to complete: ' + open.map(s => `${s.title} (${s.total - s.answered} left${s.missing.length <= 4 ? ': ' + s.missing.join(', ') : ''})`).join('; ') + '.');
  }
  if (!progress.declarationDone) parts.push('The declaration still needs your name, signature and agreement.');
  if (progress.complete) parts.push('Everything is complete — you can review and submit.');
  return parts.join(' ');
}

function offlineReply({ template, section, question, message, progress }) {
  const text = `${message || ''}`;
  if (/progress|left|remaining|missing|done|finish|complete/i.test(text)) return progressSummary(progress);

  const lines = [];
  if (/\b(should|can|shall) (i|we)\b.*\b(answer|say|tick|put|select|choose)\b|just (answer|say|tick|put)/i.test(text)) {
    lines.push("I can't tell you which answer to give — it has to reflect your company's real situation, and you'll sign a declaration that the answers are true. Here is what the question is asking:");
  }
  const subject = question ? question.text : text;
  if (/document|attach|upload|proof|evidence/i.test(text) || (!question && !text)) {
    const docs = suggestDocuments(template, section, question);
    const list = docs.length ? docs : template.documents || [];
    if (list.length) lines.push('Supporting documents to have ready: ' + list.map(d => `• ${d}`).join(' '));
  }
  if (question) {
    lines.push(`Question ${question.id} asks: ${question.text}`);
    if (question.type === 'yesno') {
      lines.push(question.detailsPrompt
        ? `Tick Yes or No. ${question.detailsPrompt.replace(/^If Yes,?\s*/i, 'If you tick Yes, please ')}.`
        : 'Tick Yes or No.');
    } else if (question.type === 'table') {
      lines.push(`Add one row per person or entity, filling in: ${question.columns.join(', ')}. If there are none, tick "None to declare".`);
    } else {
      lines.push('Type your answer in the box. If it does not apply to your company, write "Not applicable" and briefly say why.');
    }
  }
  const terms = glossaryMatches(template, `${subject} ${text}`);
  terms.slice(0, 3).forEach(g => lines.push(`${g.term} means: ${g.meaning}`));
  if (question && !/document/i.test(text)) {
    const docs = suggestDocuments(template, section, question);
    if (docs.length) lines.push('Helpful supporting document: ' + docs.join('; ') + '.');
  }
  if (!lines.length) {
    lines.push('I can explain any question in plain language, tell you which documents to attach, or show what is left to complete. Open a question and tap "Explain this question".');
  }
  return lines.join('\n\n');
}

async function assistantReply({ template, request, questionId, sectionId, message, language, history = [], responses = {} }) {
  const bounceNote = ((request.bounce && request.bounce.issues) || []).find(i => i.question_id === questionId);
  const located = questionId ? findQuestion(template, questionId) : null;
  const section = located ? located.section : (template.sections || []).find(s => s.id === sectionId) || null;
  const question = located ? located.question : null;
  const progress = computeProgress(template, responses);
  const docs = suggestDocuments(template, section, question);
  const fallback = () => ({
    reply: (bounceNote ? `Our compliance team asked for clarification on this question: "${bounceNote.note}"\n\n` : '')
      + offlineReply({ template, section, question, message, progress }),
    suggested_documents: docs,
    progress,
    model: 'offline-guide',
    language: 'English'
  });

  if (!gemini.isConfigured()) return fallback();

  const glossary = glossaryMatches(template, `${question ? question.text : ''} ${section ? section.title : ''} ${message || ''}`);
  const prompt = `You are Dilly, the DueDilly DDQ Guide. You are talking to a staff member of ${request.counterparty_name} (the counterparty). They are completing a compliance due diligence questionnaire that DueDilly sent them; DueDilly's compliance team will review the answers.

RULES
- Reply in ${isEnglish(language) ? 'English' : language}. Use short, plain sentences a non-lawyer understands. Maximum 120 words.
- Plain text only: no markdown, no asterisks, no headings. Use "-" for a short list if needed.
- Explain what the question is asking and what a good answer contains. Give a brief generic example where useful.
- Mention which supporting document is relevant if one applies.
- NEVER tell the user whether to answer Yes or No, never invent facts about their company, and never suggest hiding or softening information. If asked what to answer, explain what each answer means and say they must answer truthfully.
- Write numbers as digits. Only mention progress if the user asks what is left or how far along they are.
- If the question is unrelated to this questionnaire, politely steer back.

QUESTIONNAIRE: ${template.title}
CURRENT SECTION: ${section ? `${section.title}${section.subheading ? ' — ' + section.subheading : ''}` : 'none'}
CURRENT QUESTION: ${question ? `${question.id} (${question.type}) ${question.text}${question.detailsPrompt ? ' | ' + question.detailsPrompt : ''}${question.columns ? ' | columns: ' + question.columns.join(', ') : ''}` : 'none selected'}
RELEVANT DEFINITIONS: ${glossary.map(g => `${g.term}: ${g.meaning}`).join(' | ') || 'none'}
SUPPORTING DOCUMENT CHECKLIST: ${(template.documents || []).join(' | ') || 'none'}
LIKELY RELEVANT DOCUMENTS FOR THIS QUESTION: ${docs.join(' | ') || 'none'}
COMPLIANCE FEEDBACK ON THIS QUESTION (it was returned for clarification): ${bounceNote ? bounceNote.note : 'none'}
PROGRESS: ${progressSummary(progress)}

CONVERSATION SO FAR:
${history.slice(-6).map(h => `${h.role === 'user' ? 'User' : 'Guide'}: ${String(h.text).slice(0, 500)}`).join('\n') || '(none)'}

USER: ${String(message || 'Explain this question in plain language.').slice(0, 1000)}
GUIDE:`;

  const reply = await gemini.generateText(prompt, { temperature: 0.3, timeoutMs: 15000 });
  if (!reply) {
    const out = fallback();
    out.reply = `(The AI service is busy, so this is the standard guidance.)\n\n${out.reply}`;
    return out;
  }
  const plain = reply.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^\s*\*\s+/gm, '- ').replace(/(^|\s)\*(\S[^*]*?)\*(?=\s|[.,;:!?]|$)/g, '$1$2');
  return { reply: plain, suggested_documents: docs, progress, model: 'gemini', language: isEnglish(language) ? 'English' : language };
}

/**
 * Extracts answers from any company document the counterparty uploads.
 */
async function prefillFromDocument({ template, filename = '', mimeType = '', base64Data = '', fileContent = '' }) {
  if (!gemini.isConfigured()) {
    return { success: false, answers: {}, tables: {}, message: 'AI prefill is unavailable right now. Please complete the questionnaire manually.' };
  }
  const questionList = (template.sections || []).flatMap(s => s.questions.map(q =>
    `${q.id} [${q.type}${q.columns ? ': ' + q.columns.join(' | ') : ''}] ${q.text}`)).join('\n');

  const prompt = `You extract answers for a supplier due diligence questionnaire from a document the supplier uploaded (${filename || 'document'}).
Only use facts explicitly stated in the document. Skip any question the document does not answer. Never guess.

QUESTIONS (id [type] text):
${questionList}

Respond with JSON only:
{
  "answers": { "<question id>": { "value": "<text answer, or exactly Yes or No for yesno questions>", "details": "<details when Yes, else empty>", "source": "<short quote or location in the document>" } },
  "tables": { "<table question id>": [ { "<exact column name>": "<value>" } ] },
  "summary": "<one sentence on what the document is>"
}`;

  const parts = [{ text: prompt }];
  if (base64Data && (mimeType.startsWith('image/') || mimeType === 'application/pdf')) {
    parts.push({ inlineData: { mimeType, data: base64Data } });
  } else if (fileContent) {
    parts.push({ text: `DOCUMENT CONTENT:\n${String(fileContent).slice(0, 30000)}` });
  } else {
    return { success: false, answers: {}, tables: {}, message: 'This file type cannot be read. Upload a PDF, image or text document.' };
  }

  const out = await gemini.generateJson(parts, { timeoutMs: 45000 });
  if (!out) return { success: false, answers: {}, tables: {}, message: 'The document could not be analysed. Please try again or fill in manually.' };

  // Keep only answers that belong to this template and are well-formed
  const answers = {};
  const tables = {};
  for (const section of template.sections || []) {
    for (const q of section.questions) {
      if (q.type === 'table') {
        const rows = Array.isArray(out.tables && out.tables[q.id]) ? out.tables[q.id] : [];
        const cleaned = rows.map(r => Object.fromEntries(q.columns.map(c => [c, String((r && r[c]) || '').slice(0, 300)])))
          .filter(r => Object.values(r).some(v => v.trim()));
        if (cleaned.length) tables[q.id] = cleaned.slice(0, 20);
        continue;
      }
      const a = out.answers && out.answers[q.id];
      if (!a || a.value == null || String(a.value).trim() === '') continue;
      let value = String(a.value).trim().slice(0, 2000);
      if (q.type === 'yesno') {
        if (/^yes$/i.test(value)) value = 'Yes';
        else if (/^no$/i.test(value)) value = 'No';
        else continue;
      }
      answers[q.id] = { value, details: String(a.details || '').slice(0, 2000), source: String(a.source || '').slice(0, 300), ai_suggested: true };
    }
  }
  const count = Object.keys(answers).length + Object.keys(tables).length;
  return {
    success: true,
    answers,
    tables,
    summary: String(out.summary || ''),
    message: count ? `Suggested ${count} answers from ${filename || 'your document'}. Please check each one.` : 'No matching answers were found in that document.'
  };
}

// Every user-visible string in a template, in a stable order, so it can round-trip through translation
function collectStrings(template) {
  const strings = [template.title, template.intro, ...template.instructions, ...template.documents];
  for (const s of template.sections) {
    strings.push(s.title, s.subheading);
    for (const q of s.questions) {
      strings.push(q.text, q.detailsPrompt || '');
      if (q.columns) strings.push(...q.columns);
    }
  }
  strings.push(template.declaration.intro, ...template.declaration.statements);
  for (const g of template.glossary) strings.push(g.term, g.meaning);
  return strings;
}

function applyStrings(template, strings) {
  let i = 0;
  const next = () => strings[i++];
  const out = JSON.parse(JSON.stringify(template));
  out.title = next(); out.intro = next();
  out.instructions = out.instructions.map(next);
  out.documents = out.documents.map(next);
  for (const s of out.sections) {
    s.title = next(); s.subheading = next();
    for (const q of s.questions) {
      q.text = next();
      const prompt = next();
      if (q.type === 'yesno') q.detailsPrompt = prompt;
      // Column names stay as keys for stored answers; translated labels are display-only
      if (q.columns) q.columnLabels = q.columns.map(next);
    }
  }
  out.declaration.intro = next();
  out.declaration.statements = out.declaration.statements.map(next);
  for (const g of out.glossary) { g.term = next(); g.meaning = next(); }
  return out;
}

async function translateStrings(strings, language) {
  const result = new Array(strings.length);
  const CHUNK = 60;
  const jobs = [];
  for (let start = 0; start < strings.length; start += CHUNK) {
    const slice = strings.slice(start, start + CHUNK);
    jobs.push((async () => {
      const prompt = `Translate each string in this JSON array into ${language} for a business compliance questionnaire.
Keep the meaning precise, keep numbers, percentages, "SGD", company names, email addresses and question numbers unchanged, and keep empty strings empty.
Return a JSON array of exactly ${slice.length} strings in the same order.

${JSON.stringify(slice)}`;
      const out = await gemini.generateJson(prompt, { timeoutMs: 45000 });
      if (!Array.isArray(out) || out.length !== slice.length) return false;
      out.forEach((t, k) => { result[start + k] = slice[k] === '' ? '' : String(t); });
      return true;
    })());
  }
  const ok = await Promise.all(jobs);
  return ok.every(Boolean) ? result : null;
}

async function translateTemplate(template, language, uiStrings = []) {
  const ui = (Array.isArray(uiStrings) ? uiStrings : []).slice(0, 120).map(v => String(v).slice(0, 300));
  if (isEnglish(language)) return { translated: false, language: 'English', template, ui };
  const lang = String(language).trim().slice(0, 40);
  const db = getDb();
  const cacheKey = `${templateHash({ template, ui })}:${lang.toLowerCase()}`;
  const cached = db.getDdqTranslation(cacheKey);
  if (cached) return { translated: true, cached: true, language: lang, template: cached.template, ui: cached.ui };
  if (!gemini.isConfigured()) {
    return { translated: false, language: 'English', template, ui, message: 'Translation is unavailable right now. The questionnaire is shown in English.' };
  }
  const source = collectStrings(template);
  const translatedStrings = await translateStrings([...source, ...ui], lang);
  if (!translatedStrings) {
    return { translated: false, language: 'English', template, ui, message: `Could not translate into ${lang}. The questionnaire is shown in English.` };
  }
  const payload = {
    template: applyStrings(template, translatedStrings.slice(0, source.length)),
    ui: translatedStrings.slice(source.length)
  };
  db.saveDdqTranslation(cacheKey, lang, payload);
  return { translated: true, language: lang, template: payload.template, ui: payload.ui };
}

/**
 * Adds English translations next to free-text answers written in another language.
 */
async function translateAnswersToEnglish(responses, language) {
  if (isEnglish(language) || !gemini.isConfigured()) return responses;
  const refs = [];
  for (const [id, a] of Object.entries(responses.answers || {})) {
    if (a && typeof a.value === 'string' && a.value && !/^(Yes|No)$/.test(a.value)) refs.push({ a, key: 'value' });
    if (a && typeof a.details === 'string' && a.details) refs.push({ a, key: 'details' });
  }
  if (!refs.length) return responses;
  const prompt = `Translate each string in this JSON array into English. They are answers to a compliance questionnaire written in ${language}.
Keep names, numbers and identifiers unchanged. Return a JSON array of exactly ${refs.length} strings in the same order.

${JSON.stringify(refs.map(r => r.a[r.key]))}`;
  const out = await gemini.generateJson(prompt, { timeoutMs: 30000 });
  if (Array.isArray(out) && out.length === refs.length) {
    refs.forEach((r, i) => { r.a[`${r.key}_en`] = String(out[i]); });
    responses.translated_to_english = true;
  }
  return responses;
}

module.exports = {
  assistantReply,
  prefillFromDocument,
  translateTemplate,
  translateAnswersToEnglish,
  suggestDocuments,
  isEnglish
};
