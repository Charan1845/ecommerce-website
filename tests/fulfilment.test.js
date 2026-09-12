/**
 * Tests for where an order is and how it is allowed to move.
 *
 * Two halves, and the second is the one that matters:
 *
 *   The rules - no skipping, no going backwards, no cancelling something
 *   already on a van. These are pure and need no database.
 *
 *   The move - which is a conditional UPDATE against a real database, so two
 *   owners pressing "ship" at the same instant produce one ship and one honest
 *   refusal rather than two events and a confused customer. And cancelling has
 *   to put the stock back exactly once, however many people press it.
 */

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const USING_PG = Boolean(process.env.DATABASE_URL);
const DB_FILE = path.join(os.tmpdir(), `devgear-fulfil-${process.pid}-${Date.now()}.db`);
if (!USING_PG) process.env.DB_FILE = DB_FILE;
process.env.JWT_SECRET = 'test-only-secret';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { applySchema, get, all, run, close, transaction } = require('../src/db');
const { seedProducts } = require('../src/seed');
const {
  advance,
  timeline,
  canMove,
  nextStates,
  TRANSITIONS,
  STATES,
  INITIAL,
  NotAllowed,
} = require('../src/fulfilment');

// src/seed pulls in dotenv, which loads the real .env. Nothing here wants it.
delete process.env.RESEND_API_KEY;
delete process.env.GOOGLE_CLIENT_ID;

let customerId;

/**
 * Products belonging to these tests alone.
 *
 * The first attempt took stock from the real catalogue, and after a few orders
 * product 1 ran out and the database's `stock >= 0` CHECK refused the setup -
 * correctly. Tests that quietly depend on how much stock a catalogue entry
 * happens to start with are tests that break when somebody edits a JSON file.
 */
const TEST_PRODUCTS = [900001, 900002, 900003, 900004, 900005, 900006, 900007, 900008];
const STARTING_STOCK = 100;

before(async () => {
  await applySchema();
  await seedProducts();

  for (const id of TEST_PRODUCTS) {
    await run(
      `INSERT INTO products (id, name, brand, category, price_paise, description, stock)
       VALUES (?, ?, 'TestBrand', 'Keyboards', 100000, 'for tests', ?)
       ON CONFLICT (id) DO UPDATE SET stock = excluded.stock`,
      [id, `Test part ${id}`, STARTING_STOCK]
    );
  }

  const user = await get(
    `INSERT INTO users (username, email, password_hash, role)
     VALUES ('fulfil-customer', 'fulfil@example.com', 'x', 'customer')
     RETURNING id`
  );
  customerId = Number(user.id);
});

after(async () => {
  await close();
  if (!USING_PG) fs.rmSync(DB_FILE, { force: true });
});

/** An order with one line, so cancelling it has stock to give back. */
async function makeOrder({ productId = TEST_PRODUCTS[0], quantity = 2 } = {}) {
  return transaction(async (tx) => {
    const created = await tx.get(
      `INSERT INTO orders
         (user_id, status, total_paise, shipping_name, shipping_phone,
          shipping_address, shipping_state, shipping_pincode)
       VALUES (?, 'pending', 100000, 'Test', '9848012345', '12 Example Street', 'Telangana', '502313')
       RETURNING id`,
      [customerId]
    );

    const id = Number(created.id);
    const product = await tx.get('SELECT name, price_paise FROM products WHERE id = ?', [productId]);

    await tx.run(
      `INSERT INTO order_items (order_id, product_id, product_name, unit_price_paise, quantity)
       VALUES (?, ?, ?, ?, ?)`,
      [id, productId, product.name, product.price_paise, quantity]
    );

    // Checkout would have taken this stock, so take it here too - otherwise
    // cancelling gives back stock that was never removed.
    await tx.run('UPDATE products SET stock = stock - ? WHERE id = ?', [quantity, productId]);

    return id;
  });
}

const stockOf = async (id) => Number((await get('SELECT stock FROM products WHERE id = ?', [id])).stock);
const stateOf = async (id) =>
  (await get('SELECT fulfilment_status FROM orders WHERE id = ?', [id])).fulfilment_status;

/* ------------------------------------------------------------- the rules -- */

test('a new order starts as processing', async () => {
  const id = await makeOrder();
  assert.equal(await stateOf(id), INITIAL);
});

test('the happy path walks all the way to delivered', async () => {
  const id = await makeOrder();

  for (const step of ['packed', 'shipped', 'delivered']) {
    const moved = await advance({ orderId: id, to: step });
    assert.equal(moved.to, step);
    assert.equal(await stateOf(id), step);
  }
});

test('an order cannot skip a step', async () => {
  const id = await makeOrder();

  await assert.rejects(
    advance({ orderId: id, to: 'delivered' }),
    (err) => err instanceof NotAllowed && /can only go to/.test(err.message),
    'processing straight to delivered should be refused'
  );

  assert.equal(await stateOf(id), INITIAL, 'and it should not have moved');
});

test('an order cannot go backwards', async () => {
  const id = await makeOrder();
  await advance({ orderId: id, to: 'packed' });

  await assert.rejects(
    advance({ orderId: id, to: 'processing' }),
    (err) => err instanceof NotAllowed
  );

  assert.equal(await stateOf(id), 'packed');
});

test('a shipped order cannot be cancelled', async () => {
  const id = await makeOrder();
  await advance({ orderId: id, to: 'packed' });
  await advance({ orderId: id, to: 'shipped' });

  await assert.rejects(
    advance({ orderId: id, to: 'cancelled' }),
    (err) => err instanceof NotAllowed,
    'it is on a van - stopping it is a return, not a cancellation'
  );
});

test('a delivered order is the end of the line', async () => {
  const id = await makeOrder();
  for (const step of ['packed', 'shipped', 'delivered']) await advance({ orderId: id, to: step });

  await assert.rejects(
    advance({ orderId: id, to: 'cancelled' }),
    (err) => err instanceof NotAllowed && /end of the line/.test(err.message)
  );
});

test('moving to the state it is already in is refused', async () => {
  const id = await makeOrder();
  await assert.rejects(
    advance({ orderId: id, to: 'processing' }),
    (err) => err instanceof NotAllowed && /already/.test(err.message)
  );
});

test('an invented state is refused before anything is read', async () => {
  const id = await makeOrder();
  await assert.rejects(
    advance({ orderId: id, to: 'teleported' }),
    (err) => err instanceof NotAllowed && err.status === 400
  );
});

test('an order that does not exist is a 404, not a crash', async () => {
  await assert.rejects(
    advance({ orderId: 999999, to: 'packed' }),
    (err) => err instanceof NotAllowed && err.status === 404
  );
});

/* ---------------------------------------------------------------- stock -- */

test('cancelling puts the stock back', async () => {
  const product = TEST_PRODUCTS[1];
  const before = await stockOf(product);
  const id = await makeOrder({ productId: product, quantity: 2 });

  assert.equal(await stockOf(product), before - 2, 'the order should be holding two');

  await advance({ orderId: id, to: 'cancelled' });

  assert.equal(await stockOf(product), before, 'cancelling should have released them');
});

test('cancelling twice does not return the stock twice', async () => {
  const product = TEST_PRODUCTS[2];
  const before = await stockOf(product);
  const id = await makeOrder({ productId: product, quantity: 3 });

  await advance({ orderId: id, to: 'cancelled' });
  assert.equal(await stockOf(product), before);

  await assert.rejects(advance({ orderId: id, to: 'cancelled' }), (err) => err instanceof NotAllowed);

  assert.equal(await stockOf(product), before, 'the second attempt must not add three more');
});

test('packing and shipping do not touch stock', async () => {
  const product = TEST_PRODUCTS[3];
  const before = await stockOf(product);
  const id = await makeOrder({ productId: product, quantity: 1 });

  await advance({ orderId: id, to: 'packed' });
  await advance({ orderId: id, to: 'shipped' });

  assert.equal(await stockOf(product), before - 1, 'the item is sold, not back on the shelf');
});

/* ----------------------------------------------------------------- race -- */

test('two owners pressing ship at once produce one ship and one refusal', async () => {
  const id = await makeOrder();
  await advance({ orderId: id, to: 'packed' });

  const results = await Promise.allSettled([
    advance({ orderId: id, to: 'shipped' }),
    advance({ orderId: id, to: 'shipped' }),
  ]);

  const won = results.filter((r) => r.status === 'fulfilled');
  const lost = results.filter((r) => r.status === 'rejected');

  assert.equal(won.length, 1, 'exactly one should win');
  assert.equal(lost.length, 1, 'and exactly one should be told it lost');
  assert.ok(lost[0].reason instanceof NotAllowed);

  assert.equal(await stateOf(id), 'shipped');

  const events = await all('SELECT to_state FROM order_events WHERE order_id = ?', [id]);
  const shipped = events.filter((e) => e.to_state === 'shipped');
  assert.equal(shipped.length, 1, 'and only one event should have been written');
});

test('two cancels at once return the stock exactly once', async () => {
  const product = TEST_PRODUCTS[4];
  const before = await stockOf(product);
  const id = await makeOrder({ productId: product, quantity: 2 });

  await Promise.allSettled([
    advance({ orderId: id, to: 'cancelled' }),
    advance({ orderId: id, to: 'cancelled' }),
  ]);

  assert.equal(await stockOf(product), before, 'two cancels must not give back four');
});

/* ------------------------------------------------------------- timeline -- */

test('the timeline records every move, in order, with who did it', async () => {
  const id = await makeOrder();
  await advance({ orderId: id, to: 'packed', actorId: customerId, note: 'boxed by hand' });
  await advance({ orderId: id, to: 'shipped', actorId: customerId });

  const steps = await timeline(id);
  assert.deepEqual(
    steps.map((s) => s.state),
    ['processing', 'packed', 'shipped']
  );

  assert.ok(steps.every((s) => s.at), 'every step should be stamped');
  assert.ok(steps.every((s) => s.label), 'and have something a customer can read');
  assert.equal(steps[1].note, 'boxed by hand');

  const events = await all(
    'SELECT actor_id, from_state, to_state FROM order_events WHERE order_id = ? ORDER BY id',
    [id]
  );
  assert.equal(Number(events[0].actor_id), customerId);
  assert.equal(events[0].from_state, 'processing');
});

test('an order placed before the log existed still has a timeline', async () => {
  const id = await makeOrder();
  // Exactly what an old row looks like: a status, and no events at all.
  await run('DELETE FROM order_events WHERE order_id = ?', [id]);

  const steps = await timeline(id);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].state, INITIAL);
  assert.ok(steps[0].at, 'it falls back to when the order was placed');
});

/* ------------------------------------------------------- the map itself -- */

test('every state can be reached from the start', () => {
  const reached = new Set([INITIAL]);
  const queue = [INITIAL];

  while (queue.length) {
    for (const next of TRANSITIONS[queue.shift()]) {
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }

  for (const state of STATES) {
    assert.ok(reached.has(state), `${state} is in the map but nothing can reach it`);
  }
});

test('no state offers a move to something that is not a state', () => {
  for (const [from, options] of Object.entries(TRANSITIONS)) {
    for (const to of options) {
      assert.ok(STATES.includes(to), `${from} offers ${to}, which does not exist`);
      assert.ok(canMove(from, to));
    }
  }
});

test('the two finished states offer nothing further', () => {
  assert.deepEqual(nextStates('delivered'), []);
  assert.deepEqual(nextStates('cancelled'), []);
});

test('an order with no state yet is treated as processing', () => {
  assert.deepEqual(nextStates(null), TRANSITIONS[INITIAL]);
});
