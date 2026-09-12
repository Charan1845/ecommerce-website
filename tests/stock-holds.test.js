/**
 * Tests for how long an unpaid order may hold its stock.
 *
 * The interesting half is not "does an expired order get cancelled" - it is
 * everything the sweeper must refuse to touch. A sweeper that is slightly too
 * keen cancels orders people have paid for, or invents stock by taking back
 * items that have already been posted. So most of what is below is about what
 * does NOT happen.
 */

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const USING_PG = Boolean(process.env.DATABASE_URL);
const DB_FILE = path.join(os.tmpdir(), `devgear-holds-${process.pid}-${Date.now()}.db`);
if (!USING_PG) process.env.DB_FILE = DB_FILE;
process.env.JWT_SECRET = 'test-only-secret';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { applySchema, get, all, run, close, transaction } = require('../src/db');
const { seedProducts } = require('../src/seed');
const { advance } = require('../src/fulfilment');
const {
  holdMinutes,
  holdsOn,
  holdUntil,
  expiredOrders,
  releaseExpired,
  DEFAULT_MINUTES,
} = require('../src/stock-holds');

// src/seed pulls in dotenv, which loads the real .env.
delete process.env.RESEND_API_KEY;
delete process.env.GOOGLE_CLIENT_ID;

// Holds only run when paying is actually possible, so the simulator stays on
// for this file. Every other test file deletes it.
process.env.PAYMENT_SANDBOX = 'on';

const PRODUCT = 800001;
const STARTING_STOCK = 50;

let customerId;

before(async () => {
  await applySchema();
  await seedProducts();

  const user = await get(
    `INSERT INTO users (username, email, password_hash, role)
     VALUES ('holds-customer', 'holds@example.com', 'x', 'customer')
     RETURNING id`
  );
  customerId = Number(user.id);
});

beforeEach(async () => {
  delete process.env.STOCK_HOLD_MINUTES;

  // Several tests below deliberately leave an expired order un-swept - that is
  // the thing they are checking. Without this, the next test's sweep collects
  // those too and its own arithmetic comes out wrong. Taking their hold away
  // puts them out of scope rather than deleting them, so what each test left
  // behind is still there to look at if one of them fails.
  await run('UPDATE orders SET hold_expires_at = NULL WHERE hold_expires_at IS NOT NULL');

  await run(
    `INSERT INTO products (id, name, brand, category, price_paise, description, stock)
     VALUES (?, 'Held part', 'TestBrand', 'Keyboards', 100000, 'for tests', ?)
     ON CONFLICT (id) DO UPDATE SET stock = excluded.stock`,
    [PRODUCT, STARTING_STOCK]
  );
});

after(async () => {
  await close();
  if (!USING_PG) fs.rmSync(DB_FILE, { force: true });
});

/** Minutes from now, as the column stores it. */
const at = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();

/**
 * An order holding `quantity` of the test product.
 *
 * `hold` is passed straight through, so a test can make an order that expired
 * an hour ago without waiting an hour.
 */
async function makeOrder({ quantity = 1, hold = at(15), status = 'pending' } = {}) {
  return transaction(async (tx) => {
    const created = await tx.get(
      `INSERT INTO orders
         (user_id, status, total_paise, shipping_name, shipping_phone,
          shipping_address, shipping_state, shipping_pincode, hold_expires_at)
       VALUES (?, ?, 100000, 'Test', '9848012345', '12 Example Street', 'Telangana', '502313', ?)
       RETURNING id`,
      [customerId, status, hold]
    );

    const id = Number(created.id);

    await tx.run(
      `INSERT INTO order_items (order_id, product_id, product_name, unit_price_paise, quantity)
       VALUES (?, ?, 'Held part', 100000, ?)`,
      [id, PRODUCT, quantity]
    );

    // Checkout takes the stock when the order is placed, so the fixture must.
    await tx.run('UPDATE products SET stock = stock - ? WHERE id = ?', [quantity, PRODUCT]);

    return id;
  });
}

const stock = async () => Number((await get('SELECT stock FROM products WHERE id = ?', [PRODUCT])).stock);
const stateOf = async (id) =>
  (await get('SELECT fulfilment_status FROM orders WHERE id = ?', [id])).fulfilment_status;

/* ------------------------------------------------------------- the window */

test('the default hold is fifteen minutes', () => {
  assert.equal(holdMinutes(), DEFAULT_MINUTES);
  assert.ok(holdsOn());
});

test('the window can be changed', () => {
  process.env.STOCK_HOLD_MINUTES = '5';
  assert.equal(holdMinutes(), 5);
});

test('holds can be switched off entirely', () => {
  process.env.STOCK_HOLD_MINUTES = 'off';
  assert.equal(holdMinutes(), 0);
  assert.equal(holdsOn(), false);
  assert.equal(holdUntil(), null, 'with holds off an order gets no expiry at all');
});

test('nonsense in the setting falls back to the default rather than to zero', () => {
  // Zero would mean "expire everything immediately", which is the worst
  // possible reading of a typo.
  for (const bad of ['banana', '-5', 'NaN']) {
    process.env.STOCK_HOLD_MINUTES = bad;
    assert.equal(holdMinutes(), DEFAULT_MINUTES, `${bad} should not change the window`);
  }
});

test('holdUntil is the window from now', () => {
  process.env.STOCK_HOLD_MINUTES = '10';
  const from = new Date('2026-01-01T00:00:00.000Z');
  assert.equal(holdUntil(from), '2026-01-01T00:10:00.000Z');
});

/* ---------------------------------------------------------- what it frees */

test('an expired order is cancelled and its stock goes back', async () => {
  const before = await stock();
  const id = await makeOrder({ quantity: 3, hold: at(-1) });

  assert.equal(await stock(), before - 3, 'the order is holding three');

  const { released } = await releaseExpired();

  assert.deepEqual(released, [id]);
  assert.equal(await stateOf(id), 'cancelled');
  assert.equal(await stock(), before, 'and the three are back');
});

test('the cancellation says why, and is not blamed on a person', async () => {
  const id = await makeOrder({ hold: at(-1) });
  await releaseExpired();

  const event = await get(
    "SELECT actor_id, from_state, to_state, note FROM order_events WHERE order_id = ? AND to_state = 'cancelled'",
    [id]
  );

  assert.equal(event.actor_id, null, 'the shop did this to itself');
  assert.equal(event.from_state, 'processing');
  assert.match(event.note, /Not paid within the hold/);
});

/* ------------------------------------------------------ what it must not touch */

test('an order still inside its hold is left alone', async () => {
  const id = await makeOrder({ hold: at(15) });
  const { released } = await releaseExpired();

  assert.deepEqual(released, []);
  assert.equal(await stateOf(id), 'processing');
});

test('a paid order is never swept, however old the hold', async () => {
  const before = await stock();
  const id = await makeOrder({ quantity: 2, hold: at(-600), status: 'paid' });

  const { released } = await releaseExpired();

  assert.deepEqual(released, []);
  assert.equal(await stateOf(id), 'processing');
  assert.equal(await stock(), before - 2, 'a paid order keeps its items');
});

test('an order that has been packed is never swept', async () => {
  const before = await stock();
  const id = await makeOrder({ quantity: 2, hold: at(-600) });
  await advance({ orderId: id, to: 'packed' });

  const { released } = await releaseExpired();

  assert.deepEqual(released, []);
  assert.equal(await stateOf(id), 'packed');
  assert.equal(
    await stock(),
    before - 2,
    'the items are in a box - giving them back would be inventing stock'
  );
});

test('an order with no hold set is never swept', async () => {
  // Exactly what every order placed before this feature looks like.
  const before = await stock();
  const id = await makeOrder({ quantity: 2, hold: null });

  const { released } = await releaseExpired();

  assert.deepEqual(released, []);
  assert.equal(await stateOf(id), 'processing');
  assert.equal(await stock(), before - 2);
});

test('nothing is swept when holds are switched off', async () => {
  const id = await makeOrder({ hold: at(-1) });
  process.env.STOCK_HOLD_MINUTES = 'off';

  const { released } = await releaseExpired();

  assert.deepEqual(released, []);
  assert.equal(await stateOf(id), 'processing');
});

test('nothing is swept when nobody can pay', async () => {
  const id = await makeOrder({ hold: at(-1) });
  delete process.env.PAYMENT_SANDBOX;

  try {
    const { released } = await releaseExpired();
    assert.deepEqual(released, [], 'cancelling for non-payment when paying is impossible is unfair');
    assert.equal(await stateOf(id), 'processing');
  } finally {
    process.env.PAYMENT_SANDBOX = 'on';
  }
});

/* ---------------------------------------------------------------- races */

test('two sweeps at once release the stock exactly once', async () => {
  const before = await stock();
  const id = await makeOrder({ quantity: 4, hold: at(-1) });

  const [a, b] = await Promise.all([releaseExpired(), releaseExpired()]);

  const releasedBoth = [...a.released, ...b.released];
  assert.deepEqual(releasedBoth, [id], 'exactly one sweep should have released it');

  // The loser has two honest outcomes and this must accept both, because
  // which one happens depends on the engine rather than on the code:
  //
  //   it read the order, tried, and the conditional UPDATE refused it
  //     -> skipped 1. This is what SQLite always does, where one connection
  //        makes the two sweeps take turns.
  //
  //   it ran its query after the winner had already committed, found nothing
  //     expired, and had nothing to try
  //     -> skipped 0. This is what real PostgreSQL does, where the two sweeps
  //        genuinely overlap.
  //
  // An earlier version of this test insisted on the first and went red on
  // PostgreSQL - asserting an implementation detail of how the loser lost,
  // rather than that it did not double-credit anything.
  assert.ok(a.skipped + b.skipped <= 1, 'nothing should have been refused twice');

  assert.equal(await stock(), before, 'four back, not eight');

  const events = await all(
    "SELECT id FROM order_events WHERE order_id = ? AND to_state = 'cancelled'",
    [id]
  );
  assert.equal(events.length, 1, 'and one cancellation, whichever sweep wrote it');
});

test('a sweep racing the owner cancelling by hand credits the items once', async () => {
  const before = await stock();
  const id = await makeOrder({ quantity: 3, hold: at(-1) });

  await Promise.allSettled([
    releaseExpired(),
    advance({ orderId: id, to: 'cancelled', actorId: customerId }),
  ]);

  assert.equal(await stateOf(id), 'cancelled');
  assert.equal(await stock(), before, 'three back, whoever got there first');

  const events = await all(
    "SELECT id FROM order_events WHERE order_id = ? AND to_state = 'cancelled'",
    [id]
  );
  assert.equal(events.length, 1, 'and only one cancellation was recorded');
});

test('a paid-at-the-last-moment order is not cancelled underneath the customer', async () => {
  const before = await stock();
  const id = await makeOrder({ quantity: 2, hold: at(-1) });

  // Payment clears the hold; that is what takes it out of the sweeper's reach.
  await run(
    "UPDATE orders SET status = 'paid', hold_expires_at = NULL WHERE id = ? AND status = 'pending'",
    [id]
  );

  const { released } = await releaseExpired();

  assert.deepEqual(released, []);
  assert.equal(await stateOf(id), 'processing');
  assert.equal(await stock(), before - 2, 'they paid, so the items are theirs');
});

/* ------------------------------------------------------------- the query */

test('expiredOrders finds only what has actually lapsed', async () => {
  const lapsed = await makeOrder({ hold: at(-1) });
  const live = await makeOrder({ hold: at(30) });
  const none = await makeOrder({ hold: null });

  const found = (await expiredOrders()).map((o) => Number(o.id));

  assert.ok(found.includes(lapsed));
  assert.ok(!found.includes(live));
  assert.ok(!found.includes(none));
});

test('expiry is judged against the moment asked about, not only now', async () => {
  const id = await makeOrder({ hold: at(30) });

  const later = new Date(Date.now() + 60 * 60_000);
  const found = (await expiredOrders(later)).map((o) => Number(o.id));

  assert.ok(found.includes(id), 'an hour from now, a thirty minute hold has lapsed');
});
