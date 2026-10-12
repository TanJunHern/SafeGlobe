/**
 * Puts the built-in demo findings back on the demo cases (Aurora Venture and the others), in the local demo database.
 * A live Pond-Guard run replaces a case's findings with what the agents found; this restores the starting point
 * so a scene can be recorded again.
 *   DATABASE_PATH=demovideo/.data/demo.db node demovideo/reset-demo-findings.js
 */
const { getDb } = require('../src/db');
const riskService = require('../src/risk/riskService');
const db = getDb();
db.setSetting('risk_demo_findings_version', 0);
const changed = riskService.ensureDemoFindings(db);
console.log(JSON.stringify({ restored: changed.length, aurora: (riskService.assessEntity(db, 'aurora') || {}).risk }));
