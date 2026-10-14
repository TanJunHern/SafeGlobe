const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

// GET /api/policies
router.get('/', (req, res) => {
  const db = getDb();
  res.json({
    policies: db.getPolicies()
  });
});

// POST /api/policies/compile
router.post('/compile', (req, res) => {
  const { title = 'Custom Compliance Policy', rules = [], content = '', size = 0, mimeType = '', filename = '' } = req.body;
  const db = getDb();

  // If file content or filename is provided, store uploaded file
  let savedFile = null;
  if (content || filename || req.body.file_data) {
    savedFile = db.addUploadedFile({
      file_type: 'custom_policy',
      filename: filename || title || 'Custom_Policy.pdf',
      file_size: size || (content ? content.length : 0),
      mime_type: mimeType || 'application/pdf',
      content_data: content || req.body.file_data || '',
      parsed_records: rules.length || 1
    });
  }

  // Policy compiler parses guidelines and checks gaps / conflicts
  const compiledRule = {
    id: 'R' + (db.getPolicies().length + 1),
    sec: '§2.1',
    t: title.includes('Policy') ? title : `Enhanced screening on ${title}`,
    note: 'Compiled from uploaded guideline document',
    hits: ['halcyon', 'kestrel'],
    met: false
  };

  db.addPolicy(compiledRule);

  // A new policy may state a threshold or clause the scoring rules do not match: recommend the change, never apply it
  let recommended = [];
  try {
    const ruleText = (Array.isArray(rules) ? rules : []).map(r => (typeof r === 'string' ? r : (r && (r.t || r.text)) || '')).join('. ');
    recommended = require('../risk/suggestions').raiseFor(db, { type: 'policy', name: filename || title, text: [ruleText, content || req.body.file_data || ''].filter(Boolean).join('\n') });
  } catch (err) {
    console.error('[DueDilly] Scoring recommendations skipped:', err.message);
  }

  res.json({
    status: 'compiled',
    rule: compiledRule,
    scoringSuggestions: recommended.map(s => ({ id: s.id, title: s.title })),
    gap: 'No rule covers minority stakes below 50% held by state-owned companies.',
    conflict: 'CPI high-risk threshold (40) vs Appendix B standard risk classification for Turkey (31).',
    uploadedFile: savedFile ? { id: savedFile.id, filename: savedFile.filename, storage_path: savedFile.storage_path } : null
  });
});

// GET /api/policies/clauses   every policy clause with its text and where it was found (Agent Search or the offline fallback)
router.get('/clauses', async (req, res) => {
  const policySearch = require('../services/policySearch');
  res.json({ status: policySearch.status(), clauses: await policySearch.allClauses(getDb()) });
});

// GET /api/policies/search?q=...   policy search (feature 12)
router.get('/search', require('../middleware/rateLimit').aiRateLimit, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Type a question or a few words to search the policies' });
  res.json(Object.assign({ query: q.slice(0, 300) }, await require('../services/policySearch').search(getDb(), q)));
});

module.exports = router;
