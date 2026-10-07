const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

// GET /api/stats
router.get('/', (req, res) => {
  const db = getDb();
  const entities = db.getAllEntities();
  const cases = db.getCases();
  const alerts = db.getAlerts();

  const orgs = entities.filter(e => e.kind === 'org');
  const vessels = entities.filter(e => e.kind === 'vessel');
  const people = entities.filter(e => e.kind === 'person');

  const openCases = cases.filter(c => c.quadrant !== 'monitor');
  const escalated = cases.filter(c => c.quadrant === 'escalate');

  res.json({
    kpis: {
      monitored: {
        total: 1284,
        orgs: orgs.length,
        people: people.length,
        vessels: vessels.length
      },
      openReviews: {
        total: openCases.length,
        escalated: escalated.length,
        ddqsOut: 12
      },
      autoCleared7Days: 2912,
      sampleCheckError: '0.3%',
      medianAlertTime: '11 min'
    },
    calibration: [
      { band: 'High', threshold: '≥ 85%', upheldRate: 97.4, target: 95, sampleCount: 1906, autoClearEligible: true },
      { band: 'Medium', threshold: '60–84%', upheldRate: 83.1, sampleCount: 712, autoClearEligible: false },
      { band: 'Low', threshold: '< 60%', upheldRate: 61.8, sampleCount: 288, autoClearEligible: false }
    ],
    countryRisk: db.getCpiScores()
  });
});

module.exports = router;
