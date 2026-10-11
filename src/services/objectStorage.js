/**
 * Storage for files the app itself keeps: page snapshots taken by the crawler agents.
 *
 * DOCUMENT_STORAGE=gcs with GCS_BUCKET set: Cloud Storage, over its JSON API with the service account's token.
 * Anything else, or a failed call: a local folder next to the database (lost when a Cloud Run instance restarts).
 * Keys always start with the workspace, so one workspace never reads another's files.
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

// Beside the database and named after it (data/safe_globe.objects), like the accounts and workspace files
const localRoot = () => path.join(path.dirname(config.dbPath), `${path.basename(config.dbPath, path.extname(config.dbPath))}.objects`);
const safeKey = key => String(key).split('/').map(part => part.replace(/[^A-Za-z0-9._-]/g, '_')).filter(part => part && part !== '.' && part !== '..').join('/');
const live = () => config.documentStorage === 'gcs' && Boolean(config.gcsBucket);

let authClient = null;
async function accessToken() {
  if (!authClient) {
    const { GoogleAuth } = require('google-auth-library');
    authClient = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/devstorage.read_write'] }).getClient();
  }
  const token = await authClient.getAccessToken();
  return token.token || token;
}

const local = {
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

const gcs = {
  // POST /upload/storage/v1/b/{bucket}/o?uploadType=media&name={object}
  async save(key, buffer, contentType) {
    const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(config.gcsBucket)}/o?uploadType=media&name=${encodeURIComponent(key)}`;
    const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': contentType || 'application/octet-stream' }, body: buffer, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Cloud Storage answered ${res.status}`);
  },
  // GET /storage/v1/b/{bucket}/o/{object}?alt=media
  async read(key) {
    const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(config.gcsBucket)}/o/${encodeURIComponent(key)}?alt=media`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${await accessToken()}` }, signal: AbortSignal.timeout(15000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Cloud Storage answered ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
};

let lastError = null;

/** Saves a file and says where it went: { key, where: 'gcs' | 'local' }. */
async function saveObject(key, buffer, contentType = 'application/octet-stream') {
  const clean = safeKey(key);
  if (live()) {
    try {
      await gcs.save(clean, buffer, contentType);
      lastError = null;
      return { key: clean, where: 'gcs' };
    } catch (err) {
      lastError = err.message;
      console.error('[Storage] Cloud Storage save failed, keeping the file locally:', err.message);
    }
  }
  await local.save(clean, buffer);
  return { key: clean, where: 'local' };
}

async function readObject(key, where = null) {
  const clean = safeKey(key);
  if (where !== 'local' && live()) {
    try {
      const found = await gcs.read(clean);
      if (found) return found;
    } catch (err) {
      lastError = err.message;
    }
  }
  return local.read(clean);
}

const status = () => ({ mode: live() ? 'gcs' : 'local', bucket: live() ? config.gcsBucket : null, lastError });

module.exports = { saveObject, readObject, status, safeKey };
