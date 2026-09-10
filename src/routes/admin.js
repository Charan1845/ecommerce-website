/**
 * Shop owner routes. Everything here is blocked for ordinary customers.
 *
 * requireOwner is the authorization check: being logged in is not enough,
 * your role has to say 'owner'.
 */

const express = require('express');
const { all, get, run } = require('../db');
const { requireOwner } = require('../auth');

const router = express.Router();
router.use(requireOwner);

/** GET /api/admin/orders - every order in the shop. */
router.get('/orders', async (_req, res, next) => {
  try {
    const orders = await all(
      `SELECT o.id, o.status, o.total_paise, o.placed_at,
              o.shipping_name, o.shipping_state, o.shipping_pincode,
              u.username
       FROM orders o
       JOIN users u ON u.id = o.user_id
       ORDER BY o.placed_at DESC, o.id DESC`
    );

    for (const order of orders) {
      order.items = await all(
        `SELECT product_name, unit_price_paise, quantity
         FROM order_items WHERE order_id = ?`,
        [order.id]
      );
    }

    return res.json({ orders });
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
    const revenue = await get('SELECT COALESCE(SUM(total_paise), 0) AS total FROM orders');
    const orderCount = await get('SELECT COUNT(*) AS n FROM orders');
    const customers = await get("SELECT COUNT(*) AS n FROM users WHERE role = 'customer'");
    const outOfStock = await get('SELECT COUNT(*) AS n FROM products WHERE stock = 0');
    const lowStock = await all(
      'SELECT id, name, stock FROM products WHERE stock > 0 AND stock <= 3 ORDER BY stock, name'
    );

    // PostgreSQL returns SUM and COUNT as strings, since a bigint will not
    // always fit in a JavaScript number. Ours are small, so convert.
    return res.json({
      revenue_paise: Number(revenue.total),
      orders: Number(orderCount.n),
      customers: Number(customers.n),
      out_of_stock: Number(outOfStock.n),
      low_stock: lowStock,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
