/**
 * Orders: placing one, and reading your own.
 *
 * The checkout itself lives in src/checkout.js, because the owner's race
 * demonstration has to run the real thing rather than a copy of it. This file
 * validates the delivery address, calls it, and turns its errors into status
 * codes.
 */

const express = require('express');
const { all, get } = require('../db');
const { requireAuth } = require('../auth');
const { placeOrder, OutOfStock } = require('../checkout');
const { timeline, JOURNEY } = require('../fulfilment');

const router = express.Router();
router.use(requireAuth);

const PINCODE_RE = /^[1-9]\d{5}$/;
const PHONE_RE = /^[6-9]\d{9}$/;

function validateShipping(body) {
  const errors = {};
  const shipping = {
    name: (body.shipping_name || '').trim(),
    phone: (body.shipping_phone || '').trim(),
    address: (body.shipping_address || '').trim(),
    state: (body.shipping_state || '').trim(),
    pincode: (body.shipping_pincode || '').trim(),
  };

  if (shipping.name.length < 2) errors.shipping_name = 'Enter the full name.';
  if (!PHONE_RE.test(shipping.phone)) errors.shipping_phone = 'Enter a 10 digit mobile number.';
  if (shipping.address.length < 10) errors.shipping_address = 'Enter the full address.';
  if (!shipping.state) errors.shipping_state = 'Pick a state.';
  if (!PINCODE_RE.test(shipping.pincode)) errors.shipping_pincode = 'Enter a 6 digit pincode.';

  return { errors, shipping };
}

/**
 * POST /api/orders - place an order for everything in the cart.
 *
 * The whole thing runs inside one transaction, so it either happens
 * completely or not at all. A checkout that took the stock but failed to
 * write the order would be worse than one that simply failed.
 *
 * Note that everything inside uses the `tx` handed to the callback, not the
 * module-level helpers. On PostgreSQL a transaction lives on one connection,
 * and a query sent outside it would land on a different connection and not be
 * part of the transaction at all.
 */
router.post('/', async (req, res, next) => {
  const { errors, shipping } = validateShipping(req.body || {});
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Please fix the highlighted fields.', fields: errors });
  }

  try {
    const order = await placeOrder({ userId: req.user.id, shipping });
    return res.status(201).json({ order });
  } catch (err) {
    if (err instanceof OutOfStock) {
      // 409 Conflict: the request was fine, the world changed underneath it.
      return res.status(409).json({
        error: err.message,
        product_name: err.productName,
        remaining: err.remaining,
      });
    }
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    return next(err);
  }
});

/** GET /api/orders - this customer's own orders, newest first. */
router.get('/', async (req, res, next) => {
  try {
    const orders = await all(
      `SELECT id, status, fulfilment_status, total_paise, placed_at,
              razorpay_payment_id, paid_at, payment_provider
       FROM orders WHERE user_id = ? ORDER BY placed_at DESC, id DESC`,
      [req.user.id]
    );

    for (const order of orders) {
      order.items = await all(
        `SELECT product_id, product_name, unit_price_paise, quantity
         FROM order_items WHERE order_id = ?`,
        [order.id]
      );

      order.timeline = await timeline(order.id);
      order.journey = JOURNEY;
    }

    return res.json({ orders });
  } catch (err) {
    return next(err);
  }
});

/** GET /api/orders/:id - one order, only if it belongs to you. */
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'Bad order id.' });
    }

    // The user_id condition is the security check. Without it, changing the
    // number in the address bar would show you somebody else's order.
    const order = await get('SELECT * FROM orders WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!order) {
      return res.status(404).json({ error: 'No such order.' });
    }

    order.items = await all(
      `SELECT product_id, product_name, unit_price_paise, quantity
       FROM order_items WHERE order_id = ?`,
      [order.id]
    );

    order.timeline = await timeline(order.id);
    order.journey = JOURNEY;

    return res.json({ order });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
module.exports.OutOfStock = OutOfStock;
