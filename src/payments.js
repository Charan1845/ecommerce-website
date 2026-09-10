/**
 * Razorpay, in test mode.
 *
 * The single most important thing in this file is what it does NOT do: it
 * never sees a card number. The browser sends card details straight to
 * Razorpay's own checkout window, which is served from Razorpay's domain.
 * Razorpay then tells us "payment abc123 for order xyz succeeded", and we
 * check that message is genuine. Our server holds no card data at any point,
 * which is what keeps this out of PCI-DSS territory entirely.
 *
 * The flow, in order:
 *
 *   1. browser  -> us          "I want to pay for order 12"
 *   2. us       -> Razorpay    "create a payment order for 79800 paise"
 *   3. us       -> browser     razorpay_order_id + our public key
 *   4. browser  -> Razorpay    card details, directly, never through us
 *   5. Razorpay -> browser     payment id + a signature
 *   6. browser  -> us          those three values
 *   7. us                      recompute the signature and compare
 *
 * Step 7 is the one that matters. Without it, anyone could POST
 * "payment succeeded" to our server and get free hardware.
 */

const crypto = require('node:crypto');

const RAZORPAY_API = 'https://api.razorpay.com/v1';

const keyId = () => process.env.RAZORPAY_KEY_ID || '';
const keySecret = () => process.env.RAZORPAY_KEY_SECRET || '';

/** Payments only appear if both keys are configured. */
const isEnabled = () => Boolean(keyId() && keySecret());

/**
 * Razorpay keys are prefixed by mode. A key starting rzp_test_ can only ever
 * move imaginary money, which is what this project wants. Knowing which one
 * is loaded means the page can say so out loud rather than leaving a visitor
 * wondering whether they are about to be charged.
 */
const isTestMode = () => keyId().startsWith('rzp_test_');

function authHeader() {
  return `Basic ${Buffer.from(`${keyId()}:${keySecret()}`).toString('base64')}`;
}

/**
 * Ask Razorpay to create a payment order.
 *
 * `amountPaise` always comes from our own database, never from the browser.
 * If the browser could name its own price, it would.
 */
async function createRazorpayOrder({ amountPaise, receipt, notes = {} }) {
  const res = await fetch(`${RAZORPAY_API}/orders`, {
    method: 'POST',
    headers: {
      authorization: authHeader(),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      amount: amountPaise, // Razorpay counts in paise too, so no conversion.
      currency: 'INR',
      receipt: String(receipt),
      notes,
    }),
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    // Razorpay's message is safe to pass on - it says things like "amount
    // must be at least 100". It never contains our secret.
    const message = body?.error?.description || `Razorpay refused the request (${res.status})`;
    const err = new Error(message);
    err.status = 502;
    throw err;
  }

  return body;
}

/**
 * Is this "payment succeeded" message genuine?
 *
 * Razorpay signs `<order_id>|<payment_id>` with our key secret. Only we and
 * Razorpay know that secret, so recomputing the signature and getting the
 * same answer proves the message came from them and was not edited on the way.
 */
function verifyPaymentSignature({ razorpayOrderId, razorpayPaymentId, signature }) {
  if (!razorpayOrderId || !razorpayPaymentId || !signature) return false;

  const expected = crypto
    .createHmac('sha256', keySecret())
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');

  const given = Buffer.from(String(signature), 'utf8');
  const mine = Buffer.from(expected, 'utf8');

  // Lengths must match before timingSafeEqual will look at them, and it is
  // used instead of === so that comparison takes the same time whether the
  // first character is wrong or only the last one is. Comparing normally
  // leaks, very slightly, how much of a guess was correct.
  if (given.length !== mine.length) return false;
  return crypto.timingSafeEqual(given, mine);
}

module.exports = {
  isEnabled,
  isTestMode,
  keyId,
  createRazorpayOrder,
  verifyPaymentSignature,
};
