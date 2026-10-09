/**
 * Turns an uploaded questionnaire template file into markdown for the template parser.
 *
 * Markdown / plain text is read directly. PDF, Word and scanned templates are meant to go
 * through Google Document AI (layout parser), which is not wired up yet: this module is the
 * placeholder for it. Until then those formats are rejected with a clear message.
 */
const path = require('path');
const config = require('../config');

const TEXT_EXTENSIONS = ['.md', '.markdown', '.txt'];
const DOCUMENT_AI_EXTENSIONS = ['.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg', '.tiff'];

class ParserUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.code = 'PARSER_UNAVAILABLE';
  }
}

function documentAiConfigured() {
  const d = config.documentAi || {};
  return Boolean(d.projectId && d.location && d.processorId);
}

// PLACEHOLDER: Google Document AI.
// Intended implementation (@google-cloud/documentai):
//   const client = new DocumentProcessorServiceClient({ apiEndpoint: `${location}-documentai.googleapis.com` });
//   const name = `projects/${projectId}/locations/${location}/processors/${processorId}`;
//   const [result] = await client.processDocument({ name, rawDocument: { content: base64Data, mimeType } });
//   then convert result.document (headings, tables) into the "## 1. Section" + "| No. | Question | Response |"
//   markdown shape that parseTemplateMarkdown() understands.
async function parseWithDocumentAi({ filename }) {
  throw new ParserUnavailableError(
    `Google Document AI is configured but the integration is not implemented yet, so ${filename} cannot be parsed. Upload the template as a .md file for now.`
  );
}

/**
 * @returns {Promise<{ markdown: string, parser: 'markdown' | 'document-ai' }>}
 */
async function extractTemplateMarkdown({ filename = '', mimeType = '', markdown = '', base64Data = '' }) {
  const ext = path.extname(String(filename)).toLowerCase();

  if (markdown && (!ext || TEXT_EXTENSIONS.includes(ext))) {
    return { markdown: String(markdown), parser: 'markdown' };
  }
  if (TEXT_EXTENSIONS.includes(ext) && base64Data) {
    return { markdown: Buffer.from(base64Data, 'base64').toString('utf8'), parser: 'markdown' };
  }
  if (DOCUMENT_AI_EXTENSIONS.includes(ext) || /pdf|word|officedocument|image\//i.test(mimeType)) {
    if (documentAiConfigured()) {
      const markdownFromAi = await parseWithDocumentAi({ filename, mimeType, base64Data });
      return { markdown: markdownFromAi, parser: 'document-ai' };
    }
    throw new ParserUnavailableError(
      `${ext ? ext.slice(1).toUpperCase() : 'This file type'} templates will be parsed with Google Document AI, which is not connected yet. Upload the template as a .md file for now.`
    );
  }
  if (markdown) return { markdown: String(markdown), parser: 'markdown' };
  throw new ParserUnavailableError('Unsupported template file. Upload a .md file.');
}

module.exports = { extractTemplateMarkdown, documentAiConfigured, ParserUnavailableError, TEXT_EXTENSIONS, DOCUMENT_AI_EXTENSIONS };
