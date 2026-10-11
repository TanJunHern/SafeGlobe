#!/usr/bin/env node
/**
 * Builds the policy files that Agent Search indexes (feature 12), from the policy text the app already carries
 * (src/services/policyRagService.js) and the CDDQ template. Nothing is reworded.
 *
 *   node scripts/build-policy-files.js
 *
 * Writes:
 *   docs/policies/policy-clause-<n>-<n>.txt      one file per clause
 *   docs/policies/supplier-cddq-policy-template.txt
 *   docs/policies/kyc_policy.pdf  and  docs/test-docs/kyc_policy.pdf    the whole policy, marked "Demo policy"
 *
 * The policy is a demo policy for a fictional company. Every file says so.
 */
const fs = require('fs');
const path = require('path');
const { CORPORATE_POLICY_DOCUMENT } = require('../src/services/policyRagService');
const { localClauses } = require('../src/services/policySearch');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'docs', 'policies');
const DEMO = 'Demo policy: written for the DueDilly demo. The company and its policy are fictional.';
fs.mkdirSync(outDir, { recursive: true });

for (const c of localClauses()) {
  const text = [`DueDilly Enterprise Compliance & Counterparty Risk Policy (v2026.1)`, DEMO, '', `Section: ${c.section}`, `Clause ${c.number}${c.title !== c.section ? ` (${c.title})` : ''}`, '', c.text, ''].join('\n');
  fs.writeFileSync(path.join(outDir, c.file), text);
}

const template = fs.readFileSync(path.join(root, 'Supplier CDDQ Policy Template.md'), 'utf8');
fs.writeFileSync(path.join(outDir, 'supplier-cddq-policy-template.txt'), `${DEMO}\n\n${template}`);

// A small PDF writer: text only, Helvetica, A4. Enough for a searchable policy document, with no dependency.
function pdf(title, body) {
  const wrap = (line, width) => {
    const out = [];
    let current = '';
    for (const word of line.split(' ')) {
      if ((current + ' ' + word).trim().length > width) { out.push(current); current = word; } else current = (current + ' ' + word).trim();
    }
    out.push(current);
    return out;
  };
  const lines = body.split('\n').flatMap(l => (l.trim() ? wrap(l.trim(), 92) : ['']));
  const perPage = 48;
  const pages = [];
  for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));
  const esc = s => s.replace(/[^\x20-\x7E]/g, c => ({ '§': 'Section ', '’': "'", '“': '"', '”': '"', '–': '-', '—': '-' }[c] || '')).replace(/([\\()])/g, '\\$1');
  const objects = [];
  const add = content => { objects.push(content); return objects.length; };
  const catalog = add(''); const pagesObj = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const kids = pages.map((page, n) => {
    const text = ['BT', '/F2 9 Tf', '50 800 Td', `(${esc(`${DEMO}  Page ${n + 1} of ${pages.length}`)}) Tj`, '/F1 10.5 Tf', '0 -26 Td', '14.5 TL',
      ...page.map(l => (/^(Section \d+:|DUEDILLY )/.test(l) ? `/F2 11 Tf (${esc(l)}) Tj T* /F1 10.5 Tf` : `(${esc(l)}) Tj T*`)), 'ET'].join('\n');
    const stream = add(`<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`);
    return add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R /F2 ${bold} 0 R >> >> /Contents ${stream} 0 R >>`);
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const info = add(`<< /Title (${esc(title)}) /Producer (DueDilly scripts/build-policy-files.js) >>`);
  let out = '%PDF-1.4\n';
  const offsets = objects.map((o, i) => { const at = Buffer.byteLength(out); out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const whole = `${CORPORATE_POLICY_DOCUMENT.trim()}\n\nAnnex: Supplier CDDQ policy template\n\n${template.replace(/&#91;/g, '[').replace(/&#93;/g, ']').replace(/\\([\[\]_*.-])/g, '$1').replace(/[#*|`>]/g, ' ').replace(/ {2,}/g, ' ')}`;
const file = pdf('KYC policy (demo)', whole);
fs.writeFileSync(path.join(outDir, 'kyc_policy.pdf'), file);
fs.writeFileSync(path.join(root, 'docs', 'test-docs', 'kyc_policy.pdf'), file);

console.log(`Wrote ${fs.readdirSync(outDir).length} files to docs/policies/ and docs/test-docs/kyc_policy.pdf (${file.length} bytes).`);
for (const f of fs.readdirSync(outDir).sort()) console.log('  ' + f);
