/**
 * REST routes for the cart. You must be logged in for all of them.
 *
 * The cart stores only which product and how many - never the price. Prices
 * are read live from the catalogue every time the cart is shown, so a price
 * change appears immediately. Nothing has been bought yet, so there is
 * nothing to freeze.
 */

const express = require('express');
const { all, get, run } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

const MAX_PER_LINE = 10;

async function readCart(userId) {
  const items = await all(
    `SELECT c.product_id,
            c.quantity,
            p.name,
            p.brand,
            p.category,
            p.image,
            p.price_paise,
            p.stock
     FROM cart_items c
     JOIN products p ON p.id = c.product_id
     WHERE c.user_id = ?
     ORDER BY c.added_at`,
    [userId]
  );

  const lines = items.map((item) => ({
    ...item,
    line_total_paise: item.price_paise * item.quantity,
    // Stock can fall while something sits in a cart. Flag it here so the
    // cart page can warn before checkout rejects it.
    available: item.stock >= item.quantity,
  }));

  return {
    items: lines,
    total_paise: lines.reduce((sum, l) => sum + l.line_total_paise, 0),
    item_count: lines.reduce((sum, l) => sum + l.quantity, 0),
    has_problems: lines.some((l) => !l.available),
  };
}

/** GET /api/cart */
router.get('/', async (req, res, next) => {
  try {
    return res.json(await readCart(req.user.id));
  } catch (err) {
    return next(err);
  }
});

/** POST /api/cart  { product_id, quantity } - add, or increase if already there. */
router.post('/', async (req, res, next) => {
  try {
    const productId = Number(req.body?.product_id);
    const quantity = Number(req.body?.quantity ?? 1);

    if (!Number.isInteger(productId) || !Number.isInteger(quantity) || quantity < 1) {
      return res.status(400).json({ error: 'Bad product or quantity.' });
    }

    const product = await get('SELECT * FROM products WHERE id = ?', [productId]);
    if (!product) {
      return res.status(404).json({ error: 'No such product.' });
    }
    if (product.stock === 0) {
      return res.status(409).json({ error: `${product.name} is out of stock.` });
    }

    const existing = await get(
      'SELECT quantity FROM cart_items WHERE user_id = ? AND product_id = ?',
      [req.user.id, productId]
    );
    const wanted = (existing?.quantity || 0) + quantity;

    if (wanted > MAX_PER_LINE) {
      return res.status(409).json({ error: `You can order at most ${MAX_PER_LINE} of one item.` });
    }
    if (wanted > product.stock) {
      return res.status(409).json({ error: `Only ${product.stock} left of ${product.name}.` });
    }

    await run(
      `INSERT INTO cart_items (user_id, product_id, quantity)
       VALUES (?, ?, ?)
       ON CONFLICT (user_id, product_id) DO UPDATE SET quantity = ?`,
      [req.user.id, productId, wanted, wanted]
    );

    return res.status(201).json(await readCart(req.user.id));
  } catch (err) {
    return next(err);
  }
});

/** PATCH /api/cart/:productId  { quantity } - set an exact quantity. */
router.patch('/:productId', async (req, res, next) => {
  try {
    const productId = Number(req.params.productId);
    const quantity = Number(req.body?.quantity);

    if (!Number.isInteger(productId) || !Number.isInteger(quantity) || quantity < 0) {
      return res.status(400).json({ error: 'Bad product or quantity.' });
    }

    if (quantity === 0) {
      await run('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?', [
        req.user.id,
        productId,
      ]);
      return res.json(await readCart(req.user.id));
    }

    const product = await get('SELECT * FROM products WHERE id = ?', [productId]);
    if (!product) {
      return res.status(404).json({ error: 'No such product.' });
    }
    if (quantity > MAX_PER_LINE) {
      return res.status(409).json({ error: `You can order at most ${MAX_PER_LINE} of one item.` });
    }
    if (quantity > product.stock) {
      return res.status(409).json({ error: `Only ${product.stock} left of ${product.name}.` });
    }

    const result = await run(
      'UPDATE cart_items SET quantity = ? WHERE user_id = ? AND product_id = ?',
      [quantity, req.user.id, productId]
    );
    if (result.changes === 0) {
      return res.status(404).json({ error: 'That item is not in your cart.' });
    }

    return res.json(await readCart(req.user.id));
  } catch (err) {
    return next(err);
  }
});

/** DELETE /api/cart/:productId */
router.delete('/:productId', async (req, res, next) => {
  try {
    const productId = Number(req.params.productId);
    await run('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?', [
      req.user.id,
      productId,
    ]);
    return res.json(await readCart(req.user.id));
  } catch (err) {
    return next(err);
  }
});

/** DELETE /api/cart - empty it. */
router.delete('/', async (req, res, next) => {
  try {
    await run('DELETE FROM cart_items WHERE user_id = ?', [req.user.id]);
    return res.json(await readCart(req.user.id));
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
module.exports.readCart = readCart;
