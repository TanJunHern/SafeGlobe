/**
 * Signing in: a demo account (one click, DEMO_MODE only), Google for an existing account or an invitation,
 * and "Create an account", which makes a new, empty workspace.
 */
const express = require('express');
const router = express.Router();
const config = require('../config');
const accounts = require('../accounts/accountsService');
const { authenticate, getRoleForEmail, verifyGoogleToken, googleConfigured, issueSession, accountFromSession } = require('../middleware/auth');
const { runInWorkspace } = require('../db');

// Links that open in a new browser tab (a finding's source page) cannot send a header, so the session is also kept
// in a cookie that the browser only sends to /risk.
const PAGE_COOKIE = 'dd_session';
const pageCookie = (req, value, maxAge) => `${PAGE_COOKIE}=${value}; Path=/risk; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${req.secure ? '; Secure' : ''}`;

/** For pages opened by a link: the workspace of the signed-in person, or the Demo workspace in demo mode. */
function pageSession(req, res, next) {
  const match = String(req.headers.cookie || '').match(/(?:^|;\s*)dd_session=([^;]+)/);
  const account = match ? accountFromSession(match[1]) : null;
  if (account && account.status === 'active' && !(account.is_demo && !config.demoMode)) return runInWorkspace(account.workspace_id, next);
  if (config.demoMode) return runInWorkspace(accounts.DEMO_WORKSPACE_ID, next);
  res.status(401).type('html').send('<p>Please <a href="/login">sign in</a> to see this source.</p>');
}

function signedIn(req, res, account, status = 200) {
  const token = issueSession(account);
  res.set('Set-Cookie', pageCookie(req, token, 12 * 3600));
  res.status(status).json({ success: true, token, user: accounts.userFor(account) });
}
const fail = (res, err) => {
  if (!err.status) console.error('[Auth]', err);
  res.status(err.status || 500).json({ error: err.status ? 'Sign-in refused' : 'Sign-in failed', code: err.code || null, message: err.status ? err.message : 'Please try again.' });
};

/** The verified Google identity for this request, or an answer already sent. */
async function googleIdentity(req, res) {
  if (!googleConfigured()) {
    res.status(503).json({ error: 'Google sign-in is not set up', code: 'google_not_configured', message: 'Google sign-in is not set up on this server yet.' });
    return null;
  }
  const identity = await verifyGoogleToken(String((req.body && req.body.credential) || ''));
  if (!identity || !identity.email) {
    res.status(401).json({ error: 'Google sign-in failed', code: 'google_rejected', message: 'Google could not confirm who you are. Please try again.' });
    return null;
  }
  return identity;
}

router.get('/session', authenticate, (req, res) => {
  res.json({
    authenticated: true,
    user: req.user,
    googleClientId: config.googleClientId
  });
});

// POST /api/auth/demo   { account: "employee" | "compliance" }   one click, no Google, DEMO_MODE only
router.post('/demo', (req, res) => {
  if (!config.demoMode) return res.status(403).json({ error: 'Demo accounts are switched off', code: 'demo_off', message: 'Demo accounts are not available here. Please sign in with Google.' });
  const account = accounts.demoAccount(req.body && (req.body.account || req.body.email));
  if (!account) return res.status(404).json({ error: 'No such demo account', message: 'Choose one of the demo accounts shown.' });
  const store = require('../accounts/accountsStore').getAccountsStore();
  signedIn(req, res, store.updateAccount(account.id, { last_sign_in_at: new Date().toISOString() }));
});

// POST /api/auth/google   { credential }   an existing account, or an invitation waiting for this email
router.post('/google', async (req, res) => {
  try {
    const identity = await googleIdentity(req, res);
    if (!identity) return;
    signedIn(req, res, accounts.signInWithGoogle(identity));
  } catch (err) { fail(res, err); }
});

// POST /api/auth/signup   { credential, name, organisation }   a new workspace; this person is its compliance officer
router.post('/signup', async (req, res) => {
  try {
    const identity = await googleIdentity(req, res);
    if (!identity) return;
    const body = req.body || {};
    signedIn(req, res, accounts.createWorkspace({ email: identity.email, name: body.name || identity.name, organisation: body.organisation }), 201);
  } catch (err) { fail(res, err); }
});

// POST /api/auth/signout   forgets the page cookie; the page drops its own session
router.post('/signout', (req, res) => {
  res.set('Set-Cookie', pageCookie(req, '', 0));
  res.json({ success: true });
});

// Kept for older pages. It answers from the demo accounts and never takes a role from the caller.
router.post('/switch-persona', (req, res) => {
  const { email, name, department } = req.body || {};
  const targetEmail = (email || 'john.doe@duedilly.com').toLowerCase().trim();
  const targetRole = getRoleForEmail(targetEmail);
  res.json({
    success: true,
    user: {
      email: targetEmail,
      role: targetRole,
      name: name || (targetRole === 'compliance_officer' ? 'Grace Teo' : 'John Doe'),
      department: department || (targetRole === 'compliance_officer' ? 'Compliance & Risk Governance' : 'Procurement & Logistics')
    }
  });
});

module.exports = router;
module.exports.pageSession = pageSession;
