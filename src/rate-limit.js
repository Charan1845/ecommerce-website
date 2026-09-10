/**
 * Slowing down password guessing.
 *
 * Without this, a public login page accepts as many attempts as anyone cares
 * to make. A script can try tens of thousands of passwords a minute against a
 * username it already knows - and "owner" is not a secret. Any password a
 * human can remember loses that race eventually.
 *
 * The rule here: a handful of failures from one address, then that address
 * waits. Successful logins are not counted, so an ordinary person mistyping
 * their password twice never notices this exists.
 *
 * Kept in memory on purpose. It is one process on one small server, so a Map
 * is the honest size of the problem. Two things follow from that, and both
 * are fine here but neither should be glossed over: the counters reset when
 * the server restarts, and if this ever ran on several machines each would
 * count separately. A shop with real customers would keep these in Redis.
 */

const attempts = new Map();

/** Drop entries whose window has passed, so the Map cannot grow forever. */
function prune(now) {
  for (const [key, record] of attempts) {
    if (record.resetAt <= now) attempts.delete(key);
  }
}

/**
 * @param {object} options
 * @param {number} options.max        failures allowed inside the window
 * @param {number} options.windowMs   how long the window lasts
 * @param {string} options.message    what to tell someone who is locked out
 */
function rateLimit({ max = 8, windowMs = 15 * 60 * 1000, message } = {}) {
  return function limiter(req, res, next) {
    const now = Date.now();

    // Cheap housekeeping: only occasionally, since it walks the whole Map.
    if (Math.random() < 0.01) prune(now);

    // req.ip is only trustworthy behind a proxy if the app is told to trust
    // it - see app.set('trust proxy') in app.js. Without that, everyone would
    // share the proxy's address and one attacker could lock out the world.
    const key = `${req.ip}:${req.path}`;
    let record = attempts.get(key);

    if (!record || record.resetAt <= now) {
      record = { count: 0, resetAt: now + windowMs };
      attempts.set(key, record);
    }

    if (record.count >= max) {
      const seconds = Math.ceil((record.resetAt - now) / 1000);
      res.set('Retry-After', String(seconds));
      return res.status(429).json({
        error:
          message ||
          `Too many attempts. Try again in ${Math.ceil(seconds / 60)} minute(s).`,
      });
    }

    // Count the attempt only if it turns out to have failed. Express hands us
    // the status at the point the response is sent, so hook that moment.
    res.on('finish', () => {
      if (res.statusCode >= 400) {
        record.count += 1;
      } else {
        // A success clears the slate for that address.
        attempts.delete(key);
      }
    });

    return next();
  };
}

/** Visible for tests, so they can start from a clean slate. */
function resetRateLimits() {
  attempts.clear();
}

module.exports = { rateLimit, resetRateLimits };
