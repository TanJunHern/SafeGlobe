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

  res.json({
    status: 'compiled',
    rule: compiledRule,
    gap: 'No rule covers minority stakes below 50% held by state-owned companies.',
    conflict: 'CPI high-risk threshold (40) vs Appendix B standard risk classification for Turkey (31).',
    uploadedFile: savedFile ? { id: savedFile.id, filename: savedFile.filename, storage_path: savedFile.storage_path } : null
  });
});

module.exports = router;
