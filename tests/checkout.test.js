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

test('checkout refuses a bad pincode', async () => {
  await run('UPDATE products SET stock = 5 WHERE id = 24');

  const nina = await newCustomer('nina_shipping');
  await nina.call('POST', '/api/cart', { product_id: 24, quantity: 1 });

  const result = await nina.call('POST', '/api/orders', { ...SHIPPING, shipping_pincode: '12' });
  assert.equal(result.status, 400);
  assert.ok(result.body.fields.shipping_pincode);
});
