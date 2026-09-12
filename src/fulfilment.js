/**
 * Where an order has got to, and the rules about how it may move.
 *
 * An order walks one path: processing -> packed -> shipped -> delivered. It can
 * drop out to cancelled early on, and once it has shipped it cannot. Those are
 * the whole rules, and writing them down in one table is the point of this
 * file - a status column with no state machine behind it is a free-text field
 * that happens to contain words like "shipped".
 *
 * Two things this refuses to do, both deliberate:
 *
 *   It will not skip. processing -> delivered is rejected, because an order
 *   that was never packed and never shipped did not arrive.
 *
 *   It will not go backwards. A delivered order cannot become processing
 *   again. If something comes back, that is a return, which is a different
 *   thing with different paperwork - not an undo.
 *
 * The move itself is a conditional UPDATE, the same shape as the stock guard
 * in checkout.js:
 *
 *     UPDATE orders SET fulfilment_status = ? WHERE id = ? AND fulfilment_status = ?
 *
 * If it changed a row, the order was where we thought and is now where we put
 * it. If it changed nothing, somebody else moved it first - and we find that
 * out from how many rows changed, not by reading the row again and hoping
 * nothing happened in between.
 */

const { all, get, transaction } = require('./db');

/** The first state every order is in. */
const INITIAL = 'processing';

/** Where each state may go next. Empty means the order has finished moving. */
const TRANSITIONS = {
  processing: ['packed', 'cancelled'],
  packed: ['shipped', 'cancelled'],
  // No cancelling after this point. It is on a van; stopping it is a return.
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

const STATES = Object.keys(TRANSITIONS);

/** What each state is called, and what it means, for the customer's timeline. */
const LABELS = {
  processing: { label: 'Order placed', blurb: 'We have your order and are getting it ready.' },
  packed: { label: 'Packed', blurb: 'Boxed up and waiting for the courier.' },
  shipped: { label: 'Shipped', blurb: 'On its way to you.' },
  delivered: { label: 'Delivered', blurb: 'Handed over. Enjoy it.' },
  cancelled: { label: 'Cancelled', blurb: 'This order was cancelled and the stock put back.' },
};

/** The happy path, in order, for drawing a progress line. */
const JOURNEY = ['processing', 'packed', 'shipped', 'delivered'];

const isState = (value) => STATES.includes(value);

/** Can an order in `from` move to `to`? */
const canMove = (from, to) => Boolean(TRANSITIONS[from]?.includes(to));

/** Raised when a move is refused, with a status for the route to use. */
class NotAllowed extends Error {
  constructor(message, status = 409) {
    super(message);
    this.name = 'NotAllowed';
    this.status = status;
  }
}

/**
 * Move one order along, and write down that it happened.
 *
 * Cancelling puts the stock back. That is the part worth being careful about:
 * checkout took the stock when the order was placed, so an order that will
 * never ship is holding items nobody can buy. Restoring it is done inside the
 * same transaction as the status change, and only on the transition that
 * actually won - so an order cannot be cancelled twice and have its stock
 * returned twice.
 *
 * @param {{orderId: number, to: string, actorId?: number, note?: string}} move
 */
async function advance({ orderId, to, actorId = null, note = null }) {
  if (!isState(to)) {
    throw new NotAllowed(`There is no such state as "${to}".`, 400);
  }

  return transaction(async (tx) => {
    const order = await tx.get(
      'SELECT id, fulfilment_status, status FROM orders WHERE id = ?',
      [orderId]
    );

    if (!order) throw new NotAllowed('No such order.', 404);

    // An order from before this column existed reads as the initial state.
    const from = order.fulfilment_status || INITIAL;

    if (from === to) {
      throw new NotAllowed(`That order is already ${LABELS[to].label.toLowerCase()}.`);
    }

    if (!canMove(from, to)) {
      const options = TRANSITIONS[from];
      throw new NotAllowed(
        options.length
          ? `An order that is ${from} can only go to ${options.join(' or ')}, not ${to}.`
          : `That order is ${from}, which is the end of the line. It cannot be changed.`
      );
    }

    // The whole race, in one statement. See the note at the top of this file.
    const moved = await tx.run(
      'UPDATE orders SET fulfilment_status = ? WHERE id = ? AND fulfilment_status = ?',
      [to, orderId, from]
    );

    if (moved.changes === 0) {
      // Somebody else moved it between our read and our write. Their move is
      // as valid as ours would have been; ours is simply too late.
      throw new NotAllowed('Somebody else just changed this order. Reload and look again.');
    }

    if (to === 'cancelled') {
      const lines = await tx.all(
        'SELECT product_id, quantity FROM order_items WHERE order_id = ?',
        [orderId]
      );

      for (const line of lines) {
        await tx.run('UPDATE products SET stock = stock + ? WHERE id = ?', [
          line.quantity,
          line.product_id,
        ]);
      }
    }

    await tx.run(
      'INSERT INTO order_events (order_id, actor_id, from_state, to_state, note) VALUES (?, ?, ?, ?, ?)',
      [orderId, actorId, from, to, note]
    );

    return { id: orderId, from, to };
  });
}

/**
 * The history of one order, oldest first.
 *
 * Orders placed before this feature existed have no events at all, so the
 * timeline starts from the order itself rather than showing a blank. The shop
 * did not stop knowing when they were placed just because it started keeping
 * a log afterwards.
 */
async function timeline(orderId) {
  const order = await get(
    'SELECT id, fulfilment_status, placed_at FROM orders WHERE id = ?',
    [orderId]
  );
  if (!order) return [];

  const events = await all(
    `SELECT from_state, to_state, note, at
     FROM order_events WHERE order_id = ? ORDER BY id`,
    [orderId]
  );

  const steps = [{ state: INITIAL, at: order.placed_at, note: null }];
  for (const event of events) {
    if (event.to_state === INITIAL) continue;
    steps.push({ state: event.to_state, at: event.at, note: event.note });
  }

  return steps.map((step) => ({ ...step, ...LABELS[step.state] }));
}

/** What this order could be moved to next, for drawing the owner's buttons. */
const nextStates = (state) => TRANSITIONS[state || INITIAL] || [];

module.exports = {
  INITIAL,
  STATES,
  TRANSITIONS,
  LABELS,
  JOURNEY,
  isState,
  canMove,
  nextStates,
  advance,
  timeline,
  NotAllowed,
};
