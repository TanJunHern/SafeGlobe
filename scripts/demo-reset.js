#!/usr/bin/env node
/**
 * SafeGlobe demo kit: wipes the local database and rebuilds a clean, rehearsable story.
 *
 *   npm run demo:reset            rebuild with the Compliance Agent in placeholder mode (fast, offline)
 *   npm run demo:reset -- --ai    also let Gemini write the agent's explanations (slower, needs quota)
 *   npm run demo:reset -- --force run even if a server appears to be listening on the app port
 *
 * Everything the kit produces lives in demo-data/, which is gitignored:
 *   demo-data/scenario.json   the story (edit it to change the demo; delete it to restore the default)
 *   demo-data/samples/        files to upload during the demo (company profile for prefill, template)
 *   demo-data/backups/        the previous database, copied before every reset
 *   demo-data/DEMO-LINKS.md   logins, counterparty links and a suggested walkthrough
 *
 * The scenario is replayed through the real HTTP API, so every record is exactly what the
 * app itself would have created (tokens, agent assessments, bounce rounds, globe pins).
 */
const fs = require('fs');
const net = require('net');
const path = require('path');

const args = new Set(process.argv.slice(2));
const USE_AI = args.has('--ai');
const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);

// Placeholder mode unless --ai: seeding must be quick and must not depend on model quota
if (!USE_AI) {
  process.env.GEMINI_API_KEY = '';
  process.env.GOOGLE_API_KEY = '';
  process.env.GOOGLE_GENAI_API_KEY = '';
}
process.env.SAFEGLOBE_SKIP_PERSONA_SEED = '1';

const config = require('../src/config');
const DEMO_DIR = path.join(ROOT, 'demo-data');
const SAMPLES_DIR = path.join(DEMO_DIR, 'samples');
const BACKUP_DIR = path.join(DEMO_DIR, 'backups');
const SCENARIO_PATH = path.join(DEMO_DIR, 'scenario.json');
const SEED_PORT = 8197;
const BASE = `http://localhost:${SEED_PORT}`;

// ---------------------------------------------------------------------------
// Default scenario
// ---------------------------------------------------------------------------

const PLACES = {
  raffles: { address: 'One Raffles Place, Tower 1, Singapore 048616', lat: 1.2844, lng: 103.851, place_id: 'sg_raffles' },
  jurong: { address: 'Jurong Port Terminal, 37 Jurong Port Road, Singapore 619110', lat: 1.306, lng: 103.714, place_id: 'sg_jurong' },
  tuas: { address: 'Tuas Mega Port Terminal, Tuas South Avenue 14, Singapore', lat: 1.258, lng: 103.635, place_id: 'sg_tuas' },
  mbfc: { address: 'Marina Bay Financial Centre, 10 Marina Boulevard, Singapore 018983', lat: 1.2798, lng: 103.8536, place_id: 'sg_mbfc' }
};

const DEFAULT_SCENARIO = {
  about: 'Edit freely. steps: send | submit | bounce | resubmit | approve | reject. answers: strong | weak | disclosure.',
  employees: {
    john: { email: 'john.doe@safeglobe.com', name: 'John Doe', userId: 'EMP-1042', department: 'Procurement & Logistics' },
    sarah: { email: 'sarah.tan@safeglobe.internal', name: 'Sarah Tan', userId: 'EMP-1107', department: 'Procurement & Supply Chain' },
    marcus: { email: 'marcus.lee@safeglobe.internal', name: 'Marcus Lee', userId: 'EMP-7721', department: 'Energy & Marine Trading' }
  },
  requests: [
    {
      key: 'apex', by: 'john', days_ago: 6, stage: 'Auto-cleared (no DDQ, not monitored)',
      request: { counterparty_name: 'Apex Commodities Pte Ltd', entity_type: 'Organisation', country: 'SGP', relationship_type: 'Vendor/Supplier', contract_value: 85000, ongoing_monitoring: false, remarks: 'Packaging and office consumables for FY2026.', attributes: { reg_no: '202419822K', directors_ubo: 'Tan Wei Liang (60%), Chua Mei Ling (40%)' } }
    },
    {
      key: 'harbour', by: 'john', days_ago: 5, stage: 'Auto-cleared and monitored: already pinned on the globe',
      request: { counterparty_name: 'Harbour Green Provisions Pte Ltd', entity_type: 'Organisation', country: 'SGP', relationship_type: 'Vendor/Supplier', contract_value: 35000, ongoing_monitoring: true, location: PLACES.raffles, remarks: 'Galley provisions for chartered vessels.', attributes: { reg_no: '201988123N', directors_ubo: 'Lee Hui Min (100%)' } }
    },
    {
      key: 'lioncity', by: 'sarah', days_ago: 5, stage: 'Approved after one bounce round: pinned on the globe',
      request: { counterparty_name: 'Lion City Packaging Pte Ltd', entity_type: 'Organisation', country: 'SGP', relationship_type: 'Vendor/Supplier', contract_value: 180000, ongoing_monitoring: true, location: PLACES.mbfc, counterparty_email: 'compliance@lioncitypackaging.example', remarks: 'Three-year packaging supply framework.', attributes: { reg_no: '201533871D', directors_ubo: 'Goh Siew Ling (70%), Goh Kok Wei (30%)' } },
      company: { reg: '201533871D', gst: 'M90355512K', incorporated: '4 August 2015', website: 'www.lioncitypackaging.example', activities: 'Design and manufacture of corrugated and flexible packaging.', goods: 'Corrugated cartons and pallet wrap.', employees: '140', revenue: 'SGD 20-30 million', bank: 'DBS Bank, Singapore', contact: 'Goh Siew Ling, Managing Director, siewling@lioncitypackaging.example, +65 6555 0142', owners: [['Goh Siew Ling', 'Singaporean', 'Singapore', '70%'], ['Goh Kok Wei', 'Singaporean', 'Singapore', '30%']] },
      steps: ['send', 'submit:weak', 'bounce', 'resubmit', 'approve']
    },
    {
      key: 'meridian', by: 'john', days_ago: 3, stage: 'DDQ returned, agent recommends APPROVE: approve it live and watch it appear on the globe',
      request: { counterparty_name: 'Meridian Freight Solutions Pte Ltd', entity_type: 'Organisation', country: 'SGP', relationship_type: 'Vendor/Supplier', contract_value: 320000, ongoing_monitoring: true, location: PLACES.jurong, counterparty_email: 'kyc@meridianfreight.example', remarks: 'Freight forwarding and customs brokerage for regional shipments.', attributes: { reg_no: '201407788K', directors_ubo: 'Chen Li Hua (55%), Rajan Pillai (45%)' } },
      company: { reg: '201407788K', gst: 'M90371234X', incorporated: '12 March 2014', website: 'www.meridianfreight.example', activities: 'Freight forwarding and customs brokerage.', goods: 'Sea and air freight forwarding, customs clearance.', employees: '85', revenue: 'SGD 15-20 million', bank: 'OCBC Bank, Singapore', contact: 'Chen Li Hua, Managing Director, lihua@meridianfreight.example, +65 6555 0188', owners: [['Chen Li Hua', 'Singaporean', 'Singapore', '55%'], ['Rajan Pillai', 'Malaysian', 'Malaysia', '45%']] },
      steps: ['send', 'submit:strong']
    },
    {
      key: 'northwind', by: 'john', days_ago: 2, stage: 'DDQ returned, agent recommends BOUNCE BACK: tick the points and bounce it live',
      request: { counterparty_name: 'Northwind Bunkering Pte Ltd', entity_type: 'Organisation', country: 'SGP', relationship_type: '3rd Party Reps & Brokers', contract_value: 480000, ongoing_monitoring: false, counterparty_email: 'kyc@northwind.example', remarks: 'Introduced by a consultant whose brother sits on the port authority board.', attributes: { reg_no: '201822045H', directors_ubo: 'Marcus Lim (80%)' } },
      company: { reg: '201822045H', gst: 'M90388811C', incorporated: '9 June 2018', website: 'www.northwind.example', activities: 'Marine fuel brokerage.', goods: 'Bunker fuel brokerage.', employees: '22', revenue: 'SGD 5-10 million', bank: 'UOB, Singapore', contact: 'Marcus Lim, Director, marcus@northwind.example, +65 6555 0170', owners: [['Marcus Lim', 'Singaporean', 'Singapore', '80%']] },
      steps: ['send', 'submit:weak']
    },
    {
      key: 'straits', by: 'john', days_ago: 2, stage: 'BOUNCED: with the counterparty. Open its link to fix the flagged questions and resubmit',
      request: { counterparty_name: 'Straits Marine Brokers Pte Ltd', entity_type: 'Organisation', country: 'SGP', relationship_type: '3rd Party Reps & Brokers', contract_value: 250000, ongoing_monitoring: true, location: PLACES.jurong, counterparty_email: 'compliance@straitsmarine.example', remarks: 'Chartering broker for Q4 bulk shipments.', attributes: { reg_no: '201733410D', directors_ubo: 'Lim Hock Seng (70%), Tay Bee Choo (30%)' } },
      company: { reg: '201733410D', gst: 'M90366620T', incorporated: '21 November 2017', website: 'www.straitsmarine.example', activities: 'Ship chartering brokerage.', goods: 'Chartering brokerage for dry bulk.', employees: '31', revenue: 'SGD 8-12 million', bank: 'DBS Bank, Singapore', contact: 'Lim Hock Seng, Director, hockseng@straitsmarine.example, +65 6555 0113', owners: [['Lim Hock Seng', 'Singaporean', 'Singapore', '70%'], ['Tay Bee Choo', 'Singaporean', 'Singapore', '30%']] },
      steps: ['send', 'submit:weak', 'bounce']
    },
    {
      key: 'selat', by: 'john', days_ago: 1, stage: 'DDQ TRIGGERED, not sent: send it as John, then fill it in as the counterparty (use the sample profile to prefill)',
      request: { counterparty_name: 'MV Selat Pioneer', entity_type: 'Vessel', country: 'PAN', relationship_type: 'Customer/Trading Partner', contract_value: 420000, ongoing_monitoring: true, location: PLACES.tuas, counterparty_email: 'ops@selatshipping.example', remarks: 'Time-charter for product tanker, Tuas to Fujairah.', attributes: { imo: 'IMO 9823411', vessel_type: 'Product Tanker', registered_owner: 'Selat Shipping Pte Ltd', commercial_operator: 'Selat Shipping Pte Ltd' } }
    },
    {
      key: 'caspian', by: 'marcus', days_ago: 1, stage: 'DDQ returned with disclosures, agent recommends ESCALATE (officer judgement, cannot be bounced away)',
      request: { counterparty_name: 'Caspian Bulk Carriers LLC', entity_type: 'Organisation', country: 'ARE', relationship_type: 'Customer/Trading Partner', contract_value: 650000, ongoing_monitoring: false, counterparty_email: 'legal@caspianbulk.example', remarks: 'Dry bulk offtake, Jebel Ali.', attributes: { reg_no: 'DMCC-118204', directors_ubo: 'Farid Nazarov (100%)' } },
      company: { reg: 'DMCC-118204', gst: 'TRN 100488120300003', incorporated: '2 February 2019', website: 'www.caspianbulk.example', activities: 'Dry bulk commodity trading and shipping.', goods: 'Grain and fertiliser cargoes.', employees: '48', revenue: 'USD 40-60 million', bank: 'Emirates NBD, UAE', contact: 'Farid Nazarov, Managing Director, farid@caspianbulk.example, +971 4 555 0191', owners: [['Farid Nazarov', 'Azerbaijani', 'United Arab Emirates', '100%']] },
      steps: ['send', 'submit:disclosure']
    }
  ]
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const log = msg => console.log(`  ${msg}`);

function portInUse(port) {
  return new Promise(resolve => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

function backupAndWipe() {
  const dbPath = path.resolve(config.dbPath);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const existing = ['', '-wal', '-shm'].map(sfx => dbPath + sfx).filter(f => fs.existsSync(f));
  if (existing.length) {
    const target = path.join(BACKUP_DIR, stamp);
    fs.mkdirSync(target, { recursive: true });
    existing.forEach(f => fs.copyFileSync(f, path.join(target, path.basename(f))));
    existing.forEach(f => fs.rmSync(f));
    log(`previous database backed up to demo-data/backups/${stamp}/`);
    // Keep the five most recent backups
    fs.readdirSync(BACKUP_DIR).sort().reverse().slice(5).forEach(d => fs.rmSync(path.join(BACKUP_DIR, d), { recursive: true, force: true }));
  }
  fs.rmSync(path.join(path.dirname(dbPath), 'uploads', 'ddq'), { recursive: true, force: true });
}

// A small but valid single-page PDF, so uploaded demo documents open in a viewer
function tinyPdf(lines) {
  const text = lines.map((l, i) => `BT /F1 ${i === 0 ? 16 : 11} Tf 60 ${760 - i * 22} Td (${String(l).replace(/[()\\]/g, '\\$&')}) Tj ET`).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

const signature = name => 'data:image/svg+xml;base64,' + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="150" viewBox="0 0 600 150"><path d="M30 100 C 70 20, 110 140, 150 70 S 220 30, 260 95 S 330 130, 380 60 S 470 50, 560 85" fill="none" stroke="#1c2a4a" stroke-width="4" stroke-linecap="round"/><text x="34" y="138" font-family="Georgia, serif" font-style="italic" font-size="20" fill="#1c2a4a">${name}</text></svg>`
).toString('base64');

async function api(method, url, body, headers = {}) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${data.message || data.error || ''}`);
  return data;
}

const staffHeaders = e => ({ 'x-user-email': e.email, 'x-user-name': e.name, 'x-user-id': e.userId, 'x-user-department': e.department, 'x-user-role': 'employee' });
const OFFICER = { 'x-user-email': 'compliance@safeglobe.com', 'x-user-name': 'Grace Teo', 'x-user-id': 'COMP-901', 'x-user-department': 'Compliance & Risk Governance', 'x-user-role': 'compliance_officer' };

/**
 * Builds a counterparty's questionnaire answers for whatever template was issued.
 *   strong      complete, specific, controls in place
 *   weak        evasive and thin in places, no documents (-> agent recommends bounce back)
 *   disclosure  complete, but declares past violations and sanctions exposure (-> escalate)
 */
function buildAnswers(template, item, quality) {
  const c = item.company || {};
  const name = item.request.counterparty_name;
  const known = {
    '1.1': name, '1.2': 'None in the last 5 years.', '1.3': `Registration ${c.reg}; tax registration ${c.gst}`, '1.4': 'Private limited company',
    '1.5': `${item.request.country === 'SGP' ? 'Singapore' : 'United Arab Emirates'}, ${c.incorporated}`, '1.6': (item.request.location && item.request.location.address) || 'Registered office as per the business registry extract attached.',
    '1.7': 'Same as the registered address.', '1.8': c.website, '1.9': c.activities, '1.10': c.goods, '1.11': 'Singapore, Malaysia and Indonesia.',
    '1.12': c.employees, '1.13': c.revenue, '1.16': c.bank, '1.17': c.contact,
    '2.1': 'None: the company has no parent company.', '2.2': 'None: the company is owned directly by the individuals listed in 2.8.'
  };
  const responses = { format: 'template-v1', language: 'English', answers: {}, tables: {}, documents: {} };
  for (const section of template.sections) {
    const controls = /procedure/i.test(section.title);
    for (const q of section.questions) {
      if (q.type === 'text') {
        responses.answers[q.id] = { value: known[q.id] || 'Details are set out in the attached company profile.' };
      } else if (q.type === 'yesno') {
        if (controls && !/subcontract/i.test(q.text)) {
          responses.answers[q.id] = { value: 'Yes', details: /certification/i.test(q.text) ? 'ISO 9001:2015, valid to March 2027.' : 'In place; approved by the board and last reviewed in January 2026.' };
        } else if (/ownership chart/i.test(q.text)) {
          responses.answers[q.id] = { value: 'Yes' };
        } else {
          responses.answers[q.id] = { value: 'No' };
        }
      } else if (/beneficial owner/i.test(q.text)) {
        responses.answers[q.id] = {};
        responses.tables[q.id] = (c.owners || []).map(row => Object.fromEntries(q.columns.map((col, i) => [col, row[i] || ''])));
      } else if (/shareholder/i.test(q.text)) {
        responses.answers[q.id] = {};
        responses.tables[q.id] = (c.owners || []).map(([n, nat, , pct]) => Object.fromEntries(q.columns.map((col, i) => [col, [n, 'Individual', nat, pct][i] || ''])));
      } else if (/director/i.test(q.text)) {
        responses.answers[q.id] = {};
        responses.tables[q.id] = (c.owners || []).slice(0, 2).map(([n, nat]) => Object.fromEntries(q.columns.map((col, i) => [col, [n, 'Director', nat, c.incorporated][i] || ''])));
      } else {
        responses.answers[q.id] = { none: true };
      }
    }
  }
  const has = id => Boolean(responses.answers[id]);
  if (quality === 'weak') {
    if (has('1.9')) responses.answers['1.9'] = { value: 'tbc' };
    if (has('1.13')) responses.answers['1.13'] = { value: 'n/a' };
    if (has('3.5')) responses.answers['3.5'] = { value: 'Yes', details: 'permits' };
    if (has('6.7')) responses.answers['6.7'] = { value: 'No' };
  }
  if (quality === 'disclosure') {
    if (has('5.4')) responses.answers['5.4'] = { value: 'Yes', details: 'In 2023 the company paid a civil penalty to OFAC for two shipments routed through a restricted port. Case ref ENF-2023-118; settled, no admission of liability.' };
    if (has('7.4')) responses.answers['7.4'] = { value: 'Yes', details: 'Legacy grain contracts with a counterparty in a sanctioned jurisdiction, wound down in 2023; under 2% of annual revenue.' };
  }
  const signatory = (c.owners && c.owners[0] && c.owners[0][0]) || 'Authorised Signatory';
  responses.declaration = { agreed: true, full_name: signatory, job_title: 'Director', company: name, date: new Date().toISOString().slice(0, 10), signature: signature(signatory), signed_at: new Date().toISOString() };
  return responses;
}

async function uploadDocuments(token, template, responses, name) {
  for (let i = 0; i < (template.documents || []).length; i++) {
    const pdf = tinyPdf([template.documents[i].slice(0, 70), name, 'Demo document generated by the SafeGlobe demo kit.']);
    const out = await api('POST', '/api/ddq/document', { token, index: i, filename: `${String(i + 1).padStart(2, '0')}-${template.documents[i].split(/\s+/).slice(0, 4).join('-').replace(/[^\w-]/g, '')}.pdf`, mimeType: 'application/pdf', base64Data: pdf.toString('base64') });
    responses.documents[i] = Object.assign({ checked: true }, out.document);
  }
}

function writeSamples() {
  fs.mkdirSync(SAMPLES_DIR, { recursive: true });
  fs.writeFileSync(path.join(SAMPLES_DIR, 'selat-shipping-company-profile.txt'), `COMPANY PROFILE - SELAT SHIPPING PTE LTD

Selat Shipping Pte Ltd (formerly Selat Tankers) is a private limited company incorporated in Singapore on 18 May 2016.
UEN 201613345Z. GST registration M90399014R. Registered office: 21 Tuas South Avenue 14, Singapore 637312.
Website: www.selatshipping.example. The company owns and operates product tankers, including MV Selat Pioneer (IMO 9823411),
and provides time-charter services across Singapore, Malaysia, Indonesia and the United Arab Emirates.
It has approximately 64 employees and annual revenue of SGD 30-40 million. The company is not listed on any stock exchange.
Payments are received at United Overseas Bank, Singapore.

Shareholders and beneficial owners: Ahmad Zulkifli (Singaporean, resident in Singapore) holds 60%;
Wong Mei Fen (Singaporean, resident in Singapore) holds 40%.
Directors: Ahmad Zulkifli, Managing Director, appointed 18 May 2016; Wong Mei Fen, Finance Director, appointed 2 January 2018.
Compliance contact: Wong Mei Fen, Finance Director, meifen@selatshipping.example, +65 6555 0127.

The company has a board-approved code of conduct, a written anti-bribery and corruption policy, a sanctions compliance
policy with screening of all charterers, and an anonymous whistleblowing hotline. It holds ISO 9001:2015 certification.
`);
  const template = path.join(ROOT, 'src', 'db', 'supplier-cddq-template.md');
  if (fs.existsSync(template)) fs.copyFileSync(template, path.join(SAMPLES_DIR, 'Supplier CDDQ Policy Template.md'));
  fs.writeFileSync(path.join(SAMPLES_DIR, 'broker-questionnaire-short.md'), ['# Broker Questionnaire Template', '', '## Purpose', 'Short-form questionnaire for chartering brokers.', '', '- [ ] Broker licence copy', '- [ ] Latest audited financial statements', '',
    '## 1. About your firm', '', '| No. | Question | Response |', '| --- | --- | --- |', '| 1.1 | Full registered name of the brokerage |  |', '| 1.2 | Are you licensed or regulated? Yes / No. If Yes, name the regulator |  |', '| 1.3 | Do you hold client money? Yes / No |  |', '',
    '**1.4 Beneficial Owners (25% or more)**', '', '| Full name | Nationality | % held |', '| --- | --- | --- |', '|  |  |  |', '',
    '## Declaration', 'Signed by a director.', '', '1. The answers are true and complete.', ''].join('\n'));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\nSafeGlobe demo reset (${USE_AI ? 'Gemini-assisted' : 'placeholder mode'})\n`);

  if (!args.has('--force') && await portInUse(config.port)) {
    console.error(`  A server is listening on port ${config.port}. Stop it first (it holds the database open), or re-run with --force.\n`);
    process.exit(1);
  }

  fs.mkdirSync(DEMO_DIR, { recursive: true });
  if (!fs.existsSync(SCENARIO_PATH)) {
    fs.writeFileSync(SCENARIO_PATH, JSON.stringify(DEFAULT_SCENARIO, null, 2));
    log('wrote default demo-data/scenario.json');
  }
  const scenario = JSON.parse(fs.readFileSync(SCENARIO_PATH, 'utf8'));

  backupAndWipe();
  writeSamples();

  const { startServer, stopServer } = require('../src/server');
  const { getDb } = require('../src/db');
  const agent = require('../src/agents/complianceAgent');
  const quiet = console.log;
  console.log = () => {};          // silence the server's start-up banner
  await startServer(SEED_PORT);
  console.log = quiet;

  const rows = [];
  try {
    for (const item of scenario.requests) {
      const employee = scenario.employees[item.by];
      const created = (await api('POST', '/api/kyc/submit', item.request, staffHeaders(employee))).request;
      const id = created.id;
      const token = created.ddq_link ? created.ddq_link.split('token=')[1] : null;
      let template = null;
      let lastAnswers = null;

      for (const step of item.steps || []) {
        const [action, quality = 'strong'] = step.split(':');
        if (action === 'send') {
          await api('POST', `/api/kyc/${id}/send-ddq`, {}, staffHeaders(employee));
        } else if (action === 'submit' || action === 'resubmit') {
          template = template || (await api('GET', `/api/ddq/verify-token?token=${token}`)).template;
          lastAnswers = buildAnswers(template, item, action === 'resubmit' ? 'strong' : quality);
          if (action === 'resubmit' || quality !== 'weak') await uploadDocuments(token, template, lastAnswers, item.request.counterparty_name);
          await api('POST', '/api/ddq/submit', { token, responses: lastAnswers });
        } else if (action === 'bounce') {
          const review = (await api('GET', `/api/kyc/${id}`, undefined, OFFICER)).request.agent.ddq;
          await api('POST', `/api/kyc/${id}/triage`, { action: 'Bounce Back', notes: review.bounce.message, issues: review.bounce.issues }, OFFICER);
        } else if (action === 'approve' || action === 'reject') {
          await api('POST', `/api/kyc/${id}/triage`, { action: action === 'approve' ? 'Approve' : 'Reject', notes: action === 'approve' ? 'Clarifications received; controls and ownership verified.' : 'Outside risk appetite.' }, OFFICER);
        } else {
          throw new Error(`Unknown step "${step}" for ${item.key}`);
        }
      }

      if (USE_AI) {
        await agent.runIntake(id);
        await agent.runDdqReview(id);
      }

      // Spread submissions over the past week so the tables look lived-in
      if (item.days_ago) {
        const when = new Date(Date.now() - item.days_ago * 86400000 - Math.floor(Math.random() * 6) * 3600000);
        const stamp = `${when.toISOString().slice(0, 10)} ${String(9 + (item.days_ago % 8)).padStart(2, '0')}:${String((item.days_ago * 13) % 60).padStart(2, '0')}`;
        getDb().db.prepare('UPDATE kyc_requests SET submission_date = ? WHERE id = ?').run(stamp, id);
      }

      const final = (await api('GET', `/api/kyc/${id}`, undefined, OFFICER)).request;
      const rec = final.agent && (final.agent.ddq || final.agent.intake);
      rows.push({ id, name: final.counterparty_name, by: employee.name, status: final.request_status, ddq: final.ddq_status, agent: rec ? rec.recommendation_label : '-', stage: item.stage, link: final.ddq_link });
      log(`${id}  ${final.counterparty_name.padEnd(36)} ${final.request_status.padEnd(17)} DDQ: ${final.ddq_status.padEnd(24)} Agent: ${rec ? rec.recommendation_label : '-'}`);
    }
  } finally {
    console.log = () => {};
    await stopServer();
    console.log = quiet;
  }

  const app = `http://localhost:${config.port}`;
  const links = [
    '# SafeGlobe demo links', '',
    `Generated ${new Date().toLocaleString()} by \`npm run demo:reset\`. This file is local only (demo-data/ is gitignored).`, '',
    `Start the app with \`npm start\`, then open ${app}/login`, '',
    '## Logins', '',
    `- **Employee** (John Doe): ${app}/login -> "The Company Employee" -> ${app}/portal/employee`,
    `- **Compliance Officer** (Grace Teo): ${app}/login -> "The Compliance Officer" -> ${app}/portal/compliance`,
    `- **DDQ Manager**: ${app}/portal/ddq-manager (compliance only)`, '',
    '## Requests in this demo', '',
    '| KYC ID | Counterparty | Submitted by | Status | DDQ | Agent says | What to do with it |', '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map(r => `| ${r.id} | ${r.name} | ${r.by} | ${r.status} | ${r.ddq} | ${r.agent} | ${r.stage} |`), '',
    '## Counterparty links (open in a private window: no login needed)', '',
    ...rows.filter(r => r.link).map(r => `- **${r.name}** (${r.id}, ${r.ddq}): ${app}${r.link}`), '',
    '## Suggested 5-minute walkthrough', '',
    '1. **Employee** - log in as John. Show the table. Open MV Selat Pioneer -> "Send DDQ to Counterparty".',
    '2. **Counterparty** - open the MV Selat Pioneer link. Upload `demo-data/samples/selat-shipping-company-profile.txt` on the welcome slide to prefill, confirm a few answers, ask Aria to explain a question, switch language.',
    '3. **Counterparty, bounced** - open the Straits Marine Brokers link. Show the "Returned for clarification" banner and the flagged questions.',
    '4. **Compliance** - log in as Grace. Open Northwind Bunkering: Compliance Agent panel, the trace, the issue list. Tick points and "Bounce back to counterparty".',
    '5. **Compliance** - open Meridian Freight Solutions: agent recommends Approve. Approve it, then open the Globe: it is now pinned and monitored.',
    '6. **Compliance** - open Caspian Bulk Carriers: disclosures the agent escalates instead of bouncing. Download the DDQ (PDF).',
    '7. **DDQ Manager** - edit a question, or import `demo-data/samples/broker-questionnaire-short.md`.', '',
    '## Sample files', '',
    '- `demo-data/samples/selat-shipping-company-profile.txt` - upload in the DDQ portal to demo AI prefill',
    '- `demo-data/samples/Supplier CDDQ Policy Template.md` - the full template, for DDQ Manager import',
    '- `demo-data/samples/broker-questionnaire-short.md` - a small second template, to show templates are swappable', '',
    'Reset to this exact state at any time: stop the server, run `npm run demo:reset`, start it again.', ''
  ].join('\n');
  fs.writeFileSync(path.join(DEMO_DIR, 'DEMO-LINKS.md'), links);

  console.log(`\n  ${rows.length} demo requests created (plus the 5 built-in historical ones).`);
  console.log('  Links and walkthrough: demo-data/DEMO-LINKS.md');
  console.log('  Next: npm start\n');
}

main().catch(err => {
  console.error('\n  Demo reset failed:', err.message, '\n');
  process.exit(1);
});
