const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db');

// GET /api/uploads - list all uploaded files
router.get('/', (req, res) => {
  const db = getDb();
  const { entity_id } = req.query;
  const files = db.getUploadedFiles(entity_id || null);
  res.json({
    total: files.length,
    uploads: files
  });
});

// GET /api/uploads/:id - get file metadata and content
router.get('/:id', (req, res) => {
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
  const file = db.getUploadedFileById(req.params.id);
  if (!file) {
    return res.status(404).json({ error: 'Uploaded file not found' });
  }

  if (file.storage_path && fs.existsSync(file.storage_path)) {
    return res.download(file.storage_path, file.filename);
  }

  // Fallback to content_data if storage_path file is absent
  if (file.content_data) {
    if (file.content_data.startsWith('data:')) {
      const parts = file.content_data.split(',');
      const buffer = Buffer.from(parts[1], 'base64');
      res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
      res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
      return res.send(buffer);
    } else {
      res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.send(file.content_data);
    }
  }

  res.status(404).json({ error: 'File content not available' });
});

// POST /api/uploads - direct upload endpoint
router.post('/', (req, res) => {
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
