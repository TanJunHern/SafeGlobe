const path = require('path');
const { AsyncLocalStorage } = require('node:async_hooks');
const config = require('../config');
const SqliteDatabase = require('./sqlite');

// Database abstraction layer
// Each workspace has its own database file. The Demo workspace is the original file (DATABASE_PATH); it is also
// what code outside a request gets (startup, scripts, tests). The auth middleware sets the workspace per request.
const DEMO_WORKSPACE_ID = 'demo';
const context = new AsyncLocalStorage();
let instance = null;
const workspaceInstances = new Map();

function demoDb() {
  if (!instance) {
    if (config.dbType === 'sqlite') {
      instance = new SqliteDatabase(config.dbPath);
    } else {
      // Future GCP Firestore or Cloud SQL adapter
      console.warn(`Database type "${config.dbType}" not yet configured, falling back to SQLite`);
      instance = new SqliteDatabase(config.dbPath);
    }
  }
  return instance;
}

/** The workspace of the request being handled, or null outside a request and in the Demo workspace. */
function currentWorkspaceId() {
  const store = context.getStore();
  return store && store.workspaceId && store.workspaceId !== DEMO_WORKSPACE_ID ? store.workspaceId : null;
}

/** Folder for one created workspace's files (its uploads). */
function workspaceFolder(workspaceId) {
  return path.join(require('../accounts/accountsStore').workspacesDir(), workspaceId);
}

function workspaceDb(workspaceId) {
  if (!/^ws_[0-9a-f]+$/.test(workspaceId)) throw new Error('Unknown workspace');
  let db = workspaceInstances.get(workspaceId);
  if (!db) {
    // A created workspace starts empty: reference data only, nothing from the demo
    db = new SqliteDatabase(`${workspaceFolder(workspaceId)}.db`, { empty: true });
    try { require('../services/vesselFinderService').ensureSource(db); } catch (err) { console.error('[DueDilly] Vessel source skipped:', err.message); }
    workspaceInstances.set(workspaceId, db);
  }
  return db;
}

function getDb() {
  const workspaceId = currentWorkspaceId();
  return workspaceId ? workspaceDb(workspaceId) : demoDb();
}

/** Runs fn with getDb() pointing at that workspace's database. */
function runInWorkspace(workspaceId, fn) {
  return context.run({ workspaceId: workspaceId || DEMO_WORKSPACE_ID }, fn);
}

function closeAll() {
  if (instance && typeof instance.close === 'function') instance.close();
  for (const db of workspaceInstances.values()) db.close();
  workspaceInstances.clear();
  require('../accounts/accountsStore').closeAccountsStore();
}

module.exports = {
  getDb,
  runInWorkspace,
  currentWorkspaceId,
  workspaceFolder,
  closeAll
};
