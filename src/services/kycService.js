/**
 * SafeGlobe KYC Service - Employee Portal Module
 * 
 * Handles:
 * 1. Policy Evaluation & Automated DDQ Triggers (Point C)
 * 2. Document Multimodal Auto-Fill Extraction via Gemini (Point A)
 * 3. AI Risk Scoring & Anomaly Detection (Point B)
 * 4. KYC Request Lifecycle & Database Persistence
 * 5. Excel / CSV Export with Audit Traceability (Section 5)
 */

const config = require('../config');
const { getDb } = require('../db');
const { screenCounterparty } = require('./screening');
const jwt = require('jsonwebtoken');
const gemini = require('./geminiClient');
const { evaluatePolicyRAG } = require('./policyRagService');
const { generateKycExcelWorkbook } = require('./excelService');
const vesselFinder = require('./vesselFinderService');
const crypto = require('crypto');
const { getRules } = require('../risk/rulesStore');
const { validateFinding } = require('../risk/findingSchema');
const { assess } = require('../risk/scorer');
const { countryFinding, sourceLink, recordFindings } = require('../risk/riskService');

// High risk jurisdictions list (FATF / OFAC / Low CPI)
const HIGH_RISK_JURISDICTIONS = new Set([
  'RUS', 'IRN', 'PRK', 'SYR', 'MMR', 'CUB', 'VEN', 'BLR', 'YEM', 'LBY', 'SDN', 'SOM'
]);

/**
 * Point C: Policy RAG & Automated DDQ Trigger
 * Evaluates corporate KYC Policy rules against counterparty parameters.
 * 
 * Rules:
 * - Policy §2.1: Contract Value > SGD 100,000
 * - Policy §3.6: Politically Exposed Persons (PEP) association
 * - Policy §4.1: High-Risk Jurisdiction (CPI < 40 or FATF/Sanctions jurisdiction)
 * - Policy §5.2: 3rd Party Representatives, Agents & Brokers
 * - Policy §5.4: Maritime High-Risk Assets / Flags of Convenience / Telemetry anomalies
 * 
 * @param {Object} data
 * @returns {Object} { ddq_required, ddq_status, ddq_clause, triggered_clauses }
 */
function evaluatePolicyRules(data) {
  const db = getDb();
  const triggered = [];

  const contractValue = Number(data.contract_value || data.anticipated_contract_value || 0);
  const country = (data.country || 'SGP').toUpperCase();
  const relType = data.relationship_type || '';
  const entityType = data.entity_type || 'Organisation';
  const attrs = data.attributes || (typeof data.attributes_json === 'string' ? JSON.parse(data.attributes_json || '{}') : {});

  // Rule 1: Contract Value Threshold > SGD 100,000
  if (contractValue > 100000) {
    triggered.push('Policy §2.1 (Contract Value > SGD 100k threshold)');
  }

  // Rule 2: Politically Exposed Persons (PEP)
  const isPep = Boolean(
    attrs.pep_declared ||
    data.pep_declared ||
    data.screening_result === 'PEP Alert' ||
    /pep/i.test(data.remarks || '') ||
    /pep/i.test(data.screening_result || '')
  );
  if (isPep) {
    triggered.push('Policy §3.6 (Politically Exposed Persons & High Influence Individuals)');
  }

  // Rule 3: High-Risk Jurisdiction / CPI < 40
  const cpiRow = db.getCpiByCode(country);
  const cpiScore = cpiRow ? cpiRow.score : (HIGH_RISK_JURISDICTIONS.has(country) ? 25 : 55);
  if (cpiScore < 40 || HIGH_RISK_JURISDICTIONS.has(country)) {
    triggered.push(`Policy §4.1 (High-Risk Jurisdiction / CPI ${cpiScore} < 40)`);
  }

  // Rule 4: Third-Party Intermediaries & Brokers
  if (relType === '3rd Party Reps & Brokers' || /broker|intermediary|agent/i.test(relType)) {
    triggered.push('Policy §5.2 (Third-Party Representatives, Agents & Intermediary Risk)');
  }

  // Rule 5: Maritime Asset / Flag of Convenience / Vessel Anomaly
  if (entityType === 'Vessel') {
    const highRiskFlags = ['PAN', 'LBR', 'MHL', 'RUS', 'IRN', 'PRK'];
    const flag = (attrs.vessel_flag || country).toUpperCase();
    if (highRiskFlags.includes(flag) || /dark|sts|transshipment|anomaly/i.test(data.remarks || '')) {
      triggered.push('Policy §5.4 (Maritime High-Risk Flags & AIS Anomaly Controls)');
    }
  }

  const ddqRequired = triggered.length > 0;
  let ddqStatus = data.ddq_status;
  if (!ddqStatus || ddqStatus === 'N/A') {
    ddqStatus = ddqRequired ? 'Triggered' : 'N/A';
  }

  return {
    ddq_required: ddqRequired,
    ddq_status: ddqStatus,
    ddq_clause: triggered.join(' & '),
    triggered_clauses: triggered
  };
}

/**
 * The request's result fields, worded from a score breakdown. Used for the first, rule-based result and again
 * when Pond-Guard has screened the request, so both read the same way. Nothing here sets a number.
 */
function resultFromBreakdown(breakdown, rules, { screeningResult = 'Clear', cpiRow = null } = {}) {
  const score = breakdown.risk;
  const confidence = breakdown.confidence;
  const counted = new Set(breakdown.lines.map(l => l.category));

  // The screening result label names the most serious kind of finding (existing values, unchanged)
  let result = screeningResult || 'Clear';
  if (counted.has('sanctions_confirmed') || counted.has('sanctions_possible')) result = 'Sanctions Alert';
  else if (counted.has('pep_owner') || counted.has('pep_associate')) result = 'PEP Alert';
  else if (counted.has('vessel_ais_dark') || counted.has('vessel_sts_transfer')) result = 'High Risk';
  else if (counted.has('country_cpi_low')) result = 'Watchlist Match';

  const rationale = breakdown.lines.length
    ? `${breakdown.lines.map(l => `${l.short} (+${l.points}${l.policy ? `, ${l.policy}` : ''})`).join('; ')}. Total ${score} of ${breakdown.cap}: ${breakdown.level.label} risk. ${breakdown.routeReason}`
    : `No finding added risk points${cpiRow ? ` (${cpiRow.name}: CPI ${cpiRow.score}/100)` : ''}. ${breakdown.confidenceExplanation}`;

  const hasAnomaly = counted.has('vessel_ais_dark') || counted.has('vessel_sts_transfer');
  const resultLabel = score < rules.routes.riskLine && hasAnomaly ? 'Anomalies Flagged' : `${breakdown.level.label} Risk`;

  return { ai_result: `${resultLabel} (Confidence ${confidence}%)`, ai_score: score, ai_confidence: confidence, ai_rationale: rationale, screening_result: result };
}

/**
 * Point B: AI Risk Scoring & Anomaly Detection
 * Combines screening signals, country CPI, relationship type, and contract value.
 * 
 * @param {Object} data 
 * @param {Object} [screeningHit]
 * @returns {Object} { ai_result, ai_score, ai_confidence, ai_rationale, screening_result }
 */
function calculateAiRisk(data, screeningHit = null) {
  const db = getDb();
  const rules = getRules(db);
  const country = (data.country || 'SGP').toUpperCase();
  const contractVal = Number(data.contract_value || 0);
  const relType = data.relationship_type || '';
  const attrs = data.attributes || (typeof data.attributes_json === 'string' ? JSON.parse(data.attributes_json || '{}') : {});
  const name = data.counterparty_name || '';
  const kind = data.entity_type === 'Vessel' ? 'vessel' : data.entity_type === 'Person' ? 'person' : 'org';

  // Findings in the scoring format (GEMINI.md 4.8). The score is added up from these by src/risk/scorer.js;
  // nothing below sets a number. Screening findings come from the hit, the rest from what the intake form declares.
  const readAt = new Date().toISOString();
  const fid = 'F-' + crypto.randomBytes(4).toString('hex');
  const INTAKE = 'KYC intake form';
  const LISTS = 'Built-in sanctions lists (41)';
  const scored = screeningHit && Array.isArray(screeningHit.scoredFindings) ? screeningHit.scoredFindings.slice() : [];
  const has = category => scored.some(f => f.category === category);
  const add = f => scored.push(Object.assign({
    id: `${fid}-k${scored.length + 1}`, subject: name, source_name: INTAKE, source_trust: 'High', read_at: readAt, match_basis: 'not_name',
    corroborating_sources: [], agent: 'Intake', model_id: 'none', prompt_version: 'none'
  }, f, { source_url: sourceLink(f.source_name || INTAKE, `${fid}-k${scored.length + 1}`) }));

  const isSanctioned = /sanction|designated|blocked|ofac|ofsi/i.test(name) || /severny|varnell|zemtsov|fedgrain|rostec/i.test(name) || has('sanctions_possible') || has('sanctions_confirmed');
  if (isSanctioned && !has('sanctions_possible') && !has('sanctions_confirmed')) {
    add({ category: 'sanctions_possible', match_basis: 'strong_name', source_name: LISTS, agent: 'Sentry (offline rules)', demo: true,
      summary: 'The name matches an entry on the built-in sanctions lists. No second identifier was compared.',
      evidence_quote: 'Name matches a designated party on the built-in sanctions lists.' });
  }

  const isPep = Boolean(attrs.pep_declared || data.pep_declared || /pep/i.test(data.remarks || ''));
  if (isPep && !has('pep_owner')) {
    add({ category: 'pep_owner', summary: 'The intake form declares a politically exposed person, or the remarks mention one.',
      evidence_quote: attrs.pep_declared || data.pep_declared ? 'PEP self-declaration: Yes' : String(data.remarks || '').slice(0, 280) });
  }

  const isDarkVessel = kind === 'vessel' && (/aurora|dark|sts/i.test(name) || /dark/i.test(data.remarks || ''));
  if (isDarkVessel && !has('vessel_ais_dark')) {
    add({ category: 'vessel_ais_dark', source_name: 'AIS position feed', agent: 'Tide (offline rules)', demo: true,
      summary: 'The vessel has a history of AIS gaps.', evidence_quote: 'Vessel telemetry reveals historical AIS gaps and transshipment patterns.' });
  }

  if (relType === '3rd Party Reps & Brokers') {
    add({ category: 'broker_intermediary', summary: 'The counterparty acts as a broker or intermediary.', evidence_quote: `Relationship type: ${relType}` });
  }
  if (contractVal > rules.thresholds.contractValueSgd) {
    add({ category: 'contract_value_high', summary: `The anticipated contract value is above SGD ${rules.thresholds.contractValueSgd.toLocaleString('en-SG')}.`,
      evidence_quote: `Anticipated contract value: SGD ${contractVal.toLocaleString('en-SG')}` });
  }

  // Country counts once: take the hit's country finding when it screened the same country, else look it up here
  let countryCheck = screeningHit && screeningHit.checks ? screeningHit.checks.country : null;
  if (!has('country_cpi_low') && !has('country_cpi_mid') && !(countryCheck && countryCheck.ran)) {
    const place = countryFinding(db, rules, [{ value: country, role: kind === 'vessel' ? 'flag state' : 'country on file' }], { idPrefix: `${fid}-k`, readAt });
    if (place.finding) scored.push(place.finding);
    countryCheck = place.check;
  }
  const cpiRow = db.getCpiByCode(country);

  const listCheck = { ran: true, source_name: LISTS, source_url: sourceLink(LISTS), read_at: readAt, result: 'Screened' };
  const checks = Object.assign({ sanctions: listCheck, pep: listCheck }, (screeningHit && screeningHit.checks) || {}, { _kind: kind, country: countryCheck });
  const valid = scored.map(f => validateFinding(f, rules));
  const breakdown = assess({ findings: valid.filter(v => v.ok).map(v => v.finding), rejected: valid.filter(v => !v.ok), checks, kind }, rules);
  return {
    ...resultFromBreakdown(breakdown, rules, { screeningResult: data.screening_result, cpiRow }),
    // The scoring trail, saved with the request so the "Why <score>?" panel can show it
    scored_findings: scored,
    checks,
    breakdown
  };
}

/**
 * Point A: Document Auto-Fill (Multimodal Extraction)
 * Analyzes uploaded business documents using Google Gemini or deterministic fallback.
 * 
 * @param {Object} params
 * @param {string} [params.filename]
 * @param {string} [params.fileContent]
 * @param {string} [params.mimeType]
 * @param {string} [params.base64Data]
 * @returns {Promise<Object>}
 */
async function extractDocumentData({ filename = '', fileContent = '', mimeType = 'text/plain', base64Data = '' }) {
  // 1. Gemini reads the document whenever the shared client has a backend (AI Studio key, or Vertex AI on UAT)
  if (gemini.backend() !== 'disabled') {
    try {
      let model = config.geminiModel;
      const prompt = `You are the DueDilly Compliance Document Extraction AI.
Analyze the following onboarding document (${filename || 'document'}).
Extract counterparty KYC fields and respond strictly in valid JSON matching this schema:
{
  "counterparty_name": "<Legal Entity or Individual Name>",
  "entity_type": "<Organisation|Vessel|Person>",
  "country": "<3-letter ISO country code, e.g. SGP, USA, GBR, ARE>",
  "relationship_type": "<Vendor/Supplier|Customer/Trading Partner|3rd Party Reps & Brokers|M&A and Investment|Community Investment & Sponsorship>",
  "anticipated_contract_value": <number or null>,
  "registration_number": "<string or null>",
  "directors_ubo": "<string or null>",
  "parent_company": "<string or null>",
  "imo_number": "<string or null>",
  "vessel_flag": "<string or null>",
  "vessel_type": "<string or null>",
  "full_name": "<string or null>",
  "dob": "<YYYY-MM-DD or null>",
  "passport": "<string or null>",
  "pep_declared": <boolean>,
  "remarks": "<Brief extraction summary>"
}`;

      const parts = [{ text: prompt }];

      if (base64Data && (mimeType.startsWith('image/') || mimeType === 'application/pdf')) {
        parts.push({
          inlineData: {
            mimeType: mimeType || 'application/pdf',
            data: base64Data
          }
        });
      } else if (fileContent) {
        parts.push({ text: `DOCUMENT CONTENT:\n${fileContent.substring(0, 10000)}` });
      }

      // Shared client walks the model fallback chain (lite-latest first)
      const result = await gemini.generateJsonDetailed(parts, { timeoutMs: 20000 });
      if (result) {
        model = result.model;
        {
          const parsed = result.data;
          const extractedKeys = Object.keys(parsed).filter(k => parsed[k] !== null && parsed[k] !== '');
          return {
            success: true,
            ai_suggested: true,
            model: model,
            data: parsed,
            extracted_fields: extractedKeys,
            message: `Successfully extracted ${extractedKeys.length} fields via Gemini AI.`
          };
        }
      }
    } catch (err) {
      console.warn('[Duck-Scanner] Gemini API call skipped or timed out, using fallback:', err.message);
    }
  }

  // 2. Deterministic Heuristic Fallback
  return fallbackDocumentExtraction({ filename, fileContent });
}

/**
 * Intelligent deterministic fallback parser for onboarding documents
 */
function fallbackDocumentExtraction({ filename = '', fileContent = '' }) {
  const text = `${filename} ${fileContent}`.toLowerCase();
  
  let extracted = {
    counterparty_name: '',
    entity_type: 'Organisation',
    country: 'SGP',
    relationship_type: 'Vendor/Supplier',
    anticipated_contract_value: 150000,
    registration_number: '',
    directors_ubo: '',
    parent_company: '',
    imo_number: '',
    vessel_flag: '',
    vessel_type: '',
    full_name: '',
    dob: '',
    passport: '',
    pep_declared: false,
    remarks: 'Auto-extracted from uploaded verification file.'
  };

  // 1. Check if corporate organisation document (ACRA Bizfile, Certificate of Incorporation)
  if (/bizfile|acra|incorporation|registration|uen|company|ltd|llc|cjsc|fze|gmbh|commodities|corp/i.test(text) && !/passport|nric/i.test(text)) {
    extracted.entity_type = 'Organisation';
    if (/severny/i.test(text)) {
      extracted.counterparty_name = 'Severny Port Logistics CJSC';
      extracted.country = 'RUS';
      extracted.registration_number = 'RU-OGRN-10277390';
      extracted.directors_ubo = 'State Property Agency / Rostec';
      extracted.parent_company = 'Severny Trans Holding';
      extracted.relationship_type = 'Customer/Trading Partner';
      extracted.anticipated_contract_value = 1200000;
    } else if (/straits|bunkering/i.test(text)) {
      extracted.counterparty_name = 'Straits Bunkering Trading LLC';
      extracted.country = 'ARE';
      extracted.registration_number = 'AE-992812';
      extracted.directors_ubo = 'Rashid Al-Falasi (100%)';
      extracted.parent_company = 'Gulf Marine Trading Group';
      extracted.relationship_type = '3rd Party Reps & Brokers';
      extracted.anticipated_contract_value = 160000;
    } else if (/apex/i.test(text)) {
      extracted.counterparty_name = 'Apex Commodities Pte Ltd';
      extracted.country = 'SGP';
      extracted.registration_number = '202419822K';
      extracted.directors_ubo = 'Tan Wei Liang (60%), Chua Mei Ling (40%)';
      extracted.parent_company = 'Apex Regional Holdings';
      extracted.relationship_type = 'Vendor/Supplier';
      extracted.anticipated_contract_value = 250000;
    }
  }
  // 2. Check if maritime vessel document
  else if (/vessel|imo|tanker|bulker|maritime|aurora|ship registry/i.test(text)) {
    extracted.entity_type = 'Vessel';
    extracted.counterparty_name = /aurora/i.test(text) ? 'Aurora Venture' : '';
    extracted.country = /panama|pan/i.test(text) ? 'PAN' : (/liberia|lbr/i.test(text) ? 'LBR' : 'SGP');
    extracted.imo_number = 'IMO 9823411';
    extracted.vessel_flag = extracted.country;
    extracted.vessel_type = 'Crude Oil Tanker';
    extracted.relationship_type = 'Customer/Trading Partner';
    extracted.anticipated_contract_value = 850000;
  }
  // 3. Check if passport / person document
  else if (/passport|nric|identity|individual|national id|zemtsov/i.test(text)) {
    extracted.entity_type = 'Person';
    extracted.counterparty_name = /zemtsov/i.test(text) ? 'Arkady Zemtsov' : '';
    extracted.full_name = extracted.counterparty_name;
    extracted.country = /zemtsov|russia/i.test(text) ? 'RUS' : 'GBR';
    extracted.passport = 'P88421094';
    extracted.dob = '1980-08-15';
    extracted.pep_declared = /zemtsov/i.test(text);
    extracted.relationship_type = 'M&A and Investment';
    extracted.anticipated_contract_value = 500000;
  }
  // 4. Default Organisation
  else {
    extracted.entity_type = 'Organisation';
    if (/severny/i.test(text)) {
      extracted.counterparty_name = 'Severny Port Logistics CJSC';
      extracted.country = 'RUS';
      extracted.registration_number = 'RU-OGRN-10277390';
      extracted.directors_ubo = 'State Property Agency / Rostec';
      extracted.parent_company = 'Severny Trans Holding';
      extracted.relationship_type = 'Customer/Trading Partner';
      extracted.anticipated_contract_value = 1200000;
    } else if (/straits|bunkering/i.test(text)) {
      extracted.counterparty_name = 'Straits Bunkering Trading LLC';
      extracted.country = 'ARE';
      extracted.registration_number = 'AE-992812';
      extracted.directors_ubo = 'Rashid Al-Falasi (100%)';
      extracted.parent_company = 'Gulf Marine Trading Group';
      extracted.relationship_type = '3rd Party Reps & Brokers';
      extracted.anticipated_contract_value = 160000;
    } else if (/apex/i.test(text)) {
      extracted.counterparty_name = 'Apex Commodities Pte Ltd';
      extracted.country = 'SGP';
      extracted.registration_number = '202419822K';
      extracted.directors_ubo = 'Tan Wei Liang (60%), Chua Mei Ling (40%)';
      extracted.parent_company = 'Apex Regional Holdings';
      extracted.relationship_type = 'Vendor/Supplier';
      extracted.anticipated_contract_value = 250000;
    }
  }

  // Offline the document is not really read: when it names none of the demo records, nothing is suggested
  // (an invented company would look like a real reading)
  if (!extracted.counterparty_name) {
    return {
      success: true,
      ai_suggested: false,
      model: 'SafeGlobe-Extract-Engine',
      data: { entity_type: extracted.entity_type },
      extracted_fields: [],
      message: `Dilly could not read ${filename || 'this document'} without Gemini. Fill in the form yourself.`
    };
  }

  const extractedKeys = Object.keys(extracted).filter(k => extracted[k] !== '' && extracted[k] !== null && extracted[k] !== false);

  return {
    success: true,
    ai_suggested: true,
    model: 'SafeGlobe-Extract-Engine',
    data: extracted,
    extracted_fields: extractedKeys,
    message: `Extracted ${extractedKeys.length} attributes from ${filename || 'file'} for verification.`
  };
}

/**
 * Generates the next sequential KYC ID (e.g., KYC-2026-0006)
 */
function getNextKycId() {
  const db = getDb();
  const year = new Date().getFullYear();
  const rows = db.getAllKycRequests();
  
  let maxSeq = 0;
  for (const r of rows) {
    const match = (r.id || '').match(/KYC-\d+-(\d+)/);
    if (match) {
      const seq = parseInt(match[1], 10);
      if (!isNaN(seq) && seq > maxSeq) {
        maxSeq = seq;
      }
    }
  }
  const nextSeq = String(maxSeq + 1).padStart(4, '0');
  return `KYC-${year}-${nextSeq}`;
}

/**
 * Creates and registers a new KYC request in SQLite
 * 
 * @param {Object} input
 * @param {Object} [userContext]
 * @returns {Object} Stored and hydrated KYC record
 */
function createKycRequest(input, userContext = {}, checks = {}) {
  const db = getDb();

  if (!input.counterparty_name || !input.counterparty_name.trim()) {
    throw new Error('Counterparty Name is required');
  }

  const id = input.id || getNextKycId();
  const counterpartyName = input.counterparty_name.trim();
  const entityType = input.entity_type || 'Organisation';
  const country = (input.country || 'SGP').toUpperCase();
  const relationshipType = input.relationship_type || 'Vendor/Supplier';
  const contractValue = Number(input.contract_value || input.anticipated_contract_value || 0);
  const ongoingMonitoring = Boolean(input.ongoing_monitoring);

  // Extract Entity Attributes
  let attributes = input.attributes || {};
  if (typeof attributes === 'string') {
    try { attributes = JSON.parse(attributes); } catch (e) { attributes = {}; }
  }

  // The registry check is written by the server only (checks.vessel), never taken from the form
  delete attributes.ais;

  // Populate dynamic entity attributes from top-level fields if provided
  if (entityType === 'Organisation') {
    if (input.registration_number) attributes.reg_no = input.registration_number;
    if (input.tax_id) attributes.tax_id = input.tax_id;
    if (input.directors_ubo) attributes.directors_ubo = input.directors_ubo;
    if (input.parent_company) attributes.parent_company = input.parent_company;
  } else if (entityType === 'Vessel') {
    if (input.imo_number) attributes.imo = input.imo_number;
    if (input.vessel_flag) attributes.vessel_flag = input.vessel_flag;
    if (input.vessel_type) attributes.vessel_type = input.vessel_type;
    if (input.registered_owner) attributes.registered_owner = input.registered_owner;
    if (input.commercial_operator) attributes.commercial_operator = input.commercial_operator;
    if (checks.vessel) attributes.ais = vesselRecord(checks.vessel, { name: counterpartyName, country, type: attributes.vessel_type });
  } else if (entityType === 'Person') {
    if (input.full_name) attributes.full_name = input.full_name;
    if (input.aliases) attributes.aliases = input.aliases;
    if (input.dob) attributes.dob = input.dob;
    if (input.passport) attributes.passport = input.passport;
    if (input.pep_declared !== undefined) attributes.pep_declared = Boolean(input.pep_declared);
  }

  // Location / Google Maps Place
  let location = input.location || {};
  if (typeof location === 'string') {
    try { location = JSON.parse(location); } catch (e) { location = {}; }
  }
  if (input.formatted_address || input.address) {
    location.address = input.formatted_address || input.address;
    if (input.lat) location.lat = Number(input.lat);
    if (input.lng) location.lng = Number(input.lng);
    if (input.place_id) location.place_id = input.place_id;
  }

  // Ongoing monitoring places the counterparty on the globe, so it needs somewhere to be pinned
  const hasAisPosition = Boolean(attributes.ais && attributes.ais.lat !== null && attributes.ais.lat !== undefined);
  if (ongoingMonitoring && !hasAisPosition && !String(location.address || '').trim()) {
    throw new Error('A location is required when Ongoing Monitoring is enabled');
  }

  // Attachments
  let attachments = input.attachments || [];
  if (typeof attachments === 'string') {
    try { attachments = JSON.parse(attachments); } catch (e) { attachments = [input.attachments]; }
  }

  // 1. Run Screening Engine
  const screeningHit = screenCounterparty({
    name: counterpartyName,
    entity: entityType.toLowerCase(),
    jurisdiction: country
  });

  // 2. Evaluate Policy Rules (Point C)
  const policyEval = evaluatePolicyRules({
    counterparty_name: counterpartyName,
    entity_type: entityType,
    country,
    relationship_type: relationshipType,
    contract_value: contractValue,
    attributes,
    screening_result: screeningHit.screeningResult,
    remarks: input.remarks,
    ddq_status: input.ddq_status
  });

  // 3. AI Risk Scoring (Point B)
  const aiRisk = calculateAiRisk({
    counterparty_name: counterpartyName,
    entity_type: entityType,
    country,
    relationship_type: relationshipType,
    contract_value: contractValue,
    attributes,
    remarks: input.remarks
  }, screeningHit);

  // A vessel whose registry record contradicts the form goes to compliance, never auto-cleared
  const mismatches = (attributes.ais && attributes.ais.mismatches) || [];
  if (mismatches.length) {
    const clause = 'Policy §5.4 (Vessel registry mismatch on VesselFinder)';
    policyEval.triggered_clauses = [...(policyEval.triggered_clauses || []), clause];
    policyEval.ddq_clause = policyEval.triggered_clauses.join(' & ');
    policyEval.ddq_required = true;
    if (!policyEval.ddq_status || policyEval.ddq_status === 'N/A') policyEval.ddq_status = 'Triggered';
    Object.assign(aiRisk, withVesselMismatch(aiRisk, attributes.ais));
  }

  // Counterparty Contact Email
  const counterpartyEmail = (input.counterparty_email || input.email || `${counterpartyName.toLowerCase().replace(/[^a-z0-9]+/g, '')}@vendor.domain`).trim();

  // Cryptographic Guest Token for Counterparty DDQ Portal
  let ddqToken = input.ddq_token || null;
  let ddqExpiresAt = input.ddq_token_expires_at || null;
  let ddqStatus = input.ddq_status || policyEval.ddq_status;

  if (policyEval.ddq_required && !ddqToken) {
    const payload = {
      kyc_id: id,
      counterparty_name: counterpartyName,
      counterparty_email: counterpartyEmail,
      entity_type: entityType,
      clause: policyEval.ddq_clause,
      exp: Math.floor(Date.now() / 1000) + (14 * 86400) // 14-day validity
    };
    // Which workspace the questionnaire belongs to (absent for the Demo workspace); the counterparty has no account
    const workspaceId = require('../db').currentWorkspaceId();
    if (workspaceId) payload.ws = workspaceId;
    ddqToken = jwt.sign(payload, config.jwtSecret);
    ddqExpiresAt = new Date(Date.now() + 14 * 86400 * 1000).toISOString();
  }

  // Determine initial Request Status (Branch A vs Branch B)
  let requestStatus = input.request_status;
  if (!requestStatus) {
    if (aiRisk.screening_result === 'Sanctions Alert') {
      // A machine never rejects: a sanctions alert goes to the compliance queue and a person decides (GEMINI.md section 10)
      requestStatus = 'Under Review';
    } else if (policyEval.ddq_required) {
      requestStatus = 'Pending DDQ'; // Branch B
    } else {
      requestStatus = 'Approved'; // Branch A (Low Risk auto-approved)
    }
  }

  const now = new Date();
  const submissionDate = input.submission_date ||
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const record = {
    id,
    submission_date: submissionDate,
    counterparty_name: counterpartyName,
    entity_type: entityType,
    country,
    relationship_type: relationshipType,
    contract_value: contractValue,
    ongoing_monitoring: ongoingMonitoring ? 1 : 0,
    request_status: requestStatus,
    screening_result: aiRisk.screening_result,
    ai_result: aiRisk.ai_result,
    ai_score: aiRisk.ai_score,
    ai_confidence: aiRisk.ai_confidence,
    ai_rationale: aiRisk.ai_rationale,
    ddq_required: policyEval.ddq_required ? 1 : 0,
    ddq_status: ddqStatus,
    ddq_clause: policyEval.ddq_clause,
    remarks: input.remarks || '',
    attributes_json: JSON.stringify(attributes),
    location_json: JSON.stringify(location),
    attachments_json: JSON.stringify(attachments),
    created_by_user_id: userContext.userId || input.created_by_user_id || 'EMP-1042',
    created_by_email: userContext.email || input.created_by_email || 'john.doe@duedilly.com',
    created_by_department: userContext.department || input.created_by_department || 'Procurement & Logistics',
    ip_address: userContext.ip || input.ip_address || '127.0.0.1',
    client_timestamp: userContext.clientTimestamp || input.client_timestamp || now.toISOString(),
    last_modified_by: input.last_modified_by || 'Employee Portal',
    counterparty_email: counterpartyEmail,
    ddq_token: ddqToken,
    ddq_token_expires_at: ddqExpiresAt,
    ddq_responses_json: JSON.stringify(input.ddq_responses || {}),
    compliance_notes: input.compliance_notes || '',
    re_screening_result: input.re_screening_result || ''
  };

  const saved = db.addKycRequest(record);
  // Keep the scoring trail under the id the globe uses for this request, so its "Why <score>?" panel can be shown
  try {
    recordFindings(db, monitoredEntityId(id), aiRisk.scored_findings || [], { replace: true });
    db.setRiskChecks(monitoredEntityId(id), aiRisk.checks || {});
  } catch (err) {
    console.error('[DueDilly] Scoring trail not saved:', err.message);
  }

  // Freeze the questionnaire the counterparty will see at the moment the DDQ is issued
  if (policyEval.ddq_required) {
    try {
      const template = require('./ddqTemplateService').getActiveTemplate();
      if (template) db.setKycDdqTemplate(saved.id, template);
    } catch (err) {
      console.error('Could not snapshot DDQ template:', err.message);
    }
  }

  syncMonitoredEntity(saved);

  return {
    ...saved,
    ddq_link: ddqToken ? `/ddq/portal?token=${ddqToken}` : null
  };
}

const monitoredEntityId = kycId => `kyc-${String(kycId).toLowerCase()}`;

/**
 * Keeps the globe in step with KYC decisions: a request with Ongoing Monitoring enabled is
 * pinned on the globe from intake. Until it is Approved (auto-cleared, or passed after DDQ
 * review) the pin is marked pending; it is removed if the request is Rejected or monitoring
 * is switched off. Call after every status change.
 */
function syncMonitoredEntity(request) {
  if (!request || !request.id) return null;
  const db = getDb();
  const entityId = monitoredEntityId(request.id);
  const qualifies = Boolean(request.ongoing_monitoring) && request.request_status !== 'Rejected';
  const pending = request.request_status !== 'Approved';

  if (!qualifies) {
    if (db.getEntityById(entityId)) db.deleteEntity(entityId);
    return null;
  }

  const attrs = request.attributes || {};
  const loc = request.location || {};
  const kind = request.entity_type === 'Vessel' ? 'vessel' : request.entity_type === 'Person' ? 'person' : 'org';
  const hasPin = Number.isFinite(Number(loc.lat)) && Number.isFinite(Number(loc.lng)) && loc.lat !== null && loc.lng !== null;
  const submitter = String(request.created_by_email || '').split('@')[0].split(/[._]/).filter(Boolean)
    .map(p => p[0].toUpperCase() + p.slice(1)).join(' ') || 'Compliance';
  const ais = attrs.ais || null;
  const hasFix = ais && ais.status === 'found' && Number.isFinite(Number(ais.lat)) && Number.isFinite(Number(ais.lng)) && ais.lat !== null && ais.lng !== null;
  const voyage = kind === 'vessel' && hasFix ? { at: [Number(ais.lng), Number(ais.lat)], to: Array.isArray(ais.destination_ll) ? ais.destination_ll : null } : null;
  const cleared = pending ? 'Pending approval' : request.ddq_required ? 'Approved after DDQ review' : 'Auto-cleared by policy';

  db.upsertEntity({
    id: entityId,
    kind,
    name: request.counterparty_name,
    short: request.counterparty_name.split(/\s+/).slice(0, 2).join(' '),
    role: kind === 'vessel' ? (attrs.vessel_type || 'Vessel') : request.relationship_type,
    a3: request.country,
    city: String(loc.address || '').split(',')[0].trim(),
    reg: attrs.reg_no || attrs.imo || attrs.passport || request.id,
    risk: Number(request.ai_score) || 20,
    conf: Number(request.ai_confidence) || 90,
    owner: submitter,
    trigger: `Ongoing monitoring · ${request.id} · ${cleared}`,
    since: String(request.submission_date || '').slice(0, 4) || String(new Date().getFullYear()),
    summary: request.ai_rationale || '',
    // The globe expects [longitude, latitude]; without a pin it falls back to the country centroid.
    // A vessel is drawn at its last AIS position, with a route to its destination when it broadcasts one.
    ll: voyage ? voyage.at : hasPin ? [Number(loc.lng), Number(loc.lat)] : undefined,
    route: voyage && voyage.to ? [voyage.at, voyage.to] : undefined,
    ais: kind === 'vessel' && ais ? ais : undefined,
    flag: ais && ais.flag ? ais.flag : undefined,
    mmsi: ais && ais.mmsi ? ais.mmsi : undefined,
    dest: ais && ais.destination ? ais.destination : undefined,
    operatingAddresses: loc.address || '',
    residentialAddress: kind === 'person' ? (loc.address || '') : '',
    controllers: attrs.directors_ubo || '',
    pending,
    factors: [['-', `${cleared} (${request.id})`], ['+', `Screening result: ${request.screening_result}`], ...vesselFactors(ais)],
    findings: []
  });
  return db.getEntityById(entityId);
}

// ---------------------------------------------------------------------------------------------
// Pond-Guard at the first instance: every new request is screened by the agents, in the background.
// The first, rule-based result stays on the request until the agents answer, and for good when they cannot.
// ---------------------------------------------------------------------------------------------
const REUSE_MS = 24 * 60 * 60 * 1000;
const pgNorm = v => String(v || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const pgDigits = v => String(v || '').replace(/[^0-9a-z]/gi, '').toLowerCase();
const PG_MESSAGES = {
  screening: 'Pond-Guard is screening this request.',
  done: 'Screened by Pond-Guard.',
  limit: 'Pond-Guard daily limit reached, press Screen tomorrow',
  offline: 'Offline'
};

/**
 * What makes two requests "the same counterparty": the same registration, IMO or identity document number,
 * or, when the request gives none, the same name and country.
 */
function entityKeyFor(request) {
  const a = request.attributes || {};
  const id = pgDigits(a.imo || a.reg_no || a.passport || '');
  return id.length >= 5 ? `id:${id}` : `name:${pgNorm(request.counterparty_name)}|${String(request.country || '').toUpperCase()}`;
}

/**
 * The request as a counterparty for the screening agents. A request has no counterparty record of its own unless
 * it is monitored; when it names one that is already on the watchlist, that record's evidence is read as well.
 */
function subjectForRequest(db, request) {
  const a = request.attributes || {};
  const kind = request.entity_type === 'Vessel' ? 'vessel' : request.entity_type === 'Person' ? 'person' : 'org';
  const id = monitoredEntityId(request.id);
  const own = db.getEntityById(id) || {};
  const ids = [a.imo, a.reg_no, a.passport].map(pgDigits).filter(v => v.length >= 5);
  const name = pgNorm(request.counterparty_name);
  const known = db.getAllEntities().find(e => !String(e.id).startsWith('kyc-') && (
    [e.reg, e.imo, e.idDoc].map(pgDigits).some(v => v.length >= 5 && ids.some(x => v === x || v.endsWith(x) || x.endsWith(v))) || pgNorm(e.name) === name)) || null;
  const pick = key => (own[key] !== undefined && own[key] !== null && !(Array.isArray(own[key]) && !own[key].length) ? own[key] : known ? known[key] : undefined);
  return {
    id, kind, name: request.counterparty_name,
    a3: request.country, reg: a.reg_no || a.imo || a.passport || '', imo: a.imo || pick('imo') || '', idDoc: a.passport || pick('idDoc') || '', dob: a.dob || pick('dob') || '',
    flag: (a.ais && a.ais.flag) || pick('flag'), nationality: pick('nationality'), role: request.relationship_type,
    pep: Boolean(a.pep_declared || pick('pep')),
    lists: pick('lists') || [], findings: pick('findings') || [], factors: pick('factors') || [], signals: pick('signals') || [], flags: pick('flags') || [],
    evidenceIds: known ? [known.id] : [],
    knownAs: known ? { id: known.id, name: known.name } : null,
    request: { id: request.id, contract_value: request.contract_value, relationship_type: request.relationship_type, country: request.country }
  };
}

const pgState = (db, kycId, state) => { db.setKycPondGuard(kycId, Object.assign({ at: new Date().toISOString() }, state)); return state; };

/** Writes a Pond-Guard result over the request's first result. The score and the route come from the breakdown. */
function writeBackScreening(db, request, breakdown) {
  const rules = getRules(db);
  const fields = resultFromBreakdown(breakdown, rules, { screeningResult: 'Clear', cpiRow: db.getCpiByCode(String(request.country || '').toUpperCase()) });
  let updated = db.setKycAiResult(request.id, fields);
  // Pond-Guard never approves and never rejects. A request the first rules had cleared goes to a person
  // when the agents' findings put it on or over the line.
  if (updated.request_status === 'Approved' && breakdown.risk >= rules.routes.riskLine) {
    updated = db.updateKycRequestStatus(request.id, 'Under Review', 'Pond-Guard');
  }
  syncMonitoredEntity(updated);
  return updated;
}

/** The first, rule-based result is the suggestion on record until the agents answer. */
function recordRuleSuggestion(db, request) {
  const pondGuard = require('./pondGuardService');
  const entityId = monitoredEntityId(request.id);
  const breakdown = require('../risk/riskService').assessEntity(db, entityId);
  if (!breakdown) return null;
  return db.addSuggestion(pondGuard.suggestionOf(`RS-${entityId}-${Date.now().toString(36)}`, entityId, breakdown, getRules(db), { kycId: request.id, entityKey: entityKeyFor(request), mode: 'rules', detail: {} }));
}

/**
 * Called when a request has just been saved. Decides what happens next and says so on the request:
 * screening (the event is published, or the page asks for it), limit, or offline. Never waits for the agents.
 */
function requestScreening(db, request) {
  const pondGuard = require('./pondGuardService');
  recordRuleSuggestion(db, request);
  const m = pondGuard.mode(db);
  if (!m.live) return pgState(db, request.id, { status: m.kind === 'limit' ? 'limit' : 'offline', message: PG_MESSAGES[m.kind === 'limit' ? 'limit' : 'offline'], reason: m.reason });
  const bus = require('../events/bus');
  // On Cloud Run the CPU is only there while a request is being handled. With events handled inside the app
  // nothing may be started after the answer: the page that shows the request asks for the run instead.
  const inRequest = config.isCloudRun && bus.status().mode === 'inline';
  const state = pgState(db, request.id, { status: 'screening', message: PG_MESSAGES.screening, via: inRequest ? 'page' : bus.status().mode });
  if (!inRequest) bus.publish('screening-requested', { kycId: request.id, reason: 'New KYC request' });
  return state;
}

const screeningNow = new Map();
/**
 * Screens one request with Pond-Guard and writes the result back. One run per request at a time: a second
 * caller gets the first run's result. force: an officer asked for a fresh run (no reuse).
 */
function screenRequest(db, kycId, opts = {}) {
  const key = `${require('../db').currentWorkspaceId() || 'demo'}:${kycId}`;
  if (screeningNow.has(key)) return screeningNow.get(key);
  const run = runRequestScreening(db, kycId, opts).finally(() => screeningNow.delete(key));
  screeningNow.set(key, run);
  return run;
}

async function runRequestScreening(db, kycId, { force = false } = {}) {
  const pondGuard = require('./pondGuardService');
  const riskService = require('../risk/riskService');
  const request = db.getKycRequestById(kycId);
  if (!request) throw Object.assign(new Error('KYC request not found'), { status: 404 });
  const entityId = monitoredEntityId(request.id);
  const entityKey = entityKeyFor(request);
  const subject = subjectForRequest(db, request);
  const rules = getRules(db);

  // The same counterparty screened in the last 24 hours: that result is reused, and no run is made
  const recent = force ? null : db.findLiveSuggestionByKey(entityKey, new Date(Date.now() - REUSE_MS).toISOString());
  if (recent && recent.entityId !== entityId) {
    const prefix = `PG-${entityId}-${Date.now().toString(36)}`;
    const own = new Set(['contract_value_high', 'broker_intermediary']);
    const copied = db.getFindingRecords(recent.entityId)
      .filter(r => !own.has(r.finding.category))
      .map((r, i) => Object.assign({}, r.finding, { id: `${prefix}-r${i + 1}` }, r.status === 'accepted' ? {} : { _reason: r.reason || 'Not counted in the screening this was reused from.' }));
    // The contract value and the relationship are this request's own
    const mine = pondGuard.ruleFindings(db, rules, subject, new Set(copied.filter(f => !f._reason).map(f => f.category)), { idPrefix: prefix, readAt: new Date().toISOString() });
    riskService.recordFindings(db, entityId, [...copied, ...mine.findings], { replace: true });
    db.setRiskChecks(entityId, Object.assign({}, db.getRiskChecks(recent.entityId) || {}, { _kind: subject.kind }));
    riskService.rescoreEntity(db, entityId);
    const breakdown = riskService.assessEntity(db, entityId);
    db.addSuggestion(pondGuard.suggestionOf(prefix, entityId, breakdown, rules, { kycId: request.id, entityKey, mode: 'reused', detail: { reusedFrom: { suggestionId: recent.id, at: recent.at, kycId: recent.kycId }, dilly: recent.detail.dilly || null } }));
    const updated = writeBackScreening(db, request, breakdown);
    const when = new Date(recent.at).toISOString().slice(0, 16).replace('T', ' ');
    return { request: updated, state: pgState(db, request.id, { status: 'reused', message: `Reused from the screening at ${when} UTC`, reusedAt: recent.at, reusedFromKycId: recent.kycId || null }) };
  }

  let result;
  try {
    result = await pondGuard.screenEntity(db, entityId, () => {}, { subject, kycId: request.id, entityKey });
  } catch (err) {
    console.error('[Pond-Guard] request screening failed:', err.message);
    result = { live: false, kind: 'offline', reason: 'The screening could not finish.' };
  }
  if (!result.live) {
    const limit = result.kind === 'limit';
    return { request: db.getKycRequestById(kycId), state: pgState(db, request.id, { status: limit ? 'limit' : 'offline', message: PG_MESSAGES[limit ? 'limit' : 'offline'], reason: result.reason }) };
  }
  const updated = writeBackScreening(db, request, result.breakdown);
  return { request: updated, state: pgState(db, request.id, { status: 'done', message: PG_MESSAGES.done, suggestionId: result.suggestion.id, knownAs: subject.knownAs }) };
}

/** What is kept on the request from a VesselFinder lookup, plus how it differs from the form. */
function vesselRecord(vessel, declared) {
  const db = getDb();
  // The flag is only compared when the form's country code maps to a flag state name
  const cpiRow = declared.country ? db.getCpiByCode(declared.country) : null;
  const declaredFlag = vesselFinder.flagName(declared.country) || (cpiRow && cpiRow.name) || '';
  const record = {
    status: vessel.status, imo: vessel.imo, source: vessel.source, source_url: vessel.source_url, via: vessel.via || '',
    checked_at: vessel.checked_at, message: vessel.message || ''
  };
  if (vessel.status !== 'found') return Object.assign(record, { mismatches: [] });
  return Object.assign(record, {
    name: vessel.name, type: vessel.type, flag: vessel.flag, mmsi: vessel.mmsi,
    lat: vessel.lat, lng: vessel.lng, course: vessel.course, speed: vessel.speed, reported: vessel.reported, precision: vessel.precision,
    destination: vessel.destination, eta: vessel.eta, destination_ll: vessel.destination_ll || null,
    mismatches: vesselFinder.compare({ name: declared.name, flag: declaredFlag, type: declared.type }, vessel)
  });
}

const mismatchText = ais => (ais.mismatches || []).map(m => `${m.field.toLowerCase()} declared "${m.declared}", registry "${m.registry}"`).join('; ');

/** Raises a request to at least Medium Risk and says why, when the registry contradicts the form. */
function withVesselMismatch(aiRisk, ais) {
  const score = Math.max(Number(aiRisk.ai_score) || 0, 65);
  const label = score >= 75 ? 'High Risk' : 'Medium Risk';
  return {
    ai_score: score,
    ai_result: `${label} (Confidence ${aiRisk.ai_confidence}%)`,
    ai_rationale: `${aiRisk.ai_rationale} VesselFinder registry mismatch for IMO ${ais.imo}: ${mismatchText(ais)}.`
  };
}

/** Lines shown under "why this score" on the globe for a vessel. */
function vesselFactors(ais) {
  if (!ais) return [];
  if (ais.status === 'found') {
    const lines = [['-', `IMO ${ais.imo} verified on VesselFinder as ${ais.name}`]];
    (ais.mismatches || []).forEach(m => lines.push(['+', `${m.field} mismatch: declared "${m.declared}", registry "${m.registry}"`]));
    return lines;
  }
  if (ais.status === 'not_found') return [['+', `IMO ${ais.imo} was not found on VesselFinder`]];
  if (ais.status === 'invalid') return [['+', `IMO ${ais.imo || 'number'} is not a valid IMO number`]];
  return [['+', 'IMO not verified: VesselFinder could not be reached']];
}

/**
 * Re-reads one vessel request from VesselFinder (position, destination, registry details),
 * stores it on the request and moves its marker on the globe. Returns the stored record, or null.
 */
async function refreshVessel(requestId) {
  const db = getDb();
  const request = db.getKycRequestById(requestId);
  if (!request || request.entity_type !== 'Vessel') return null;
  const attrs = Object.assign({}, request.attributes || {});
  const before = attrs.ais || null;
  const vessel = await vesselFinder.lookup(attrs.imo, { fresh: true });
  // An outage must not wipe a position that was read earlier
  if (vessel.status === 'unavailable' && before && before.status === 'found') return before;
  attrs.ais = vesselRecord(vessel, { name: request.counterparty_name, country: request.country, type: attrs.vessel_type });
  const updated = db.setKycAttributes(request.id, attrs);
  // Only a vessel that has its own marker is moved: demo entities with the same name keep theirs
  if (db.getEntityById(monitoredEntityId(request.id))) syncMonitoredEntity(updated);
  if (before && before.status === 'found' && attrs.ais.status === 'found' && before.destination !== attrs.ais.destination) {
    db.addAlert('Tide', request.id, `${request.counterparty_name}: destination changed from ${before.destination || 'none'} to ${attrs.ais.destination || 'none'} (VesselFinder)`, 'monitor');
  }
  return attrs.ais;
}

/** Looks up monitored vessels that have never been checked. Runs in the background after start-up. */
async function refreshUncheckedVessels() {
  if (!vesselFinder.isEnabled()) return 0;
  const todo = getDb().getAllKycRequests({}).filter(r => r.entity_type === 'Vessel' && r.ongoing_monitoring && r.request_status !== 'Rejected' && !(r.attributes && r.attributes.ais));
  for (const r of todo) {
    try { await refreshVessel(r.id); } catch (err) { console.error(`[DueDilly] Vessel lookup failed for ${r.id}:`, err.message); }
  }
  return todo.length;
}

/**
 * Pins every monitored request that is not on the globe yet (requests created before pins
 * were added at intake, or seeded straight into the database). A request whose counterparty
 * is already on the globe under another id, such as the built-in demo entities, is left alone.
 */
function syncAllMonitoredEntities() {
  const db = getDb();
  const names = new Set(db.getAllEntities().filter(e => !String(e.id).startsWith('kyc-')).map(e => String(e.name).trim().toLowerCase()));
  db.getAllKycRequests({}).forEach(r => {
    if (r.ongoing_monitoring && names.has(String(r.counterparty_name).trim().toLowerCase())) return;
    syncMonitoredEntity(r);
  });
}

/**
 * Section 5: Export to Excel (.xlsx compatible CSV with UTF-8 BOM)
 * Includes all 13 table columns + hidden audit fields
 * 
 * @param {Array} records
 * @returns {string} CSV text
 */
function exportKycCsv(records) {
  const headers = [
    // 13 Table Schema Columns in exact order
    'KYC ID',
    'Submission Date',
    'Counterparty Name',
    'Entity Type',
    'Country of Incorporation / Flag / Nationality',
    'Relationship Type',
    'Anticipated Contract Value (SGD)',
    'Ongoing Monitoring',
    'Request Status',
    'KYC Screening Result',
    'AI Result',
    'DDQ Required',
    'DDQ Status',
    // Audit & Traceability Fields
    'AI Rationale',
    'Triggered Policy Clause',
    'Created By User ID',
    'Created By Email',
    'Created By Department',
    'Client IP Address',
    'Client Timestamp',
    'Last Modified By',
    'Entity Attributes',
    'Verified Physical Address'
  ];

  function escapeCsv(val) {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  }

  const rows = records.map(r => {
    const formattedVal = `SGD ${Number(r.contract_value || 0).toLocaleString('en-US')}`;
    const monitoring = r.ongoing_monitoring ? 'Enabled' : 'Disabled';
    const ddqReq = r.ddq_required ? 'Yes' : 'No';
    const attrsStr = r.attributes ? JSON.stringify(r.attributes) : '';
    const locStr = r.location && r.location.address ? r.location.address : '';

    return [
      escapeCsv(r.id),
      escapeCsv(r.submission_date),
      escapeCsv(r.counterparty_name),
      escapeCsv(r.entity_type),
      escapeCsv(r.country),
      escapeCsv(r.relationship_type),
      escapeCsv(formattedVal),
      escapeCsv(monitoring),
      escapeCsv(r.request_status),
      escapeCsv(r.screening_result),
      escapeCsv(r.ai_result),
      escapeCsv(ddqReq),
      escapeCsv(r.ddq_status),
      escapeCsv(r.ai_rationale),
      escapeCsv(r.ddq_clause),
      escapeCsv(r.created_by_user_id),
      escapeCsv(r.created_by_email),
      escapeCsv(r.created_by_department),
      escapeCsv(r.ip_address),
      escapeCsv(r.client_timestamp),
      escapeCsv(r.last_modified_by),
      escapeCsv(attrsStr),
      escapeCsv(locStr)
    ].join(',');
  });

  // Prefix with UTF-8 Byte Order Mark (\uFEFF) for native Excel double-click opening
  return '\uFEFF' + [headers.map(h => `"${h}"`).join(','), ...rows].join('\r\n');
}

/**
 * Seeds demo requests owned by the hackathon employee persona so the row-scoped
 * employee portal is not empty on first login. No-op once that persona has any row.
 */
function ensurePersonaSeed() {
  // The demo kit (scripts/demo-reset.js) seeds its own, fuller story for this persona
  if (process.env.SAFEGLOBE_SKIP_PERSONA_SEED) return;
  const db = getDb();
  // A clean workspace (npm run demo:clean) starts with no requests at all
  if (!db.hasPlaceholderData()) return;
  const persona = { userId: 'EMP-1042', email: 'john.doe@duedilly.com', department: 'Procurement & Logistics' };
  if (db.getAllKycRequests({ created_by_email: persona.email }).length > 0) return;

  const samples = [
    {
      counterparty_name: 'Apex Commodities Pte Ltd',
      entity_type: 'Organisation',
      country: 'SGP',
      relationship_type: 'Vendor/Supplier',
      contract_value: 85000,
      ongoing_monitoring: false,
      remarks: 'Office consumables and packaging supply for FY2026.',
      attributes: { reg_no: '202419822K', directors_ubo: 'Tan Wei Liang (60%), Chua Mei Ling (40%)' }
    },
    {
      counterparty_name: 'Straits Marine Brokers Pte Ltd',
      entity_type: 'Organisation',
      country: 'SGP',
      relationship_type: '3rd Party Reps & Brokers',
      contract_value: 250000,
      ongoing_monitoring: true,
      counterparty_email: 'compliance@straitsmarine.example',
      remarks: 'Chartering broker for Q4 bulk shipments.',
      attributes: { reg_no: '201733410D', directors_ubo: 'Lim Hock Seng (70%)' },
      location: { address: 'Jurong Port Terminal, 37 Jurong Port Road, Singapore 619110', lat: 1.306, lng: 103.714, place_id: 'sg_jurong' }
    },
    {
      counterparty_name: 'MV Aurora Tide',
      entity_type: 'Vessel',
      country: 'PAN',
      relationship_type: 'Customer/Trading Partner',
      contract_value: 420000,
      ongoing_monitoring: true,
      counterparty_email: 'ops@auroraocean.example',
      remarks: 'Time-charter for crude lifting, Tuas to Fujairah.',
      attributes: { imo: 'IMO 9823411', vessel_type: 'Crude Oil Tanker', registered_owner: 'Aurora Ocean Marine Ltd', commercial_operator: 'Straits Tankers Chartering' },
      location: { address: 'Tuas Mega Port Terminal, Tuas South Avenue 14, Singapore', lat: 1.258, lng: 103.635, place_id: 'sg_tuas' }
    }
  ];
  for (const sample of samples) createKycRequest(sample, persona);
}

module.exports = {
  requestScreening,
  screenRequest,
  subjectForRequest,
  entityKeyFor,
  resultFromBreakdown,
  PG_MESSAGES,
  ensurePersonaSeed,
  syncMonitoredEntity,
  syncAllMonitoredEntities,
  refreshVessel,
  refreshUncheckedVessels,
  evaluatePolicyRules,
  calculateAiRisk,
  extractDocumentData,
  createKycRequest,
  exportKycCsv,
  generateKycExcelWorkbook,
  getNextKycId
};
