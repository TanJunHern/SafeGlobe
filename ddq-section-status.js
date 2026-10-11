/* DDQ section status: one deterministic function shared by the DDQ portal (live, as the
   counterparty types) and the server (re-checked on submit). No AI, no network.
   Loaded as a plain <script> in the browser (window.DDQStatus) and with require() in Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DDQStatus = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STATUS_WORDS = {
    not_started: 'not started',
    in_progress: 'in progress',
    done: 'complete',
    needs_attention: 'needs another look'
  };
  const MIN_DETAILS = 15;

  const text = v => (typeof v === 'string' ? v.trim() : '');
  const hasText = v => text(v).length > 0;
  const NA = /^(not applicable|n\s*\/\s*a|n\.a\.?|na)\b/i;
  const isNa = v => NA.test(text(v));
  const afterNa = v => text(v).replace(NA, '').replace(/^[\s.,:;()\-–—]+|[\s()]+$/g, '');
  const needsConfirm = a => Boolean(a && a.ai_suggested && !a.confirmed);

  function tableRows(q, responses) {
    return ((responses.tables && responses.tables[q.id]) || []).filter(r => Object.values(r || {}).some(hasText));
  }

  // Has the person put anything at all against this question?
  function hasAnyAnswer(q, responses) {
    const a = (responses.answers && responses.answers[q.id]) || {};
    if (q.type === 'table') return Boolean(a.none) || tableRows(q, responses).length > 0;
    return hasText(a.value);
  }

  // Is the question fully answered (ignoring the quality checks below)?
  function isAnswered(q, responses) {
    const a = (responses.answers && responses.answers[q.id]) || {};
    if (needsConfirm(a)) return false;
    if (q.type === 'table') return Boolean(a.none) || tableRows(q, responses).length > 0;
    if (q.type === 'yesno') {
      const v = text(a.value);
      if (/^no\b/i.test(v)) return true;
      if (/^yes\b/i.test(v)) return !q.detailsPrompt || hasText(a.details);
      return isNa(v) && (hasText(a.details) || hasText(afterNa(v)));
    }
    return hasText(a.value);
  }

  // "If Yes, describe the change" -> "Please describe the change."
  function detailsRequest(prompt) {
    const rest = text(prompt).replace(/^if yes,?\s*/i, '').replace(/[.\s]+$/, '');
    if (!rest) return 'Please give details.';
    const verb = /^(describe|give|name|list|state|explain|provide|specify|attach|identify)\b/i.test(rest);
    return `Please ${verb ? '' : 'tell us '}${rest.charAt(0).toLowerCase()}${rest.slice(1)}.`;
  }

  // Sum of the leading number in every cell of a "% held" style column
  function percentTotal(q, columns, responses) {
    const idx = (q.columns || []).findIndex(c => /%/.test(c));
    if (idx < 0) return null;
    const key = columns[idx];
    let total = 0;
    tableRows(q, responses).forEach(r => {
      const m = text(r[key]).match(/-?\d+(?:[.,]\d+)?/);
      if (m) total += parseFloat(m[0].replace(',', '.'));
    });
    return total;
  }

  /* Checks, run only on questions that have an answer.
     `columnsOf(q)` returns the keys used in responses.tables rows (the English column names). */
  function checkQuestion(q, responses, columnsOf) {
    const a = (responses.answers && responses.answers[q.id]) || {};
    const failed = [];
    const fail = (check, message) => failed.push({ check, questionId: q.id, message: `Question ${q.id}: ${message}` });

    if (q.type === 'yesno') {
      const v = text(a.value);
      if (!/^(yes|no)\b/i.test(v) && !isNa(v)) {
        fail('yes_no_unclear', 'please answer Yes or No.');
      } else if (isNa(v) && !hasText(a.details) && !hasText(afterNa(v))) {
        fail('na_without_reason', 'you answered Not applicable. Please say why it does not apply.');
      } else if (/^yes\b/i.test(v) && q.detailsPrompt && text(a.details).length < MIN_DETAILS) {
        fail('yes_without_details', `you answered Yes. ${detailsRequest(q.detailsPrompt)}`);
      }
    } else if (q.type === 'table') {
      const total = percentTotal(q, columnsOf(q), responses);
      if (total !== null && total > 100.0001) {
        fail('ownership_over_100', `the percentages add up to ${Math.round(total * 100) / 100}%. They cannot be more than 100%.`);
      }
    } else if (isNa(a.value) && !hasText(afterNa(a.value))) {
      fail('na_without_reason', 'you answered Not applicable. Please say why it does not apply.');
    }
    return failed;
  }

  /**
   * Status of one section.
   * @param section   { title, questions: [{ id, type, required, detailsPrompt, columns }] }
   * @param responses { answers, tables } in the template-v1 response format
   * @param options   { columnsOf(question) -> keys of table rows; defaults to question.columns }
   * @returns { status, failed: [{ check, questionId, message }], answered, required }
   */
  function sectionStatus(section, responses, options) {
    const res = responses || {};
    const columnsOf = (options && options.columnsOf) || (q => q.columns || []);
    const questions = (section && section.questions) || [];
    const required = questions.filter(q => q.required !== false);
    const answered = required.filter(q => isAnswered(q, res)).length;
    const base = { answered, required: required.length };

    if (!questions.some(q => hasAnyAnswer(q, res))) return Object.assign({ status: 'not_started', failed: [] }, base);

    const failed = [];
    questions.forEach(q => { if (hasAnyAnswer(q, res)) failed.push(...checkQuestion(q, res, columnsOf)); });
    if (failed.length) return Object.assign({ status: 'needs_attention', failed }, base);
    if (answered < required.length) return Object.assign({ status: 'in_progress', failed: [] }, base);
    return Object.assign({ status: 'done', failed: [] }, base);
  }

  // Declaration: name, job title, date and signature must all be present (and the box ticked)
  function declarationStatus(declaration) {
    const d = declaration || {};
    const blank = [];
    if (!hasText(d.full_name)) blank.push('full name');
    if (!hasText(d.job_title)) blank.push('job title');
    if (!hasText(d.date)) blank.push('date');
    if (!hasText(d.signature)) blank.push('signature');
    if (!d.agreed) blank.push('agreement tick box');
    const failed = blank.length
      ? [{ check: 'declaration_incomplete', questionId: 'declaration', message: `Declaration: please add your ${blank.join(', ')}.` }]
      : [];
    return { status: failed.length ? 'in_progress' : 'done', failed, blank };
  }

  // Whole questionnaire: one entry per section, plus the declaration
  function evaluate(template, responses, options) {
    const sections = ((template && template.sections) || []).map((s, i) =>
      Object.assign({ index: i, title: s.title }, sectionStatus(s, responses, options)));
    const declaration = declarationStatus((responses || {}).declaration);
    const done = sections.filter(s => s.status === 'done').length;
    return {
      sections,
      declaration,
      done,
      total: sections.length,
      allSectionsDone: done === sections.length,
      ready: done === sections.length && declaration.status === 'done',
      failed: sections.reduce((all, s) => all.concat(s.failed), [])
    };
  }

  return { sectionStatus, declarationStatus, evaluate, isAnswered, STATUS_WORDS, MIN_DETAILS };
});
