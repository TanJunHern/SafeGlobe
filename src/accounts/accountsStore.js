/**
 * Accounts store: workspaces, the people in them, and the log of every account change.
 * It is a separate SQLite file from the workspace data, because sign-in has to find the account before it knows
 * which workspace database to open (src/db/index.js).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

const DEMO_WORKSPACE_ID = 'demo';
// The demo personas. Their ids are the user ids the app has always used for them.
const DEMO_ACCOUNTS = [
  { key: 'compliance', id: 'COMP-901', email: 'compliance@duedilly.com', name: 'Grace Teo', role: 'compliance_officer', department: 'Compliance & Risk Governance' },
  { key: 'employee', id: 'EMP-1042', email: 'john.doe@duedilly.com', name: 'John Doe', role: 'employee', department: 'Procurement & Logistics' }
];

const basePath = () => config.dbPath.replace(/\.db$/, '');
const accountsPath = () => `${basePath()}.accounts.db`;
/** Folder holding one database file (and one uploads folder) per created workspace. */
const workspacesDir = () => `${basePath()}.workspaces`;

const newId = prefix => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
const normEmail = email => String(email || '').toLowerCase().trim();
const now = () => new Date().toISOString();

class AccountsStore {
  constructor(file = accountsPath()) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    try { this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 10000;'); } catch (e) {}
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        is_demo INTEGER DEFAULT 0,
        created_by TEXT,
        created_at TEXT
      );
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        name TEXT,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        is_demo INTEGER DEFAULT 0,
        department TEXT,
        invited_by TEXT,
        invited_at TEXT,
        last_sign_in_at TEXT,
        created_at TEXT
      );
      CREATE TABLE IF NOT EXISTS account_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL,
        actor_name TEXT,
        actor_email TEXT,
        action TEXT NOT NULL,
        target_name TEXT,
        target_email TEXT,
        detail TEXT,
        at TEXT
      );
    `);
    this.resetDemoWorkspace();
  }

  /** The Demo workspace starts the same at every start: its two demo accounts, no invitations, an empty log. */
  resetDemoWorkspace() {
    this.db.prepare('DELETE FROM accounts WHERE workspace_id = ?').run(DEMO_WORKSPACE_ID);
    this.db.prepare('DELETE FROM account_audit WHERE workspace_id = ?').run(DEMO_WORKSPACE_ID);
    this.db.prepare('INSERT INTO workspaces (id, name, is_demo, created_by, created_at) VALUES (?, ?, 1, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, is_demo = 1')
      .run(DEMO_WORKSPACE_ID, config.workspaceName, 'DueDilly', now());
    for (const a of DEMO_ACCOUNTS) {
      // A demo email can never belong to another workspace
      this.db.prepare('DELETE FROM accounts WHERE email = ?').run(a.email);
      this.insertAccount({ id: a.id, workspace_id: DEMO_WORKSPACE_ID, email: a.email, name: a.name, role: a.role, status: 'active', is_demo: 1, department: a.department });
    }
  }

  insertWorkspace({ name, created_by }) {
    const id = newId('ws');
    this.db.prepare('INSERT INTO workspaces (id, name, is_demo, created_by, created_at) VALUES (?, ?, 0, ?, ?)').run(id, name, created_by || '', now());
    return this.getWorkspace(id);
  }

  getWorkspace(id) {
    const row = this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id);
    return row ? { id: row.id, name: row.name, isDemo: Boolean(row.is_demo), createdBy: row.created_by, createdAt: row.created_at } : null;
  }

  insertAccount(a) {
    const id = a.id || newId('acc');
    this.db.prepare(`INSERT INTO accounts (id, workspace_id, email, name, role, status, is_demo, department, invited_by, invited_at, last_sign_in_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, a.workspace_id, normEmail(a.email), a.name || '', a.role, a.status, a.is_demo ? 1 : 0, a.department || '', a.invited_by || '', a.invited_at || '', a.last_sign_in_at || '', now());
    return this.getAccountById(id);
  }

  getAccountById(id) { return this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(String(id || '')) || null; }
  getAccountByEmail(email) { return this.db.prepare('SELECT * FROM accounts WHERE email = ?').get(normEmail(email)) || null; }
  listAccounts(workspaceId) { return this.db.prepare('SELECT * FROM accounts WHERE workspace_id = ? ORDER BY created_at, name').all(workspaceId); }

  updateAccount(id, patch) {
    const keys = Object.keys(patch);
    if (!keys.length) return this.getAccountById(id);
    this.db.prepare(`UPDATE accounts SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map(k => patch[k]), id);
    return this.getAccountById(id);
  }

  deleteAccount(id) { return this.db.prepare('DELETE FROM accounts WHERE id = ?').run(id).changes > 0; }

  countActiveOfficers(workspaceId) {
    return this.db.prepare(`SELECT COUNT(*) AS n FROM accounts WHERE workspace_id = ? AND role = 'compliance_officer' AND status = 'active'`).get(workspaceId).n;
  }

  addAudit({ workspace_id, actor, action, target, detail = '' }) {
    this.db.prepare('INSERT INTO account_audit (workspace_id, actor_name, actor_email, action, target_name, target_email, detail, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(workspace_id, (actor && actor.name) || '', (actor && actor.email) || '', action, (target && target.name) || '', (target && target.email) || '', detail, now());
  }

  listAudit(workspaceId, limit = 200) {
    return this.db.prepare('SELECT * FROM account_audit WHERE workspace_id = ? ORDER BY id DESC LIMIT ?').all(workspaceId, limit);
  }

  close() { try { this.db.close(); } catch (e) {} }
}

let instance = null;
function getAccountsStore() {
  if (!instance) instance = new AccountsStore();
  return instance;
}
function closeAccountsStore() {
  if (instance) { instance.close(); instance = null; }
}

module.exports = { getAccountsStore, closeAccountsStore, workspacesDir, normEmail, DEMO_WORKSPACE_ID, DEMO_ACCOUNTS };
