/**
 * Tests for the parts of DevGear that are actually possible to get wrong.
 *
 * Run with:  npm test
 *
 * These run against SQLite in a throwaway file, so they are fast and need
 * nothing installed. Point DATABASE_URL at a scratch PostgreSQL database and
 * the same tests run against that instead - worth doing before deploying,
 * because that is where the checkout race becomes genuinely parallel.
 */

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

// These must be set before src/db is loaded, because it reads them on import.
const USING_PG = Boolean(process.env.DATABASE_URL);
const DB_FILE = path.join(os.tmpdir(), `devgear-test-${process.pid}-${Date.now()}.db`);
if (!USING_PG) process.env.DB_FILE = DB_FILE;
process.env.JWT_SECRET = 'test-only-secret';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { applySchema, get, all, run, close } = require('../src/db');
const { seedProducts, seedDemo } = require('../src/seed');
const { resetRateLimits } = require('../src/rate-limit');
const { createApp } = require('../src/app');

let server;
let BASE;

before(async () => {
  await applySchema();
  await seedProducts();
  await seedDemo();

  server = createApp().listen(0);
  BASE = `http://localhost:${server.address().port}`;
});

after(async () => {
  server?.close();
  // Windows will not delete a file that is still open, so close the database
  // before removing it.
  await close();
  if (!USING_PG) fs.rmSync(DB_FILE, { force: true });
});

/** A logged-in browser: remembers its own cookie, like a real one would. */
async function newCustomer(username) {
  let cookie = '';

  async function call(method, url, body) {
    const res = await fetch(BASE + url, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const setCookie = res.headers.getSetCookie?.() ?? [];
    if (setCookie.length) cookie = setCookie.map((c) => c.split(';')[0]).join('; ');

    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  // Every test signs people up; the signup limit is not what is under test.
  resetRateLimits();

  const signup = await call('POST', '/api/auth/signup', {
    username,
    email: `${username}@example.com`,
    password: 'a-good-password',
    confirm_password: 'a-good-password',
    phone: '9848012345',
    state: 'Telangana',
    terms: true,
  });
  assert.equal(signup.status, 201, `signup failed: ${JSON.stringify(signup.body)}`);

  return { call, username };
}

const SHIPPING = {
  shipping_name: 'Test Customer',
  shipping_phone: '9848012345',
  shipping_address: '12 Example Street, Test Colony',
  shipping_state: 'Telangana',
  shipping_pincode: '502313',
};

/** Cookie string from a plain fetch response. */
const cookieFrom = (res) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');

// ---------------------------------------------------------------------------

test('two buyers race for the last item and exactly one wins', async () => {
  // Product 13, the MX Master 3S, is seeded with stock 1.
  const productId = 13;
  await run('UPDATE products SET stock = 1 WHERE id = ?', [productId]);

  const alice = await newCustomer('alice_race');
  const bob = await newCustomer('bob_race');

  await alice.call('POST', '/api/cart', { product_id: productId, quantity: 1 });
  await bob.call('POST', '/api/cart', { product_id: productId, quantity: 1 });

  // Both press Place Order without waiting for the other.
  const [a, b] = await Promise.all([
    alice.call('POST', '/api/orders', SHIPPING),
    bob.call('POST', '/api/orders', SHIPPING),
  ]);

  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [201, 409], 'exactly one buyer should succeed');

  const loser = a.status === 409 ? a : b;
  assert.match(loser.body.error, /sold out|Only 0 left/i);

  // The shop must not have sold something it did not have.
  const product = await get('SELECT stock FROM products WHERE id = ?', [productId]);
  assert.equal(product.stock, 0, 'stock must land on 0, never below');

  const orders = await all('SELECT id FROM orders');
  assert.equal(orders.length, 1, 'only one order should exist');
});

test('the loser keeps their cart, so they can try something else', async () => {
  const productId = 14;
  await run('UPDATE products SET stock = 1 WHERE id = ?', [productId]);

  const carol = await newCustomer('carol_race');
  const dave = await newCustomer('dave_race');

  await carol.call('POST', '/api/cart', { product_id: productId, quantity: 1 });
  await dave.call('POST', '/api/cart', { product_id: productId, quantity: 1 });

  const [c] = await Promise.all([
    carol.call('POST', '/api/orders', SHIPPING),
    dave.call('POST', '/api/orders', SHIPPING),
  ]);

  const loser = c.status === 409 ? carol : dave;
  const cart = await loser.call('GET', '/api/cart');
  assert.equal(cart.body.items.length, 1, 'a failed checkout must not empty the cart');
});

test('an order with several items is all-or-nothing', async () => {
  // One item plentiful, one item gone. The whole order must fail, and the
  // plentiful one must not be quietly taken from stock.
  await run('UPDATE products SET stock = 50 WHERE id = 17');

  const eve = await newCustomer('eve_partial');
  await eve.call('POST', '/api/cart', { product_id: 17, quantity: 2 });

  // Put it in the cart while stock exists, then have it sell out underneath.
  await run('UPDATE products SET stock = 5 WHERE id = 18');
  await eve.call('POST', '/api/cart', { product_id: 18, quantity: 1 });
  await run('UPDATE products SET stock = 0 WHERE id = 18');

  const result = await eve.call('POST', '/api/orders', SHIPPING);
  assert.equal(result.status, 409);

  const plentiful = await get('SELECT stock FROM products WHERE id = 17');
  assert.equal(
    plentiful.stock,
    50,
    'a failed order must not take stock from the items that were fine'
  );
});

test('an order remembers the price it was placed at', async () => {
  const productId = 20;
  await run('UPDATE products SET stock = 5, price_paise = 54900 WHERE id = ?', [productId]);

  const frank = await newCustomer('frank_price');
  await frank.call('POST', '/api/cart', { product_id: productId, quantity: 1 });
  const placed = await frank.call('POST', '/api/orders', SHIPPING);
  assert.equal(placed.status, 201);

  // The shop doubles the price the next morning.
  await run('UPDATE products SET price_paise = 109800 WHERE id = ?', [productId]);

  const orders = await frank.call('GET', '/api/orders');
  const item = orders.body.orders[0].items[0];
  assert.equal(item.unit_price_paise, 54900, 'the receipt must still say what was paid');
  assert.equal(orders.body.orders[0].total_paise, 54900);
});

test('a cart shows the current price, not the price when it was added', async () => {
  const productId = 22;
  await run('UPDATE products SET stock = 5, price_paise = 89900 WHERE id = ?', [productId]);

  const grace = await newCustomer('grace_price');
  await grace.call('POST', '/api/cart', { product_id: productId, quantity: 1 });

  await run('UPDATE products SET price_paise = 49900 WHERE id = ?', [productId]);

  const cart = await grace.call('GET', '/api/cart');
  assert.equal(cart.body.total_paise, 49900, 'the cart should follow the live price');
});

test('a sold out product cannot be added to a cart', async () => {
  await run('UPDATE products SET stock = 0 WHERE id = 27');

  const heidi = await newCustomer('heidi_stock');
  const result = await heidi.call('POST', '/api/cart', { product_id: 27, quantity: 1 });

  assert.equal(result.status, 409);
  assert.match(result.body.error, /out of stock/i);
});

test('you cannot read another customer order', async () => {
  await run('UPDATE products SET stock = 5 WHERE id = 23');

  const ivan = await newCustomer('ivan_privacy');
  await ivan.call('POST', '/api/cart', { product_id: 23, quantity: 1 });
  const placed = await ivan.call('POST', '/api/orders', SHIPPING);
  const orderId = placed.body.order.id;

  const judy = await newCustomer('judy_privacy');
  const peek = await judy.call('GET', `/api/orders/${orderId}`);

  assert.equal(peek.status, 404, 'changing the id in the address bar must not work');
});

test('a customer cannot use the owner routes', async () => {
  const ken = await newCustomer('ken_role');

  const orders = await ken.call('GET', '/api/admin/orders');
  assert.equal(orders.status, 403);

  const stock = await ken.call('PATCH', '/api/admin/products/13/stock', { stock: 999 });
  assert.equal(stock.status, 403);
});

test('passwords are never stored as typed', async () => {
  await newCustomer('laura_hash');

  const row = await get('SELECT password_hash FROM users WHERE username = ?', ['laura_hash']);
  assert.ok(row.password_hash);
  assert.notEqual(row.password_hash, 'a-good-password');
  assert.match(row.password_hash, /^\$2[aby]\$/, 'should be a bcrypt hash');
});

test('checkout refuses an empty cart', async () => {
  const mike = await newCustomer('mike_empty');
  const result = await mike.call('POST', '/api/orders', SHIPPING);

  assert.equal(result.status, 400);
  assert.match(result.body.error, /empty/i);
});

test('a logged out visitor is sent to the login page', async () => {
  // redirect: 'manual' so we can see the redirect itself rather than the page
  // it lands on.
  const home = await fetch(`${BASE}/`, { redirect: 'manual' });
  assert.equal(home.status, 302);
  assert.match(home.headers.get('location'), /^\/login\.html\?next=/);

  const cart = await fetch(`${BASE}/cart.html`, { redirect: 'manual' });
  assert.equal(cart.status, 302);
  assert.match(cart.headers.get('location'), /next=%2Fcart\.html/);

  // The login page itself must stay reachable, or nobody could ever log in.
  const login = await fetch(`${BASE}/login.html`, { redirect: 'manual' });
  assert.equal(login.status, 200);

  // So must the files it needs to look like anything.
  const css = await fetch(`${BASE}/css/style.css`, { redirect: 'manual' });
  assert.equal(css.status, 200);
});

test('the demo button logs you in without an account', async () => {
  const offered = await fetch(`${BASE}/api/auth/demo`);
  assert.equal((await offered.json()).available, true);

  const login = await fetch(`${BASE}/api/auth/demo-login`, { method: 'POST' });
  assert.equal(login.status, 200);

  const cookie = cookieFrom(login);
  assert.ok(cookie, 'demo login must set a login cookie');

  // And that cookie really does get you into the shop.
  const products = await fetch(`${BASE}/api/products`, { headers: { cookie } });
  assert.equal(products.status, 200);
});

test('the demo account is a customer, not the owner', async () => {
  const login = await fetch(`${BASE}/api/auth/demo-login`, { method: 'POST' });
  const cookie = cookieFrom(login);

  const { user } = await login.json();
  assert.equal(user.role, 'customer');

  // Anyone at all can press that button, so it must not reach the owner pages.
  const orders = await fetch(`${BASE}/api/admin/orders`, { headers: { cookie } });
  assert.equal(orders.status, 403);

  const stock = await fetch(`${BASE}/api/admin/products/13/stock`, {
    method: 'PATCH',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ stock: 999 }),
  });
  assert.equal(stock.status, 403);
});

test('the demo account can be switched off for a deployment', async () => {
  process.env.DEMO_LOGIN = 'off';
  try {
    const offered = await fetch(`${BASE}/api/auth/demo`);
    assert.equal((await offered.json()).available, false);

    const login = await fetch(`${BASE}/api/auth/demo-login`, { method: 'POST' });
    assert.equal(login.status, 404);
  } finally {
    delete process.env.DEMO_LOGIN;
  }
});

test('an owner account can never be handed out as the demo', async () => {
  // If somebody ever renamed the demo account onto an owner, the endpoint has
  // to refuse rather than give the shop away.
  await run("UPDATE users SET role = 'owner' WHERE username = 'demo'");
  try {
    const login = await fetch(`${BASE}/api/auth/demo-login`, { method: 'POST' });
    assert.equal(login.status, 404);
  } finally {
    await run("UPDATE users SET role = 'customer' WHERE username = 'demo'");
  }
});

test('the catalogue data is behind the login too', async () => {
  const products = await fetch(`${BASE}/api/products`);
  assert.equal(products.status, 401, 'the door is locked, the window must be too');

  const one = await fetch(`${BASE}/api/products/13`);
  assert.equal(one.status, 401);
});

test('password guessing gets locked out', async () => {
  resetRateLimits();

  const wrong = () =>
    fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'owner', password: 'not-the-password' }),
    });

  // The first several wrong guesses are simply rejected.
  for (let i = 0; i < 8; i++) {
    const res = await wrong();
    assert.equal(res.status, 401, `attempt ${i + 1} should be a plain rejection`);
  }

  // After that the door closes, without the server even checking.
  const blocked = await wrong();
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers.get('retry-after'), 'should say how long to wait');

  resetRateLimits();
});

test('a correct password still works after a couple of typos', async () => {
  resetRateLimits();

  const login = (password) =>
    fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'demo', password }),
    });

  // Somebody mistyping their own password must not be locked out.
  assert.equal((await login('wrong-one')).status, 401);
  assert.equal((await login('wrong-again')).status, 401);

  const ok = await login(process.env.DEMO_PASSWORD || 'demo1234');
  assert.equal(ok.status, 200, 'the real password must still be accepted');

  resetRateLimits();
});

/* ---------------------------------------------------------------------- */
/* paying                                                                   */
/* ---------------------------------------------------------------------- */

const TEST_SECRET = 'test_secret_not_a_real_razorpay_key';

/** Sign the way Razorpay would, so these tests never call their API. */
const signLikeRazorpay = (razorpayOrderId, paymentId, secret = TEST_SECRET) =>
  crypto.createHmac('sha256', secret).update(razorpayOrderId + '|' + paymentId).digest('hex');

/** Turn payments on for one test, and always turn them back off. */
async function withPayments(fn) {
  process.env.RAZORPAY_KEY_ID = 'rzp_test_fake_key_id';
  process.env.RAZORPAY_KEY_SECRET = TEST_SECRET;
  try {
    return await fn();
  } finally {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
  }
}

/** A customer with one pending order, ready to be paid for. */
async function customerWithOrder(username, productId) {
  await run('UPDATE products SET stock = 5 WHERE id = ?', [productId]);
  const customer = await newCustomer(username);
  await customer.call('POST', '/api/cart', { product_id: productId, quantity: 1 });
  const placed = await customer.call('POST', '/api/orders', SHIPPING);
  assert.equal(placed.status, 201);
  return { customer, orderId: placed.body.order.id };
}

test('with no keys configured, paying is simply not offered', async () => {
  const config = await (await fetch(BASE + '/api/payments/config')).json();
  assert.equal(config.enabled, false);
  assert.equal(config.key_id, null, 'no key should be handed out when disabled');

  const { customer, orderId } = await customerWithOrder('olive_nopay', 30);
  const start = await customer.call('POST', '/api/payments/orders/' + orderId);
  assert.equal(start.status, 503);
});

test('the public key is shared but the secret never is', async () => {
  await withPayments(async () => {
    const config = await (await fetch(BASE + '/api/payments/config')).json();
    assert.equal(config.enabled, true);
    assert.equal(config.test_mode, true, 'an rzp_test_ key must be reported as test mode');
    assert.equal(config.key_id, 'rzp_test_fake_key_id');
    assert.ok(!JSON.stringify(config).includes(TEST_SECRET), 'the secret must never reach the browser');
  });
});

test('a real Razorpay signature is accepted and a forged one is not', async () => {
  await withPayments(async () => {
    const { customer, orderId } = await customerWithOrder('peter_pay', 31);

    // Stand in for the call to Razorpay: pretend they created this order.
    const rzpOrderId = 'order_TESTfake123';
    await run('UPDATE orders SET razorpay_order_id = ? WHERE id = ?', [rzpOrderId, orderId]);

    const forged = await customer.call('POST', '/api/payments/verify', {
      order_id: orderId,
      razorpay_order_id: rzpOrderId,
      razorpay_payment_id: 'pay_TESTfake123',
      razorpay_signature: 'nonsense',
    });
    assert.equal(forged.status, 400, 'an unsigned claim of payment must be refused');

    const stillPending = await get('SELECT status FROM orders WHERE id = ?', [orderId]);
    assert.equal(stillPending.status, 'pending', 'a forged payment must not mark it paid');

    const genuine = await customer.call('POST', '/api/payments/verify', {
      order_id: orderId,
      razorpay_order_id: rzpOrderId,
      razorpay_payment_id: 'pay_TESTfake123',
      razorpay_signature: signLikeRazorpay(rzpOrderId, 'pay_TESTfake123'),
    });
    assert.equal(genuine.status, 200);
    assert.equal(genuine.body.status, 'paid');

    const paid = await get('SELECT status, razorpay_payment_id, paid_at FROM orders WHERE id = ?', [orderId]);
    assert.equal(paid.status, 'paid');
    assert.equal(paid.razorpay_payment_id, 'pay_TESTfake123');
    assert.ok(paid.paid_at, 'paid_at should be recorded');
  });
});

test('a genuine signature from a different order cannot be reused', async () => {
  await withPayments(async () => {
    // A cheap order that really was paid for.
    const cheap = await customerWithOrder('quinn_cheap', 17);
    const cheapRzp = 'order_TESTcheap';
    await run('UPDATE orders SET razorpay_order_id = ? WHERE id = ?', [cheapRzp, cheap.orderId]);
    const paymentId = 'pay_TESTcheap';
    const realSignature = signLikeRazorpay(cheapRzp, paymentId);

    await cheap.customer.call('POST', '/api/payments/verify', {
      order_id: cheap.orderId,
      razorpay_order_id: cheapRzp,
      razorpay_payment_id: paymentId,
      razorpay_signature: realSignature,
    });

    // Now try to spend that same genuine signature on an expensive order.
    const pricey = await customerWithOrder('quinn_pricey', 36);
    await run('UPDATE orders SET razorpay_order_id = ? WHERE id = ?', ['order_TESTpricey', pricey.orderId]);

    const replay = await pricey.customer.call('POST', '/api/payments/verify', {
      order_id: pricey.orderId,
      razorpay_order_id: cheapRzp,
      razorpay_payment_id: paymentId,
      razorpay_signature: realSignature,
    });

    assert.equal(replay.status, 400, 'a signature belonging to another order must be refused');
    const still = await get('SELECT status FROM orders WHERE id = ?', [pricey.orderId]);
    assert.equal(still.status, 'pending');
  });
});

test('you cannot start paying for another customer order', async () => {
  await withPayments(async () => {
    const mine = await customerWithOrder('rita_owner', 20);
    const stranger = await newCustomer('sam_stranger');

    const attempt = await stranger.call('POST', '/api/payments/orders/' + mine.orderId);
    assert.equal(attempt.status, 404, 'another customer order must not even be visible');
  });
});

test('an order that is already paid cannot be paid again', async () => {
  await withPayments(async () => {
    const { customer, orderId } = await customerWithOrder('tina_twice', 23);
    const rzpOrderId = 'order_TESTtwice';
    await run('UPDATE orders SET razorpay_order_id = ? WHERE id = ?', [rzpOrderId, orderId]);

    const signature = signLikeRazorpay(rzpOrderId, 'pay_TESTtwice');

    const first = await customer.call('POST', '/api/payments/verify', {
      order_id: orderId,
      razorpay_order_id: rzpOrderId,
      razorpay_payment_id: 'pay_TESTtwice',
      razorpay_signature: signature,
    });
    assert.equal(first.status, 200);

    // Submitting the same success twice is a double click, not an attack.
    const again = await customer.call('POST', '/api/payments/verify', {
      order_id: orderId,
      razorpay_order_id: rzpOrderId,
      razorpay_payment_id: 'pay_TESTtwice',
      razorpay_signature: signature,
    });
    assert.equal(again.status, 200);
    assert.equal(again.body.already, true);

    // But starting a fresh payment for it must not be allowed.
    const restart = await customer.call('POST', '/api/payments/orders/' + orderId);
    assert.equal(restart.status, 409);
  });
});

test('checkout refuses a bad pincode', async () => {
  await run('UPDATE products SET stock = 5 WHERE id = 24');

  const nina = await newCustomer('nina_shipping');
  await nina.call('POST', '/api/cart', { product_id: 24, quantity: 1 });

  const result = await nina.call('POST', '/api/orders', { ...SHIPPING, shipping_pincode: '12' });
  assert.equal(result.status, 400);
  assert.ok(result.body.fields.shipping_pincode);
});
