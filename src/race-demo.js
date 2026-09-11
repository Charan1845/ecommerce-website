/**
 * The two-buyers race, run on demand so somebody can watch it happen.
 *
 * The most interesting thing this shop does is invisible. Two people click Buy
 * on the last item within microseconds of each other, one wins, and the only
 * evidence is a test that most people looking at the project will never run.
 *
 * This runs the same race against the live shop and reports what happened.
 *
 * Two things make it honest rather than theatre:
 *
 *   It calls the real checkout - `placeOrder` from src/checkout.js - the same
 *   function the Place Order button calls. A demonstration that ran a
 *   simplified copy would prove something about the copy.
 *
 *   It does not slow anything down or stage the result. Both checkouts start
 *   in the same tick and the database decides. Run it twice and a different
 *   buyer wins, because it is a real race.
 *
 * Everything it creates is removed afterwards, including if it throws, and the
 * product's stock is put back exactly as it was found.
 */

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const { all, get, run } = require('./db');
const { placeOrder, OutOfStock } = require('./checkout');

const BUYERS = ['Buyer A', 'Buyer B'];

const SHIPPING = {
  name: 'Race demonstration',
  phone: '9000000000',
  address: 'Not a real delivery - this order is deleted immediately',
  state: 'Telangana',
  pincode: '500001',
};

/**
 * Throwaway accounts for the two buyers.
 *
 * Given a random password nobody is told, because nothing ever logs in as
 * them - the demo calls checkout directly. They are deleted at the end, so
 * they never appear in the customer list or the order history.
 */
async function createRacer(suffix) {
  const username = `race_demo_${suffix}_${crypto.randomBytes(3).toString('hex')}`;

  const created = await get(
    `INSERT INTO users (username, email, password_hash, role)
     VALUES (?, ?, ?, 'customer')
     RETURNING id`,
    [username, `${username}@race.invalid`, bcrypt.hashSync(crypto.randomBytes(12).toString('hex'), 4)]
  );

  return { id: Number(created.id), username };
}

async function removeRacer(racer) {
  await run(
    'DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id = ?)',
    [racer.id]
  );
  await run('DELETE FROM orders WHERE user_id = ?', [racer.id]);
  await run('DELETE FROM cart_items WHERE user_id = ?', [racer.id]);
  await run('DELETE FROM users WHERE id = ?', [racer.id]);
}

/**
 * Set the stage, start both buyers at once, report, then put everything back.
 *
 * @param {number} productId which product they both want
 */
async function runRace(productId) {
  const product = await get('SELECT id, name, brand, stock FROM products WHERE id = ?', [productId]);
  if (!product) {
    const err = new Error('No such product.');
    err.status = 404;
    throw err;
  }

  const stockBefore = product.stock;
  const racers = [];

  try {
    racers.push(await createRacer('a'), await createRacer('b'));

    // One item, two buyers who both want it.
    await run('UPDATE products SET stock = 1 WHERE id = ?', [productId]);
    for (const racer of racers) {
      await run('INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, 1)', [
        racer.id,
        productId,
      ]);
    }

    // Both start here, in the same tick. Nothing decides the winner except
    // which transaction reaches the UPDATE first.
    const startedAt = Date.now();
    const settled = await Promise.allSettled(
      racers.map((racer) => placeOrder({ userId: racer.id, shipping: SHIPPING }))
    );
    const elapsedMs = Date.now() - startedAt;

    const buyers = settled.map((result, index) => {
      if (result.status === 'fulfilled') {
        return {
          buyer: BUYERS[index],
          outcome: 'won',
          order_id: result.value.id,
          message: 'Order placed.',
        };
      }

      const reason = result.reason;
      return {
        buyer: BUYERS[index],
        outcome: reason instanceof OutOfStock ? 'lost' : 'error',
        message: reason?.message || 'Something went wrong.',
      };
    });

    const after = await get('SELECT stock FROM products WHERE id = ?', [productId]);

    const winners = buyers.filter((b) => b.outcome === 'won').length;
    const losers = buyers.filter((b) => b.outcome === 'lost').length;

    return {
      product: { id: product.id, name: product.name, brand: product.brand },
      stock_at_start: 1,
      buyers,
      stock_after: after.stock,
      elapsed_ms: elapsedMs,
      // The three things that have to be true. Shown rather than asserted,
      // so a failure would be visible on the page instead of hidden.
      checks: {
        exactly_one_winner: winners === 1,
        exactly_one_told_sold_out: losers === 1,
        stock_landed_on_zero: after.stock === 0,
      },
      stock_restored_to: stockBefore,
    };
  } finally {
    // Runs even if the race threw. The shop must be left exactly as found.
    for (const racer of racers) {
      await removeRacer(racer).catch(() => {});
    }
    await run('UPDATE products SET stock = ? WHERE id = ?', [stockBefore, productId]).catch(() => {});
  }
}

/** Products worth racing on - anything actually in stock. */
async function raceable() {
  return all(
    `SELECT id, name, brand, stock FROM products
     WHERE stock > 0 ORDER BY category, name`
  );
}

module.exports = { runRace, raceable };
