/**
 * Orders, and the checkout that creates them.
 *
 * This file is the point of the whole project. Everything else is a form or a
 * list; this is the part that has to be correct when two people click Buy at
 * the same instant.
 */

const express = require('express');
const { all, get, transaction } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

const PINCODE_RE = /^[1-9]\d{5}$/;
const PHONE_RE = /^[6-9]\d{9}$/;

/** Raised when somebody else took the last one first. */
class OutOfStock extends Error {
  constructor(productName, remaining) {
    super(
      remaining > 0
        ? `Only ${remaining} left of ${productName}.`
        : `${productName} sold out while you were checking out.`
    );
    this.name = 'OutOfStock';
    this.productName = productName;
    this.remaining = remaining;
  }
}

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
    const order = await transaction(async (tx) => {
      const cart = await tx.all(
        `SELECT c.product_id, c.quantity
         FROM cart_items c
         WHERE c.user_id = ?
         ORDER BY c.product_id`,
        [req.user.id]
      );

      if (cart.length === 0) {
        const err = new Error('Your cart is empty.');
        err.status = 400;
        throw err;
      }

      let total = 0;
      const lines = [];

      for (const line of cart) {
        // ---------------------------------------------------------------
        // This single statement is the heart of the project.
        //
        // The obvious way to write checkout is: read the stock, check it is
        // enough, then subtract. That is wrong, and it is wrong in a way that
        // only shows up under load. Between your read and your subtraction
        // somebody else can do their own read - both see "1 left", both
        // decide it is fine, and both sell the same mouse.
        //
        // Instead the check and the subtraction are one statement. The
        // database applies it to a row at a time, so the WHERE clause is
        // tested at the moment of the write, not before it.
        //
        // If it changed a row, the stock was there and is now ours.
        // If it changed nothing, somebody else got in first - and we find out
        // by looking at how many rows changed, not by asking a second time.
        // ---------------------------------------------------------------
        const taken = await tx.run(
          'UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?',
          [line.quantity, line.product_id, line.quantity]
        );

        const product = await tx.get(
          'SELECT name, price_paise, stock FROM products WHERE id = ?',
          [line.product_id]
        );

        if (taken.changes === 0) {
          // Throwing rolls the transaction back, which puts back any stock
          // taken by earlier lines in this same order.
          throw new OutOfStock(product?.name ?? 'That item', product?.stock ?? 0);
        }

        total += product.price_paise * line.quantity;
        lines.push({
          product_id: line.product_id,
          // Copied on purpose. The order must still read correctly after the
          // catalogue price changes or the product is renamed.
          product_name: product.name,
          unit_price_paise: product.price_paise,
          quantity: line.quantity,
        });
      }

      const created = await tx.get(
        `INSERT INTO orders
           (user_id, status, total_paise, shipping_name, shipping_phone,
            shipping_address, shipping_state, shipping_pincode)
         VALUES (?, 'pending', ?, ?, ?, ?, ?, ?)
         RETURNING id`,
        [
          req.user.id,
          total,
          shipping.name,
          shipping.phone,
          shipping.address,
          shipping.state,
          shipping.pincode,
        ]
      );

      const orderId = Number(created.id);

      for (const line of lines) {
        await tx.run(
          `INSERT INTO order_items
             (order_id, product_id, product_name, unit_price_paise, quantity)
           VALUES (?, ?, ?, ?, ?)`,
          [orderId, line.product_id, line.product_name, line.unit_price_paise, line.quantity]
        );
      }

      await tx.run('DELETE FROM cart_items WHERE user_id = ?', [req.user.id]);

      return { id: orderId, total_paise: total, status: 'pending', items: lines };
    });

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
      `SELECT id, status, total_paise, placed_at
       FROM orders WHERE user_id = ? ORDER BY placed_at DESC, id DESC`,
      [req.user.id]
    );

    for (const order of orders) {
      order.items = await all(
        `SELECT product_id, product_name, unit_price_paise, quantity
         FROM order_items WHERE order_id = ?`,
        [order.id]
      );
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

    return res.json({ order });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
module.exports.OutOfStock = OutOfStock;
