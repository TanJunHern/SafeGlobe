const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

/**
 * Phase 2: Claim Organisation Profile (PRD 2.1)
 * POST /api/claim
 * Body: { id: "severny", email: "compliance@company.com", signatory: "Name", role: "..." }
 */
router.post('/', (req, res) => {
  const { id, email, signatory, role } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Field "id" is required' });
  }

  const db = getDb();
  const entity = db.getEntityById(id);
  if (!entity) {
    return res.status(404).json({ error: 'Entity not found' });
  }

  const updated = db.claimProfile(id, email || '', signatory || 'Corporate Representative', role || '');

  // Log alert for watching screeners
  db.addAlert(
    'Truth check',
    id,
    `${entity.short || entity.name}: profile claimed by ${signatory || 'authorized officer'} after corporate verification`,
    'investigate'
  );

  res.json({
    status: 'claimed',
    entity: updated,
    message: `Profile successfully verified and claimed for ${entity.short || entity.name}`
  });
});

module.exports = router;
