/**
 * Storage for supporting documents uploaded by counterparties through the DDQ portal.
 *
 * Files are kept on local disk for now. The interface (save / read by key) is deliberately
 * small so a Firebase / Google Cloud Storage driver can replace the local one later without
 * touching the routes: set DOCUMENT_STORAGE=firebase and implement firebaseDriver below.
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

const MAX_BYTES = 7 * 1024 * 1024; // JSON body limit is 10 MB and base64 adds ~33%
const ALLOWED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt'];

const localRoot = () => path.join(path.dirname(config.dbPath), 'uploads');

const localDriver = {
  name: 'local',
  async save(key, buffer) {
    const target = path.join(localRoot(), key);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buffer);
  },
  async read(key) {
    const target = path.join(localRoot(), key);
    return fs.existsSync(target) ? fs.readFileSync(target) : null;
  }
};

// PLACEHOLDER: Firebase Storage / Google Cloud Storage driver.
// Implement with firebase-admin: bucket.file(key).save(buffer) and bucket.file(key).download().
const firebaseDriver = {
  name: 'firebase',
  async save() { throw new Error('Firebase document storage is not implemented yet'); },
  async read() { throw new Error('Firebase document storage is not implemented yet'); }
};

function driver() {
  return config.documentStorage === 'firebase' ? firebaseDriver : localDriver;
}

function safeName(filename = '') {
  const base = path.basename(String(filename)).replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(-120);
  return base || 'document';
}

/**
 * Stores one supporting document for a DDQ. Returns the metadata saved with the answers.
 */
async function saveDdqDocument({ kycId, index, filename, mimeType = '', base64Data = '' }) {
  const name = safeName(filename);
  const ext = path.extname(name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new Error(`File type ${ext || '(none)'} is not accepted. Use PDF, image, Word, Excel, CSV or text files.`);
  }
  const buffer = Buffer.from(String(base64Data), 'base64');
  if (!buffer.length) throw new Error('The uploaded file is empty');
  if (buffer.length > MAX_BYTES) throw new Error('File is larger than the 7 MB limit');

  const slot = Number.isInteger(Number(index)) ? Number(index) : 0;
  const key = `ddq/${kycId}/${slot}-${name}`;
  await driver().save(key, buffer);
  return { key, filename: name, size: buffer.length, mime_type: mimeType, storage: driver().name, uploaded_at: new Date().toISOString() };
}

/**
 * Reads a stored document. The key must belong to the given KYC request.
 */
async function readDdqDocument({ kycId, key }) {
  const expectedPrefix = `ddq/${kycId}/`;
  if (typeof key !== 'string' || !key.startsWith(expectedPrefix) || key.includes('..')) return null;
  return driver().read(key);
}

module.exports = { saveDdqDocument, readDdqDocument, MAX_BYTES, ALLOWED_EXTENSIONS };
