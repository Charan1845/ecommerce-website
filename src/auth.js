/**
 * Who you are (authentication) and what you may do (authorization).
 *
 * The login token is stored in an httpOnly cookie, which means page JavaScript
 * cannot read it. If we kept it in localStorage instead, any injected script
 * on the page could steal it and log in as that user forever.
 */

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { get } = require('./db');

const COOKIE_NAME = 'devgear_token';
const TOKEN_LIFETIME = '7d';

// bcrypt deliberately takes a noticeable amount of time. That is the point:
// it makes guessing millions of passwords against a stolen database slow.
const BCRYPT_ROUNDS = 12;

function secret() {
  const value = process.env.JWT_SECRET;
  if (!value) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET must be set in production');
    }
    return 'dev-only-secret-change-before-deploying';
  }
  return value;
}

const hashPassword = (plain) => bcrypt.hash(plain, BCRYPT_ROUNDS);
const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

function issueToken(res, user) {
  const token = jwt.sign({ sub: user.id, role: user.role }, secret(), {
    expiresIn: TOKEN_LIFETIME,
  });

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function clearToken(res) {
  res.clearCookie(COOKIE_NAME);
}

/**
 * Was this cookie handed out before the password last changed?
 *
 * `iat` counts in whole seconds, so a cookie issued in the same second as the
 * reset is treated as older. That errs towards logging somebody out, which is
 * the safe direction: the one they just typed the new password into is not
 * this one, because resetting deliberately does not log you in.
 */
function issuedBeforePasswordChange(payload, changedAt) {
  if (!changedAt || !payload?.iat) return false;

  // PostgreSQL hands back a Date, SQLite an ISO string.
  const changed = changedAt instanceof Date ? changedAt : new Date(String(changedAt));
  if (Number.isNaN(changed.getTime())) return false;

  return payload.iat * 1000 <= changed.getTime();
}

/**
 * Reads the cookie and, if it is valid, hangs the user on req.user.
 * Never rejects - pages like the catalogue work fine logged out.
 */
async function loadUser(req, _res, next) {
  req.user = null;

  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return next();

  try {
    const payload = jwt.verify(token, secret());
    // Read the user fresh from the database rather than trusting the token's
    // contents. A token issued last week may name a role that has since
    // changed, or a user who has since been deleted.
    const user = await get(
      'SELECT id, username, email, phone, state, role, password_changed_at FROM users WHERE id = ?',
      [payload.sub]
    );

    // A login cookie cannot be recalled once handed out, so a password reset
    // has to be enforced here instead: any cookie issued before the password
    // changed stops counting. Without this, somebody who already had access
    // keeps it through the reset meant to remove them.
    if (user && issuedBeforePasswordChange(payload, user.password_changed_at)) {
      return next();
    }

    if (user) {
      delete user.password_changed_at;
      req.user = user;
    }
  } catch {
    // Expired or tampered with. Treat as logged out.
  }

  return next();
}

/** Blocks anyone not logged in. */
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please log in first.' });
  return next();
}

/** Blocks anyone who is not the shop owner. */
function requireOwner(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please log in first.' });
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Only the shop owner can do that.' });
  }
  return next();
}

module.exports = {
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
  issueToken,
  clearToken,
  loadUser,
  requireAuth,
  requireOwner,
};
