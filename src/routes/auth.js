/** REST routes for signing up, logging in and logging out. */

const express = require('express');
const { get } = require('../db');
const { rateLimit } = require('../rate-limit');
const { requestReset, completeReset, LIFETIME_MINUTES } = require('../password-reset');
const { isEnabled: emailEnabled } = require('../email');
const {
  hashPassword,
  verifyPassword,
  issueToken,
  clearToken,
  requireAuth,
} = require('../auth');

const router = express.Router();

// Guessing a password is the attack this shop is actually exposed to: the
// owner username is not a secret and the login page is public.
const loginLimit = rateLimit({
  max: 8,
  windowMs: 15 * 60 * 1000,
  message: 'Too many failed login attempts. Wait 15 minutes and try again.',
});

// Signing up is not an attack, but without a limit one script could fill the
// users table overnight.
const signupLimit = rateLimit({
  max: 15,
  windowMs: 60 * 60 * 1000,
  message: 'Too many accounts created from here. Try again later.',
});

// Asking for a reset is cheap for us and useful to somebody working through a
// list of addresses, so it gets its own limit.
const resetLimit = rateLimit({
  max: 5,
  windowMs: 60 * 60 * 1000,
  message: 'Too many reset requests from here. Try again later.',
});

const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INDIAN_STATES = [
  'Andhra Pradesh', 'Karnataka', 'Kerala', 'Maharashtra',
  'Tamil Nadu', 'Telangana',
];

/** What the browser is allowed to know about a user. Never the hash. */
const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  email: u.email,
  phone: u.phone,
  state: u.state,
  role: u.role,
});

function validateSignup(body) {
  const errors = {};
  const username = (body.username || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  const phone = (body.phone || '').trim();
  const state = (body.state || '').trim();

  if (!USERNAME_RE.test(username)) {
    errors.username = 'Use 3 to 30 letters, numbers or underscores.';
  }
  if (!EMAIL_RE.test(email)) {
    errors.email = 'That does not look like an email address.';
  }
  if (password.length < 8) {
    errors.password = 'Use at least 8 characters.';
  }
  if (password !== body.confirm_password) {
    errors.confirm_password = 'The two passwords do not match.';
  }
  if (phone && !/^[6-9]\d{9}$/.test(phone)) {
    errors.phone = 'Enter a 10 digit Indian mobile number.';
  }
  if (state && !INDIAN_STATES.includes(state)) {
    errors.state = 'Pick a state from the list.';
  }
  if (!body.terms) {
    errors.terms = 'Please accept the terms to continue.';
  }

  return { errors, values: { username, email, password, phone, state } };
}

router.post('/signup', signupLimit, async (req, res, next) => {
  try {
    const { errors, values } = validateSignup(req.body || {});
    if (Object.keys(errors).length) {
      return res.status(400).json({ error: 'Please fix the highlighted fields.', fields: errors });
    }

    if (await get('SELECT id FROM users WHERE username = ?', [values.username])) {
      return res.status(409).json({
        error: 'That username is taken.',
        fields: { username: 'That username is taken.' },
      });
    }
    if (await get('SELECT id FROM users WHERE email = ?', [values.email])) {
      return res.status(409).json({
        error: 'That email is already registered.',
        fields: { email: 'That email is already registered.' },
      });
    }

    const password_hash = await hashPassword(values.password);
    // RETURNING works the same on SQLite and PostgreSQL, so the new id comes
    // back from the insert itself rather than a follow-up query.
    const created = await get(
      `INSERT INTO users (username, email, password_hash, phone, state, role)
       VALUES (?, ?, ?, ?, ?, 'customer')
       RETURNING id`,
      [values.username, values.email, password_hash, values.phone || null, values.state || null]
    );

    const user = await get('SELECT * FROM users WHERE id = ?', [created.id]);
    issueToken(res, user);
    return res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    return next(err);
  }
});

router.post('/login', loginLimit, async (req, res, next) => {
  try {
    const identifier = (req.body?.username || '').trim();
    const password = req.body?.password || '';

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Enter your username and password.' });
    }

    // Allow logging in with either the username or the email address.
    const user = await get('SELECT * FROM users WHERE username = ? OR email = ?', [
      identifier,
      identifier.toLowerCase(),
    ]);

    // One message for both "no such user" and "wrong password". Saying which
    // one it was would let someone discover which usernames exist.
    const ok = user && (await verifyPassword(password, user.password_hash));
    if (!ok) {
      return res.status(401).json({ error: 'Wrong username or password.' });
    }

    issueToken(res, user);
    return res.json({ user: publicUser(user) });
  } catch (err) {
    return next(err);
  }
});

router.post('/logout', (req, res) => {
  clearToken(res);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* the demo account                                                     */
/* ------------------------------------------------------------------ */

/**
 * Look up the shared demo account, if there is one and it is allowed.
 *
 * Two conditions, both of which matter. It has to be switched on - set
 * DEMO_LOGIN=off and this disappears entirely. And it has to be an ordinary
 * customer: anyone at all can press that button, so it must never be able to
 * hand out the owner's powers.
 */
async function demoAccount() {
  if (process.env.DEMO_LOGIN === 'off') return null;

  const username = process.env.DEMO_USERNAME || 'demo';
  const user = await get('SELECT * FROM users WHERE username = ?', [username]);

  if (!user || user.role !== 'customer') return null;
  return user;
}

/** Is there a demo account? The login page asks before showing the button. */
router.get('/demo', async (_req, res, next) => {
  try {
    const user = await demoAccount();
    res.json({ available: Boolean(user), username: user ? user.username : null });
  } catch (err) {
    next(err);
  }
});

/** Log in as the demo customer. No password needed - that is the point. */
router.post('/demo-login', async (_req, res, next) => {
  try {
    const user = await demoAccount();
    if (!user) {
      return res.status(404).json({ error: 'The demo account is not available.' });
    }

    issueToken(res, user);
    return res.json({ user: publicUser(user) });
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ */
/* forgotten passwords                                                  */
/* ------------------------------------------------------------------ */

/**
 * POST /api/auth/forgot  { email }
 *
 * Always answers the same way. Saying "no account with that address" would
 * turn this form into a way of finding out who has an account here, which is
 * worth more to somebody with a list of addresses than it is to a forgetful
 * customer.
 */
router.post('/forgot', resetLimit, async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim();

    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({
        error: 'Enter the email address on your account.',
        fields: { email: 'That does not look like an email address.' },
      });
    }

    // What happened is logged for whoever runs the shop, and deliberately not
    // reflected in the reply.
    const result = await requestReset(email);
    console.log(`password reset requested: ${result.outcome}`);

    return res.json({
      ok: true,
      message:
        'If that address has an account, a reset link is on its way. ' +
        `It works once and stops working after ${LIFETIME_MINUTES} minutes.`,
      // Whether the shop can send email at all is not a secret, and the page
      // needs it to explain itself honestly when it cannot.
      email_configured: emailEnabled(),
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/auth/reset  { token, password, confirm_password }
 *
 * Spends the link and sets the new password. Deliberately does not log the
 * visitor in afterwards: arriving at a reset link only proves control of the
 * mailbox, and making them type the new password once more costs a moment and
 * confirms they know it.
 */
router.post('/reset', resetLimit, async (req, res, next) => {
  try {
    const password = req.body?.password || '';

    if (password !== req.body?.confirm_password) {
      return res.status(400).json({
        error: 'Please fix the highlighted fields.',
        fields: { confirm_password: 'The two passwords do not match.' },
      });
    }

    const { username } = await completeReset({ token: req.body?.token, password });
    console.log(`password reset completed for ${username}`);

    return res.json({ ok: true, message: 'Your password has been changed. You can log in now.' });
  } catch (err) {
    if (err.status) {
      return res
        .status(err.status)
        .json({ error: err.message, fields: err.field ? { [err.field]: err.message } : {} });
    }
    return next(err);
  }
});

/** Who am I? The front end calls this on every page load to draw the header. */
router.get('/me', (req, res) => {
  res.json({ user: req.user ? publicUser(req.user) : null });
});

/** Kept separate so the front end can check auth without a 401 in the console. */
router.get('/profile', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

module.exports = router;
module.exports.INDIAN_STATES = INDIAN_STATES;
