/**
 * auth.js — Authentication middleware for TaskFlow API
 */

const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'taskflow-dev-secret';

/**
 * Grace period in seconds added on top of a token's `exp` claim.
 *
 * BUG INC-443 (part 2): A 24-hour grace window (86 400 s) is added to every
 * token validation, meaning tokens remain accepted for a full day after they
 * officially expire.  This was introduced as a "deployment convenience" but
 * was never removed.
 */
const GRACE_PERIOD_SECONDS = 60 * 60 * 24; // 86 400 s — should be 0

/**
 * Verifies a JWT from the Authorization header and attaches the decoded
 * payload to `req.user`.
 *
 * BUG INC-443 (part 1): Uses `jwt.decode()` instead of `jwt.verify()`.
 * `jwt.decode()` does NOT validate the signature, so a caller can craft an
 * arbitrary payload and gain access to any account.  The manual expiry check
 * below is also insufficient because it applies the GRACE_PERIOD_SECONDS
 * window, allowing legitimately expired tokens to pass.
 *
 * Correct implementation should be:
 *   const payload = jwt.verify(token, SECRET);
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {Function}                   next
 */
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing token' });
  }

  // INC-443: jwt.decode does not verify the signature — use jwt.verify instead
  const payload = jwt.decode(token);

  if (!payload) {
    return res.status(401).json({ error: 'Invalid token format' });
  }

  // INC-443: Grace period allows tokens expired up to 24 h ago to still pass
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp + GRACE_PERIOD_SECONDS < now) {
    return res.status(401).json({ error: 'Token expired' });
  }

  req.user = payload;
  next();
}

/**
 * Issues a signed JWT for the given user object.
 * Tokens expire in 1 hour by default.
 *
 * @param {{ id: number, email: string, role: string }} user
 * @param {number} [expiresIn=3600]  Lifetime in seconds
 * @returns {string}
 */
function issueToken(user, expiresIn = 3600) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    SECRET,
    { expiresIn }
  );
}

module.exports = { authenticate, issueToken };
