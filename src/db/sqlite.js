const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');
const seed = require('./seed-data');

class SqliteDatabase {
  constructor(dbPath = config.dbPath) {
    this.dbPath = dbPath;
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new DatabaseSync(this.dbPath);
    try {
      this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 10000;');
    } catch (e) {}
    this.initSchema();
    this.seedIfEmpty();
  }

  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        short_name TEXT,
        role TEXT,
        jurisdiction TEXT,
        city TEXT,
        reg_no TEXT,
        risk INTEGER DEFAULT 50,
        confidence INTEGER DEFAULT 80,
        owner TEXT,
        trigger_event TEXT,
        since TEXT,
        claimed INTEGER DEFAULT 0,
        summary TEXT,
        metadata_json TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS ownership_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        label TEXT NOT NULL,
        provenance TEXT NOT NULL,
        confidence TEXT
      );

      CREATE TABLE IF NOT EXISTS statements (
        org_id TEXT PRIMARY KEY,
        date_str TEXT NOT NULL,
        statement_text TEXT NOT NULL,
        remediation TEXT,
        claims_json TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (org_id) REFERENCES entities(id)
      );

      CREATE TABLE IF NOT EXISTS claims (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id TEXT NOT NULL,
        email TEXT NOT NULL,
        signatory TEXT NOT NULL,
        role TEXT,
        status TEXT DEFAULT 'verified',
        claimed_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS cases (
        case_id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        owner TEXT NOT NULL,
        reviewer TEXT DEFAULT 'Grace Teo',
        status TEXT DEFAULT 'open',
        risk INTEGER NOT NULL,
        confidence INTEGER NOT NULL,
        quadrant TEXT NOT NULL,
        decision_text TEXT,
        decision_reasons TEXT,
        evidence_sources TEXT,
        decision_date TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (entity_id) REFERENCES entities(id)
      );

      CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        agent TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        text TEXT NOT NULL,
        quadrant TEXT NOT NULL,
        is_country INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        type TEXT NOT NULL,
        how TEXT NOT NULL,
        cover TEXT NOT NULL,
        trust TEXT NOT NULL,
        health TEXT NOT NULL,
        config_json TEXT
      );

      CREATE TABLE IF NOT EXISTS policies (
        id TEXT PRIMARY KEY,
        section TEXT NOT NULL,
        text TEXT NOT NULL,
        note TEXT,
        hits_json TEXT,
        is_met INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS cpi (
        a3 TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        score INTEGER NOT NULL,
        rank INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ddq_records (
        id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        questions_json TEXT NOT NULL,
        answers_json TEXT,
        status TEXT DEFAULT 'sent',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS uploaded_files (
        id TEXT PRIMARY KEY,
        entity_id TEXT,
        file_type TEXT NOT NULL,
        filename TEXT NOT NULL,
        file_size INTEGER DEFAULT 0,
        mime_type TEXT,
        content_data TEXT,
        parsed_records INTEGER DEFAULT 1,
        storage_path TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS source_records (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        source_label TEXT NOT NULL,
        source_type TEXT NOT NULL,
        entity_name TEXT NOT NULL,
        entity_kind TEXT DEFAULT 'org',
        jurisdiction TEXT,
        reg_no TEXT,
        risk_level TEXT DEFAULT 'Medium',
        risk_score INTEGER DEFAULT 50,
        summary TEXT,
        details_json TEXT,
        raw_content TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_sr_source ON source_records(source_id);
      CREATE INDEX IF NOT EXISTS idx_sr_name ON source_records(entity_name);
    `);
    this.seedSourceRecordsIfEmpty();
  }


  seedIfEmpty() {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM entities').get();
    if (row && row.count > 0) return; // already seeded

    // 1. Seed CPI
    const insertCpi = this.db.prepare('INSERT OR REPLACE INTO cpi (a3, name, score, rank) VALUES (?, ?, ?, ?)');
    for (const c of seed.CPI_2025) {
      insertCpi.run(c.a3, c.name, c.score, c.rank);
    }

    // 2. Seed Entities (Orgs, Vessels, People)
    const insertEntity = this.db.prepare(`
      INSERT OR REPLACE INTO entities 
      (id, kind, name, short_name, role, jurisdiction, city, reg_no, risk, confidence, owner, trigger_event, since, claimed, summary, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Orgs
    for (const o of seed.ORGS) {
      insertEntity.run(
        o.id,
        'org',
        o.name,
        o.short || o.name,
        o.role || '',
        o.a3 || '',
        o.city || '',
        o.reg || '',
        o.risk || 0,
        o.conf || 0,
        o.owner || 'Sofia Lim',
        o.trigger || '',
        o.since || '',
        o.claimed ? 1 : 0,
        o.summary || '',
        JSON.stringify({
          ll: o.ll,
          factors: o.factors || [],
          raise: o.raise || '',
          findings: o.findings || [],
          linked: !!o.linked,
          stateOwned: !!o.stateOwned,
          ddqPending: !!o.ddqPending
        })
      );
    }

    // Vessels
    for (const v of seed.VESSELS) {
      insertEntity.run(
        v.id,
        'vessel',
        v.name,
        v.name,
        v.type,
        v.flag,
        v.dest || '',
        v.imo || '',
        v.risk || 0,
        v.conf || 0,
        v.owner || 'Sofia Lim',
        v.trigger || '',
        '',
        0,
        `Vessel ${v.name} (${v.type}), IMO ${v.imo}, flag ${v.flag}`,
        JSON.stringify({
          mmsi: v.mmsi,
          built: v.built,
          dwt: v.dwt,
          flag: v.flag,
          dest: v.dest,
          chartered: !!v.chartered,
          names: v.names || [],
          flags: v.flags || [],
          links: v.links || [],
          signals: v.signals || [],
          factors: v.factors || [],
          raise: v.raise || ''
        })
      );
    }

    // People
    for (const p of seed.PEOPLE) {
      insertEntity.run(
        p.id,
        'person',
        p.name,
        p.name,
        p.role,
        '',
        '',
        '',
        p.risk || 0,
        p.conf || 0,
        p.owner || 'Hafiz Rahman',
        p.trigger || '',
        '',
        0,
        p.note || '',
        JSON.stringify({
          pep: !!p.pep,
          lists: p.lists || [],
          note: p.note || ''
        })
      );
    }

    // 3. Seed Ownership Edges
    const insertEdge = this.db.prepare('INSERT INTO ownership_edges (source_id, target_id, label, provenance, confidence) VALUES (?, ?, ?, ?, ?)');
    for (const [src, tgt, lab, prov, confVal] of seed.EDGES) {
      insertEdge.run(src, tgt, lab, prov, confVal || null);
    }

    // 4. Seed Statements
    const insertStmt = this.db.prepare('INSERT OR REPLACE INTO statements (org_id, date_str, statement_text, remediation, claims_json) VALUES (?, ?, ?, ?, ?)');
    for (const key of Object.keys(seed.STATEMENTS)) {
      const s = seed.STATEMENTS[key];
      insertStmt.run(key, s.date, s.text, s.remediation || '', JSON.stringify(s.claims || []));
    }

    // 5. Seed Alerts
    const insertAlert = this.db.prepare('INSERT INTO alerts (timestamp, agent, entity_id, text, quadrant, is_country) VALUES (?, ?, ?, ?, ?, ?)');
    for (const a of seed.ALERTS) {
      insertAlert.run(a.t, a.agent, a.id, a.x, a.q, a.country ? 1 : 0);
    }

    // 6. Seed Sources
    const insertSource = this.db.prepare('INSERT OR REPLACE INTO sources (id, label, type, how, cover, trust, health, config_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const s of seed.SOURCES) {
      insertSource.run(s.id, s.label, s.type, s.how, s.cover, s.trust, s.health, JSON.stringify(s.kv || []));
    }

    // 7. Seed Policies
    const insertPolicy = this.db.prepare('INSERT OR REPLACE INTO policies (id, section, text, note, hits_json, is_met) VALUES (?, ?, ?, ?, ?, ?)');
    for (const pol of seed.POLICIES) {
      insertPolicy.run(pol.id, pol.sec, pol.t, pol.note || '', JSON.stringify(pol.hits || []), pol.met ? 1 : 0);
    }

    // 8. Seed Initial Cases
    const insertCase = this.db.prepare(`
      INSERT OR REPLACE INTO cases 
      (case_id, entity_id, owner, reviewer, status, risk, confidence, quadrant, decision_text, decision_reasons, evidence_sources, decision_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const allEnts = [...seed.ORGS, ...seed.VESSELS, ...seed.PEOPLE];
    allEnts.forEach((ent, i) => {
      const caseId = 'RV-26-' + String(4100 + i * 7).padStart(4, '0');
      const isHigh = ent.risk >= 50;
      const isConf = ent.conf >= 80;
      const quad = isHigh ? (isConf ? 'escalate' : 'investigate') : (isConf ? 'monitor' : 'gaps');
      insertCase.run(
        caseId,
        ent.id,
        ent.owner || 'Sofia Lim',
        'Grace Teo',
        quad === 'monitor' ? 'auto_cleared' : 'open',
        ent.risk,
        ent.conf,
        quad,
        quad === 'monitor' ? 'Auto-cleared by Sentry screening agent with written justification.' : null,
        quad === 'monitor' ? 'Clean registration extract; 0 hits across 41 sanctions lists; PEP negative.' : null,
        'Built-in sanctions lists, PEP and national gazette registries',
        quad === 'monitor' ? '06 Oct 2026' : null
      );
    });
  }

  // --- Entities ---
  getAllEntities() {
    const rows = this.db.prepare('SELECT * FROM entities ORDER BY name ASC').all();
    return rows.map(r => this._hydrateEntity(r));
  }

  getEntityById(id) {
    const row = this.db.prepare('SELECT * FROM entities WHERE id = ?').get(id);
    return row ? this._hydrateEntity(row) : null;
  }

  upsertEntity(entity) {
    const stmt = this.db.prepare(`
      INSERT INTO entities 
      (id, kind, name, short_name, role, jurisdiction, city, reg_no, risk, confidence, owner, trigger_event, since, claimed, summary, metadata_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        short_name = excluded.short_name,
        role = excluded.role,
        jurisdiction = excluded.jurisdiction,
        city = excluded.city,
        reg_no = excluded.reg_no,
        risk = excluded.risk,
        confidence = excluded.confidence,
        owner = excluded.owner,
        trigger_event = excluded.trigger_event,
        since = excluded.since,
        claimed = excluded.claimed,
        summary = excluded.summary,
        metadata_json = excluded.metadata_json,
        updated_at = CURRENT_TIMESTAMP
    `);

    const meta = {
      ll: entity.ll,
      factors: entity.factors || [],
      raise: entity.raise || '',
      findings: entity.findings || [],
      linked: !!entity.linked,
      stateOwned: !!entity.stateOwned,
      ddqPending: !!entity.ddqPending,
      mmsi: entity.mmsi,
      built: entity.built,
      dwt: entity.dwt,
      flag: entity.flag,
      dest: entity.dest,
      chartered: !!entity.chartered,
      names: entity.names,
      flags: entity.flags,
      links: entity.links,
      signals: entity.signals,
      pep: entity.pep,
      lists: entity.lists,
      // Organization fields
      tradingNames: entity.tradingNames || entity.trading_names || '',
      operatingAddresses: entity.operatingAddresses || entity.operating_addresses || '',
      controllers: entity.controllers || entity.directors_ubos || '',
      // Individual fields
      aliases: entity.aliases || entity.name_variants || '',
      dob: entity.dob || entity.date_of_birth || '',
      nationality: entity.nationality || '',
      idDoc: entity.idDoc || entity.id_document || '',
      residentialAddress: entity.residentialAddress || entity.residential_address || ''
    };

    stmt.run(
      entity.id,
      entity.kind || 'org',
      entity.name,
      entity.short || entity.name,
      entity.role || '',
      entity.a3 || entity.jurisdiction || '',
      entity.city || '',
      entity.reg || entity.reg_no || '',
      entity.risk || 0,
      entity.conf || entity.confidence || 0,
      entity.owner || 'Grace Teo',
      entity.trigger || entity.trigger_event || 'Intake screening',
      entity.since || '',
      entity.claimed ? 1 : 0,
      entity.summary || '',
      JSON.stringify(meta)
    );

    return this.getEntityById(entity.id);
  }

  _hydrateEntity(row) {
    let meta = {};
    try {
      meta = JSON.parse(row.metadata_json || '{}');
    } catch (e) {}

    return {
      id: row.id,
      kind: row.kind,
      type: row.kind,
      name: row.name,
      short: row.short_name,
      role: row.role,
      a3: row.jurisdiction,
      jurisdiction: row.jurisdiction,
      city: row.city,
      reg: row.reg_no,
      risk: row.risk,
      conf: row.confidence,
      confidence: row.confidence,
      owner: row.owner,
      trigger: row.trigger_event,
      since: row.since,
      claimed: Boolean(row.claimed),
      summary: row.summary,
      ...meta
    };
  }

  // --- Graph Edges ---
  getOwnershipEdges() {
    return this.db.prepare('SELECT source_id, target_id, label, provenance, confidence FROM ownership_edges').all().map(r => [
      r.source_id,
      r.target_id,
      r.label,
      r.provenance,
      r.confidence
    ]);
  }

  addOwnershipEdge(src, tgt, label, prov, conf = null) {
    this.db.prepare('INSERT INTO ownership_edges (source_id, target_id, label, provenance, confidence) VALUES (?, ?, ?, ?, ?)')
      .run(src, tgt, label, prov, conf);
  }

  // --- Phase 2: Claims & Statements ---
  claimProfile(orgId, email, signatory, role) {
    this.db.prepare('UPDATE entities SET claimed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(orgId);
    this.db.prepare('INSERT INTO claims (org_id, email, signatory, role) VALUES (?, ?, ?, ?)').run(orgId, email, signatory, role || '');
    return this.getEntityById(orgId);
  }

  getStatement(orgId) {
    const row = this.db.prepare('SELECT * FROM statements WHERE org_id = ?').get(orgId);
    if (!row) return null;
    let claims = [];
    try { claims = JSON.parse(row.claims_json || '[]'); } catch (e) {}
    return {
      orgId: row.org_id,
      date: row.date_str,
      text: row.statement_text,
      remediation: row.remediation,
      claims
    };
  }

  saveStatement(orgId, dateStr, text, remediation, claims) {
    this.db.prepare(`
      INSERT INTO statements (org_id, date_str, statement_text, remediation, claims_json, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(org_id) DO UPDATE SET
        date_str = excluded.date_str,
        statement_text = excluded.statement_text,
        remediation = excluded.remediation,
        claims_json = excluded.claims_json,
        updated_at = CURRENT_TIMESTAMP
    `).run(orgId, dateStr, text, remediation || '', JSON.stringify(claims));

    return this.getStatement(orgId);
  }

  // --- Alerts ---
  getAlerts(limit = 50) {
    const rows = this.db.prepare('SELECT * FROM alerts ORDER BY id DESC LIMIT ?').all(limit);
    return rows.map(r => ({
      id: r.entity_id,
      t: r.timestamp,
      agent: r.agent,
      x: r.text,
      q: r.quadrant,
      country: Boolean(r.is_country)
    }));
  }

  addAlert(agent, entityId, text, quadrant = 'investigate', isCountry = false) {
    const now = new Date();
    const t = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ', ' +
              now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    this.db.prepare('INSERT INTO alerts (timestamp, agent, entity_id, text, quadrant, is_country) VALUES (?, ?, ?, ?, ?, ?)')
      .run(t, agent, entityId, text, quadrant, isCountry ? 1 : 0);
  }

  // --- Sources ---
  getSources() {
    const rows = this.db.prepare('SELECT * FROM sources').all();
    return rows.map(r => {
      let kv = [];
      let config = {};
      try {
        const parsed = JSON.parse(r.config_json || '[]');
        if (Array.isArray(parsed)) {
          kv = parsed;
        } else if (parsed && typeof parsed === 'object') {
          kv = parsed.kv || [];
          config = parsed;
        }
      } catch (e) {}
      return {
        id: r.id,
        label: r.label,
        type: r.type,
        how: r.how,
        cover: r.cover,
        trust: r.trust,
        health: r.health,
        kv,
        config
      };
    });
  }

  addSource(source) {
    const configData = source.config_json 
      ? (typeof source.config_json === 'string' ? source.config_json : JSON.stringify(source.config_json))
      : JSON.stringify({ kv: source.kv || [], ...(source.config || {}) });

    this.db.prepare(`
      INSERT OR REPLACE INTO sources (id, label, type, how, cover, trust, health, config_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      source.id,
      source.label,
      source.type,
      source.how,
      source.cover,
      source.trust,
      source.health || 'new',
      configData
    );
    return source;
  }

  deleteSource(id) {
    return this.db.prepare('DELETE FROM sources WHERE id = ?').run(id);
  }

  updateSourceHealth(id, health) {
    this.db.prepare('UPDATE sources SET health = ? WHERE id = ?').run(health, id);
  }

  // --- Policies ---
  getPolicies() {
    const rows = this.db.prepare('SELECT * FROM policies').all();
    return rows.map(r => {
      let hits = [];
      try { hits = JSON.parse(r.hits_json || '[]'); } catch (e) {}
      return {
        id: r.id,
        sec: r.section,
        t: r.text,
        note: r.note,
        hits,
        met: Boolean(r.is_met)
      };
    });
  }

  addPolicy(policy) {
    this.db.prepare(`
      INSERT OR REPLACE INTO policies (id, section, text, note, hits_json, is_met)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      policy.id,
      policy.sec,
      policy.t,
      policy.note || '',
      JSON.stringify(policy.hits || []),
      policy.met ? 1 : 0
    );
  }

  // --- Cases & Reviews ---
  getCases() {
    const rows = this.db.prepare(`
      SELECT c.*, e.name, e.short_name, e.kind, e.jurisdiction, e.trigger_event, e.reg_no
      FROM cases c
      JOIN entities e ON c.entity_id = e.id
      ORDER BY c.created_at DESC
    `).all();

    return rows.map(r => ({
      caseId: r.case_id,
      id: r.entity_id,
      name: r.name,
      short: r.short_name || r.name,
      kind: r.kind,
      a3: r.jurisdiction,
      trigger: r.trigger_event,
      reg: r.reg_no,
      owner: r.owner,
      reviewer: r.reviewer,
      status: r.status,
      risk: r.risk,
      conf: r.confidence,
      quadrant: r.quadrant,
      decisionText: r.decision_text,
      decisionReasons: r.decision_reasons,
      evidenceSources: r.evidence_sources,
      decisionDate: r.decision_date
    }));
  }

  addCase(caseObj) {
    this.db.prepare(`
      INSERT OR REPLACE INTO cases 
      (case_id, entity_id, owner, reviewer, status, risk, confidence, quadrant, decision_text, decision_reasons, evidence_sources, decision_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      caseObj.caseId,
      caseObj.entity_id || caseObj.id,
      caseObj.owner || 'Sofia Lim',
      caseObj.reviewer || 'Grace Teo',
      caseObj.status || 'open',
      caseObj.risk,
      caseObj.confidence || caseObj.conf,
      caseObj.quadrant,
      caseObj.decisionText || null,
      caseObj.decisionReasons || null,
      caseObj.evidenceSources || null,
      caseObj.decisionDate || null
    );
  }

  recordCaseDecision(caseId, reviewer, decision, reasons, evidence) {
    const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    this.db.prepare(`
      UPDATE cases 
      SET status = 'closed',
          reviewer = ?,
          decision_text = ?,
          decision_reasons = ?,
          evidence_sources = ?,
          decision_date = ?
      WHERE case_id = ? OR entity_id = ?
    `).run(reviewer, decision, reasons, evidence, dateStr, caseId, caseId);
  }

  // --- CPI ---
  getCpiScores() {
    return this.db.prepare('SELECT a3, name, score, rank FROM cpi').all();
  }

  getCpiByCode(a3) {
    return this.db.prepare('SELECT a3, name, score, rank FROM cpi WHERE a3 = ?').get(a3);
  }

  // --- Uploaded Files (Data Feeds & Custom Policies) ---
  addUploadedFile({ id, entity_id, file_type, filename, file_size = 0, mime_type = '', content_data = '', parsed_records = 1, storage_path = '' }) {
    const fileId = id || ('up_' + Date.now() + '_' + Math.floor(Math.random() * 1000));
    
    // Also save physical copy to data/uploads
    let finalPath = storage_path;
    try {
      const folderName = (file_type === 'custom_policy' || file_type === 'pdf_document' || file_type === 'pdf_source') ? 'policies' : 'feeds';
      const uploadDir = path.join(__dirname, '../../data/uploads', folderName);
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      finalPath = path.join(uploadDir, `${fileId}_${safeName}`);

      let buffer;
      if (content_data && typeof content_data === 'string' && content_data.startsWith('data:')) {
        const base64Data = content_data.split(',')[1] || '';
        buffer = Buffer.from(base64Data, 'base64');
      } else {
        buffer = Buffer.from(content_data || '', 'utf8');
      }
      fs.writeFileSync(finalPath, buffer);
    } catch (e) {
      // Non-fatal if disk write fails
    }

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO uploaded_files 
      (id, entity_id, file_type, filename, file_size, mime_type, content_data, parsed_records, storage_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(fileId, entity_id || null, file_type, filename, file_size, mime_type, content_data, parsed_records, finalPath);
    return this.getUploadedFileById(fileId);
  }

  getUploadedFiles(entity_id = null) {
    if (entity_id) {
      return this.db.prepare(`
        SELECT id, entity_id, file_type, filename, file_size, mime_type, parsed_records, storage_path, created_at 
        FROM uploaded_files 
        WHERE entity_id = ? 
        ORDER BY created_at DESC
      `).all(entity_id);
    }
    return this.db.prepare(`
      SELECT id, entity_id, file_type, filename, file_size, mime_type, parsed_records, storage_path, created_at 
      FROM uploaded_files 
      ORDER BY created_at DESC
    `).all();
  }

  getUploadedFileById(id) {
    return this.db.prepare('SELECT * FROM uploaded_files WHERE id = ?').get(id);
  }

  // --- Source Records / Knowledge Base ---
  seedSourceRecordsIfEmpty() {
    try {
      const row = this.db.prepare('SELECT COUNT(*) as count FROM source_records').get();
      if (row && row.count > 0) return;

      const initialRecords = [
        // Dataset (s1: Group blocklist)
        {
          id: 'sr_s1_1',
          source_id: 's1',
          source_label: 'Group blocklist',
          source_type: 'dataset',
          entity_name: 'Severny Agro Export LLC',
          entity_kind: 'org',
          jurisdiction: 'RUS',
          reg_no: 'RU-104779601',
          risk_level: 'High',
          risk_score: 92,
          summary: 'Sectoral sanctions designation; 51% owned by Russian state agricultural enterprise.',
          details_json: JSON.stringify({ program: 'Sectoral Sanctions (Russia)', ownership: '51% SOE', list: 'Group Blocklist CSV' }),
          raw_content: 'Severny Agro Export LLC,RU-104779601,RUS,High,Sectoral Sanctions 51% SOE'
        },
        {
          id: 'sr_s1_2',
          source_id: 's1',
          source_label: 'Group blocklist',
          source_type: 'dataset',
          entity_name: 'Varnell Maritime Ltd',
          entity_kind: 'org',
          jurisdiction: 'CYP',
          reg_no: 'CY-HE83910',
          risk_level: 'High',
          risk_score: 88,
          summary: 'Blocked maritime holding vehicle associated with designated transport schemes.',
          details_json: JSON.stringify({ program: 'Designated Maritime Entity', fleet_count: 4 }),
          raw_content: 'Varnell Maritime Ltd,CY-HE83910,CYP,High,Designated maritime holding'
        },
        {
          id: 'sr_s1_3',
          source_id: 's1',
          source_label: 'Group blocklist',
          source_type: 'dataset',
          entity_name: 'Arkady Zemtsov',
          entity_kind: 'person',
          jurisdiction: 'RUS',
          reg_no: 'OFAC-SDN-8821',
          risk_level: 'High',
          risk_score: 96,
          summary: 'OFAC designated individual; controlling shareholder across shadow fleet networks.',
          details_json: JSON.stringify({ program: 'OFAC SDN', dob: '1974-05-12', role: 'Controlling UBO' }),
          raw_content: 'Arkady Zemtsov,OFAC-SDN-8821,RUS,High,OFAC SDN listed individual'
        },
        // API (s2: Vendor X sanctions API)
        {
          id: 'sr_s2_1',
          source_id: 's2',
          source_label: 'Vendor X sanctions API',
          source_type: 'api',
          entity_name: 'Kestrel Trading FZE',
          entity_kind: 'org',
          jurisdiction: 'ARE',
          reg_no: 'RAK-FZ-2019-881',
          risk_level: 'High',
          risk_score: 82,
          summary: 'Vendor API graph match: 50% indirect beneficial control by sanctioned individual Arkady Zemtsov.',
          details_json: JSON.stringify({ ubo: 'Arkady Zemtsov', control_stake: 0.50, verified: true }),
          raw_content: '{"entity":"Kestrel Trading FZE","country":"ARE","ubo":"Arkady Zemtsov","stake":0.50}'
        },
        {
          id: 'sr_s2_2',
          source_id: 's2',
          source_label: 'Vendor X sanctions API',
          source_type: 'api',
          entity_name: 'Aurora Venture',
          entity_kind: 'vessel',
          jurisdiction: 'LBR',
          reg_no: 'IMO 9412345',
          risk_level: 'High',
          risk_score: 85,
          summary: 'Maritime intelligence feed: 31 hr AIS dark period in Arabian Sea followed by STS transfer east of Johor.',
          details_json: JSON.stringify({ imo: '9412345', flag: 'LBR', ais_gap_hours: 31, sts_transfer: true }),
          raw_content: '{"vessel":"Aurora Venture","imo":"9412345","flag":"LBR","dark_gap_h":31}'
        },
        {
          id: 'sr_s2_3',
          source_id: 's2',
          source_label: 'Vendor X sanctions API',
          source_type: 'api',
          entity_name: 'Straits Bunkering Trading LLC',
          entity_kind: 'org',
          jurisdiction: 'ARE',
          reg_no: 'AE-992812',
          risk_level: 'Low',
          risk_score: 14,
          summary: 'Corporate registry differentiation: Cleared from designated list due to distinct UEN and directors.',
          details_json: JSON.stringify({ status: 'Auto-cleared false positive', reg: 'AE-992812' }),
          raw_content: '{"entity":"Straits Bunkering Trading LLC","status":"cleared_false_positive"}'
        },
        // Website (s3: MAS enforcement actions)
        {
          id: 'sr_s3_1',
          source_id: 's3',
          source_label: 'MAS enforcement actions',
          source_type: 'website',
          entity_name: 'Aethelgard Finance Pte Ltd',
          entity_kind: 'org',
          jurisdiction: 'SGP',
          reg_no: 'UEN 201827102D',
          risk_level: 'Medium',
          risk_score: 62,
          summary: 'Regulator bulletin: Reprimanded for customer due diligence deficiencies and AML compliance breaches.',
          details_json: JSON.stringify({ regulator: 'Monetary Authority of Singapore', notice: 'MAS Notice 626' }),
          raw_content: 'MAS Enforcement Bulletin: Reprimand issued to Aethelgard Finance Pte Ltd for AML controls.'
        },
        {
          id: 'sr_s3_2',
          source_id: 's3',
          source_label: 'MAS enforcement actions',
          source_type: 'website',
          entity_name: 'Alexander Viktorov',
          entity_kind: 'person',
          jurisdiction: 'SGP',
          reg_no: 'ID-PASSPORT-V9102',
          risk_level: 'Medium',
          risk_score: 58,
          summary: 'Executive director named in MAS supervisory proceedings for cross-border fund flow oversight failure.',
          details_json: JSON.stringify({ regulator: 'MAS', role: 'Executive Director' }),
          raw_content: 'MAS enforcement notice: Executive Director Alexander Viktorov cautioned.'
        },
        // Document (PDF Regulatory Gazette)
        {
          id: 'sr_doc_1',
          source_id: 's_doc_demo',
          source_label: 'National Sanctions Gazette & Maritime Directives',
          source_type: 'document',
          entity_name: 'Halcyon Energy DMCC',
          entity_kind: 'org',
          jurisdiction: 'ARE',
          reg_no: 'DMCC-55102',
          risk_level: 'Low',
          risk_score: 24,
          summary: 'Document audit verified: Clean beneficial ownership register and current compliance certification.',
          details_json: JSON.stringify({ doc_type: 'Regulatory Gazette Extract', ubo_cleared: true }),
          raw_content: 'Gazette Extract: Halcyon Energy DMCC verified clean ownership and compliant trade licence.'
        }
      ];

      this.addSourceRecords(initialRecords);
    } catch (e) {
      console.error('Error seeding source records:', e);
    }
  }

  addSourceRecord(r) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO source_records
      (id, source_id, source_label, source_type, entity_name, entity_kind, jurisdiction, reg_no, risk_level, risk_score, summary, details_json, raw_content)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      r.id,
      r.source_id,
      r.source_label,
      r.source_type,
      r.entity_name,
      r.entity_kind || 'org',
      r.jurisdiction || 'GLB',
      r.reg_no || '',
      r.risk_level || 'Medium',
      r.risk_score || 50,
      r.summary || '',
      typeof r.details_json === 'string' ? r.details_json : JSON.stringify(r.details_json || {}),
      r.raw_content || ''
    );
    return r;
  }

  addSourceRecords(records) {
    if (!Array.isArray(records) || records.length === 0) return [];
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO source_records
      (id, source_id, source_label, source_type, entity_name, entity_kind, jurisdiction, reg_no, risk_level, risk_score, summary, details_json, raw_content)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of records) {
      stmt.run(
        r.id,
        r.source_id,
        r.source_label,
        r.source_type,
        r.entity_name,
        r.entity_kind || 'org',
        r.jurisdiction || 'GLB',
        r.reg_no || '',
        r.risk_level || 'Medium',
        r.risk_score || 50,
        r.summary || '',
        typeof r.details_json === 'string' ? r.details_json : JSON.stringify(r.details_json || {}),
        r.raw_content || ''
      );
    }
    return records;
  }

  getSourceRecords(filter = {}) {
    let query = 'SELECT * FROM source_records WHERE 1=1';
    const params = [];
    if (filter.sourceId) {
      query += ' AND source_id = ?';
      params.push(filter.sourceId);
    }
    if (filter.kind) {
      query += ' AND entity_kind = ?';
      params.push(filter.kind);
    }
    if (filter.type) {
      query += ' AND source_type = ?';
      params.push(filter.type);
    }
    query += ' ORDER BY created_at DESC';
    const rows = this.db.prepare(query).all(...params);
    return rows.map(r => ({
      ...r,
      details: (() => { try { return JSON.parse(r.details_json || '{}'); } catch(e){ return {}; } })()
    }));
  }

  getSourceRecordsBySource(sourceId) {
    return this.getSourceRecords({ sourceId });
  }

  deleteSourceRecordsBySourceId(sourceId) {
    return this.db.prepare('DELETE FROM source_records WHERE source_id = ?').run(sourceId);
  }

  searchSourceRecords(searchTerm, kind = null) {
    const term = `%${(searchTerm || '').trim().toLowerCase()}%`;
    let query = `
      SELECT * FROM source_records 
      WHERE (LOWER(entity_name) LIKE ? OR LOWER(summary) LIKE ? OR LOWER(reg_no) LIKE ?)
    `;
    const params = [term, term, term];
    if (kind && kind !== 'all') {
      query += ' AND entity_kind = ?';
      params.push(kind);
    }
    query += ' ORDER BY risk_score DESC LIMIT 20';
    const rows = this.db.prepare(query).all(...params);
    return rows.map(r => ({
      ...r,
      details: (() => { try { return JSON.parse(r.details_json || '{}'); } catch(e){ return {}; } })()
    }));
  }

  getAllSourceRecords() {
    return this.getSourceRecords();
  }

  close() {
    try {
      this.db.close();
    } catch (e) {}
  }
}

module.exports = SqliteDatabase;

