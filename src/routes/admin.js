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
router.get('/orders', (_req, res) => {
  const orders = all(
    `SELECT o.id, o.status, o.total_paise, o.placed_at,
            o.shipping_name, o.shipping_state, o.shipping_pincode,
            u.username
     FROM orders o
     JOIN users u ON u.id = o.user_id
     ORDER BY o.placed_at DESC, o.id DESC`
  );

  for (const order of orders) {
    order.items = all(
      `SELECT product_name, unit_price_paise, quantity
       FROM order_items WHERE order_id = ?`,
      [order.id]
    );
  }

  res.json({ orders });
});

/** GET /api/admin/products - the catalogue with stock, lowest stock first. */
router.get('/products', (_req, res) => {
  const products = all(
    `SELECT id, name, brand, category, price_paise, stock
     FROM products ORDER BY stock ASC, name ASC`
  );
  res.json({ products });
});

/**
 * PATCH /api/admin/products/:id/stock  { stock }
 *
 * This exists so the last-item demo is repeatable: set the MX Master back to
 * 1, run the two-buyers test again, without touching the database by hand.
 */
router.patch('/products/:id/stock', (req, res) => {
  const id = Number(req.params.id);
  const stock = Number(req.body?.stock);

  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Bad product id.' });
  }
  if (!Number.isInteger(stock) || stock < 0 || stock > 9999) {
    return res.status(400).json({ error: 'Stock must be a whole number from 0 to 9999.' });
  }

  const result = run('UPDATE products SET stock = ? WHERE id = ?', [stock, id]);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'No such product.' });
  }

  return res.json({ product: get('SELECT id, name, stock FROM products WHERE id = ?', [id]) });
});

/** GET /api/admin/stats - the numbers for the top of the owner dashboard. */
router.get('/stats', (_req, res) => {
  const revenue = get('SELECT COALESCE(SUM(total_paise), 0) AS total FROM orders');
  const orderCount = get('SELECT COUNT(*) AS n FROM orders');
  const customers = get("SELECT COUNT(*) AS n FROM users WHERE role = 'customer'");
  const outOfStock = get('SELECT COUNT(*) AS n FROM products WHERE stock = 0');
  const lowStock = all(
    'SELECT id, name, stock FROM products WHERE stock > 0 AND stock <= 3 ORDER BY stock, name'
  );

  res.json({
    revenue_paise: revenue.total,
    orders: orderCount.n,
    customers: customers.n,
    out_of_stock: outOfStock.n,
    low_stock: lowStock,
  });
});

module.exports = router;
