const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db');
const { officerOnly } = require('../middleware/auth');

// GET /api/uploads - list all uploaded files (officer only)
router.get('/', officerOnly, (req, res) => {
  const db = getDb();
  const { entity_id } = req.query;
  const files = db.getUploadedFiles(entity_id || null);
  res.json({
    total: files.length,
    uploads: files
  });
});

// GET /api/uploads/:id - get file metadata and content (officer only)
router.get('/:id', officerOnly, (req, res) => {
  const db = getDb();
  const file = db.getUploadedFileById(req.params.id);
  if (!file) {
    return res.status(404).json({ error: 'Uploaded file not found' });
  }
  res.json(file);
});

// GET /api/uploads/:id/download - download actual stored file
router.get('/:id/download', (req, res) => {
  const db = getDb();
  let file = db.getUploadedFileById(req.params.id);
  if (!file && db.getUploadedFiles) {
    file = db.getUploadedFiles().find(u => u.id === req.params.id || u.filename === req.params.id);
  }
  if (!file) {
    return res.status(404).json({ error: 'Uploaded file not found' });
  }

  const filename = file.filename || 'document.pdf';
  const safeFilename = path.basename(filename).replace(/["\r\n]/g, '_');
  const mimeType = file.mime_type || (filename.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');

  if (file.storage_path && fs.existsSync(file.storage_path)) {
    return res.download(file.storage_path, filename);
  }

  // Fallback to content_data if storage_path file is absent on disk
  if (file.content_data) {
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Content-Type', mimeType);

    if (typeof file.content_data === 'string' && file.content_data.startsWith('data:')) {
      const parts = file.content_data.split(',');
      const buffer = Buffer.from(parts[1] || '', 'base64');
      return res.send(buffer);
    } else {
      const buffer = Buffer.isBuffer(file.content_data)
        ? file.content_data
        : Buffer.from(file.content_data, typeof file.content_data === 'string' ? 'utf8' : undefined);
      return res.send(buffer);
    }
  }

  res.status(404).json({ error: 'File content not available' });
});

// POST /api/uploads - direct upload endpoint (officer only)
router.post('/', officerOnly, (req, res) => {
  const { entity_id, file_type, filename, file_size, mime_type, content_data, parsed_records } = req.body;
  if (!filename || !file_type) {
    return res.status(400).json({ error: 'Fields "filename" and "file_type" are required' });
  }

  const db = getDb();
  const file = db.addUploadedFile({
    entity_id,
    file_type,
    filename,
    file_size: file_size || 0,
    mime_type: mime_type || (file_type === 'custom_policy' ? 'application/pdf' : 'text/csv'),
    content_data: content_data || '',
    parsed_records: parsed_records || 1
  });

  res.status(201).json({
    status: 'stored',
    file
  });
});

module.exports = router;
