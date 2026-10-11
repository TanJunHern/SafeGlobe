/**
 * Settings: the accounts of a workspace. Compliance officers only (checked in server.js for the whole router).
 */
const express = require('express');
const router = express.Router();
const config = require('../config');
const accounts = require('../accounts/accountsService');

const fail = (res, err) => {
  if (!err.status) console.error('[Settings]', err);
  res.status(err.status || 500).json({ error: err.status ? 'Not done' : 'Request failed', code: err.code || null, message: err.status ? err.message : 'Please try again.' });
};

// Where an invited person goes to sign in. The invitation itself is matched by their Google email, not by the link.
const inviteLink = (req, email) => `${config.publicBaseUrl || `${req.protocol}://${req.get('host')}`}/login?invite=${encodeURIComponent(email)}`;

// GET /api/settings/accounts   the accounts, the change log, and what this workspace allows
router.get('/accounts', (req, res) => {
  const data = accounts.listForWorkspace(req.user.workspace.id);
  res.json(Object.assign(data, {
    accounts: data.accounts.map(a => Object.assign(a, { isYou: a.id === req.user.accountId, inviteLink: a.status === 'invited' ? inviteLink(req, a.email) : null })),
    deleteAllowed: !req.user.workspace.isDemo,
    deleteNote: req.user.workspace.isDemo ? accounts.NOT_IN_DEMO : '',
    roles: accounts.ROLES
  }));
});

// POST /api/settings/invites   { email }   always as Employee
router.post('/invites', async (req, res) => {
  try {
    const email = String((req.body && req.body.email) || '');
    res.status(201).json(Object.assign({ success: true }, await accounts.invite(req.user, email, inviteLink(req, email.toLowerCase().trim()))));
  } catch (err) { fail(res, err); }
});

router.post('/invites/:id/resend', async (req, res) => {
  try {
    const target = require('../accounts/accountsStore').getAccountsStore().getAccountById(req.params.id);
    res.json(Object.assign({ success: true }, await accounts.resendInvite(req.user, req.params.id, inviteLink(req, target ? target.email : ''))));
  } catch (err) { fail(res, err); }
});

router.delete('/invites/:id', (req, res) => {
  try { res.json(Object.assign({ success: true }, accounts.cancelInvite(req.user, req.params.id))); } catch (err) { fail(res, err); }
});

// PUT /api/settings/accounts/:id/role   { role: "compliance_officer" | "employee" }
router.put('/accounts/:id/role', (req, res) => {
  try { res.json({ success: true, account: accounts.setRole(req.user, req.params.id, String((req.body && req.body.role) || '')) }); } catch (err) { fail(res, err); }
});

router.delete('/accounts/:id', (req, res) => {
  try { res.json(Object.assign({ success: true }, accounts.deleteAccount(req.user, req.params.id))); } catch (err) { fail(res, err); }
});

module.exports = router;
