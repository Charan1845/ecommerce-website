/**
 * How long an unpaid order may hold its stock.
 *
 * Checkout takes the stock the moment an order is placed. That is deliberate -
 * it is what stops the shop selling the last mouse twice - but it has a cost:
 * an order nobody ever pays for keeps holding items nobody else can buy. On a
 * shop with four of something, a handful of abandoned checkouts empties the
 * catalogue without a single sale.
 *
 * So a pending order holds its stock for a window, and after that the hold
 * lapses and the items go back on the shelf.
 *
 * Two things about how this is built are worth saying out loud.
 *
 * FIRST: releasing a hold is not its own piece of stock arithmetic. It calls
 * the same `advance(..., 'cancelled')` the owner's Cancel button calls, which
 * already returns stock inside the transaction that wins the status change.
 * Writing a second path that also adds stock back would mean two places that
 * can credit the same items - and the day they both ran, the shop would
 * believe it had more mice than it ever bought.
 *
 * SECOND: it will not touch an order it does not understand.
 *
 *   - only pending ones. A paid order has been paid for.
 *   - only ones still processing. If the owner has packed or shipped it, the
 *     items have physically left; giving them back to the catalogue would be
 *     inventing stock.
 *   - only ones with a hold actually set. Orders placed before this feature
 *     existed have none, and are left alone forever rather than all being
 *     cancelled the moment it ships.
 *   - only when paying is possible at all. With no payment provider
 *     configured nobody *can* pay, and cancelling them would be punishing
 *     customers for the shop's own configuration.
 */

const { all } = require('./db');
const { advance, NotAllowed } = require('./fulfilment');
const { isEnabled: paymentsEnabled } = require('./payments');

/** Default window. Long enough to find a card, short enough to matter. */
const DEFAULT_MINUTES = 15;

/**
 * How many minutes a hold lasts, or 0 when holds are switched off.
 *
 * Read on each call rather than at import, so a test can change it and the
 * server does not have to be restarted to try a different window.
 */
function holdMinutes() {
  const raw = process.env.STOCK_HOLD_MINUTES;

  if (raw === undefined || raw === '') return DEFAULT_MINUTES;
  if (raw === 'off' || raw === 'never') return 0;

  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes < 0) return DEFAULT_MINUTES;

  return minutes;
}

const holdsOn = () => holdMinutes() > 0;

/**
 * When a hold placed now would run out, or null if holds are off.
 *
 * Returned as an ISO string because that is what the column stores on both
 * engines - see the note on paid_at in db.js about not letting a value come
 * back as a string in one place and a Date in another.
 */
function holdUntil(from = new Date()) {
  if (!holdsOn()) return null;
  return new Date(from.getTime() + holdMinutes() * 60 * 1000).toISOString();
}

/** Whatever the database gave us for a timestamp, as a Date. */
function asDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;

  // SQLite hands back text. Anything we wrote is already ISO; anything a
  // DEFAULT wrote is "YYYY-MM-DD HH:MM:SS" in UTC.
  const text = String(value);
  const date = new Date(text.includes('T') ? text : `${text.replace(' ', 'T')}Z`);

  return Number.isNaN(date.getTime()) ? null : date;
}

/** Orders whose hold has run out, oldest first. */
async function expiredOrders(now = new Date()) {
  const candidates = await all(
    `SELECT id, hold_expires_at
     FROM orders
     WHERE status = 'pending'
       AND fulfilment_status = 'processing'
       AND hold_expires_at IS NOT NULL
     ORDER BY id`
  );

  // Compared here rather than in the WHERE clause on purpose. The column is
  // TEXT on SQLite and TIMESTAMPTZ on PostgreSQL, and a comparison that works
  // on both without either one quietly doing something string-shaped is more
  // trouble than it is worth at this size. A shop with a hundred thousand
  // open orders would want an indexed WHERE and a real type; this one has
  // tens, and correctness on both engines matters more than the scan.
  return candidates.filter((order) => {
    const expires = asDate(order.hold_expires_at);
    return expires !== null && expires.getTime() <= now.getTime();
  });
}

/**
 * Let every lapsed hold go.
 *
 * Losing a race here is normal, not an error: the owner may have cancelled the
 * same order by hand a moment earlier, or another sweep may be running. The
 * conditional UPDATE inside `advance` decides who wins, and the loser simply
 * has nothing to do.
 *
 * @returns {Promise<{released: number[], skipped: number}>}
 */
async function releaseExpired({ now = new Date() } = {}) {
  if (!holdsOn() || !paymentsEnabled()) return { released: [], skipped: 0 };

  const released = [];
  let skipped = 0;

  for (const order of await expiredOrders(now)) {
    try {
      await advance({
        orderId: order.id,
        to: 'cancelled',
        // Null actor: the shop did this to itself. order_events allows it
        // precisely so an automatic move is not attributed to a person.
        actorId: null,
        note: 'Not paid within the hold, so the stock went back.',
      });
      released.push(order.id);
    } catch (err) {
      if (err instanceof NotAllowed) {
        skipped += 1;
        continue;
      }
      throw err;
    }
  }

  return { released, skipped };
}

/* ------------------------------------------------------------- the timer -- */

let timer = null;

/** How often to look. A minute is plenty for a fifteen minute hold. */
const SWEEP_MS = 60 * 1000;

/**
 * Start sweeping in the background.
 *
 * `unref` so this timer never keeps the process alive on its own: a server
 * that will not shut down because a sweeper is pending is a server that has to
 * be killed, and killing servers mid-transaction is how databases get strange.
 */
function startSweeper({ intervalMs = SWEEP_MS, onError = console.error } = {}) {
  if (timer || !holdsOn()) return null;

  timer = setInterval(() => {
    releaseExpired().then(
      ({ released }) => {
        if (released.length) {
          console.log(`stock holds: released ${released.length} unpaid order(s):`, released.join(', '));
        }
      },
      (err) => onError('stock hold sweep failed:', err)
    );
  }, intervalMs);

  timer.unref?.();
  return timer;
}

function stopSweeper() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  DEFAULT_MINUTES,
  holdMinutes,
  holdsOn,
  holdUntil,
  expiredOrders,
  releaseExpired,
  startSweeper,
  stopSweeper,
  asDate,
};
