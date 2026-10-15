const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { runInWorkspace } = require('../db');
const { getAccountsStore, normEmail, DEMO_WORKSPACE_ID } = require('../accounts/accountsStore');
const accounts = require('../accounts/accountsService');

const googleClient = config.googleClientId ? new OAuth2Client(config.googleClientId) : null;
const SESSION_HOURS = 12;

// Tests replace the Google check with a stand-in, so sign-in can be tested offline
let googleVerifier = null;
function setGoogleVerifier(fn) { googleVerifier = fn; }
const googleConfigured = () => Boolean(googleVerifier || googleClient);

/** The email and name behind a Google ID token, or null when it cannot be verified. */
async function verifyGoogleToken(idToken) {
  if (!idToken) return null;
  if (googleVerifier) return googleVerifier(idToken);
  if (!googleClient) return null;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken, audience: config.googleClientId });
    const payload = ticket.getPayload();
    if (!payload || !payload.email || payload.email_verified === false) return null;
    return { email: normEmail(payload.email), name: payload.name || '', sub: payload.sub || '' };
  } catch (err) {
    return null;
  }
}

/** A signed session for one account. It holds only the account id: role and workspace are read on every request. */
function issueSession(account) {
  return jwt.sign({ typ: 'session', sub: account.id }, config.jwtSecret, { expiresIn: `${SESSION_HOURS}h` });
}

function accountFromSession(token) {
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    return decoded && decoded.typ === 'session' ? getAccountsStore().getAccountById(decoded.sub) : null;
  } catch (err) {
    return null;
  }
}

/**
 * Resolves role from email address
 * The role is the one on the person's account. Nobody without an active account is a compliance officer.
 */
function getRoleForEmail(email = '') {
  const account = getAccountsStore().getAccountByEmail(email);
  return account && account.status === 'active' ? account.role : 'employee';
}

const signInRequired = res => res.status(401).json({ error: 'Sign in required', message: 'Please sign in to continue.' });

/**
 * Authentication middleware
 * Supports DueDilly sessions, Google ID tokens, and (in DEMO_MODE only) the demo persona headers.
 * Sets req.user and points getDb() at that person's workspace for the rest of the request.
 */
async function authenticate(req, res, next) {
  try {
    const demo = config.demoMode;
    let account = null;

    // Check Bearer Token if present (headers, query param, or cookie)
    const authHeader = req.headers['authorization'];
    let token = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (req.query && req.query.token) {
      token = String(req.query.token).trim();
    } else if (req.headers.cookie) {
      const match = String(req.headers.cookie).match(/(?:^|;\s*)dd_session=([^;]+)/);
      if (match) token = match[1];
    }

    if (token) {
      // 1. A DueDilly session
      account = accountFromSession(token);
      // 2. A Google ID token, for a person who already has an account
      if (!account && token.length > 50) {
        const google = await verifyGoogleToken(token);
        if (google) account = getAccountsStore().getAccountByEmail(google.email);
      }
      if (account && account.status !== 'active') account = null;
      if (account && account.is_demo && !demo) account = null;
    }

    if (account) {
      req.user = accounts.userFor(account);
      return runInWorkspace(account.workspace_id, next);
    }

    // The x-user-* headers are the demo persona picker. Outside DEMO_MODE they are ignored:
    // anyone can send a header, so only a verified sign-in may say who the user is.
    if (!demo) return signInRequired(res);

    let email = normEmail(req.headers['x-user-email'] || (req.query && req.query.user_email));
    // A session that is no longer valid (expired, or the account was deleted) must not quietly become a demo persona
    if (!email && (authHeader || (req.query && req.query.token))) return signInRequired(res);
    let name = req.headers['x-user-name'] || (req.query && req.query.user_name) || '';
    let userId = req.headers['x-user-id'] || (req.query && req.query.user_id) || '';
    let department = req.headers['x-user-department'] || (req.query && req.query.user_department) || '';

    // Default fallback to standard test persona if completely unauthenticated
    const anonymous = !email;
    if (anonymous) {
      email = 'john.doe@duedilly.com';
      name = 'John Doe';
      userId = 'EMP-1042';
      department = 'Procurement & Logistics';
    }

    // A header can only ever reach the Demo workspace, and never chooses the role (x-user-role is not read).
    // A known demo account gets its stored role; any other email is a Demo-workspace employee.
    const known = getAccountsStore().getAccountByEmail(email);
    if (known && known.workspace_id !== DEMO_WORKSPACE_ID) return signInRequired(res);
    const role = known && known.status === 'active' ? known.role : 'employee';
    const workspace = getAccountsStore().getWorkspace(DEMO_WORKSPACE_ID);

    req.user = {
      email,
      name: name || (known && known.name) || (role === 'compliance_officer' ? 'Grace Teo' : 'John Doe'),
      userId: userId || (known && known.status === 'active' ? known.id : '') || (role === 'compliance_officer' ? 'COMP-901' : 'EMP-1042'),
      department: department || (known && known.department) || (role === 'compliance_officer' ? 'Compliance & Risk Governance' : 'Procurement & Logistics'),
      role,
      anonymous,
      accountId: known && known.status === 'active' ? known.id : null,
      demoAccount: true,
      workspace: { id: workspace.id, name: workspace.name, isDemo: true }
    };

    runInWorkspace(DEMO_WORKSPACE_ID, next);
  } catch (err) {
    console.error('Auth middleware error:', err);
    res.status(500).json({ error: 'Sign-in check failed', message: 'Please try again.' });
  }
}

/**
 * Role guard middleware
 */
function requireRole(allowedRoles = []) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Access denied',
        message: `Requires one of roles: ${roles.join(', ')}. Current role: ${req.user ? req.user.role : 'unauthenticated'}`
      });
    }
    next();
  };
}

/** For the few open routes: a caller who says who they are is checked as usual; anyone else lands in the Demo workspace. */
function optionalAuth(req, res, next) {
  if (req.headers['authorization'] || (req.query && req.query.token) || (config.demoMode && (req.headers['x-user-email'] || (req.query && req.query.user_email)))) return authenticate(req, res, next);
  runInWorkspace(DEMO_WORKSPACE_ID, next);
}

/** Signed in, and a compliance officer. */
const officerOnly = [authenticate, requireRole('compliance_officer')];

module.exports = {
  authenticate,
  requireRole,
  officerOnly,
  optionalAuth,
  accountFromSession,
  getRoleForEmail,
  verifyGoogleToken,
  googleConfigured,
  setGoogleVerifier,
  issueSession
};
