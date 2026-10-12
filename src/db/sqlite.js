const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');
const seed = require('./seed-data');

class SqliteDatabase {
  constructor(dbPath = config.dbPath, { empty = false } = {}) {
    this.dbPath = dbPath;
    // A workspace someone created (not the Demo workspace): reference data only, never the demo story
    this.emptyWorkspace = Boolean(empty);
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
    this.ensureReferenceData();
    // Demo counterparties are scored from findings like any other case (src/risk/riskService.js)
    try { require('../risk/riskService').ensureDemoFindings(this); } catch (e) { console.error('[DueDilly] Demo findings skipped:', e.message); }
  }

  /** Reference rows added after a database was first created: new CPI countries, corrected demo records. */
  ensureReferenceData() {
    const insertCpi = this.db.prepare('INSERT OR IGNORE INTO cpi (a3, name, score, rank) VALUES (?, ?, ?, ?)');
    for (const c of seed.CPI_2025) insertCpi.run(c.a3, c.name, c.score, c.rank);
    // The Vendor X record for Aurora Venture carried a different IMO and flag from the vessel record
    this.db.prepare(`UPDATE source_records SET jurisdiction = 'CMR', reg_no = 'IMO 9304124', details_json = ?, raw_content = ? WHERE id = 'sr_s2_2' AND reg_no = 'IMO 9412345'`)
      .run(JSON.stringify({ imo: '9304124', flag: 'CMR', ais_gap_hours: 31, sts_transfer: true }), '{"vessel":"Aurora Venture","imo":"9304124","flag":"CMR","dark_gap_h":31}');
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

      CREATE TABLE IF NOT EXISTS kyc_requests (
        id TEXT PRIMARY KEY,
        submission_date TEXT NOT NULL,
        counterparty_name TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        country TEXT NOT NULL,
        relationship_type TEXT NOT NULL,
        contract_value INTEGER DEFAULT 0,
        ongoing_monitoring INTEGER DEFAULT 0,
        request_status TEXT DEFAULT 'Submitted',
        screening_result TEXT DEFAULT 'Clear',
        ai_result TEXT,
        ai_score INTEGER DEFAULT 20,
        ai_confidence INTEGER DEFAULT 90,
        ai_rationale TEXT,
        ddq_required INTEGER DEFAULT 0,
        ddq_status TEXT DEFAULT 'N/A',
        ddq_clause TEXT,
        remarks TEXT,
        attributes_json TEXT,
        location_json TEXT,
        attachments_json TEXT,
        created_by_user_id TEXT DEFAULT 'EMP-1042',
        created_by_email TEXT DEFAULT 'sarah.tan@duedilly.internal',
        created_by_department TEXT DEFAULT 'Procurement & Supply Chain',
        ip_address TEXT DEFAULT '127.0.0.1',
        client_timestamp TEXT,
        last_modified_by TEXT DEFAULT 'System',
        counterparty_email TEXT,
        ddq_token TEXT,
        ddq_token_expires_at TEXT,
        ddq_responses_json TEXT,
        compliance_notes TEXT,
        re_screening_result TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_kyc_status ON kyc_requests(request_status);
      CREATE INDEX IF NOT EXISTS idx_kyc_date ON kyc_requests(submission_date);
      CREATE INDEX IF NOT EXISTS idx_kyc_creator ON kyc_requests(created_by_email);
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ddq_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        is_active INTEGER DEFAULT 0,
        source_filename TEXT,
        template_json TEXT NOT NULL,
        updated_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS ddq_translations (
        cache_key TEXT PRIMARY KEY,
        language TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Migrate any existing kyc_requests table
    const migrationCols = [
      'counterparty_email TEXT',
      'ddq_token TEXT',
      'ddq_token_expires_at TEXT',
      'ddq_responses_json TEXT',
      'compliance_notes TEXT',
      're_screening_result TEXT',
      'ddq_template_json TEXT',
      'ddq_draft_json TEXT',
      'ddq_submitted_at TEXT',
      'agent_json TEXT',
      'ddq_bounce_json TEXT',
      'monitoring_json TEXT'
    ];
    for (const col of migrationCols) {
      try {
        this.db.exec(`ALTER TABLE kyc_requests ADD COLUMN ${col}`);
      } catch (e) {}
    }
    // Ongoing monitoring: what a re-screen against each source costs, and app-wide settings
    try { this.db.exec('ALTER TABLE sources ADD COLUMN cost_per_screen REAL DEFAULT 0'); } catch (e) {}
    this.db.exec('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)');
    // Risk scoring (src/risk): every finding that was read, accepted or rejected, and which checks ran per case
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS findings (
        id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        category TEXT,
        status TEXT NOT NULL DEFAULT 'accepted',
        reject_reason TEXT,
        finding_json TEXT NOT NULL,
        is_demo INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_findings_entity ON findings(entity_id);
      CREATE TABLE IF NOT EXISTS risk_checks (
        entity_id TEXT PRIMARY KEY,
        checks_json TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // Phase 3. Ripples triage: a severity for sorting (not a risk score), one line on what changed, and duplicates merged
    for (const col of ['severity TEXT', 'what_changed TEXT', 'merged_into INTEGER', 'triaged_by TEXT', 'rescreen TEXT']) {
      try { this.db.exec(`ALTER TABLE alerts ADD COLUMN ${col}`); } catch (e) {}
    }
    // Events already handled (a redelivered event does nothing) and the extraction fixes Dilly has suggested
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events_seen (
        id TEXT PRIMARY KEY,
        event TEXT NOT NULL,
        handled_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS source_proposals (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        problem TEXT,
        old_instructions TEXT,
        new_instructions TEXT,
        test_json TEXT,
        proposed_by TEXT,
        decided_by TEXT,
        decided_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // The review model (src/learning): what officers labelled, the models trained on it, and what the model predicts
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS review_labels (
        id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        label TEXT NOT NULL,
        features_json TEXT NOT NULL,
        rule_risk INTEGER,
        rule_confidence INTEGER,
        rule_route TEXT,
        reviewer TEXT,
        note TEXT,
        is_synthetic INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_review_labels_entity ON review_labels(entity_id);
      CREATE TABLE IF NOT EXISTS ml_models (
        id TEXT PRIMARY KEY,
        backend TEXT NOT NULL,
        status TEXT NOT NULL,
        info_json TEXT NOT NULL,
        model_json TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS ml_predictions (
        entity_id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL,
        prediction_json TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // Reviewer copilot: the AI draft and what the reviewer finally confirmed are both kept
    // DDQ answer verification: the result of comparing a returned questionnaire with the findings
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS copilot_drafts (
        id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        draft_json TEXT NOT NULL,
        final_json TEXT,
        created_by TEXT,
        confirmed_by TEXT,
        confirmed_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_copilot_entity ON copilot_drafts(entity_id);
      CREATE TABLE IF NOT EXISTS ddq_verifications (
        kyc_id TEXT PRIMARY KEY,
        result_json TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // Must run after the migration: older tables lack ddq_token until the ALTER above
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_kyc_token ON kyc_requests(ddq_token)');

    this.seedSourceRecordsIfEmpty();
    this.seedKycRequestsIfEmpty();
  }


  /** False for a workspace created by `npm run demo:clean`: no built-in demo counterparties, alerts, sources or rules. */
  hasPlaceholderData() {
    if (this.emptyWorkspace) return false;
    return this.getSetting('placeholder_data', true) !== false;
  }

  seedIfEmpty() {
    // Clean workspace: only the reference data the rules need (country risk scores) is loaded
    if (process.env.SAFEGLOBE_NO_PLACEHOLDER_DATA === '1' || !this.hasPlaceholderData()) {
      this.setSetting('placeholder_data', false);
      if (!this.db.prepare('SELECT COUNT(*) as count FROM cpi').get().count) {
        const insertCpi = this.db.prepare('INSERT OR REPLACE INTO cpi (a3, name, score, rank) VALUES (?, ?, ?, ?)');
        for (const c of seed.CPI_2025) insertCpi.run(c.a3, c.name, c.score, c.rank);
      }
      // The policy rules are part of the app. A created workspace gets them without the demo counterparties they hit.
      if (this.emptyWorkspace && !this.db.prepare('SELECT COUNT(*) as count FROM policies').get().count) {
        const insertPolicy = this.db.prepare('INSERT OR REPLACE INTO policies (id, section, text, note, hits_json, is_met) VALUES (?, ?, ?, ?, ?, ?)');
        for (const pol of seed.POLICIES) insertPolicy.run(pol.id, pol.sec, pol.t, '', '[]', 0);
      }
      return;
    }

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
      pending: entity.pending ? true : undefined,
      route: entity.route,
      ais: entity.ais,
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
      controllersList: entity.controllersList || null,
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

  deleteEntity(id) {
    return this.db.prepare('DELETE FROM entities WHERE id = ?').run(id).changes > 0;
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
      country: Boolean(r.is_country),
      // Ripples triage (Phase 3). severity is a sorting aid, never a risk score.
      alertId: r.id,
      severity: r.severity || null,
      whatChanged: r.what_changed || null,
      mergedInto: r.merged_into || null,
      triagedBy: r.triaged_by || null,
      rescreen: r.rescreen || null
    }));
  }

  addAlert(agent, entityId, text, quadrant = 'investigate', isCountry = false) {
    const now = new Date();
    const t = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ', ' +
              now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const info = this.db.prepare('INSERT INTO alerts (timestamp, agent, entity_id, text, quadrant, is_country) VALUES (?, ?, ?, ?, ?, ?)')
      .run(t, agent, entityId, text, quadrant, isCountry ? 1 : 0);
    const alertId = Number(info.lastInsertRowid);
    // The event bus listens here, so every alert raises "alert-raised" wherever it was added (src/events)
    if (typeof SqliteDatabase.onAlertAdded === 'function') {
      try { SqliteDatabase.onAlertAdded({ alertId, agent, entityId, text, quadrant, isCountry: Boolean(isCountry) }); } catch (e) { console.error('[Events] alert-raised not published:', e.message); }
    }
    return alertId;
  }

  getAlertRow(alertId) {
    return this.db.prepare('SELECT * FROM alerts WHERE id = ?').get(alertId) || null;
  }

  /** Other alerts for the same counterparty, newest first, that have not been merged into another one. */
  getRecentAlertRows(entityId, { excludeId = 0, limit = 8 } = {}) {
    return this.db.prepare('SELECT * FROM alerts WHERE entity_id = ? AND id != ? AND merged_into IS NULL ORDER BY id DESC LIMIT ?').all(entityId, excludeId, limit);
  }

  setAlertTriage(alertId, { severity = null, whatChanged = null, mergedInto = null, triagedBy = null }) {
    this.db.prepare('UPDATE alerts SET severity = ?, what_changed = ?, merged_into = ?, triaged_by = ? WHERE id = ?').run(severity, whatChanged, mergedInto, triagedBy, alertId);
    return this.getAlertRow(alertId);
  }

  setAlertRescreen(alertId, state) {
    this.db.prepare('UPDATE alerts SET rescreen = ? WHERE id = ?').run(state, alertId);
  }

  countMergedAlerts(alertId) {
    return this.db.prepare('SELECT COUNT(*) AS n FROM alerts WHERE merged_into = ?').get(alertId).n;
  }

  // --- Reviewer copilot drafts ---
  saveCopilotDraft({ id, entityId, draft, createdBy }) {
    this.db.prepare('INSERT INTO copilot_drafts (id, entity_id, status, draft_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, entityId, 'draft', JSON.stringify(draft), createdBy || '', new Date().toISOString());
    return this.getCopilotDraft(id);
  }

  getCopilotDraft(id) {
    const r = this.db.prepare('SELECT * FROM copilot_drafts WHERE id = ?').get(id);
    if (!r) return null;
    return { id: r.id, entityId: r.entity_id, status: r.status, draft: JSON.parse(r.draft_json), final: r.final_json ? JSON.parse(r.final_json) : null, createdBy: r.created_by, confirmedBy: r.confirmed_by, confirmedAt: r.confirmed_at, createdAt: r.created_at };
  }

  getLatestCopilotDraft(entityId) {
    const r = this.db.prepare('SELECT id FROM copilot_drafts WHERE entity_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(entityId);
    return r ? this.getCopilotDraft(r.id) : null;
  }

  confirmCopilotDraft(id, final, confirmedBy) {
    this.db.prepare("UPDATE copilot_drafts SET status = 'confirmed', final_json = ?, confirmed_by = ?, confirmed_at = ? WHERE id = ?").run(JSON.stringify(final), confirmedBy || '', new Date().toISOString(), id);
    return this.getCopilotDraft(id);
  }

  // --- DDQ answer verification ---
  saveDdqVerification(kycId, result) {
    this.db.prepare('INSERT INTO ddq_verifications (kyc_id, result_json, created_at) VALUES (?, ?, ?) ON CONFLICT(kyc_id) DO UPDATE SET result_json = excluded.result_json, created_at = excluded.created_at').run(kycId, JSON.stringify(result), new Date().toISOString());
    return result;
  }

  getDdqVerification(kycId) {
    const r = this.db.prepare('SELECT * FROM ddq_verifications WHERE kyc_id = ?').get(kycId);
    return r ? Object.assign(JSON.parse(r.result_json), { savedAt: r.created_at }) : null;
  }

  deleteFindingRecord(id) {
    return this.db.prepare('DELETE FROM findings WHERE id = ?').run(id).changes;
  }

  // --- Review labels and the review model (src/learning) ---
  saveReviewLabel(l) {
    this.db.prepare('INSERT OR REPLACE INTO review_labels (id, entity_id, label, features_json, rule_risk, rule_confidence, rule_route, reviewer, note, is_synthetic, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(l.id, l.entityId, l.label, JSON.stringify(l.features), l.features.rule_risk, l.features.rule_confidence, l.route || '', l.reviewer || '', l.note || '', l.isSynthetic ? 1 : 0, l.createdAt || new Date().toISOString());
  }

  getReviewLabels({ entityId = null, synthetic = null, limit = 5000 } = {}) {
    const rows = this.db.prepare('SELECT * FROM review_labels WHERE (? IS NULL OR entity_id = ?) AND (? IS NULL OR is_synthetic = ?) ORDER BY created_at DESC, rowid DESC LIMIT ?')
      .all(entityId, entityId, synthetic === null ? null : (synthetic ? 1 : 0), synthetic === null ? null : (synthetic ? 1 : 0), limit);
    return rows.map(r => ({ id: r.id, entityId: r.entity_id, label: r.label, features: JSON.parse(r.features_json), route: r.rule_route, reviewer: r.reviewer, note: r.note, isSynthetic: Boolean(r.is_synthetic), createdAt: r.created_at }));
  }

  countReviewLabels() {
    const rows = this.db.prepare('SELECT is_synthetic AS s, label, COUNT(*) AS n FROM review_labels GROUP BY is_synthetic, label').all();
    const out = { real: { risk: 0, no_risk: 0 }, synthetic: { risk: 0, no_risk: 0 } };
    for (const r of rows) if (out[r.s ? 'synthetic' : 'real'][r.label] !== undefined) out[r.s ? 'synthetic' : 'real'][r.label] = r.n;
    return out;
  }

  deleteSyntheticReviewLabels() {
    return this.db.prepare('DELETE FROM review_labels WHERE is_synthetic = 1').run().changes;
  }

  saveMlModel({ id, backend, status, info, model = null }) {
    this.db.prepare('INSERT INTO ml_models (id, backend, status, info_json, model_json, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, info_json = excluded.info_json, model_json = COALESCE(excluded.model_json, ml_models.model_json)')
      .run(id, backend, status, JSON.stringify(info), model ? JSON.stringify(model) : null, new Date().toISOString());
  }

  getMlModel(id = null, { withModel = false } = {}) {
    const r = id ? this.db.prepare('SELECT * FROM ml_models WHERE id = ?').get(id) : this.db.prepare("SELECT * FROM ml_models WHERE status = 'ready' ORDER BY created_at DESC, rowid DESC LIMIT 1").get();
    if (!r) return null;
    return { id: r.id, backend: r.backend, status: r.status, info: JSON.parse(r.info_json), model: withModel && r.model_json ? JSON.parse(r.model_json) : undefined, createdAt: r.created_at };
  }

  getLatestMlModel() {
    const r = this.db.prepare('SELECT id FROM ml_models ORDER BY created_at DESC, rowid DESC LIMIT 1').get();
    return r ? this.getMlModel(r.id) : null;
  }

  listMlModels(limit = 12) {
    return this.db.prepare('SELECT id FROM ml_models ORDER BY created_at DESC, rowid DESC LIMIT ?').all(limit).map(r => this.getMlModel(r.id));
  }

  savePredictions(modelId, predictions) {
    this.db.prepare('DELETE FROM ml_predictions').run();
    const stmt = this.db.prepare('INSERT OR REPLACE INTO ml_predictions (entity_id, model_id, prediction_json, created_at) VALUES (?, ?, ?, ?)');
    for (const p of predictions) stmt.run(p.entityId, modelId, JSON.stringify(p), new Date().toISOString());
  }

  getPredictions() {
    return this.db.prepare('SELECT * FROM ml_predictions').all().map(r => Object.assign(JSON.parse(r.prediction_json), { modelId: r.model_id, at: r.created_at }));
  }

  // --- Events (src/events): an event is handled once, however often it is delivered ---
  hasSeenEvent(id) {
    return Boolean(this.db.prepare('SELECT 1 FROM events_seen WHERE id = ?').get(id));
  }

  markEventSeen(id, event) {
    this.db.prepare('INSERT OR IGNORE INTO events_seen (id, event) VALUES (?, ?)').run(id, event);
    this.db.prepare("DELETE FROM events_seen WHERE handled_at < datetime('now', '-14 days')").run();
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
        cost_per_screen: Number(r.cost_per_screen) || 0,
        kv,
        config
      };
    });
  }

  setSourceCost(id, cost) {
    return this.db.prepare('UPDATE sources SET cost_per_screen = ? WHERE id = ?').run(cost, id).changes > 0;
  }

  getSetting(key, fallback = null) {
    const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
    if (!row) return fallback;
    try { return JSON.parse(row.value); } catch (e) { return fallback; }
  }

  setSetting(key, value) {
    this.db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
    return value;
  }

  // Ongoing monitoring schedule of one KYC request (frequency, dates, sources, last / next run)
  setKycMonitoring(id, monitoring, enabled) {
    this.db.prepare('UPDATE kyc_requests SET monitoring_json = ?, ongoing_monitoring = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(monitoring ? JSON.stringify(monitoring) : null, enabled ? 1 : 0, id);
    return this.getKycRequestById(id);
  }

  setKycAttributes(id, attributes) {
    this.db.prepare('UPDATE kyc_requests SET attributes_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(JSON.stringify(attributes || {}), id);
    return this.getKycRequestById(id);
  }

  setKycRescreenResult(id, text) {
    this.db.prepare('UPDATE kyc_requests SET re_screening_result = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(text, id);
  }

  addSource(source) {
    // INSERT OR REPLACE below would reset the cost a compliance officer has set
    const previous = this.db.prepare('SELECT cost_per_screen FROM sources WHERE id = ?').get(source.id);
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
    if (previous && previous.cost_per_screen) this.setSourceCost(source.id, previous.cost_per_screen);
    return source;
  }

  /** Merges patch into a source's stored settings (its crawl state, extraction instructions, ticks). */
  updateSourceConfig(id, patch) {
    const row = this.db.prepare('SELECT config_json FROM sources WHERE id = ?').get(id);
    if (!row) return null;
    let current = {};
    try {
      const parsed = JSON.parse(row.config_json || '{}');
      current = Array.isArray(parsed) ? { kv: parsed } : (parsed || {});
    } catch (e) {}
    const next = Object.assign({}, current, patch);
    this.db.prepare('UPDATE sources SET config_json = ? WHERE id = ?').run(JSON.stringify(next), id);
    return next;
  }

  getSourceById(id) {
    return this.getSources().find(s => s.id === id) || null;
  }

  // --- Suggested extraction fixes (self-healing): proposed by the crawler agent, applied only by a person ---
  addSourceProposal(p) {
    this.db.prepare('INSERT INTO source_proposals (id, source_id, status, problem, old_instructions, new_instructions, test_json, proposed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(p.id, p.source_id, 'pending', p.problem || '', p.old_instructions || '', p.new_instructions || '', JSON.stringify(p.test || {}), p.proposed_by || '');
    return this.getSourceProposal(p.id);
  }

  getSourceProposal(id) {
    const r = this.db.prepare('SELECT * FROM source_proposals WHERE id = ?').get(id);
    if (!r) return null;
    let test = {};
    try { test = JSON.parse(r.test_json || '{}'); } catch (e) {}
    return { id: r.id, sourceId: r.source_id, status: r.status, problem: r.problem, oldInstructions: r.old_instructions, newInstructions: r.new_instructions, test, proposedBy: r.proposed_by, decidedBy: r.decided_by, decidedAt: r.decided_at, createdAt: r.created_at };
  }

  getSourceProposals({ sourceId = null, status = null } = {}) {
    const rows = this.db.prepare('SELECT id FROM source_proposals WHERE (? IS NULL OR source_id = ?) AND (? IS NULL OR status = ?) ORDER BY created_at DESC, rowid DESC').all(sourceId, sourceId, status, status);
    return rows.map(r => this.getSourceProposal(r.id));
  }

  decideSourceProposal(id, status, decidedBy) {
    this.db.prepare('UPDATE source_proposals SET status = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = ?').run(status, decidedBy || '', new Date().toISOString(), id, 'pending');
    return this.getSourceProposal(id);
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

  // --- Risk findings and checks (src/risk) ---
  saveFindingRecord(entityId, { finding, status = 'accepted', reason = '' }) {
    this.db.prepare(`
      INSERT INTO findings (id, entity_id, category, status, reject_reason, finding_json, is_demo)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET entity_id = excluded.entity_id, category = excluded.category, status = excluded.status,
        reject_reason = excluded.reject_reason, finding_json = excluded.finding_json, is_demo = excluded.is_demo
    `).run(finding.id, entityId, finding.category || '', status, reason || null, JSON.stringify(finding), finding.demo ? 1 : 0);
  }

  _hydrateFindingRecord(r) {
    let finding = {};
    try { finding = JSON.parse(r.finding_json); } catch (e) {}
    return { entityId: r.entity_id, status: r.status, reason: r.reject_reason || '', finding, createdAt: r.created_at };
  }

  getFindingRecords(entityId) {
    return this.db.prepare('SELECT * FROM findings WHERE entity_id = ? ORDER BY created_at ASC, id ASC').all(entityId).map(r => this._hydrateFindingRecord(r));
  }

  getFindingRecordById(id) {
    const row = this.db.prepare('SELECT * FROM findings WHERE id = ?').get(id);
    return row ? this._hydrateFindingRecord(row) : null;
  }

  deleteFindingRecords(entityId) {
    this.db.prepare('DELETE FROM findings WHERE entity_id = ?').run(entityId);
  }

  setRiskChecks(entityId, checks) {
    this.db.prepare(`INSERT INTO risk_checks (entity_id, checks_json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(entity_id) DO UPDATE SET checks_json = excluded.checks_json, updated_at = CURRENT_TIMESTAMP`).run(entityId, JSON.stringify(checks || {}));
  }

  getRiskChecks(entityId) {
    const row = this.db.prepare('SELECT checks_json FROM risk_checks WHERE entity_id = ?').get(entityId);
    if (!row) return null;
    try { return JSON.parse(row.checks_json); } catch (e) { return {}; }
  }

  /** Ids of every case that has been through the scorer */
  getScoredEntityIds() {
    return this.db.prepare('SELECT entity_id FROM risk_checks UNION SELECT entity_id FROM findings').all().map(r => r.entity_id);
  }

  /** Writes a computed score back to the counterparty and to its open case. Decided cases keep the score they were decided on. */
  setEntityScore(entityId, risk, confidence, quadrant) {
    this.db.prepare('UPDATE entities SET risk = ?, confidence = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(risk, confidence, entityId);
    this.db.prepare(`UPDATE cases SET risk = ?, confidence = ?, quadrant = ? WHERE entity_id = ? AND status != 'closed'`).run(risk, confidence, quadrant, entityId);
  }

  setEntityMetadata(entityId, patch) {
    const row = this.db.prepare('SELECT metadata_json FROM entities WHERE id = ?').get(entityId);
    if (!row) return;
    let meta = {};
    try { meta = JSON.parse(row.metadata_json || '{}'); } catch (e) {}
    this.db.prepare('UPDATE entities SET metadata_json = ? WHERE id = ?').run(JSON.stringify(Object.assign(meta, patch)), entityId);
  }

  // --- CPI ---
  /** Country risk by ISO code or by country name (vessel flags are stored by name) */
  getCpiByCodeOrName(value) {
    const v = String(value || '').trim();
    if (!v) return undefined;
    return this.db.prepare('SELECT a3, name, score, rank FROM cpi WHERE a3 = ? OR lower(name) = lower(?)').get(v.toUpperCase(), v);
  }

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
    if (this.emptyWorkspace) return;
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
          jurisdiction: 'CMR',
          reg_no: 'IMO 9304124',
          risk_level: 'High',
          risk_score: 85,
          summary: 'Maritime intelligence feed: 31 hr AIS dark period in Arabian Sea followed by STS transfer east of Johor.',
          details_json: JSON.stringify({ imo: '9304124', flag: 'CMR', ais_gap_hours: 31, sts_transfer: true }),
          raw_content: '{"vessel":"Aurora Venture","imo":"9304124","flag":"CMR","dark_gap_h":31}'
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
      r.risk_score == null ? 50 : r.risk_score,
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
        r.risk_score == null ? 50 : r.risk_score,
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

  // --- KYC Requests (Employee Portal Module) ---
  seedKycRequestsIfEmpty() {
    // Clean workspace (npm run demo:clean): no historical sample requests
    if (process.env.SAFEGLOBE_NO_PLACEHOLDER_DATA === '1' || !this.hasPlaceholderData()) return;
    try {
      const row = this.db.prepare('SELECT COUNT(*) as count FROM kyc_requests').get();
      if (row && row.count > 0) return;

      const initial = [
        {
          id: 'KYC-2026-0001',
          submission_date: '2026-10-07 14:32',
          counterparty_name: 'Severny Agro Export LLC',
          entity_type: 'Organisation',
          country: 'RUS',
          relationship_type: 'Customer/Trading Partner',
          contract_value: 1450000,
          ongoing_monitoring: 1,
          request_status: 'Screening In Progress',
          screening_result: 'Sanctions Alert',
          ai_result: 'High Risk (Confidence 92%)',
          ai_score: 88,
          ai_confidence: 92,
          ai_rationale: '51% state-owned Russian agricultural exporter subject to sectoral sanctions restrictions under EU/UK/OFAC regimes.',
          ddq_required: 1,
          ddq_status: 'Triggered',
          ddq_clause: 'Policy §4.1 (High-risk jurisdiction CPI 22) & §2.1 (Contract > SGD 100k)',
          remarks: 'Grain procurement agreement renewal for Q4 shipment cycle.',
          attributes_json: JSON.stringify({
            reg_no: 'RU-104779601',
            tax_id: 'OGRN 1092315000418',
            directors_ubo: 'Russian State Agricultural Holding (51%)',
            parent_company: 'State Agro Holding'
          }),
          location_json: JSON.stringify({
            address: 'Novorossiysk Commercial Seaport, Krasnodar Krai, Russia',
            lat: 44.7244,
            lng: 37.7675
          }),
          attachments_json: JSON.stringify(['severny_registry_extract.pdf', 'grain_export_licence.pdf']),
          created_by_user_id: 'EMP-1042',
          created_by_email: 'sarah.tan@duedilly.internal',
          created_by_department: 'Commodities Trading',
          ip_address: '10.0.4.12',
          client_timestamp: '2026-10-07T06:32:00.000Z',
          last_modified_by: 'System (Automated Screening)'
        },
        {
          id: 'KYC-2026-0002',
          submission_date: '2026-10-06 09:15',
          counterparty_name: 'Aurora Venture',
          entity_type: 'Vessel',
          country: 'LBR',
          relationship_type: 'Vendor/Supplier',
          contract_value: 420000,
          ongoing_monitoring: 1,
          request_status: 'Pending DDQ',
          screening_result: 'Watchlist Match',
          ai_result: 'Anomalies Flagged',
          ai_score: 85,
          ai_confidence: 88,
          ai_rationale: 'Satellite AIS telemetry identified 31 hr unverified dark period in Arabian Sea followed by STS transfer east of Johor.',
          ddq_required: 1,
          ddq_status: 'Sent to Counterparty',
          ddq_clause: 'Policy §5.4 (Vessel AIS dark period gap) & §2.1 (Contract > SGD 100k)',
          remarks: 'Time charter proposed for bunker bunkering and clean petroleum products.',
          attributes_json: JSON.stringify({
            imo: 'IMO 9412345',
            flag: 'Liberia',
            vessel_type: 'Crude Oil Tanker',
            owner: 'Meridian Maritime Holdings',
            operator: 'Varnell Maritime Ltd'
          }),
          location_json: JSON.stringify({
            address: 'Port of Monrovia, Liberia / AIS Coordinates',
            lat: 6.3156,
            lng: -10.8074
          }),
          attachments_json: JSON.stringify(['aurora_q88_charter.pdf']),
          created_by_user_id: 'EMP-2089',
          created_by_email: 'marcus.lee@duedilly.internal',
          created_by_department: 'Marine Logistics',
          ip_address: '10.0.8.44',
          client_timestamp: '2026-10-06T01:15:00.000Z',
          last_modified_by: 'Compliance Reviewer (Grace Teo)'
        },
        {
          id: 'KYC-2026-0003',
          submission_date: '2026-10-05 16:40',
          counterparty_name: 'Apex Global Trading Pte Ltd',
          entity_type: 'Organisation',
          country: 'SGP',
          relationship_type: 'Vendor/Supplier',
          contract_value: 85000,
          ongoing_monitoring: 1,
          request_status: 'Approved',
          screening_result: 'Clear',
          ai_result: 'Low Risk (Confidence 94%)',
          ai_score: 18,
          ai_confidence: 94,
          ai_rationale: 'Clean corporate registry extract with verified domestic directors. No international sanctions or adverse media exposure.',
          ddq_required: 0,
          ddq_status: 'N/A',
          ddq_clause: 'None (Standard Risk Profile)',
          remarks: 'Annual bunker procurement vendor onboarding.',
          attributes_json: JSON.stringify({
            reg_no: 'UEN 20210012A',
            tax_id: 'GST-M9021-X',
            directors_ubo: 'Tan Wei (55%), Maria Chen (45%)',
            parent_company: 'Independent'
          }),
          location_json: JSON.stringify({
            address: '71 Robinson Road #14-01, Singapore 068895',
            lat: 1.2789,
            lng: 103.8492
          }),
          attachments_json: JSON.stringify(['acra_bizfile_apex.pdf']),
          created_by_user_id: 'EMP-1042',
          created_by_email: 'sarah.tan@duedilly.internal',
          created_by_department: 'Procurement & Supply Chain',
          ip_address: '10.0.4.12',
          client_timestamp: '2026-10-05T08:40:00.000Z',
          last_modified_by: 'System (Auto-clear)'
        },
        {
          id: 'KYC-2026-0004',
          submission_date: '2026-10-04 11:20',
          counterparty_name: 'Arkady Zemtsov',
          entity_type: 'Person',
          country: 'RUS',
          relationship_type: 'M&A and Investment',
          contract_value: 3500000,
          ongoing_monitoring: 1,
          request_status: 'Rejected',
          screening_result: 'Sanctions Alert',
          ai_result: 'High Risk (Confidence 96%)',
          ai_score: 95,
          ai_confidence: 96,
          ai_rationale: 'Target individual matches UK OFSI and US OFAC designated SDN lists. Beneficial controller of restricted offshore corporate networks.',
          ddq_required: 1,
          ddq_status: 'Completed',
          ddq_clause: 'Policy §3.2 (Sanctioned UBO Block) & §3.6 (PEP / Designated individual)',
          remarks: 'Proposed equity investment co-investor review.',
          attributes_json: JSON.stringify({
            aliases: 'Aleksandr Zemtsov, Alex Zemtsov',
            dob: '1974-05-12',
            passport: 'Passport 51-No-889102',
            pep_declared: 1
          }),
          location_json: JSON.stringify({
            address: 'Tverskaya Street, Moscow, Russia',
            lat: 55.7643,
            lng: 37.6056
          }),
          attachments_json: JSON.stringify(['passport_scan_zemtsov.pdf']),
          created_by_user_id: 'EMP-3011',
          created_by_email: 'david.koh@duedilly.internal',
          created_by_department: 'Strategic Corporate Development',
          ip_address: '10.0.2.88',
          client_timestamp: '2026-10-04T03:20:00.000Z',
          last_modified_by: 'Compliance Officer (Grace Teo)'
        },
        {
          id: 'KYC-2026-0005',
          submission_date: '2026-10-03 15:05',
          counterparty_name: 'Straits Bunkering Trading LLC',
          entity_type: 'Organisation',
          country: 'ARE',
          relationship_type: '3rd Party Reps & Brokers',
          contract_value: 160000,
          ongoing_monitoring: 1,
          request_status: 'Approved',
          screening_result: 'Clear',
          ai_result: 'Low Risk (Confidence 96%)',
          ai_score: 14,
          ai_confidence: 96,
          ai_rationale: 'Potential name-similarity hit on designated entity cleared as false positive via distinct registration number and separate directors.',
          ddq_required: 1,
          ddq_status: 'Completed',
          ddq_clause: 'Policy §5.2 (3rd Party Intermediaries / Brokers) & §2.1 (Contract > SGD 100k)',
          remarks: 'Middle East bunkering brokerage engagement.',
          attributes_json: JSON.stringify({
            reg_no: 'AE-992812',
            tax_id: 'UAE-VAT-TRN1002',
            directors_ubo: 'Rashid Al-Falasi (100%)',
            parent_company: 'Gulf Marine Trading Group'
          }),
          location_json: JSON.stringify({
            address: 'DIFC Gate Precinct Building 4, Dubai, UAE',
            lat: 25.2048,
            lng: 55.2708
          }),
          attachments_json: JSON.stringify(['dubai_trade_licence.pdf', 'intermediary_ddq_signed.pdf']),
          created_by_user_id: 'EMP-1042',
          created_by_email: 'sarah.tan@duedilly.internal',
          created_by_department: 'Procurement & Supply Chain',
          ip_address: '10.0.4.12',
          client_timestamp: '2026-10-03T07:05:00.000Z',
          last_modified_by: 'Compliance Reviewer (Grace Teo)'
        }
      ];

      for (const r of initial) {
        this.addKycRequest(r);
      }
    } catch (e) {
      console.error('Error seeding KYC requests:', e);
    }
  }

  addKycRequest(r) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO kyc_requests 
      (id, submission_date, counterparty_name, entity_type, country, relationship_type, contract_value, ongoing_monitoring,
       request_status, screening_result, ai_result, ai_score, ai_confidence, ai_rationale, ddq_required, ddq_status, ddq_clause,
       remarks, attributes_json, location_json, attachments_json, created_by_user_id, created_by_email, created_by_department,
       ip_address, client_timestamp, last_modified_by, counterparty_email, ddq_token, ddq_token_expires_at, ddq_responses_json,
       compliance_notes, re_screening_result, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    stmt.run(
      r.id,
      r.submission_date || new Date().toISOString().replace('T', ' ').substring(0, 16),
      r.counterparty_name,
      r.entity_type || 'Organisation',
      (r.country || 'SGP').toUpperCase(),
      r.relationship_type || 'Vendor/Supplier',
      r.contract_value || 0,
      r.ongoing_monitoring ? 1 : 0,
      r.request_status || 'Submitted',
      r.screening_result || 'Clear',
      r.ai_result || 'Low Risk',
      r.ai_score || 20,
      r.ai_confidence || 90,
      r.ai_rationale || '',
      r.ddq_required ? 1 : 0,
      r.ddq_status || 'N/A',
      r.ddq_clause || '',
      r.remarks || '',
      typeof r.attributes_json === 'string' ? r.attributes_json : JSON.stringify(r.attributes_json || r.attributes || {}),
      typeof r.location_json === 'string' ? r.location_json : JSON.stringify(r.location_json || r.location || {}),
      typeof r.attachments_json === 'string' ? r.attachments_json : JSON.stringify(r.attachments_json || r.attachments || []),
      r.created_by_user_id || 'EMP-1042',
      r.created_by_email || 'sarah.tan@duedilly.internal',
      r.created_by_department || 'Procurement & Supply Chain',
      r.ip_address || '127.0.0.1',
      r.client_timestamp || new Date().toISOString(),
      r.last_modified_by || 'Employee Portal',
      r.counterparty_email || '',
      r.ddq_token || null,
      r.ddq_token_expires_at || null,
      typeof r.ddq_responses_json === 'string' ? r.ddq_responses_json : JSON.stringify(r.ddq_responses_json || r.ddq_responses || {}),
      r.compliance_notes || '',
      r.re_screening_result || ''
    );
    return this.getKycRequestById(r.id);
  }

  getAllKycRequests(filter = {}) {
    let query = 'SELECT * FROM kyc_requests WHERE 1=1';
    const params = [];

    // Row-level employee scoping (WHERE created_by_email == session.email)
    const emailFilter = filter.created_by_email || filter.user_email;
    if (emailFilter && emailFilter !== 'all') {
      query += ' AND LOWER(created_by_email) = ?';
      params.push(emailFilter.trim().toLowerCase());
    }

    if (filter.status && filter.status !== 'all') {
      query += ' AND request_status = ?';
      params.push(filter.status);
    }
    if (filter.entity_type && filter.entity_type !== 'all') {
      query += ' AND entity_type = ?';
      params.push(filter.entity_type);
    }
    if (filter.search) {
      const term = `%${filter.search.trim().toLowerCase()}%`;
      query += ' AND (LOWER(counterparty_name) LIKE ? OR LOWER(id) LIKE ? OR LOWER(country) LIKE ?)';
      params.push(term, term, term);
    }

    query += ' ORDER BY submission_date DESC, created_at DESC';
    const rows = this.db.prepare(query).all(...params);
    return rows.map(r => this._hydrateKycRequest(r));
  }

  getKycRequestById(id) {
    const row = this.db.prepare('SELECT * FROM kyc_requests WHERE id = ?').get(id);
    return row ? this._hydrateKycRequest(row) : null;
  }

  getKycRequestByDdqToken(token) {
    if (!token) return null;
    const row = this.db.prepare('SELECT * FROM kyc_requests WHERE ddq_token = ?').get(token);
    return row ? this._hydrateKycRequest(row) : null;
  }

  updateKycRequestStatus(id, status, lastModifiedBy = 'Compliance Officer') {
    this.db.prepare(`
      UPDATE kyc_requests
      SET request_status = ?, last_modified_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, lastModifiedBy, id);
    return this.getKycRequestById(id);
  }

  updateDdqSubmission(id, { responses = {}, reScreeningResult = '', complianceNotes = '' } = {}) {
    this.db.prepare(`
      UPDATE kyc_requests
      SET ddq_responses_json = ?,
          ddq_submitted_at = CURRENT_TIMESTAMP,
          request_status = 'DDQ Under Review',
          ddq_status = 'Under Review',
          re_screening_result = ?,
          compliance_notes = ?,
          last_modified_by = 'Counterparty (DDQ Portal)',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      JSON.stringify(responses),
      reScreeningResult || 'DDQ Submitted - Awaiting Compliance Review',
      complianceNotes || 'Counterparty completed mandatory due diligence questionnaire.',
      id
    );
    return this.getKycRequestById(id);
  }

  updateKycDecision(id, { status, notes = '', reviewer = 'Compliance Officer', ddqStatus = null }) {
    this.db.prepare(`
      UPDATE kyc_requests
      SET request_status = ?,
          compliance_notes = ?,
          last_modified_by = ?,
          ddq_status = COALESCE(?, ddq_status),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, notes, reviewer, ddqStatus, id);
    return this.getKycRequestById(id);
  }

  // ---------------------------------------------------------------------
  // DDQ templates, drafts and translation cache
  // ---------------------------------------------------------------------
  _hydrateDdqTemplate(row, withBody = true) {
    if (!row) return null;
    const { template_json, ...meta } = row;
    const out = { ...meta, is_active: Boolean(row.is_active) };
    if (withBody) {
      try { out.template = JSON.parse(template_json); } catch (e) { out.template = null; }
    }
    return out;
  }

  listDdqTemplates() {
    return this.db.prepare('SELECT * FROM ddq_templates ORDER BY is_active DESC, updated_at DESC').all()
      .map(row => {
        const t = this._hydrateDdqTemplate(row);
        const sections = (t.template && t.template.sections) || [];
        return {
          id: t.id, name: t.name, is_active: t.is_active, source_filename: t.source_filename,
          updated_by: t.updated_by, created_at: t.created_at, updated_at: t.updated_at,
          section_count: sections.length,
          question_count: sections.reduce((n, s) => n + (s.questions || []).length, 0)
        };
      });
  }

  getDdqTemplate(id) {
    return this._hydrateDdqTemplate(this.db.prepare('SELECT * FROM ddq_templates WHERE id = ?').get(id));
  }

  getActiveDdqTemplate() {
    return this._hydrateDdqTemplate(this.db.prepare('SELECT * FROM ddq_templates WHERE is_active = 1 LIMIT 1').get());
  }

  nextDdqTemplateId() {
    const rows = this.db.prepare('SELECT id FROM ddq_templates').all();
    const max = rows.reduce((m, r) => Math.max(m, parseInt((r.id.match(/(\d+)$/) || [0, 0])[1], 10) || 0), 0);
    return `TPL-${String(max + 1).padStart(4, '0')}`;
  }

  saveDdqTemplate({ id, name, source_filename = '', template, updated_by = 'Compliance Officer' }) {
    const tplId = id || this.nextDdqTemplateId();
    const existing = this.db.prepare('SELECT id FROM ddq_templates WHERE id = ?').get(tplId);
    if (existing) {
      this.db.prepare(`
        UPDATE ddq_templates SET name = ?, template_json = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(name, JSON.stringify(template), updated_by, tplId);
    } else {
      this.db.prepare(`
        INSERT INTO ddq_templates (id, name, is_active, source_filename, template_json, updated_by) VALUES (?, ?, 0, ?, ?, ?)
      `).run(tplId, name, source_filename, JSON.stringify(template), updated_by);
    }
    return this.getDdqTemplate(tplId);
  }

  activateDdqTemplate(id) {
    if (!this.db.prepare('SELECT id FROM ddq_templates WHERE id = ?').get(id)) return null;
    this.db.exec('UPDATE ddq_templates SET is_active = 0');
    this.db.prepare('UPDATE ddq_templates SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    return this.getDdqTemplate(id);
  }

  deleteDdqTemplate(id) {
    return this.db.prepare('DELETE FROM ddq_templates WHERE id = ? AND is_active = 0').run(id).changes > 0;
  }

  getKycDdqBundle(id) {
    const row = this.db.prepare('SELECT ddq_template_json, ddq_draft_json FROM kyc_requests WHERE id = ?').get(id);
    if (!row) return null;
    const parse = v => { try { return v ? JSON.parse(v) : null; } catch (e) { return null; } };
    return { template: parse(row.ddq_template_json), draft: parse(row.ddq_draft_json) };
  }

  setKycDdqTemplate(id, template) {
    this.db.prepare('UPDATE kyc_requests SET ddq_template_json = ? WHERE id = ?').run(JSON.stringify(template), id);
  }

  setKycAgent(id, agent) {
    this.db.prepare('UPDATE kyc_requests SET agent_json = ? WHERE id = ?').run(agent ? JSON.stringify(agent) : null, id);
  }

  setKycDdqBounce(id, bounce) {
    this.db.prepare('UPDATE kyc_requests SET ddq_bounce_json = ? WHERE id = ?').run(bounce ? JSON.stringify(bounce) : null, id);
  }

  setKycDdqResponses(id, responses) {
    this.db.prepare('UPDATE kyc_requests SET ddq_responses_json = ? WHERE id = ?').run(JSON.stringify(responses || {}), id);
  }

  saveKycDdqDraft(id, draft) {
    this.db.prepare('UPDATE kyc_requests SET ddq_draft_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(JSON.stringify(draft || {}), id);
  }

  getDdqTranslation(cacheKey) {
    const row = this.db.prepare('SELECT payload_json FROM ddq_translations WHERE cache_key = ?').get(cacheKey);
    try { return row ? JSON.parse(row.payload_json) : null; } catch (e) { return null; }
  }

  saveDdqTranslation(cacheKey, language, payload) {
    this.db.prepare('INSERT OR REPLACE INTO ddq_translations (cache_key, language, payload_json) VALUES (?, ?, ?)')
      .run(cacheKey, language, JSON.stringify(payload));
  }

  markKycDdqSent(id, sentBy = 'Employee Portal') {
    this.db.prepare(`
      UPDATE kyc_requests
      SET ddq_status = 'Sent to Counterparty',
          last_modified_by = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(sentBy, id);
    return this.getKycRequestById(id);
  }

  _hydrateKycRequest(r) {
    let attributes = {};
    let location = {};
    let attachments = [];
    let ddq_responses = {};
    try { attributes = JSON.parse(r.attributes_json || '{}'); } catch(e){}
    try { location = JSON.parse(r.location_json || '{}'); } catch(e){}
    try { attachments = JSON.parse(r.attachments_json || '[]'); } catch(e){}
    try { ddq_responses = JSON.parse(r.ddq_responses_json || '{}'); } catch(e){}

    // Template snapshot and draft are large; they are served by getKycDdqBundle() instead
    const { ddq_template_json, ddq_draft_json, agent_json, ddq_bounce_json, monitoring_json, ...rest } = r;
    r = rest;
    let agent = null;
    let ddq_bounce = null;
    try { agent = agent_json ? JSON.parse(agent_json) : null; } catch(e){}
    try { ddq_bounce = ddq_bounce_json ? JSON.parse(ddq_bounce_json) : null; } catch(e){}
    let monitoring = null;
    try { monitoring = monitoring_json ? JSON.parse(monitoring_json) : null; } catch(e){}

    return {
      ...r,
      ongoing_monitoring: Boolean(r.ongoing_monitoring),
      ddq_required: Boolean(r.ddq_required),
      attributes,
      location,
      attachments,
      ddq_responses,
      agent,
      ddq_bounce,
      monitoring,
      ddq_link: r.ddq_token ? `/ddq/portal?token=${r.ddq_token}` : null
    };
  }

  close() {
    try {
      this.db.close();
    } catch (e) {}
  }
}

module.exports = SqliteDatabase;


