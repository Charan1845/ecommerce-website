/**
 * Paying for an order that has already been placed.
 *
 * Orders are created as 'pending' by checkout. These routes are what turns a
 * pending order into a paid one, and nothing else in the app is allowed to
 * make that change.
 */

const express = require('express');
const { get, run } = require('../db');
const { requireAuth } = require('../auth');
const {
  isEnabled,
  isTestMode,
  keyId,
  createRazorpayOrder,
  verifyPaymentSignature,
} = require('../payments');

const router = express.Router();

/**
 * GET /api/payments/config
 *
 * The page asks whether paying is possible before showing a Pay button.
 * Returns the PUBLIC key only - the secret never leaves the server, and the
 * public key is meant to be in the page, which is why Razorpay gives you two.
 */
router.get('/config', (_req, res) => {
  res.json({
    enabled: isEnabled(),
    test_mode: isTestMode(),
    key_id: isEnabled() ? keyId() : null,
  });
});

router.use(requireAuth);

/**
 * POST /api/payments/orders/:id
 *
 * Start paying for one of your own pending orders.
 */
router.post('/orders/:id', async (req, res, next) => {
  try {
    if (!isEnabled()) {
      return res.status(503).json({ error: 'Payments are not switched on for this shop.' });
    }

    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'Bad order id.' });
    }

    // Both conditions matter. The user_id stops you paying - or reading the
    // total of - somebody else's order by changing the number in the URL.
    const order = await get('SELECT * FROM orders WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!order) {
      return res.status(404).json({ error: 'No such order.' });
    }
    if (order.status === 'paid') {
      return res.status(409).json({ error: 'That order has already been paid for.' });
    }
    if (order.status === 'cancelled') {
      return res.status(409).json({ error: 'That order was cancelled.' });
    }

    // The amount comes from our row, never from the request body.
    const created = await createRazorpayOrder({
      amountPaise: order.total_paise,
      receipt: `devgear-${order.id}`,
      notes: { devgear_order_id: String(order.id), username: req.user.username },
    });

    await run('UPDATE orders SET razorpay_order_id = ? WHERE id = ?', [created.id, order.id]);

    return res.json({
      key_id: keyId(),
      test_mode: isTestMode(),
      razorpay_order_id: created.id,
      amount_paise: order.total_paise,
      order_id: order.id,
      prefill: {
        name: order.shipping_name,
        email: req.user.email,
        contact: order.shipping_phone,
      },
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/payments/verify
 *
 * The browser reports a successful payment. Believe it only if the signature
 * checks out - this endpoint is public-facing, and "I paid, honest" is a free
 * order if nobody checks.
 */
router.post('/verify', async (req, res, next) => {
  try {
    if (!isEnabled()) {
      return res.status(503).json({ error: 'Payments are not switched on for this shop.' });
    }

    const orderId = Number(req.body?.order_id);
    const razorpayOrderId = req.body?.razorpay_order_id;
    const razorpayPaymentId = req.body?.razorpay_payment_id;
    const signature = req.body?.razorpay_signature;

    if (!Number.isInteger(orderId)) {
      return res.status(400).json({ error: 'Bad order id.' });
    }

    const order = await get('SELECT * FROM orders WHERE id = ? AND user_id = ?', [
      orderId,
      req.user.id,
    ]);
    if (!order) {
      return res.status(404).json({ error: 'No such order.' });
    }
    if (order.status === 'paid') {
      // Not an error worth shouting about - a double submit lands here.
      return res.json({ status: 'paid', already: true });
    }

    // The order id must be the one we asked Razorpay to create for this order.
    // Without this check, a genuine signature from a different, cheaper order
    // could be replayed to mark an expensive one paid.
    if (!order.razorpay_order_id || order.razorpay_order_id !== razorpayOrderId) {
      return res.status(400).json({ error: 'That payment does not belong to this order.' });
    }

    const genuine = verifyPaymentSignature({
      razorpayOrderId,
      razorpayPaymentId,
      signature,
    });

    if (!genuine) {
      return res.status(400).json({ error: 'That payment could not be verified.' });
    }

    // Only mark it paid if it is still pending, and say so by row count.
    const updated = await run(
      `UPDATE orders
       SET status = 'paid', razorpay_payment_id = ?, paid_at = ?
       WHERE id = ? AND status = 'pending'`,
      [razorpayPaymentId, new Date().toISOString(), order.id]
    );

    if (updated.changes === 0) {
      return res.status(409).json({ error: 'That order could not be marked paid.' });
    }

    return res.json({ status: 'paid', order_id: order.id });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
