const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const kycService = require('../services/kycService');

/**
 * GET /api/kyc
 * List all submitted KYC requests with optional query filters:
 * - status (e.g. 'all', 'Pending DDQ', 'Approved', 'Submitted')
 * - entity_type (e.g. 'all', 'Organisation', 'Vessel', 'Person')
 * - search (searches counterparty_name, id, country)
 */
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const filter = {
      status: req.query.status || 'all',
      entity_type: req.query.entity_type || 'all',
      search: req.query.search || ''
    };
    const requests = db.getAllKycRequests(filter);
    res.json({
      success: true,
      count: requests.length,
      requests
    });
  } catch (err) {
    console.error('Error fetching KYC requests:', err);
    res.status(500).json({ error: 'Failed to retrieve KYC requests', message: err.message });
  }
});

/**
 * GET /api/kyc/export
 * Section 5: Export to Excel (.xlsx / CSV with UTF-8 BOM)
 * Downloads all matching records with both visible table columns and hidden audit trail.
 */
router.get('/export', (req, res) => {
  try {
    const db = getDb();
    const filter = {
      status: req.query.status || 'all',
      entity_type: req.query.entity_type || 'all',
      search: req.query.search || ''
    };
    const requests = db.getAllKycRequests(filter);
    const csvContent = kycService.exportKycCsv(requests);

    const filename = `SafeGlobe_KYC_Requests_${new Date().toISOString().substring(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);
  } catch (err) {
    console.error('Error exporting KYC requests:', err);
    res.status(500).json({ error: 'Failed to export KYC requests', message: err.message });
  }
});

/**
 * POST /api/kyc/extract-document
 * Point A: Document Auto-Fill (Multimodal Extraction)
 * Analyzes uploaded business file and returns structured attributes for human verification.
 */
router.post('/extract-document', async (req, res) => {
  try {
    const { filename, fileContent, mimeType, base64Data } = req.body;
    const result = await kycService.extractDocumentData({
      filename: filename || 'corporate_profile.pdf',
      fileContent: fileContent || '',
      mimeType: mimeType || 'application/pdf',
      base64Data: base64Data || ''
    });

    res.json(result);
  } catch (err) {
    console.error('Error extracting KYC document:', err);
    res.status(500).json({ error: 'Failed to extract document', message: err.message });
  }
});

/**
 * GET /api/kyc/:id
 * Retrieve a specific KYC request by ID
 */
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const request = db.getKycRequestById(req.params.id);
    if (!request) {
      return res.status(404).json({ error: 'KYC request not found' });
    }
    res.json({
      success: true,
      request
    });
  } catch (err) {
    console.error('Error retrieving KYC request:', err);
    res.status(500).json({ error: 'Failed to retrieve KYC request', message: err.message });
  }
});

/**
 * POST /api/kyc
 * Create and submit a new KYC Request with automated Policy RAG & AI screening
 */
router.post('/', async (req, res) => {
  try {
    // Derive user audit context from session / headers
    const userContext = {
      userId: req.headers['x-user-id'] || 'EMP-1042',
      email: req.headers['x-user-email'] || 'sarah.tan@safeglobe.internal',
      department: req.headers['x-user-department'] || 'Procurement & Supply Chain',
      ip: req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1',
      clientTimestamp: req.headers['x-client-timestamp'] || new Date().toISOString()
    };

    const newRequest = kycService.createKycRequest(req.body, userContext);
    res.status(201).json({
      success: true,
      message: 'KYC Request registered successfully',
      request: newRequest
    });
  } catch (err) {
    console.error('Error creating KYC request:', err);
    res.status(400).json({ error: 'Failed to create KYC request', message: err.message });
  }
});

/**
 * PATCH /api/kyc/:id/status
 * Update status of KYC request (e.g. Approved, Rejected, Pending DDQ)
 */
router.patch('/:id/status', (req, res) => {
  try {
    const { status, last_modified_by } = req.body;
    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }
    const db = getDb();
    const updated = db.updateKycRequestStatus(req.params.id, status, last_modified_by || 'Compliance Officer');
    if (!updated) {
      return res.status(404).json({ error: 'KYC request not found' });
    }
    res.json({
      success: true,
      message: `KYC Request updated to ${status}`,
      request: updated
    });
  } catch (err) {
    console.error('Error updating KYC request status:', err);
    res.status(500).json({ error: 'Failed to update KYC request', message: err.message });
  }
});

module.exports = router;
