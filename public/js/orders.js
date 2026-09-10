/**
 * The customer's own order history, and paying for the pending ones.
 *
 * Every price shown here comes from the order itself, not from the catalogue.
 * That is why an old order still shows the price that was actually paid even
 * after the shop changes it.
 */

let paymentConfig = { enabled: false };

function when(value) {
  // SQLite hands back "YYYY-MM-DD HH:MM:SS" in UTC; PostgreSQL hands back a
  // full ISO timestamp. Accept either.
  const text = String(value);
  const date = new Date(text.includes('T') ? text : `${text.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function orderCard(order) {
  const rows = order.items
    .map(
      (item) => `
      <tr>
        <td><a href="/product.html?id=${item.product_id}">${esc(item.product_name)}</a></td>
        <td class="num">${rupees(item.unit_price_paise)}</td>
        <td class="num">${item.quantity}</td>
        <td class="num">${rupees(item.unit_price_paise * item.quantity)}</td>
      </tr>`
    )
    .join('');

  const payable = order.status === 'pending' && paymentConfig.enabled;

  const payRow = payable
    ? `<div class="pay-row">
         <button class="btn" data-pay="${order.id}">Pay ${rupees(order.total_paise)}</button>
         <span class="pay-note">
           ${paymentConfig.simulated
             ? 'Simulated payment. No card, no money, nothing leaves this site.'
             : 'Razorpay test mode - card 4111 1111 1111 1111, any future expiry, any CVV. No real money moves.'}
         </span>
       </div>`
    : '';

  const paidNote =
    order.status === 'paid' && order.razorpay_payment_id
      ? `<div class="pay-note">
           Paid ${order.paid_at ? when(order.paid_at) : ''} &middot;
           reference <code>${esc(order.razorpay_payment_id)}</code>
           ${order.payment_provider === 'sandbox'
             ? '<strong>&middot; simulated payment, no money moved</strong>'
             : ''}
         </div>`
      : '';

  return `
    <section class="panel" style="margin-bottom:20px">
      <div style="display:flex; flex-wrap:wrap; gap:12px; align-items:center; margin-bottom:14px">
        <h2 style="margin:0">Order #${order.id}</h2>
        <span class="pill ${esc(order.status)}">${esc(order.status)}</span>
        <span style="color:var(--ink-soft)">${when(order.placed_at)}</span>
        <strong style="margin-left:auto; font-size:18px">${rupees(order.total_paise)}</strong>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th class="num">Price paid</th>
              <th class="num">Qty</th>
              <th class="num">Line total</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>

      ${payRow}
      ${paidNote}
    </section>`;
}

/* ------------------------------------------------------------------ */
/* the simulated gateway's window                                      */
/* ------------------------------------------------------------------ */

/**
 * A stand-in for a real gateway's payment window.
 *
 * Deliberately does not look like a real checkout. The card field is disabled
 * and pre-filled with an obviously fake number, and the banner says what this
 * is - somebody landing on this page should never be in doubt about whether
 * they are about to be charged.
 */
function openSandboxWindow({ amountPaise, orderId }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'sandbox-overlay';
    overlay.innerHTML = `
      <div class="sandbox-window" role="dialog" aria-modal="true" aria-label="Simulated payment">
        <div class="sandbox-banner">Simulated payment &middot; not a real gateway</div>

        <div class="sandbox-body">
          <div class="sandbox-amount">${rupees(amountPaise)}</div>
          <p class="sandbox-for">DevGear &middot; Order #${orderId}</p>

          <label class="sandbox-label">Card number</label>
          <input class="sandbox-input" value="4111 1111 1111 1111" disabled>

          <div class="sandbox-split">
            <div>
              <label class="sandbox-label">Expiry</label>
              <input class="sandbox-input" value="12 / 30" disabled>
            </div>
            <div>
              <label class="sandbox-label">CVV</label>
              <input class="sandbox-input" value="123" disabled>
            </div>
          </div>

          <p class="sandbox-explain">
            These fields are a drawing. Nothing is typed, nothing is sent to a
            bank, and no money exists. What is real is what happens next: the
            gateway signs its answer, and the shop refuses it unless the
            signature checks out.
          </p>

          <button class="btn" id="sandbox-pay" style="width:100%">Pay ${rupees(amountPaise)}</button>
          <button class="btn secondary" id="sandbox-fail" style="width:100%; margin-top:8px">
            Simulate a declined card
          </button>
          <button class="btn danger" id="sandbox-cancel" style="width:100%; margin-top:4px">Cancel</button>
        </div>
      </div>`;

    const close = (outcome) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(outcome);
    };

    function onKey(e) {
      if (e.key === 'Escape') close('cancel');
    }

    overlay.querySelector('#sandbox-pay').addEventListener('click', () => close('success'));
    overlay.querySelector('#sandbox-fail').addEventListener('click', () => close('failure'));
    overlay.querySelector('#sandbox-cancel').addEventListener('click', () => close('cancel'));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close('cancel');
    });
    document.addEventListener('keydown', onKey);

    document.body.appendChild(overlay);
    overlay.querySelector('#sandbox-pay').focus();
  });
}

/** Hand the three values to our server, which decides whether to believe them. */
async function confirmPayment(orderId, payload) {
  await apiPost('/api/payments/verify', {
    order_id: orderId,
    razorpay_order_id: payload.razorpay_order_id,
    razorpay_payment_id: payload.razorpay_payment_id,
    razorpay_signature: payload.razorpay_signature,
  });
  showNotice(`Order #${orderId} is paid.`, 'success');
  await load();
}

/* ------------------------------------------------------------------ */

async function payForOrder(orderId, button) {
  const original = button.textContent.trim();
  button.disabled = true;
  button.textContent = 'Opening…';

  const restore = () => {
    button.disabled = false;
    button.textContent = original;
  };

  try {
    // Ask our server to create the payment order. The amount comes from our
    // database, not from anything on this page.
    const start = await apiPost(`/api/payments/orders/${orderId}`);

    if (start.provider === 'sandbox') {
      const outcome = await openSandboxWindow({
        amountPaise: start.amount_paise,
        orderId: start.order_id,
      });

      if (outcome === 'cancel') {
        showNotice('Payment cancelled. The order is still waiting to be paid.', 'info');
        restore();
        return;
      }

      try {
        const authorised = await apiPost('/api/payments/sandbox/authorize', {
          payment_order_id: start.razorpay_order_id,
          outcome,
        });
        await confirmPayment(start.order_id, authorised);
      } catch (err) {
        showNotice(err.message);
        restore();
      }
      return;
    }

    // Razorpay's own window.
    const rzp = new window.Razorpay({
      key: start.key_id,
      amount: start.amount_paise,
      currency: 'INR',
      name: 'DevGear',
      description: `Order #${start.order_id}`,
      order_id: start.razorpay_order_id,
      prefill: start.prefill,
      theme: { color: '#2563eb' },
      handler: async (response) => {
        try {
          await confirmPayment(start.order_id, response);
        } catch (err) {
          showNotice(`Payment taken but not confirmed: ${err.message}`);
        }
      },
      modal: {
        ondismiss: () => {
          restore();
          showNotice('Payment cancelled. The order is still waiting to be paid.', 'info');
        },
      },
    });

    rzp.on('payment.failed', (event) => {
      showNotice(event?.error?.description || 'The payment failed.');
      restore();
    });

    rzp.open();
    button.textContent = original;
  } catch (err) {
    showNotice(err.message);
    restore();
  }
}

async function load() {
  const { orders } = await apiGet('/api/orders');

  document.getElementById('empty').hidden = orders.length > 0;
  document.getElementById('sub').textContent = orders.length
    ? `${orders.length} order${orders.length === 1 ? '' : 's'}, newest first.`
    : '';
  document.getElementById('orders').innerHTML = orders.map(orderCard).join('');
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = await whoAmI();
  if (!user) {
    window.location.href = '/login.html?next=%2Forders.html';
    return;
  }

  const placed = new URLSearchParams(window.location.search).get('placed');
  if (placed) {
    showNotice(`Order #${placed} placed.`, 'success');
  }

  try {
    paymentConfig = await apiGet('/api/payments/config');
    await load();
  } catch (err) {
    showNotice(err.message);
  }

  document.getElementById('orders').addEventListener('click', (e) => {
    const button = e.target.closest('[data-pay]');
    if (button) payForOrder(Number(button.dataset.pay), button);
  });
});
