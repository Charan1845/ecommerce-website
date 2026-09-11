/**
 * Shop owner routes. Everything here is blocked for ordinary customers.
 *
 * requireOwner is the authorization check: being logged in is not enough,
 * your role has to say 'owner'. There is exactly one way to become an owner -
 * the seed creates that account - because signing up always makes a customer.
 */

const express = require('express');
const { all, get, run } = require('../db');
const { requireOwner } = require('../auth');
const { runRace, raceable } = require('../race-demo');

const router = express.Router();
router.use(requireOwner);

const STATUSES = ['pending', 'paid', 'cancelled'];

/**
 * GET /api/admin/orders?status=pending&q=charan
 *
 * Every order in the shop, with the customer's contact and delivery details -
 * the things you would actually need to pack and post one.
 */
router.get('/orders', async (req, res, next) => {
  try {
    const conditions = [];
    const params = [];

    if (STATUSES.includes(req.query.status)) {
      conditions.push('o.status = ?');
      params.push(req.query.status);
    }

    if (req.query.q) {
      // LOWER on both sides so this behaves the same on SQLite and
      // PostgreSQL. Values travel as parameters, never glued into the SQL.
      conditions.push(
        `(LOWER(u.username) LIKE LOWER(?)
          OR LOWER(u.email) LIKE LOWER(?)
          OR LOWER(o.shipping_name) LIKE LOWER(?)
          OR o.shipping_phone LIKE ?
          OR o.shipping_pincode LIKE ?)`
      );
      const like = `%${req.query.q}%`;
      params.push(like, like, like, like, like);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const orders = await all(
      `SELECT o.id, o.status, o.total_paise, o.placed_at,
              o.shipping_name, o.shipping_phone, o.shipping_address,
              o.shipping_state, o.shipping_pincode,
              o.razorpay_payment_id, o.paid_at, o.payment_provider,
              u.id AS customer_id, u.username, u.email, u.phone AS account_phone
       FROM orders o
       JOIN users u ON u.id = o.user_id
       ${where}
       ORDER BY o.placed_at DESC, o.id DESC`,
      params
    );

    for (const order of orders) {
      order.items = await all(
        `SELECT product_id, product_name, unit_price_paise, quantity
         FROM order_items WHERE order_id = ?`,
        [order.id]
      );
    }

    return res.json({ orders, count: orders.length });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/admin/customers
 *
 * Who has bought what. The owner account is left out - it is the shop, not a
 * customer.
 */
router.get('/customers', async (_req, res, next) => {
  try {
    const customers = await all(
      `SELECT u.id, u.username, u.email, u.phone, u.state, u.created_at,
              COUNT(o.id) AS order_count,
              COALESCE(SUM(o.total_paise), 0) AS spent_paise,
              COALESCE(SUM(CASE WHEN o.status = 'paid' THEN o.total_paise ELSE 0 END), 0) AS paid_paise,
              MAX(o.placed_at) AS last_order_at
       FROM users u
       LEFT JOIN orders o ON o.user_id = u.id
       WHERE u.role = 'customer'
       GROUP BY u.id, u.username, u.email, u.phone, u.state, u.created_at
       ORDER BY COUNT(o.id) DESC, u.id DESC`
    );

    // PostgreSQL returns COUNT and SUM as strings, since a bigint does not
    // always fit in a JavaScript number. Ours are small.
    return res.json({
      customers: customers.map((c) => ({
        ...c,
        order_count: Number(c.order_count),
        spent_paise: Number(c.spent_paise),
        paid_paise: Number(c.paid_paise),
      })),
    });
  } catch (err) {
    return next(err);
  }
});

/** GET /api/admin/products - the catalogue with stock, lowest stock first. */
router.get('/products', async (_req, res, next) => {
  try {
    const products = await all(
      `SELECT id, name, brand, category, price_paise, stock
       FROM products ORDER BY stock ASC, name ASC`
    );
    return res.json({ products });
  } catch (err) {
    return next(err);
  }
});

/**
 * PATCH /api/admin/products/:id/stock  { stock }
 *
 * This exists so the last-item demo is repeatable: set the MX Master back to
 * 1, run the two-buyers test again, without touching the database by hand.
 */
router.patch('/products/:id/stock', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const stock = Number(req.body?.stock);

    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'Bad product id.' });
    }
    if (!Number.isInteger(stock) || stock < 0 || stock > 9999) {
      return res.status(400).json({ error: 'Stock must be a whole number from 0 to 9999.' });
    }

    const result = await run('UPDATE products SET stock = ? WHERE id = ?', [stock, id]);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'No such product.' });
    }

    const product = await get('SELECT id, name, stock FROM products WHERE id = ?', [id]);
    return res.json({ product });
  } catch (err) {
    return next(err);
  }
});

/** GET /api/admin/stats - the numbers for the top of the owner dashboard. */
router.get('/stats', async (_req, res, next) => {
  try {
    const revenue = await get(
      "SELECT COALESCE(SUM(total_paise), 0) AS total FROM orders WHERE status = 'paid'"
    );
    const awaiting = await get(
      "SELECT COALESCE(SUM(total_paise), 0) AS total, COUNT(*) AS n FROM orders WHERE status = 'pending'"
    );
    const orderCount = await get('SELECT COUNT(*) AS n FROM orders');
    const customers = await get("SELECT COUNT(*) AS n FROM users WHERE role = 'customer'");
    const outOfStock = await get('SELECT COUNT(*) AS n FROM products WHERE stock = 0');
    const lowStock = await all(
      'SELECT id, name, stock FROM products WHERE stock > 0 AND stock <= 3 ORDER BY stock, name'
    );

    return res.json({
      // Only paid orders count as money taken. Counting pending ones as
      // revenue is how a dashboard ends up flattering itself.
      revenue_paise: Number(revenue.total),
      awaiting_payment_paise: Number(awaiting.total),
      awaiting_payment_count: Number(awaiting.n),
      orders: Number(orderCount.n),
      customers: Number(customers.n),
      out_of_stock: Number(outOfStock.n),
      low_stock: lowStock,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/admin/race - which products can be raced on.
 */
router.get('/race', async (_req, res, next) => {
  try {
    return res.json({ products: await raceable() });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/admin/race  { product_id }
 *
 * Runs the two-buyers race against the real checkout and reports what
 * happened. Everything it creates is deleted afterwards and the product's
 * stock is put back, so this is safe to press on the live shop.
 *
 * Owner only - it briefly sets a product's stock to 1, which is not something
 * a customer should be able to do.
 */
router.post('/race', async (req, res, next) => {
  try {
    const productId = Number(req.body?.product_id);
    if (!Number.isInteger(productId)) {
      return res.status(400).json({ error: 'Bad product id.' });
    }

    return res.json(await runRace(productId));
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    return next(err);
  }
});

module.exports = router;
