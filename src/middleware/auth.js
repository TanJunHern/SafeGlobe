const { OAuth2Client } = require('google-auth-library');
const config = require('../config');

const googleClient = config.googleClientId ? new OAuth2Client(config.googleClientId) : null;

/**
 * Resolves role from email address
 */
function getRoleForEmail(email = '') {
  const normEmail = (email || '').toLowerCase().trim();
  if (!normEmail) return 'employee';
  
  const isCompliance = config.complianceEmails.some(ce => normEmail === ce || normEmail.includes('compliance'));
  return isCompliance ? 'compliance_officer' : 'employee';
}

/**
 * Authentication middleware
 * Supports Google ID tokens, JWTs, and Persona simulation headers
 */
async function authenticate(req, res, next) {
  try {
    let email = req.headers['x-user-email'] || '';
    let name = req.headers['x-user-name'] || '';
    let userId = req.headers['x-user-id'] || '';
    let department = req.headers['x-user-department'] || '';

    // Check Bearer Token if present
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      
      // 1. Try Google OAuth2 verification if configured
      if (googleClient && token.length > 50) {
        try {
          const ticket = await googleClient.verifyIdToken({
            idToken: token,
            audience: config.googleClientId
          });
          const payload = ticket.getPayload();
          if (payload && payload.email) {
            email = payload.email;
            name = payload.name || name;
            userId = payload.sub || userId;
          }
        } catch (gErr) {
          // Token may be a simulated JWT
        }
      }
    }

    // Default fallback to standard test persona if completely unauthenticated
    const anonymous = !email;
    if (anonymous) {
      email = 'john.doe@safeglobe.com';
      name = 'John Doe';
      userId = 'EMP-1042';
      department = 'Procurement & Logistics';
    }

    const role = req.headers['x-user-role'] || getRoleForEmail(email);

    req.user = {
      email: email.toLowerCase().trim(),
      name: name || (role === 'compliance_officer' ? 'Grace Teo' : 'John Doe'),
      userId: userId || (role === 'compliance_officer' ? 'COMP-901' : 'EMP-1042'),
      department: department || (role === 'compliance_officer' ? 'Compliance & Risk Governance' : 'Procurement & Logistics'),
      role,
      anonymous
    };

    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    next();
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

module.exports = {
  authenticate,
  requireRole,
  getRoleForEmail
};
