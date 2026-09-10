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
         <button class="btn" data-pay="${order.id}" data-amount="${order.total_paise}">
           Pay ${rupees(order.total_paise)}
         </button>
         ${paymentConfig.test_mode
           ? '<span class="pay-note">Test mode - use card 4111 1111 1111 1111, any future expiry, any CVV. No real money moves.</span>'
           : ''}
       </div>`
    : '';

  const paidNote =
    order.status === 'paid' && order.razorpay_payment_id
      ? `<div class="pay-note">Paid ${order.paid_at ? when(order.paid_at) : ''} &middot;
           payment <code>${esc(order.razorpay_payment_id)}</code></div>`
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

/**
 * Open Razorpay's checkout for one order.
 *
 * Card details are typed into Razorpay's own window and go straight to them.
 * This page never sees them, and neither does our server.
 */
async function payForOrder(orderId, button) {
  const original = button.textContent.trim();
  button.disabled = true;
  button.textContent = 'Opening…';

  try {
    // Ask our server to create the payment order. The amount comes from our
    // database, not from anything on this page.
    const start = await apiPost(`/api/payments/orders/${orderId}`);

    const rzp = new window.Razorpay({
      key: start.key_id,
      amount: start.amount_paise,
      currency: 'INR',
      name: 'DevGear',
      description: `Order #${start.order_id}`,
      order_id: start.razorpay_order_id,
      prefill: start.prefill,
      theme: { color: '#2563eb' },

      // Razorpay calls this once the payment succeeds, handing us the ids and
      // a signature. Our server decides whether to believe it.
      handler: async (response) => {
        try {
          await apiPost('/api/payments/verify', {
            order_id: start.order_id,
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
          });
          showNotice(`Order #${start.order_id} is paid.`, 'success');
          await load();
        } catch (err) {
          showNotice(`Payment taken but not confirmed: ${err.message}`);
        }
      },

      modal: {
        ondismiss: () => {
          button.disabled = false;
          button.textContent = original;
          showNotice('Payment cancelled. The order is still waiting to be paid.', 'info');
        },
      },
    });

    rzp.on('payment.failed', (event) => {
      showNotice(event?.error?.description || 'The payment failed.');
      button.disabled = false;
      button.textContent = original;
    });

    rzp.open();
    button.textContent = original;
  } catch (err) {
    showNotice(err.message);
    button.disabled = false;
    button.textContent = original;
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
