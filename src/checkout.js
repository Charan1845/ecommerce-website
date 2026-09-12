/**
 * Placing an order.
 *
 * This lives apart from the route that calls it for one reason: the owner's
 * race demonstration needs to run *the real checkout*, twice at once. A demo
 * that ran a simplified copy would prove nothing about the shop - it would
 * prove something about the copy.
 *
 * So there is exactly one implementation, and both callers use it.
 */

const { transaction } = require('./db');
const { holdUntil } = require('./stock-holds');

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

/**
 * Turn one customer's cart into an order.
 *
 * The whole thing runs inside one transaction, so it either happens
 * completely or not at all. A checkout that took the stock but failed to
 * write the order would be worse than one that simply failed.
 *
 * Everything inside uses the `tx` handed to the callback, not the
 * module-level helpers. On PostgreSQL a transaction lives on one connection,
 * and a query sent outside it would land on a different connection and not be
 * part of the transaction at all.
 */
async function placeOrder({ userId, shipping }) {
  return transaction(async (tx) => {
    const cart = await tx.all(
      `SELECT c.product_id, c.quantity
       FROM cart_items c
       WHERE c.user_id = ?
       ORDER BY c.product_id`,
      [userId]
    );

    if (cart.length === 0) {
      const err = new Error('Your cart is empty.');
      err.status = 400;
      throw err;
    }

    let total = 0;
    const lines = [];

    for (const line of cart) {
      // -----------------------------------------------------------------
      // This single statement is the heart of the project.
      //
      // The obvious way to write checkout is: read the stock, check it is
      // enough, then subtract. That is wrong, and it is wrong in a way that
      // only shows up under load. Between your read and your subtraction
      // somebody else can do their own read - both see "1 left", both decide
      // it is fine, and both sell the same mouse.
      //
      // Instead the check and the subtraction are one statement. The database
      // applies it to a row at a time, so the WHERE clause is tested at the
      // moment of the write, not before it.
      //
      // If it changed a row, the stock was there and is now ours.
      // If it changed nothing, somebody else got in first - and we find out by
      // looking at how many rows changed, not by asking a second time.
      // -----------------------------------------------------------------
      const taken = await tx.run(
        'UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?',
        [line.quantity, line.product_id, line.quantity]
      );

      const product = await tx.get('SELECT name, price_paise, stock FROM products WHERE id = ?', [
        line.product_id,
      ]);

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

    // The stock above is now this order's, and this is how long it may keep it
    // while it waits to be paid for. Null when holds are switched off, which
    // means the order keeps its stock indefinitely - the behaviour before
    // src/stock-holds.js existed.
    const holdsUntil = holdUntil();

    const created = await tx.get(
      `INSERT INTO orders
         (user_id, status, total_paise, shipping_name, shipping_phone,
          shipping_address, shipping_state, shipping_pincode, hold_expires_at)
       VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
      [
        userId,
        total,
        shipping.name,
        shipping.phone,
        shipping.address,
        shipping.state,
        shipping.pincode,
        holdsUntil,
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

    await tx.run('DELETE FROM cart_items WHERE user_id = ?', [userId]);

    return {
      id: orderId,
      total_paise: total,
      status: 'pending',
      hold_expires_at: holdsUntil,
      items: lines,
    };
  });
}

module.exports = { placeOrder, OutOfStock };
