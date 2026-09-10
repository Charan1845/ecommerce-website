/**
 * A pretend payment gateway.
 *
 * ---------------------------------------------------------------------------
 * THIS IS NOT A PAYMENT PROVIDER. No money moves. No card is real. Nothing
 * here is connected to any bank, and it must never be used to take money.
 * ---------------------------------------------------------------------------
 *
 * Why it exists: Razorpay will not hand out even test-mode keys without
 * identity documents, which is a lot to give a company so a student project
 * can show a green tick. This stands in for them so the checkout can be
 * clicked through end to end.
 *
 * What is genuinely being demonstrated, and what is not:
 *
 *   REAL - the shop's verification. It recomputes an HMAC signature and
 *          refuses anything that does not match, exactly as it does for
 *          Razorpay. The tests forge signatures and replay real ones from
 *          other orders, and the shop rejects them.
 *
 *   FAKE - the counterparty. Normally the signature proves a message came
 *          from Razorpay, because only Razorpay knows their secret. Here the
 *          same process plays both sides, so the signature proves the message
 *          came from us. That is the one thing a simulator cannot fake, and
 *          it is why this must never handle real money.
 *
 * The gateway is kept in a separate file from the shop on purpose, with its
 * own secret, so the shop's code has no way to shortcut the check.
 */

const crypto = require('node:crypto');

/** Payment orders this gateway has been asked to create. */
const orders = new Map();

const ORDER_TTL_MS = 30 * 60 * 1000;

/**
 * The gateway's signing secret - the stand-in for "something only Razorpay
 * knows". Derived from JWT_SECRET so it survives a restart (a payment started
 * before a redeploy can still be verified after it), but is not the same
 * value, because one secret doing two jobs means breaking one breaks both.
 */
function gatewaySecret() {
  if (process.env.SANDBOX_GATEWAY_SECRET) return process.env.SANDBOX_GATEWAY_SECRET;

  const base = process.env.JWT_SECRET || 'dev-only-secret-change-before-deploying';
  return crypto.createHash('sha256').update(`${base}:sandbox-gateway`).digest('hex');
}

function prune() {
  const now = Date.now();
  for (const [id, order] of orders) {
    if (now - order.createdAt > ORDER_TTL_MS) orders.delete(id);
  }
}

/** Mirrors Razorpay's create-order call. */
function createOrder({ amountPaise, receipt, notes = {} }) {
  prune();

  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    const err = new Error('A payment must be for a positive whole number of paise.');
    err.status = 400;
    throw err;
  }

  const id = `sandbox_order_${crypto.randomBytes(9).toString('hex')}`;
  orders.set(id, { id, amountPaise, receipt, notes, createdAt: Date.now(), authorized: false });

  return { id, amount: amountPaise, currency: 'INR', receipt, notes };
}

/**
 * Stands in for the customer completing payment in the gateway's own window.
 *
 * Returns the same three values Razorpay returns, signed the same way, so the
 * shop's verify step cannot tell the difference and does not need to.
 */
function authorize({ orderId, succeed = true }) {
  const order = orders.get(orderId);

  if (!order) {
    const err = new Error('That payment attempt has expired. Start it again.');
    err.status = 404;
    throw err;
  }
  if (order.authorized) {
    const err = new Error('That payment has already been completed.');
    err.status = 409;
    throw err;
  }

  if (!succeed) {
    // A declined card. The shop should leave the order pending.
    orders.delete(orderId);
    const err = new Error('The card was declined. (Simulated failure.)');
    err.status = 402;
    err.declined = true;
    throw err;
  }

  order.authorized = true;

  const paymentId = `sandbox_pay_${crypto.randomBytes(9).toString('hex')}`;
  const signature = sign(orderId, paymentId);

  return { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature };
}

/** The same construction Razorpay uses: HMAC-SHA256 of "<order>|<payment>". */
function sign(orderId, paymentId) {
  return crypto
    .createHmac('sha256', gatewaySecret())
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
}

/** Visible for tests. */
function reset() {
  orders.clear();
}

module.exports = { createOrder, authorize, sign, gatewaySecret, reset };
