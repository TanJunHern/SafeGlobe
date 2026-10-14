/**
 * THE SANCTIONS AGENT
 *
 * Specialized agent under the multi-agent orchestrator framework.
 * Reads and infers from compliance reports and documents to determine which countries
 * and territories are currently subject to international sanctions, embargoes and trade restrictions.
 *
 * Ingestion:
 *   Currently ingests PDF documents from custom policies, data sources, uploaded files,
 *   direct file paths, buffers, or base64 data URIs.
 *
 * Deterministic + LLM Modes:
 *   - Offline / No API Key: deterministic regex & contextual parser with exact quote extraction.
 *   - Gemini API Key: natural-language synthesis with regulatory analysis.
 */
const fs = require('fs');
const path = require('path');
const { Tool, Agent, Runner } = require('./framework');
const { getDb } = require('../db');

const AGENT_NAME = 'Sanctions Agent';
const INSTRUCTION = `You are the SafeGlobe Sanctions Agent. Your role is to analyze ingested reports (PDF documents from policies and sources) and infer which countries and territories are currently subject to international sanctions or trade restrictions.
Identify the target countries (ISO-3), the sanctioning regimes (OFAC, EU, UN, UK, MAS), specific restriction types, severity level, and verbatim evidence citations.
Respond with JSON only, matching the exact schema requested.`;

// ---------------------------------------------------------------------------
// Jurisdictions & Sanctions Knowledge Base
// ---------------------------------------------------------------------------

const JURISDICTION_ALIASES = [
  { iso3: 'RUS', name: 'Russia', aliases: ['russia', 'russian federation', 'russian', 'moscow'] },
  { iso3: 'IRN', name: 'Iran', aliases: ['iran', 'islamic republic of iran', 'iranian', 'tehran'] },
  { iso3: 'PRK', name: 'North Korea', aliases: ['north korea', 'dprk', "democratic people's republic of korea", 'pyongyang'] },
  { iso3: 'SYR', name: 'Syria', aliases: ['syria', 'syrian arab republic', 'syrian', 'damascus'] },
  { iso3: 'CUB', name: 'Cuba', aliases: ['cuba', 'cuban', 'republic of cuba', 'havana'] },
  { iso3: 'VEN', name: 'Venezuela', aliases: ['venezuela', 'venezuelan', 'bolivarian republic of venezuela', 'caracas'] },
  { iso3: 'BLR', name: 'Belarus', aliases: ['belarus', 'belarusian', 'belorussian', 'republic of belarus', 'minsk'] },
  { iso3: 'MMR', name: 'Myanmar', aliases: ['myanmar', 'burma', 'burmese', 'republic of the union of myanmar', 'yangon', 'naypyidaw'] },
  { iso3: 'SDN', name: 'Sudan', aliases: ['sudan', 'sudanese', 'republic of the sudan', 'khartoum'] },
  { iso3: 'SSD', name: 'South Sudan', aliases: ['south sudan', 'republic of south sudan', 'juba'] },
  { iso3: 'YEM', name: 'Yemen', aliases: ['yemen', 'yemeni', 'republic of yemen', 'sanaa', 'houthi'] },
  { iso3: 'LBY', name: 'Libya', aliases: ['libya', 'libyan', 'state of libya', 'tripoli'] },
  { iso3: 'SOM', name: 'Somalia', aliases: ['somalia', 'somali', 'federal republic of somalia', 'mogadishu'] },
  { iso3: 'ZWE', name: 'Zimbabwe', aliases: ['zimbabwe', 'zimbabwean', 'republic of zimbabwe', 'harare'] },
  { iso3: 'CAF', name: 'Central African Republic', aliases: ['central african republic', 'car', 'bangui'] },
  { iso3: 'COD', name: 'Democratic Republic of the Congo', aliases: ['democratic republic of the congo', 'drc', 'congo-kinshasa'] },
  { iso3: 'UKR-OCC', name: 'Occupied Ukrainian Territories', aliases: ['crimea', 'sevastopol', 'donetsk', 'luhansk', 'kherson', 'zaporizhzhia'] }
];

const SANCTION_REGIMES = [
  { id: 'OFAC', name: 'US OFAC', patterns: [/\bOFAC\b/i, /Office of Foreign Assets Control/i, /US Treasury/i, /Executive Order\s+\d+/i, /SDN\b/] },
  { id: 'EU', name: 'European Union', patterns: [/\bEU\b/i, /European Union/i, /Council Regulation/i, /EU Sanctions/i, /CFSP\b/] },
  { id: 'UN', name: 'United Nations', patterns: [/\bUN\b/i, /United Nations/i, /Security Council/i, /UNSC Resolution/i] },
  { id: 'UK', name: 'UK OFSI', patterns: [/\bOFSI\b/i, /UK Sanctions/i, /Office of Financial Sanctions Implementation/i, /HM Treasury/i] },
  { id: 'MAS', name: 'Monetary Authority of Singapore', patterns: [/\bMAS\b/i, /Monetary Authority of Singapore/i, /MAS Notice/i] },
  { id: 'SECO', name: 'Switzerland SECO', patterns: [/\bSECO\b/i, /State Secretariat for Economic Affairs/i] }
];

const SANCTION_TRIGGERS = [
  /\bsanction(?:s|ed|ing)?\b/i,
  /\bembargo(?:es|ed)?\b/i,
  /\bprohibit(?:s|ed|ion|ing)?\b/i,
  /\brestrict(?:s|ed|ion|ing)?\b/i,
  /\basset freeze\b/i,
  /\bexport control(?:s)?\b/i,
  /\bimport ban\b/i,
  /\bspecially designated\b/i,
  /\boil price cap\b/i,
  /\bmaritime restriction(?:s)?\b/i,
  /\bdark fleet\b/i,
  /\bshadow fleet\b/i,
  /\bswift disconnect\b/i,
  /\bdual[- ]use\b/i,
  /\barms embargo\b/i
];

// ---------------------------------------------------------------------------
// PDF Parsing Helpers (Zero native dependencies)
// ---------------------------------------------------------------------------

function extractTextFromBuffer(buffer) {
  if (!buffer || buffer.length === 0) return '';
  const str = buffer.toString('binary');
  const textChunks = [];

  // 1. Literal strings in PDF objects: (Text string)
  const literalRegex = /\(([^()]{3,})\)/g;
  let match;
  while ((match = literalRegex.exec(str)) !== null) {
    if (match[1]) {
      const cleaned = match[1]
        .replace(/\\([nrtbf()\\\/])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\', '/': '/' }[c] || c))
        .replace(/\\[0-7]{1,3}/g, oct => String.fromCharCode(parseInt(oct.slice(1), 8)))
        .trim();
      if (cleaned.length > 2 && /[\x20-\x7E]/.test(cleaned)) {
        textChunks.push(cleaned);
      }
    }
  }

  // 2. Uncompressed stream text
  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  while ((match = streamRegex.exec(str)) !== null) {
    const raw = match[1];
    // Look for text operators like (Hello) Tj or [(H) 10 (ello)] TJ
    const tjRegex = /\(([^()]+)\)\s*(?:Tj|'|")/g;
    let tjMatch;
    while ((tjMatch = tjRegex.exec(raw)) !== null) {
      if (tjMatch[1]) textChunks.push(tjMatch[1].trim());
    }
  }

  // 3. Fallback: if very little text found and buffer starts with readable ASCII/UTF-8
  if (textChunks.length === 0) {
    const utf8 = buffer.toString('utf8');
    // If it looks like plain text or markdown mock
    if (utf8.includes('sanction') || utf8.includes('policy') || utf8.includes('notice') || utf8.includes('Regulation')) {
      return utf8.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ').replace(/\s+/g, ' ').trim();
    }
  }

  return textChunks.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Resolves PDF input from buffer, base64, file path, or database source/policy reference.
 */
function resolvePdfText(input) {
  if (!input) return { text: '', filename: 'unknown.pdf', size: 0, source: 'empty' };

  let buffer = null;
  let filename = input.filename || 'report.pdf';
  let sourceRef = 'direct';

  // 1. Direct text supplied
  if (typeof input.text === 'string' && input.text.trim().length > 0) {
    return { text: input.text.trim(), filename, size: input.text.length, source: 'text_input' };
  }

  // 2. Base64 data string
  const rawBase64 = input.content || input.base64 || input.file_data || input.document || input.data || input.file;
  if (typeof rawBase64 === 'string') {
    const cleanB64 = rawBase64.includes(',') ? rawBase64.split(',')[1] : rawBase64;
    try {
      buffer = Buffer.from(cleanB64, 'base64');
      sourceRef = 'base64_payload';
    } catch (e) {}
  }

  // 3. Direct buffer
  if (Buffer.isBuffer(input.buffer)) {
    buffer = input.buffer;
    sourceRef = 'buffer';
  }

  // 4. File path on disk
  if (!buffer && input.filePath && fs.existsSync(input.filePath)) {
    try {
      buffer = fs.readFileSync(input.filePath);
      filename = path.basename(input.filePath);
      sourceRef = `file://${input.filePath}`;
    } catch (e) {}
  }

  // 5. Look up in SQLite by uploadedFileId
  const db = getDb();
  if (!buffer && input.uploadedFileId) {
    const upFile = db.getUploadedFileById(input.uploadedFileId);
    if (upFile) {
      filename = upFile.filename || filename;
      sourceRef = `uploaded_file:${upFile.id}`;
      if (upFile.storage_path && fs.existsSync(upFile.storage_path)) {
        buffer = fs.readFileSync(upFile.storage_path);
      } else if (upFile.content_data) {
        const c = upFile.content_data;
        const b64 = c.includes(',') ? c.split(',')[1] : c;
        buffer = Buffer.from(b64, 'base64');
      }
    }
  }

  // 6. Look up in SQLite by sourceId
  if (!buffer && input.sourceId) {
    const src = db.getSourceById ? db.getSourceById(input.sourceId) : (db.getSources().find(s => s.id === input.sourceId));
    if (src) {
      sourceRef = `source:${src.id}`;
      filename = (src.config && src.config.filename) || `${src.label}.pdf`;
      if (src.config && src.config.content) {
        const c = src.config.content;
        const b64 = c.includes(',') ? c.split(',')[1] : c;
        buffer = Buffer.from(b64, 'base64');
      }
    }
    // Also check uploaded_files matching this source label or entity
    if (!buffer) {
      const up = db.getUploadedFiles().find(u => u.filename && (u.filename.includes(input.sourceId) || (src && u.filename.includes(src.label))));
      if (up && up.storage_path && fs.existsSync(up.storage_path)) {
        buffer = fs.readFileSync(up.storage_path);
      }
    }
  }

  // 7. Look up in SQLite by policyId
  if (!buffer && input.policyId) {
    const pol = db.getPolicyById ? db.getPolicyById(input.policyId) : (db.getPolicies().find(p => p.id === input.policyId));
    if (pol) {
      sourceRef = `policy:${pol.id}`;
      filename = `policy_${pol.id}.pdf`;
      // Check uploaded files for custom policy
      const up = db.getUploadedFiles().find(u => u.file_type === 'custom_policy');
      if (up && up.storage_path && fs.existsSync(up.storage_path)) {
        buffer = fs.readFileSync(up.storage_path);
      }
    }
  }

  if (!buffer) {
    return { text: '', filename, size: 0, source: sourceRef, error: 'Could not load PDF document from specified source' };
  }

  const extracted = extractTextFromBuffer(buffer);
  return {
    text: extracted,
    filename,
    size: buffer.length,
    source: sourceRef
  };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const extractPdfDocument = new Tool({
  name: 'extract_pdf_document',
  description: 'Ingests and extracts text, structure and metadata from a PDF compliance report',
  parameters: { input: 'PDF source: buffer, base64, filePath, sourceId, or policyId' },
  run: (input) => {
    const doc = resolvePdfText(input);
    if (!doc.text) {
      return {
        success: false,
        filename: doc.filename,
        error: doc.error || 'No readable text could be extracted from PDF document',
        textLength: 0,
        summary: `Failed to extract text from ${doc.filename}`
      };
    }
    return {
      success: true,
      filename: doc.filename,
      size: doc.size,
      source: doc.source,
      textLength: doc.text.length,
      sample: doc.text.slice(0, 300),
      summary: `Extracted ${doc.text.length} characters from ${doc.filename} (${doc.source})`
    };
  }
});

const detectSanctionedJurisdictions = new Tool({
  name: 'detect_sanctioned_jurisdictions',
  description: 'Scans document text to identify mentioned countries and infer active sanctions, regimes, and evidence excerpts',
  parameters: { text: 'Extracted document text', filename: 'string' },
  run: ({ text = '', filename = '' }) => {
    if (!text) return { countries: [], count: 0, summary: 'No text provided to scan' };

    const detected = [];
    const lowerText = text.toLowerCase();

    // Check each known jurisdiction
    for (const jur of JURISDICTION_ALIASES) {
      let bestMatch = null;
      let matchPos = -1;

      for (const alias of jur.aliases) {
        const regex = new RegExp(`\\b${alias}\\b`, 'i');
        const m = regex.exec(text);
        if (m) {
          bestMatch = alias;
          matchPos = m.index;
          break;
        }
      }

      if (!bestMatch || matchPos === -1) continue;

      // Extract window around match (250 characters before and after)
      const start = Math.max(0, matchPos - 250);
      const end = Math.min(text.length, matchPos + 250);
      const windowText = text.slice(start, end);

      // Check if sanctions trigger words exist in document or window
      const hasLocalTrigger = SANCTION_TRIGGERS.some(trig => trig.test(windowText));
      const hasDocTrigger = SANCTION_TRIGGERS.some(trig => trig.test(text));

      if (hasLocalTrigger || (hasDocTrigger && jur.iso3 !== 'GLB')) {
        // Detect regimes
        const regimes = [];
        for (const reg of SANCTION_REGIMES) {
          if (reg.patterns.some(p => p.test(windowText) || p.test(text))) {
            regimes.push(reg.id);
          }
        }
        if (regimes.length === 0) regimes.push('OFAC', 'EU'); // Standard baseline regimes

        // Classify sanction types
        const types = [];
        if (/embargo|comprehensive/i.test(windowText) || ['PRK', 'IRN', 'SYR', 'CUB'].includes(jur.iso3)) {
          types.push('Comprehensive Embargo');
        }
        if (/sectoral|energy|oil|petroleum|gas/i.test(windowText) || jur.iso3 === 'RUS' || jur.iso3 === 'VEN') {
          types.push('Sectoral: Energy & Petroleum');
        }
        if (/maritime|vessel|dark period|ais|tanker|flag/i.test(windowText)) {
          types.push('Maritime Transport & Shipping Controls');
        }
        if (/asset freeze|financial|bank|swift|funds/i.test(windowText)) {
          types.push('Financial Asset Freeze & Banking Prohibitions');
        }
        if (/arms|military|defense|dual-use/i.test(windowText)) {
          types.push('Arms Embargo & Dual-Use Export Restrictions');
        }
        if (types.length === 0) types.push('Trade & Financial Prohibitions');

        // Extract clean evidence excerpt
        const excerptRegex = new RegExp(`([^.!?\\n]*?\\b${bestMatch}\\b[^.!?\\n]*?[.!?\\n])`, 'i');
        const exMatch = excerptRegex.exec(windowText) || { 0: windowText.trim().slice(0, 220) };
        const cleanExcerpt = exMatch[0].replace(/\s+/g, ' ').trim();

        const isHighSeverity = types.includes('Comprehensive Embargo') || ['RUS', 'IRN', 'PRK', 'SYR'].includes(jur.iso3);
        const confidence = hasLocalTrigger ? (regimes.length > 1 ? 95 : 88) : 75;

        detected.push({
          country: jur.name,
          iso3: jur.iso3,
          status: 'Active',
          severity: isHighSeverity ? 'High' : 'Medium',
          confidence,
          regimes,
          sanction_types: types,
          matched_term: bestMatch,
          evidence_excerpt: cleanExcerpt.length > 10 ? cleanExcerpt : `Sanctions mention in connection with ${jur.name} (${filename}).`
        });
      }
    }

    return {
      countries: detected,
      count: detected.length,
      summary: detected.length > 0
        ? `Identified ${detected.length} sanctioned jurisdictions: ${detected.map(c => `${c.country} (${c.iso3})`).join(', ')}`
        : 'No specific sanctioned countries detected in document text.'
    };
  }
});

const correlateCpiRisk = new Tool({
  name: 'correlate_cpi_risk',
  description: 'Correlates country code with Transparency International CPI score and corruption risk classification',
  parameters: { iso3: 'ISO-3 country code' },
  run: ({ iso3 }) => {
    const db = getDb();
    const row = db.getCpiByCode(iso3);
    const score = row ? row.score : null;
    return {
      iso3,
      country_name: row ? row.name : iso3,
      cpi_score: score,
      tier: score !== null && score < 35 ? 'High Risk' : score !== null && score < 60 ? 'Medium Risk' : 'Low Risk',
      summary: `${iso3}: CPI ${score !== null ? `${score}/100` : 'Not Listed'}`
    };
  }
});

// ---------------------------------------------------------------------------
// Agent Definition
// ---------------------------------------------------------------------------

const sanctionsAgent = new Agent({
  name: AGENT_NAME,
  description: 'Ingests compliance reports and documents to identify and infer which countries and territories are currently subject to international sanctions, embargoes and trade restrictions.',
  instruction: INSTRUCTION,
  tools: [extractPdfDocument, detectSanctionedJurisdictions, correlateCpiRisk],

  plan: async (input, ctx) => {
    // 1. Ingest & extract text from PDF document
    const docData = resolvePdfText(input);
    await ctx.call('extract_pdf_document', input, `Ingest PDF document: ${docData.filename}`);

    if (!docData.text) {
      return {
        stage: 'sanctions_analysis',
        document: { filename: docData.filename, source: docData.source, text_length: 0 },
        sanctioned_countries: [],
        high_risk_jurisdictions_count: 0,
        primary_regimes: [],
        overall_risk_level: 'Low',
        recommendation: 'Unable to extract document content',
        summary: `Document ${docData.filename} contained no parseable text.`
      };
    }

    // 2. Identify sanctioned countries & evidence
    const scan = await ctx.call('detect_sanctioned_jurisdictions', { text: docData.text, filename: docData.filename }, 'Detect sanctioned jurisdictions & extract evidence');
    const countries = scan && scan.countries ? scan.countries : [];

    // 3. Correlate with CPI risk database
    for (const c of countries) {
      const cpi = await ctx.call('correlate_cpi_risk', { iso3: c.iso3 }, `CPI risk correlation for ${c.iso3}`);
      if (cpi) {
        c.cpi_score = cpi.cpi_score;
        c.cpi_tier = cpi.tier;
      }
    }

    // 4. Synthesize overall risk and actions
    const allRegimes = [...new Set(countries.flatMap(c => c.regimes || []))];
    const hasHighSeverity = countries.some(c => c.severity === 'High');
    const overallRisk = countries.length === 0 ? 'Low' : hasHighSeverity ? 'High' : 'Medium';

    const recommendation = countries.length === 0
      ? 'Clear: No sanctioned countries identified in document'
      : hasHighSeverity
        ? 'Mandatory Block / Escalation to Sanctions Committee: Comprehensive sanctions restrictions active'
        : 'Enhanced Due Diligence Required: Sectoral or conditional restrictions detected';

    const summary = countries.length > 0
      ? `Report indicates active sanctions exposure for ${countries.length} jurisdiction(s): ${countries.map(c => `${c.country} (${c.iso3} - ${c.severity})`).join(', ')}. Key regimes involved: ${allRegimes.join(', ') || 'OFAC/EU'}.`
      : `Document ${docData.filename} evaluated: no international sanctions or prohibited jurisdiction triggers detected.`;

    return {
      stage: 'sanctions_analysis',
      document: {
        filename: docData.filename,
        source: docData.source,
        text_length: docData.text.length,
        format: 'PDF document'
      },
      sanctioned_countries: countries,
      high_risk_jurisdictions_count: countries.filter(c => c.severity === 'High').length,
      primary_regimes: allRegimes,
      overall_risk_level: overallRisk,
      recommendation,
      summary
    };
  },

  synthesize: async (draft, ctx, input) => {
    // If Gemini model is active, refine the narrative and strategic counsel
    if (ctx.model && ctx.model.mode === 'gemini' && draft.sanctioned_countries.length > 0) {
      const prompt = `Analyze this sanctions extraction from compliance document "${draft.document.filename}":
Detected Sanctions: ${JSON.stringify(draft.sanctioned_countries)}
Total jurisdictions: ${draft.sanctioned_countries.length}

Generate a polished compliance briefing JSON with fields:
- "executive_summary": concise 2-sentence executive summary for compliance officers
- "enforcement_rationale": brief explanation of why these countries are restricted
- "actionable_guardrails": array of 2-3 specific control actions (e.g. proof of non-Russian origin, vessel AIS tracking)`;

      const geminiJson = await ctx.llm(prompt);
      if (geminiJson && typeof geminiJson === 'object') {
        if (geminiJson.executive_summary) draft.summary = geminiJson.executive_summary;
        if (geminiJson.actionable_guardrails) draft.actionable_guardrails = geminiJson.actionable_guardrails;
        if (geminiJson.enforcement_rationale) draft.enforcement_rationale = geminiJson.enforcement_rationale;
      }
    }
    return draft;
  }
});

// ---------------------------------------------------------------------------
// Entry Points
// ---------------------------------------------------------------------------

async function analyzePdf(input, { useModel = true } = {}) {
  return Runner.run(sanctionsAgent, input, { useModel });
}

function describe() {
  const { resolveModel } = require('./framework');
  const model = resolveModel();
  return {
    name: AGENT_NAME,
    description: sanctionsAgent.description,
    mode: model.mode,
    supported_formats: ['PDF document', 'application/pdf'],
    source_types: ['policies', 'sources', 'uploads', 'buffer', 'base64'],
    capabilities: [
      'Ingest PDF compliance reports from custom policies and external data sources',
      'Identify sanctioned jurisdictions, regimes (OFAC, EU, UN, UK, MAS) and restriction types',
      'Extract verbatim textual citations and evidence excerpts from PDF documents',
      'Correlate detected jurisdictions with Transparency International CPI governance scores'
    ],
    tools: sanctionsAgent.describe().tools
  };
}

module.exports = {
  AGENT_NAME,
  sanctionsAgent,
  analyzePdf,
  describe,
  resolvePdfText,
  extractTextFromBuffer
};
