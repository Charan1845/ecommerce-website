/**
 * Paying, through one of two providers.
 *
 *   razorpay - the real thing, in test mode. Used when both Razorpay keys are
 *              configured.
 *   sandbox  - a pretend gateway that lives in this repository. Used when
 *              PAYMENT_SANDBOX=on and there are no Razorpay keys, so the
 *              checkout can be clicked through without handing a payments
 *              company identity documents for a demo shop.
 *
 * The shop's own code does not care which is in use. It asks for a payment
 * order, gets an id back, and later checks a signature. Everything specific
 * to a provider is in this file.
 *
 * The single most important thing here is what it does NOT do: it never sees
 * a card number. With Razorpay the details are typed into Razorpay's own
 * window on Razorpay's domain. With the sandbox there is no card at all - the
 * form is a drawing.
 *
 * The flow, in order:
 *
 *   1. browser  -> us          "I want to pay for order 12"
 *   2. us       -> gateway     "create a payment order for 79800 paise"
 *   3. us       -> browser     payment order id
 *   4. browser  -> gateway     completes the payment
 *   5. gateway  -> browser     payment id + a signature
 *   6. browser  -> us          those three values
 *   7. us                      recompute the signature and compare
 *
 * Step 7 is the one that matters. Without it, anyone could POST "payment
 * succeeded" to our server and get free hardware.
 */

const crypto = require('node:crypto');
const sandbox = require('./sandbox-gateway');

const RAZORPAY_API = 'https://api.razorpay.com/v1';

const keyId = () => process.env.RAZORPAY_KEY_ID || '';
const keySecret = () => process.env.RAZORPAY_KEY_SECRET || '';

const hasRazorpay = () => Boolean(keyId() && keySecret());
const sandboxAllowed = () => process.env.PAYMENT_SANDBOX === 'on';

/** 'razorpay', 'sandbox', or null when paying is switched off entirely. */
function provider() {
  if (hasRazorpay()) return 'razorpay';
  if (sandboxAllowed()) return 'sandbox';
  return null;
}

const isEnabled = () => provider() !== null;

/** True when nothing that happens can move money. Both modes here are that. */
const isSimulated = () => provider() === 'sandbox';

/**
 * Razorpay keys are prefixed by mode. A key starting rzp_test_ can only ever
 * move imaginary money, which is what this project wants.
 */
const isTestMode = () => (provider() === 'sandbox' ? true : keyId().startsWith('rzp_test_'));

function authHeader() {
  return `Basic ${Buffer.from(`${keyId()}:${keySecret()}`).toString('base64')}`;
}

/** Whichever secret belongs to the provider currently in use. */
function signingSecret() {
  return provider() === 'sandbox' ? sandbox.gatewaySecret() : keySecret();
}

/**
 * Ask the gateway to create a payment order.
 *
 * `amountPaise` always comes from our own database, never from the browser.
 * If the browser could name its own price, it would.
 */
async function createPaymentOrder({ amountPaise, receipt, notes = {} }) {
  if (provider() === 'sandbox') {
    return sandbox.createOrder({ amountPaise, receipt, notes });
  }

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
    const message = body?.error?.description || `The payment provider refused the request (${res.status})`;
    const err = new Error(message);
    err.status = 502;
    throw err;
  }

  return body;
}

/**
 * Is this "payment succeeded" message genuine?
 *
 * The gateway signs `<order_id>|<payment_id>` with a secret. Recomputing the
 * signature and getting the same answer proves the message was not edited on
 * the way here.
 *
 * With Razorpay it also proves the message came from Razorpay, because only
 * they know their secret. With the sandbox it does not prove that - the same
 * process signs and checks - which is exactly why the sandbox must never be
 * used for real money. The check itself is the same code either way.
 */
function verifyPaymentSignature({ razorpayOrderId, razorpayPaymentId, signature }) {
  if (!razorpayOrderId || !razorpayPaymentId || !signature) return false;

  const expected = crypto
    .createHmac('sha256', signingSecret())
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
  provider,
  isEnabled,
  isSimulated,
  isTestMode,
  keyId,
  createPaymentOrder,
  verifyPaymentSignature,
};
