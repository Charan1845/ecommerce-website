/**
 * Paying for an order that has already been placed.
 *
 * Orders are created as 'pending' by checkout. These routes are what turns a
 * pending order into a paid one, and nothing else in the app is allowed to
 * make that change.
 *
 * Note how little of this cares which gateway is in use. The shop asks for a
 * payment order, hands the browser an id, and later checks a signature. Only
 * src/payments.js knows whether that was Razorpay or the sandbox.
 */

const express = require('express');
const { get, run } = require('../db');
const { requireAuth } = require('../auth');
const sandboxGateway = require('../sandbox-gateway');
const { upiQrSvg } = require('../upi');
const {
  provider,
  isEnabled,
  isSimulated,
  isTestMode,
  keyId,
  createPaymentOrder,
  verifyPaymentSignature,
} = require('../payments');

const router = express.Router();

/**
 * GET /api/payments/config
 *
 * The page asks whether paying is possible before showing a Pay button, and
 * what to say about it. Returns the PUBLIC key only - the secret never leaves
 * the server, which is why Razorpay gives you two of them.
 */
router.get('/config', (_req, res) => {
  res.json({
    enabled: isEnabled(),
    provider: provider(),
    simulated: isSimulated(),
    test_mode: isEnabled() ? isTestMode() : false,
    key_id: provider() === 'razorpay' ? keyId() : null,
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
    const created = await createPaymentOrder({
      amountPaise: order.total_paise,
      receipt: `devgear-${order.id}`,
      notes: { devgear_order_id: String(order.id), username: req.user.username },
    });

    await run('UPDATE orders SET razorpay_order_id = ? WHERE id = ?', [created.id, order.id]);

    const response = {
      provider: provider(),
      simulated: isSimulated(),
      key_id: provider() === 'razorpay' ? keyId() : null,
      test_mode: isTestMode(),
      razorpay_order_id: created.id,
      amount_paise: order.total_paise,
      order_id: order.id,
      prefill: {
        name: order.shipping_name,
        email: req.user.email,
        contact: order.shipping_phone,
      },
    };

    // The simulator also offers a UPI QR, because that is how most people in
    // India actually pay. It is deliberately not payable - see src/upi.js.
    if (provider() === 'sandbox') {
      response.upi = await upiQrSvg({
        amountPaise: order.total_paise,
        orderId: order.id,
      });
    }

    return res.json(response);
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/payments/sandbox/authorize
 *
 * Stands in for the customer completing payment inside a real gateway's
 * window. Only exists in sandbox mode - with Razorpay configured this is a
 * 404, because the real gateway does this part and it is not ours to do.
 */
router.post('/sandbox/authorize', (req, res, next) => {
  try {
    if (provider() !== 'sandbox') {
      return res.status(404).json({ error: 'No such endpoint.' });
    }

    const result = sandboxGateway.authorize({
      orderId: req.body?.payment_order_id,
      succeed: req.body?.outcome !== 'failure',
    });

    return res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message, declined: Boolean(err.declined) });
    }
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

    // The payment order must be the one we asked the gateway to create for
    // this order. Without this check, a genuine signature from a different,
    // cheaper order could be replayed to mark an expensive one paid.
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
    // The provider is recorded too, so a receipt never hides the fact that it
    // was paid through a simulator.
    const updated = await run(
      `UPDATE orders
       SET status = 'paid', razorpay_payment_id = ?, paid_at = ?, payment_provider = ?
       WHERE id = ? AND status = 'pending'`,
      [razorpayPaymentId, new Date().toISOString(), provider(), order.id]
    );

    if (updated.changes === 0) {
      return res.status(409).json({ error: 'That order could not be marked paid.' });
    }

    return res.json({ status: 'paid', order_id: order.id, provider: provider() });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
