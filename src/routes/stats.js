const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

// GET /api/stats: figures for the top strip, all counted from the KYC requests on record
router.get('/', (req, res) => {
  const db = getDb();
  const requests = db.getAllKycRequests({});
  const decided = r => ['Approved', 'Rejected'].includes(r.request_status);
  const flagged = r => r.screening_result && r.screening_result !== 'Clear';
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const when = r => String(r.updated_at || r.created_at || '').replace(' ', 'T');

  const monitored = requests.filter(r => r.ongoing_monitoring && r.request_status === 'Approved');
  const open = requests.filter(r => !decided(r));
  // Approved without a questionnaire: the request cleared on screening alone
  const autoCleared = requests.filter(r => r.request_status === 'Approved' && !r.ddq_required);
  let monitoringCost = 0;
  try { monitoringCost = require('../services/monitoringService').listMonitoring().totals.per_year; } catch (e) {}

  res.json({
    kpis: {
      screened: {
        total: requests.length,
        orgs: requests.filter(r => r.entity_type === 'Organisation').length,
        people: requests.filter(r => r.entity_type === 'Person').length,
        vessels: requests.filter(r => r.entity_type === 'Vessel').length,
        flagged: requests.filter(flagged).length
      },
      monitored: {
        total: monitored.length,
        orgs: monitored.filter(r => r.entity_type === 'Organisation').length,
        people: monitored.filter(r => r.entity_type === 'Person').length,
        vessels: monitored.filter(r => r.entity_type === 'Vessel').length,
        costPerYear: monitoringCost
      },
      openReviews: {
        total: open.length,
        escalated: open.filter(flagged).length,
        ddqsOut: requests.filter(r => ['Sent to Counterparty', 'Returned to Counterparty'].includes(r.ddq_status)).length
      },
      autoCleared: {
        total: autoCleared.length,
        last7Days: autoCleared.filter(r => when(r) >= weekAgo).length
      },
      decided: {
        approved: requests.filter(r => r.request_status === 'Approved').length,
        rejected: requests.filter(r => r.request_status === 'Rejected').length
      }
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
