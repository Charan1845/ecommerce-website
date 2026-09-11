/**
 * Turning a verified Google identity into an account here.
 *
 * Three things can be true when somebody signs in with Google, and the third
 * is the one worth thinking about.
 *
 *   They have signed in with Google before. Recognised by `google_sub`, the
 *   permanent id Google gives an account - not by email, which people change.
 *
 *   They are new. An account is made for them. They never have a password,
 *   and never need one.
 *
 *   THEY ALREADY HAVE A PASSWORD ACCOUNT ON THE SAME ADDRESS.
 *
 * That last case is where this is easy to get wrong. Signing up here does not
 * verify the address, so anybody can register victim@example.com. If Google
 * sign-in simply matched on email and logged them in, the real owner of that
 * mailbox would be handed straight into an account somebody else created -
 * and that somebody would still know the password.
 *
 * So the rule is: **proof of the mailbox outranks an unverified password.**
 * Linking a Google account to an existing password account retires that
 * password. Whoever set it can take the account back through the reset flow,
 * because that also needs the mailbox - and whoever does not have the mailbox
 * is simply out.
 *
 * Existing sessions on that account end at the same moment, through the same
 * password_changed_at check the reset flow uses.
 *
 * The honest fix for all of this is verifying email addresses at signup, and
 * that is worth doing. Until then, this is the safe way round.
 */

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const { get, transaction } = require('./db');

/**
 * A password hash nothing can ever match.
 *
 * The column is NOT NULL, and an account signed in through Google has no
 * password by design. Rather than loosening the column, it gets the hash of a
 * random value nobody has ever seen, so every password check simply fails.
 */
const unusablePassword = () =>
  bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10);

/** Make a username out of an email address, avoiding one already taken. */
async function usernameFrom(email, tx) {
  const base =
    String(email)
      .split('@')[0]
      .replace(/[^a-zA-Z0-9_]/g, '')
      .slice(0, 24) || 'shopper';

  // Usernames must be at least 3 characters, same as the signup form.
  const stem = base.length >= 3 ? base : `${base}_user`;

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? stem : `${stem}${attempt + 1}`;
    const taken = await tx.get('SELECT id FROM users WHERE username = ?', [candidate]);
    if (!taken) return candidate;
  }

  return `shopper_${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Find or make the account behind a verified Google identity.
 *
 * @param {{sub: string, email: string, name?: string}} identity - already verified
 * @returns {Promise<{user: object, outcome: 'returning'|'created'|'linked'}>}
 */
async function signInWithGoogle(identity) {
  return transaction(async (tx) => {
    // 1. Seen this Google account before.
    const known = await tx.get('SELECT * FROM users WHERE google_sub = ?', [identity.sub]);
    if (known) {
      // Their address may have changed on Google's side since last time.
      if (known.email !== identity.email) {
        const clash = await tx.get('SELECT id FROM users WHERE email = ? AND id != ?', [
          identity.email,
          known.id,
        ]);
        if (!clash) {
          await tx.run('UPDATE users SET email = ? WHERE id = ?', [identity.email, known.id]);
          known.email = identity.email;
        }
      }
      return { user: known, outcome: 'returning' };
    }

    // 2. An account already exists on this address.
    const existing = await tx.get('SELECT * FROM users WHERE email = ?', [identity.email]);
    if (existing) {
      const now = new Date().toISOString();

      // Retire the password and end sessions opened before now. See the note
      // at the top of this file - this is the whole point.
      await tx.run(
        `UPDATE users
         SET google_sub = ?, password_hash = ?, password_changed_at = ?
         WHERE id = ?`,
        [identity.sub, unusablePassword(), now, existing.id]
      );

      const linked = await tx.get('SELECT * FROM users WHERE id = ?', [existing.id]);
      return { user: linked, outcome: 'linked' };
    }

    // 3. Nobody here yet.
    const username = await usernameFrom(identity.email, tx);
    const created = await tx.get(
      `INSERT INTO users (username, email, password_hash, role, google_sub)
       VALUES (?, ?, ?, 'customer', ?)
       RETURNING id`,
      [username, identity.email, unusablePassword(), identity.sub]
    );

    const user = await tx.get('SELECT * FROM users WHERE id = ?', [created.id]);
    return { user, outcome: 'created' };
  });
}

module.exports = { signInWithGoogle, usernameFrom, unusablePassword };
