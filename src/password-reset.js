/**
 * Forgotten passwords.
 *
 * The whole feature is a way of proving somebody controls an email address,
 * so a few rules decide whether it is a feature or a back door:
 *
 *   The token is random, and long. 32 bytes, so guessing is not a strategy.
 *
 *   Only its hash is stored. Stealing this table gets you hashes you cannot
 *   turn back into working links - the same reasoning as passwords.
 *
 *   It expires, and it works once. Spent the moment it is used, and every
 *   other outstanding link for that account is spent with it.
 *
 *   Asking about an address never reveals whether it exists. "If that address
 *   has an account, a link is on its way" is returned either way. Anything
 *   else turns the form into a way of discovering who has an account here.
 *
 *   Resetting ends sessions that were opened earlier. A login cookie cannot
 *   be recalled once issued, so users.password_changed_at is set and the
 *   cookie is checked against it. Without this, somebody who already had
 *   access keeps it after the rightful owner resets - which is the one moment
 *   they are most likely to be trying to get rid of them.
 */

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const { get, run, transaction } = require('./db');
const { send, resetEmail, siteUrl, isEnabled } = require('./email');

/** How long a link is good for. Long enough to find the email, short enough to matter. */
const LIFETIME_MINUTES = Number(process.env.RESET_LINK_MINUTES || 30);

const BCRYPT_ROUNDS = 12;

/** Tokens are our own random bytes, so a fast hash is the right tool. */
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

/**
 * Start a reset for whoever owns this address, if anybody does.
 *
 * Returns what happened for the server's own logs. The route deliberately
 * tells the visitor the same thing regardless.
 */
async function requestReset(email) {
  const user = await get('SELECT id, username, email FROM users WHERE email = ?', [
    String(email || '').trim().toLowerCase(),
  ]);

  if (!user) return { outcome: 'no such address' };

  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + LIFETIME_MINUTES * 60 * 1000).toISOString();

  await transaction(async (tx) => {
    // Asking again replaces any earlier link rather than leaving several
    // working at once.
    await tx.run('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL', [user.id]);
    await tx.run(
      'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
      [user.id, hashToken(token), expiresAt]
    );
  });

  const link = `${siteUrl()}/reset.html?token=${token}`;

  if (!isEnabled()) {
    // No mail provider configured. In development the link goes to the
    // server's own console so the flow can still be walked through; in
    // production it goes nowhere, because printing reset links into a log
    // anybody can read would be worse than the feature not working.
    if (process.env.NODE_ENV !== 'production') {
      console.log('\n--- password reset (email is not configured) ---');
      console.log(`for: ${user.username} <${user.email}>`);
      console.log(link);
      console.log('--- this is printed only outside production ---\n');
      return { outcome: 'printed to the console', link };
    }
    return { outcome: 'email not configured' };
  }

  const { subject, text, html } = resetEmail({
    username: user.username,
    link,
    minutes: LIFETIME_MINUTES,
  });

  const result = await send({ to: user.email, subject, text, html });
  return { outcome: result.sent ? 'emailed' : `not sent: ${result.reason}` };
}

/**
 * Spend a token and set a new password.
 *
 * Throws with a `status` when the link is no good. The message is the same
 * for expired, already used and never existed - telling them apart would let
 * somebody probe for which tokens were real.
 */
async function completeReset({ token, password }) {
  if (!token || typeof token !== 'string') {
    const err = new Error('That reset link is not valid.');
    err.status = 400;
    throw err;
  }

  if (!password || password.length < 8) {
    const err = new Error('Use at least 8 characters.');
    err.status = 400;
    err.field = 'password';
    throw err;
  }

  const now = new Date();
  const passwordHash = bcrypt.hashSync(password, BCRYPT_ROUNDS);

  return transaction(async (tx) => {
    const record = await tx.get(
      `SELECT r.id, r.user_id, r.expires_at, r.used_at, u.username
       FROM password_resets r
       JOIN users u ON u.id = r.user_id
       WHERE r.token_hash = ?`,
      [hashToken(token)]
    );

    const expired = record && new Date(record.expires_at) <= now;

    if (!record || record.used_at || expired) {
      const err = new Error('That reset link has expired or has already been used.');
      err.status = 400;
      throw err;
    }

    // Spend it first, and only if it is still unspent. Two requests arriving
    // together cannot both get past this - the same trick checkout uses.
    const spent = await tx.run(
      'UPDATE password_resets SET used_at = ? WHERE id = ? AND used_at IS NULL',
      [now.toISOString(), record.id]
    );

    if (spent.changes === 0) {
      const err = new Error('That reset link has expired or has already been used.');
      err.status = 400;
      throw err;
    }

    await tx.run('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?', [
      passwordHash,
      now.toISOString(),
      record.user_id,
    ]);

    // Anything else outstanding for this account dies with it.
    await tx.run('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL', [
      record.user_id,
    ]);

    return { username: record.username };
  });
}

/** Throw away links nobody used. Housekeeping, not security. */
async function purgeExpired() {
  const result = await run('DELETE FROM password_resets WHERE expires_at <= ?', [
    new Date().toISOString(),
  ]);
  return result.changes;
}

module.exports = { requestReset, completeReset, purgeExpired, LIFETIME_MINUTES, hashToken };
