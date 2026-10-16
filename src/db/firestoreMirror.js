const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const config = require('../config');

// Firestore as the permanent copy of every SQLite database (DATABASE_TYPE=firestore).
// SQLite stays the working copy inside the container, so no caller changes. Cloud Run's disk is wiped on every
// restart and deploy, so:
//   - a few seconds after a write, the changed rows are copied to Firestore (deleted rows are removed there too);
//   - a fresh container with no database file rebuilds it from Firestore before the app opens it.
// Layout: {root}/{dbKey} holds the table schemas; {root}/{dbKey}/tables/{table}/rows/{rowid} holds one row as `row`.
// dbKey is "demo", "accounts" or a created workspace id (ws_...). The root keeps this computer and Cloud Run apart,
// so a laptop run never overwrites the live data: duedilly_local_uat here, duedilly_cloud_uat on Cloud Run.

const SYNC_MS = 3000;
const MAX_ROW_BYTES = 900 * 1024; // Firestore's limit is 1 MiB per document
const PART_CHARS = 300 * 1024; // a UTF-16 code unit is at most 3 bytes in UTF-8, so a part stays under 1 MiB

const enabled = () => config.dbType === 'firestore';
const rootName = () => process.env.FIRESTORE_COLLECTION
  || `duedilly_${process.env.K_SERVICE ? 'cloud' : 'local'}_${config.appEnv || 'default'}`;

let client = null;
function firestore() {
  if (!client) {
    const { Firestore } = require('@google-cloud/firestore');
    client = new Firestore({
      projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID || undefined,
      databaseId: process.env.FIRESTORE_DATABASE_ID || '(default)',
      ignoreUndefinedProperties: true
    });
  }
  return client;
}

/** The local file a mirrored database lives in, or null for a key this app does not know. */
function fileFor(key) {
  const accounts = require('../accounts/accountsStore');
  if (key === 'demo') return config.dbPath;
  if (key === 'accounts') return accounts.accountsPath();
  if (/^ws_[0-9a-f]+$/.test(key)) return `${path.join(accounts.workspacesDir(), key)}.db`;
  return null;
}

// ---- copying changes to Firestore ----

const tracked = new Map(); // dbKey -> { db, changes, known: Map(table -> Map(rowid -> hash)) | null, schema }
let timer = null;
let running = null;
let disabled = false;

/** Copy this open database to Firestore from now on. */
function track(key, db) {
  if (!enabled() || disabled) return;
  tracked.set(key, { db, changes: -1, known: null, schema: null });
  if (!timer) {
    timer = setInterval(() => { if (!running) runSync(); }, SYNC_MS);
    timer.unref();
  }
}

function runSync() {
  running = syncOnce()
    .catch(err => console.error('[DueDilly] Firestore copy failed, retrying in a few seconds:', err.message))
    .finally(() => { running = null; });
  return running;
}

async function syncOnce() {
  for (const [key, t] of tracked) {
    let changes;
    try { changes = t.db.prepare('SELECT total_changes() AS c').get().c; } catch (e) { tracked.delete(key); continue; } // closed
    if (changes === t.changes) continue;
    await syncDb(key, t);
    t.changes = changes;
  }
}

const toJson = row => JSON.stringify(row, (k, v) => {
  if (v instanceof Uint8Array) return { $b64: Buffer.from(v).toString('base64') };
  return typeof v === 'bigint' ? Number(v) : v;
});
const toFields = row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k,
  v instanceof Uint8Array ? Buffer.from(v) : typeof v === 'bigint' ? Number(v) : v]));

function readTables(db) {
  return db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()
    .map(({ name, sql }) => {
      try { return { name, sql, rows: db.prepare(`SELECT rowid AS __rowid, * FROM "${name}"`).all() }; }
      catch (e) { return null; } // a WITHOUT ROWID table: none exist today
    })
    .filter(Boolean);
}

async function loadKnown(dbRef) {
  const known = new Map();
  for (const tableRef of await dbRef.collection('tables').listDocuments()) {
    const snap = await tableRef.collection('rows').select('h').get();
    known.set(tableRef.id, new Map(snap.docs.map(d => [d.id, d.get('h')])));
  }
  return known;
}

async function syncDb(key, t) {
  const fsdb = firestore();
  const dbRef = fsdb.collection(rootName()).doc(key);
  if (!t.known) t.known = await loadKnown(dbRef);
  const tables = readTables(t.db); // synchronous: one consistent snapshot

  const writer = fsdb.bulkWriter();
  let failed = 0;
  const write = p => p.catch(() => { failed++; });
  const next = new Map();
  for (const { name, rows } of tables) {
    const before = t.known.get(name) || new Map();
    const after = new Map();
    const rowsRef = dbRef.collection('tables').doc(name).collection('rows');
    for (const row of rows) {
      const id = String(row.__rowid);
      delete row.__rowid;
      const json = toJson(row);
      const h = crypto.createHash('sha1').update(json).digest('base64');
      after.set(id, h);
      if (before.get(id) === h) continue;
      const rowRef = rowsRef.doc(id);
      if (Buffer.byteLength(json) <= MAX_ROW_BYTES) {
        write(writer.set(rowRef, { h, row: toFields(row) }));
      } else {
        let parts = 0;
        for (let i = 0; i < json.length; parts++) {
          let end = Math.min(i + PART_CHARS, json.length);
          if (end < json.length && /[\ud800-\udbff]/.test(json[end - 1])) end--; // never split a surrogate pair
          write(writer.set(rowRef.collection('parts').doc(String(parts)), { s: json.slice(i, end) }));
          i = end;
        }
        write(writer.set(rowRef, { h, parts }));
      }
    }
    for (const id of before.keys()) if (!after.has(id)) write(writer.delete(rowsRef.doc(id)));
    next.set(name, after);
  }
  for (const [name, before] of t.known) {
    if (next.has(name)) continue; // a dropped table: remove its rows
    const rowsRef = dbRef.collection('tables').doc(name).collection('rows');
    for (const id of before.keys()) write(writer.delete(rowsRef.doc(id)));
  }
  const schema = Object.fromEntries(tables.map(({ name, sql }) => [name, sql]));
  const schemaJson = JSON.stringify(schema);
  if (schemaJson !== t.schema) write(writer.set(dbRef, { tables: schema, updatedAt: new Date().toISOString() }));

  await writer.close();
  if (failed) {
    t.known = null; // read Firestore again before the retry
    throw new Error(`${failed} write(s) for "${key}" did not go through`);
  }
  t.known = next;
  t.schema = schemaJson;
}

/** Copy anything still waiting. Called on shutdown (Cloud Run gives 10 seconds after SIGTERM). */
async function flush() {
  if (!timer) return;
  if (running) await running;
  await runSync();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  tracked.clear();
}

// ---- rebuilding missing files from Firestore ----

let prepared = false;

/**
 * Before the first database opens: rebuild every mirrored file that is missing here. Runs in a child process,
 * because the databases open synchronously and Firestore is asynchronous only.
 */
function prepare() {
  if (prepared || !enabled()) return;
  prepared = true;
  try {
    execFileSync(process.execPath, [__filename, 'restore'], { stdio: 'inherit', env: process.env, timeout: 120000 });
  } catch (err) {
    // Copying now would overwrite the saved data with a fresh database, so this run does not copy at all
    disabled = true;
    console.error(`[DueDilly] Firestore restore failed (${err.message}). This run will NOT copy to Firestore, so the saved data stays safe. Fix the error above and restart.`);
  }
}

const fromJson = json => JSON.parse(json, (k, v) => (v && typeof v === 'object' && typeof v.$b64 === 'string' ? Buffer.from(v.$b64, 'base64') : v));
const toParam = v => (typeof v === 'number' && Number.isSafeInteger(v) ? BigInt(v) : v); // keeps integers INTEGER

async function rowOf(doc) {
  const parts = doc.get('parts');
  if (!parts) return doc.get('row') || {};
  const snap = await doc.ref.collection('parts').get();
  const byIndex = new Map(snap.docs.map(d => [Number(d.id), d.get('s')]));
  let json = '';
  for (let i = 0; i < parts; i++) json += byIndex.get(i);
  return fromJson(json);
}

async function restoreDb(dbDoc, file) {
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.restoring`;
  fs.rmSync(tmp, { force: true });
  const db = new DatabaseSync(tmp);
  let count = 0;
  try {
    for (const [name, sql] of Object.entries(dbDoc.get('tables') || {})) {
      db.exec(sql);
      const cols = db.prepare(`PRAGMA table_info("${name}")`).all();
      const colNames = new Set(cols.map(c => c.name));
      const pk = cols.filter(c => c.pk > 0);
      // An INTEGER PRIMARY KEY is the rowid itself; any other table gets its rowid back explicitly
      const aliased = pk.length === 1 && String(pk[0].type).toUpperCase() === 'INTEGER';
      const snap = await dbDoc.ref.collection('tables').doc(name).collection('rows').get();
      db.exec('BEGIN');
      for (const doc of snap.docs) {
        const row = await rowOf(doc);
        const names = Object.keys(row).filter(c => colNames.has(c));
        const columns = [...(aliased ? [] : ['rowid']), ...names];
        const values = [...(aliased ? [] : [BigInt(doc.id)]), ...names.map(c => toParam(row[c]))];
        db.prepare(`INSERT INTO "${name}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
          .run(...values);
        count++;
      }
      db.exec('COMMIT');
    }
  } finally {
    db.close();
  }
  fs.renameSync(tmp, file); // only a complete file ever appears under the real name
  console.log(`[DueDilly] Restored ${path.basename(file)} from Firestore (${count} rows)`);
}

async function restoreMissing() {
  const snap = await firestore().collection(rootName()).get();
  for (const dbDoc of snap.docs) {
    const file = fileFor(dbDoc.id);
    if (file && !fs.existsSync(file)) await restoreDb(dbDoc, file);
  }
}

if (require.main === module && process.argv[2] === 'restore') {
  restoreMissing().then(() => process.exit(0), err => { console.error('[DueDilly] Firestore restore:', err.message); process.exit(1); });
}

module.exports = { enabled, rootName, prepare, track, flush, stop };
