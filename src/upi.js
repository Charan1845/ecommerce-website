/**
 * The UPI QR code shown by the simulated gateway.
 *
 * ---------------------------------------------------------------------------
 * THE QR CODE IS DELIBERATELY NOT PAYABLE.
 *
 * A real UPI QR encodes a real UPI id, and this shop is on the public
 * internet. If it carried a working id, a stranger could scan it and send
 * real money for an order that will never be packed or posted. Nobody should
 * lose a rupee to a portfolio project.
 *
 * So the payee address ends in `.invalid` - a top-level domain IANA reserves
 * permanently and refuses to register, precisely so it can be used for
 * addresses that must never resolve. A UPI app scanning this will look for
 * the payee, find nothing, and stop. There is no account behind it, and there
 * cannot be one.
 * ---------------------------------------------------------------------------
 *
 * Everything else about it is shaped like the real thing: the same `upi://`
 * scheme, the same parameters, the same amount in rupees, so the QR scans and
 * parses exactly as a genuine one would.
 */

const QRCode = require('qrcode');

/** Never a registrable address. That is the entire point. */
const SIMULATED_PAYEE = 'devgear-demo@simulation.invalid';

/**
 * Build the `upi://pay` string a UPI app would read.
 *
 * `am` is in rupees with two decimals - that is what the UPI spec wants, and
 * it is the one place in this project where money is not in whole paise. The
 * conversion happens here and nowhere else.
 */
function upiUri({ amountPaise, orderId }) {
  const rupees = (amountPaise / 100).toFixed(2);

  const params = new URLSearchParams({
    pa: SIMULATED_PAYEE,
    pn: 'DevGear (simulation)',
    am: rupees,
    cu: 'INR',
    tn: `DevGear order ${orderId} - simulated, not payable`,
  });

  return `upi://pay?${params.toString()}`;
}

/** The QR as inline SVG, so no image file has to be stored or served. */
async function upiQrSvg({ amountPaise, orderId }) {
  const uri = upiUri({ amountPaise, orderId });

  const svg = await QRCode.toString(uri, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 220,
    color: { dark: '#0f172a', light: '#ffffff' },
  });

  return { svg, uri, payee: SIMULATED_PAYEE };
}

module.exports = { upiUri, upiQrSvg, SIMULATED_PAYEE };
