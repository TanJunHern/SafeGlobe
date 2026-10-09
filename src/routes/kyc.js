const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const kycService = require('../services/kycService');
const { authenticate, requireRole } = require('../middleware/auth');
const complianceAgent = require('../agents/complianceAgent');

// Mount auth middleware across KYC routes
router.use(authenticate);

// Row-level scoping: a signed-in employee only ever sees their own rows.
// Requests carrying no identity at all (legacy API callers) keep the unscoped view.
function isScopedEmployee(req) {
  return req.user.role === 'employee' && !req.user.anonymous;
}

/**
 * GET /api/kyc/my-requests
 * Employee scoped requests: strictly filtered by session email (WHERE created_by_email == session.email)
 */
router.get('/my-requests', (req, res) => {
  try {
    const db = getDb();
    const filter = {
      status: req.query.status || 'all',
      entity_type: req.query.entity_type || 'all',
      search: req.query.search || '',
      created_by_email: req.user.email
    };
    const requests = db.getAllKycRequests(filter);
    res.json({
      success: true,
      scoped_user: req.user.email,
      count: requests.length,
      requests
    });
  } catch (err) {
    console.error('Error fetching employee KYC requests:', err);
    res.status(500).json({ error: 'Failed to retrieve employee requests', message: err.message });
  }
});

/**
 * GET /api/kyc
 * Global / triage view for Compliance Officers, with optional scope filter
 */
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const scope = req.query.scope;
    const filter = {
      status: req.query.status || 'all',
      entity_type: req.query.entity_type || 'all',
      search: req.query.search || ''
    };

    if (scope === 'my' || isScopedEmployee(req)) {
      filter.created_by_email = req.user.email;
    }

    const requests = db.getAllKycRequests(filter);
    res.json({
      success: true,
      user_role: req.user.role,
      count: requests.length,
      requests
    });
  } catch (err) {
    console.error('Error fetching KYC requests:', err);
    res.status(500).json({ error: 'Failed to retrieve KYC requests', message: err.message });
  }
});

/**
 * GET /api/kyc/export-excel
 * Streams real Microsoft Excel (.xlsx) file with visible data + hidden audit trail
 */
router.get('/export-excel', async (req, res) => {
  try {
    const db = getDb();
    const filter = {
      status: req.query.status || 'all',
      entity_type: req.query.entity_type || 'all',
      search: req.query.search || ''
    };
    if (req.query.scope === 'my' || isScopedEmployee(req)) {
      filter.created_by_email = req.user.email;
    }

    const requests = db.getAllKycRequests(filter);
    const workbook = await kycService.generateKycExcelWorkbook(requests);

    const filename = `SafeGlobe_KYC_Requests_${new Date().toISOString().substring(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Error streaming Excel workbook:', err);
    res.status(500).json({ error: 'Failed to export Excel file', message: err.message });
  }
});

/**
 * GET /api/kyc/export
 * Backwards-compatible CSV export with UTF-8 BOM
 */
router.get('/export', (req, res) => {
  try {
    const db = getDb();
    const filter = {
      status: req.query.status || 'all',
      entity_type: req.query.entity_type || 'all',
      search: req.query.search || ''
    };
    if (req.query.scope === 'my' || isScopedEmployee(req)) {
      filter.created_by_email = req.user.email;
    }

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
 * Multimodal file extraction via Gemini 2.5 Flash
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
 * Retrieve specific KYC request by ID
 */
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const request = db.getKycRequestById(req.params.id);
    if (!request) {
      return res.status(404).json({ error: 'KYC request not found' });
    }
    if (isScopedEmployee(req) && (request.created_by_email || '').toLowerCase() !== req.user.email) {
      return res.status(403).json({ error: 'Access denied', message: 'Employees can only view their own KYC requests' });
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
 * GET /api/kyc/:id/ddq
 * Questionnaire snapshot + counterparty answers, for the review drawer and the PDF copy
 */
router.get('/:id/ddq', (req, res) => {
  try {
    const db = getDb();
    const request = db.getKycRequestById(req.params.id);
    if (!request) {
      return res.status(404).json({ error: 'KYC request not found' });
    }
    if (isScopedEmployee(req) && (request.created_by_email || '').toLowerCase() !== req.user.email) {
      return res.status(403).json({ error: 'Access denied', message: 'Employees can only view DDQs for their own requests' });
    }
    const bundle = db.getKycDdqBundle(request.id) || {};
    const submitted = Object.keys(request.ddq_responses || {}).length > 0;
    res.json({
      success: true,
      submitted,
      request: {
        id: request.id,
        counterparty_name: request.counterparty_name,
        counterparty_email: request.counterparty_email,
        entity_type: request.entity_type,
        country: request.country,
        request_status: request.request_status,
        ddq_status: request.ddq_status,
        ddq_clause: request.ddq_clause,
        submitted_at: request.ddq_submitted_at || null
      },
      template: bundle.template,
      responses: submitted ? request.ddq_responses : null
    });
  } catch (err) {
    console.error('Error fetching DDQ document:', err);
    res.status(500).json({ error: 'Failed to retrieve DDQ', message: err.message });
  }
});

/**
 * GET /api/kyc/:id/ddq/documents/:index
 * Downloads a supporting document the counterparty attached to its DDQ
 */
router.get('/:id/ddq/documents/:index', async (req, res) => {
  try {
    const db = getDb();
    const request = db.getKycRequestById(req.params.id);
    if (!request) {
      return res.status(404).json({ error: 'KYC request not found' });
    }
    if (isScopedEmployee(req) && (request.created_by_email || '').toLowerCase() !== req.user.email) {
      return res.status(403).json({ error: 'Access denied', message: 'Employees can only view documents for their own requests' });
    }
    const doc = ((request.ddq_responses || {}).documents || {})[req.params.index];
    const buffer = doc && doc.key
      ? await require('../services/documentStorage').readDdqDocument({ kycId: request.id, key: doc.key })
      : null;
    if (!buffer) {
      return res.status(404).json({ error: 'Document not found' });
    }
    res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${String(doc.filename || 'document').replace(/"/g, '')}"`);
    res.send(buffer);
  } catch (err) {
    console.error('Error downloading DDQ document:', err);
    res.status(500).json({ error: 'Failed to download document', message: err.message });
  }
});

/**
 * POST /api/kyc and POST /api/kyc/submit
 * Create and submit KYC request with automated Policy RAG check and signed DDQ link
 */
const submitKycHandler = async (req, res) => {
  try {
    const userContext = {
      userId: req.user.userId || 'EMP-1042',
      email: req.user.email || 'john.doe@safeglobe.com',
      department: req.user.department || 'Procurement & Logistics',
      ip: req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1',
      clientTimestamp: req.headers['x-client-timestamp'] || new Date().toISOString()
    };

    const created = kycService.createKycRequest(req.body, userContext);
    // Compliance Agent: intake scoring + investigation (stored now, model-written detail follows)
    const agent = await complianceAgent.runIntake(created.id, { enrich: 'background' }).catch(err => {
      console.error('Compliance Agent intake failed:', err.message);
      return null;
    });
    const newRequest = Object.assign({}, created, { agent });
    res.status(201).json({
      success: true,
      message: 'KYC Request registered successfully',
      request: newRequest
    });
  } catch (err) {
    console.error('Error creating KYC request:', err);
    res.status(400).json({ error: 'Failed to create KYC request', message: err.message });
  }
};

router.post('/', submitKycHandler);
router.post('/submit', submitKycHandler);

/**
 * POST /api/kyc/:id/triage
 * Compliance officer one-click triage: Approve, Reject, or Request More Info
 */
const TRIAGE_STATUS = {
  'Approve': 'Approved',
  'Reject': 'Rejected',
  'Bounce Back': 'Pending DDQ',
  'Request More Info': 'Pending DDQ',
  'Request Info': 'Pending DDQ'
};

router.post('/:id/triage', requireRole('compliance_officer'), (req, res) => {
  try {
    const { action, notes = '' } = req.body;
    const status = TRIAGE_STATUS[action];
    if (!status) {
      return res.status(400).json({ error: 'Action is required (Approve, Reject, Bounce Back)' });
    }

    const db = getDb();
    const existing = db.getKycRequestById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'KYC request not found' });
    }

    const reviewer = `${req.user.name} (Compliance Officer)`;
    const bouncing = status === 'Pending DDQ';
    if (bouncing && !existing.ddq_link) {
      return res.status(400).json({ error: 'This request has no questionnaire to send back' });
    }

    // Bouncing re-opens the questionnaire with the points to clarify; approval closes it out
    let ddqStatus = null;
    if (bouncing) ddqStatus = 'Returned to Counterparty';
    else if (existing.ddq_required && status === 'Approved' && existing.ddq_status === 'Under Review') ddqStatus = 'Completed';

    if (bouncing) {
      const bundle = db.getKycDdqBundle(existing.id) || {};
      const validIds = new Set(((bundle.template && bundle.template.sections) || []).flatMap(s => s.questions.map(q => q.id)).concat('documents'));
      const issues = (Array.isArray(req.body.issues) ? req.body.issues : [])
        .map(i => ({ question_id: String((i && i.question_id) || '').slice(0, 24), note: String((i && i.note) || '').trim().slice(0, 600) }))
        .filter(i => validIds.has(i.question_id) && i.note);
      const round = ((existing.ddq_responses && existing.ddq_responses.bounce_history) || []).length + 1;
      db.setKycDdqBounce(existing.id, { round, note: String(notes).trim().slice(0, 1200), issues, by: reviewer, at: new Date().toISOString() });
      // The counterparty continues from the answers they already gave
      if (existing.ddq_responses && existing.ddq_responses.format === 'template-v1') {
        const { ubo_list, pep_declared, litigation_declared, sanctions_declared, conflict_declared, yes_answers, ...draft } = existing.ddq_responses;
        db.saveKycDdqDraft(existing.id, draft);
      }
    }

    const updated = db.updateKycDecision(req.params.id, {
      status,
      notes,
      reviewer,
      ddqStatus
    });
    // Approved + Ongoing Monitoring pins the counterparty on the globe; anything else removes it
    kycService.syncMonitoredEntity(updated);

    res.json({
      success: true,
      message: `KYC request updated to ${status}`,
      request: updated
    });
  } catch (err) {
    console.error('Error triaging KYC request:', err);
    res.status(500).json({ error: 'Failed to triage KYC request', message: err.message });
  }
});

/**
 * POST /api/kyc/:id/agent/run   { stage: 'intake' | 'ddq_review' }
 * Re-runs the Compliance Agent for a request and waits for the full (model-assisted) result
 */
router.post('/:id/agent/run', requireRole('compliance_officer'), async (req, res) => {
  try {
    const db = getDb();
    if (!db.getKycRequestById(req.params.id)) {
      return res.status(404).json({ error: 'KYC request not found' });
    }
    const stage = req.body && req.body.stage;
    if (stage !== 'ddq_review') await complianceAgent.runIntake(req.params.id);
    if (stage !== 'intake') await complianceAgent.runDdqReview(req.params.id);
    res.json({ success: true, agent: db.getKycRequestById(req.params.id).agent });
  } catch (err) {
    console.error('Error running Compliance Agent:', err);
    res.status(500).json({ error: 'Compliance Agent failed', message: err.message });
  }
});

/**
 * POST /api/kyc/:id/send-ddq
 * Dispatches the signed one-time DDQ guest link to the counterparty
 */
router.post('/:id/send-ddq', (req, res) => {
  try {
    const db = getDb();
    const existing = db.getKycRequestById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'KYC request not found' });
    }
    if (isScopedEmployee(req) && (existing.created_by_email || '').toLowerCase() !== req.user.email) {
      return res.status(403).json({ error: 'Access denied', message: 'Employees can only dispatch DDQs for their own requests' });
    }
    if (!existing.ddq_required || !existing.ddq_link) {
      return res.status(400).json({ error: 'No DDQ is required for this request' });
    }

    const updated = existing.ddq_status === 'Triggered'
      ? db.markKycDdqSent(existing.id, req.user.name)
      : existing;

    res.json({
      success: true,
      message: `DDQ link dispatched to ${updated.counterparty_email || 'counterparty'}`,
      ddq_link: updated.ddq_link,
      request: updated
    });
  } catch (err) {
    console.error('Error dispatching DDQ link:', err);
    res.status(500).json({ error: 'Failed to dispatch DDQ link', message: err.message });
  }
});

/**
 * PATCH /api/kyc/:id/status
 * Update status of KYC request
 */
router.patch('/:id/status', (req, res) => {
  try {
    const { status, last_modified_by, notes } = req.body;
    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }
    const db = getDb();
    const modifier = last_modified_by || req.user.name || 'Compliance Officer';
    const updated = notes
      ? db.updateKycDecision(req.params.id, { status, notes, reviewer: modifier })
      : db.updateKycRequestStatus(req.params.id, status, modifier);

    if (!updated) {
      return res.status(404).json({ error: 'KYC request not found' });
    }
    kycService.syncMonitoredEntity(updated);
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
