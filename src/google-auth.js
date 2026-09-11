/**
 * Signing in with Google.
 *
 * Switched off unless GOOGLE_CLIENT_ID is set, like payments and email.
 *
 * This uses Google Identity Services, where the browser hands us a signed
 * token describing who just proved they own a Google account. There is no
 * client secret anywhere in this flow - the only thing we hold is the client
 * id, which is public by design. One less secret to leak.
 *
 * The token is a JWT signed by Google with RS256. Verifying it means four
 * things, and skipping any one of them makes the whole feature theatre:
 *
 *   1. The signature is really Google's, checked against the public keys they
 *      publish. Without this anyone can write their own token.
 *   2. `aud` is our client id. A token minted for a different site is a real
 *      Google token and still nothing to do with us.
 *   3. `iss` is Google.
 *   4. It has not expired.
 *
 * Doing this on the server matters. The browser could be told anything; the
 * only thing worth trusting is a signature we checked ourselves.
 */

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

/** Where Google publishes the public keys its tokens are signed with. */
const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs';

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

const clientId = () => process.env.GOOGLE_CLIENT_ID || '';
const isEnabled = () => Boolean(clientId());

/**
 * Google's signing keys, cached.
 *
 * They rotate every so often, so this is refreshed rather than fetched once -
 * but not on every sign-in either, which would put Google in the path of
 * every login and make them a single point of failure for the shop.
 */
let keyCache = { keys: null, fetchedAt: 0 };
const CACHE_MS = 60 * 60 * 1000;

async function googleKeys({ force = false } = {}) {
  const fresh = Date.now() - keyCache.fetchedAt < CACHE_MS;
  if (!force && keyCache.keys && fresh) return keyCache.keys;

  const res = await fetch(GOOGLE_CERTS);
  if (!res.ok) throw new Error(`could not fetch Google's signing keys (${res.status})`);

  const body = await res.json();
  keyCache = { keys: body.keys || [], fetchedAt: Date.now() };
  return keyCache.keys;
}

/** Turn one of Google's published JWK keys into something jsonwebtoken can use. */
function publicKeyFor(jwk) {
  return crypto.createPublicKey({ key: jwk, format: 'jwk' }).export({
    type: 'spki',
    format: 'pem',
  });
}

/**
 * Check the token Google gave the browser, and return who it says they are.
 *
 * Throws with a `status` when it does not hold up. The message stays vague on
 * purpose - a visitor cannot do anything useful with the detail, and it is
 * the sort of detail worth not publishing.
 */
async function verifyIdToken(credential) {
  if (!isEnabled()) {
    const err = new Error('Signing in with Google is not switched on for this shop.');
    err.status = 503;
    throw err;
  }

  if (!credential || typeof credential !== 'string') {
    const err = new Error('That Google sign-in could not be verified.');
    err.status = 400;
    throw err;
  }

  const decoded = jwt.decode(credential, { complete: true });
  const kid = decoded?.header?.kid;

  if (!kid) {
    const err = new Error('That Google sign-in could not be verified.');
    err.status = 400;
    throw err;
  }

  // If the key id is unknown, Google may have rotated since we last looked.
  let keys = await googleKeys();
  let jwk = keys.find((k) => k.kid === kid);
  if (!jwk) {
    keys = await googleKeys({ force: true });
    jwk = keys.find((k) => k.kid === kid);
  }

  if (!jwk) {
    const err = new Error('That Google sign-in could not be verified.');
    err.status = 400;
    throw err;
  }

  let payload;
  try {
    payload = jwt.verify(credential, publicKeyFor(jwk), {
      algorithms: ['RS256'],
      audience: clientId(),
      issuer: GOOGLE_ISSUERS,
    });
  } catch {
    const err = new Error('That Google sign-in could not be verified.');
    err.status = 400;
    throw err;
  }

  // Google will happily tell us about an address the account has not proved it
  // owns. Since the whole point here is proof of a mailbox, an unverified one
  // is worth nothing.
  if (!payload.email || payload.email_verified !== true) {
    const err = new Error('That Google account has no confirmed email address.');
    err.status = 400;
    throw err;
  }

  return {
    sub: payload.sub,
    email: String(payload.email).toLowerCase(),
    name: payload.name || '',
  };
}

module.exports = { isEnabled, clientId, verifyIdToken, GOOGLE_CERTS };
