/**
 * The owner dashboard.
 *
 * Hiding this page from customers is only a convenience. The real protection
 * is on the server: every /api/admin route checks the role before answering,
 * so reading this file and calling those endpoints by hand gets you a 403.
 */

const filters = { status: '', q: '' };

function when(value) {
  if (!value) return '—';
  const text = String(value);
  const date = new Date(text.includes('T') ? text : `${text.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function statsHtml(s) {
  return [
    ['Revenue', rupees(s.revenue_paise), 'money actually taken'],
    ['Awaiting payment', rupees(s.awaiting_payment_paise), `${s.awaiting_payment_count} order(s)`],
    ['Orders', s.orders, 'all time'],
    ['Customers', s.customers, 'excluding you'],
    ['Sold out', s.out_of_stock, `${s.low_stock.length} low on stock`],
  ]
    .map(
      ([label, value, note]) => `
        <div class="stat">
          <div class="label">${label}</div>
          <div class="value">${value}</div>
          <div class="stat-note">${esc(note)}</div>
        </div>`
    )
    .join('');
}

/**
 * One order, with everything needed to actually pack and post it.
 *
 * Revenue counts paid orders only. A dashboard that counts pending ones is
 * flattering itself - the money has not arrived.
 */
function orderCard(order) {
  const rows = order.items
    .map(
      (i) => `<tr>
        <td>${esc(i.product_name)}</td>
        <td class="num">${rupees(i.unit_price_paise)}</td>
        <td class="num">${i.quantity}</td>
        <td class="num">${rupees(i.unit_price_paise * i.quantity)}</td>
      </tr>`
    )
    .join('');

  const payment =
    order.status === 'paid'
      ? `Paid ${when(order.paid_at)} &middot; reference <code>${esc(order.razorpay_payment_id || '—')}</code>
         ${order.payment_provider === 'sandbox'
           ? '<strong>&middot; simulated, no money moved</strong>'
           : ''}`
      : 'Not paid yet.';

  return `
    <section class="panel" style="margin-bottom:18px">
      <div style="display:flex; flex-wrap:wrap; gap:12px; align-items:center; margin-bottom:14px">
        <h2 style="margin:0">Order #${order.id}</h2>
        <span class="pill ${esc(order.status)}">${esc(order.status)}</span>
        <span style="color:var(--ink-soft)">${when(order.placed_at)}</span>
        <strong style="margin-left:auto; font-size:18px">${rupees(order.total_paise)}</strong>
      </div>

      <div class="admin-order-grid">
        <div>
          <div class="label">Customer</div>
          <div><strong>${esc(order.username)}</strong></div>
          <div>${esc(order.email)}</div>
          ${order.account_phone ? `<div>${esc(order.account_phone)}</div>` : ''}
        </div>

        <div>
          <div class="label">Deliver to</div>
          <div><strong>${esc(order.shipping_name)}</strong></div>
          <div>${esc(order.shipping_address)}</div>
          <div>${esc(order.shipping_state)} ${esc(order.shipping_pincode)}</div>
          <div>${esc(order.shipping_phone)}</div>
        </div>

        <div>
          <div class="label">Payment</div>
          <div>${payment}</div>
        </div>
      </div>

      <div class="table-wrap" style="margin-top:14px">
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
    </section>`;
}

function customerRow(c) {
  return `
    <tr>
      <td>
        <strong>${esc(c.username)}</strong>
        <div style="color:var(--ink-faint); font-size:12px">joined ${when(c.created_at)}</div>
      </td>
      <td>
        <div>${esc(c.email)}</div>
        ${c.phone ? `<div style="color:var(--ink-soft)">${esc(c.phone)}</div>` : ''}
      </td>
      <td>${esc(c.state || '—')}</td>
      <td class="num">${c.order_count}</td>
      <td class="num">${rupees(c.paid_paise)}</td>
      <td>${when(c.last_order_at)}</td>
    </tr>`;
}

function productRow(p) {
  return `
    <tr data-product="${p.id}">
      <td><a href="/product.html?id=${p.id}">${esc(p.name)}</a></td>
      <td>${esc(p.brand)}</td>
      <td>${esc(p.category)}</td>
      <td class="num">${rupees(p.price_paise)}</td>
      <td class="num">
        <input type="number" value="${p.stock}" min="0" max="9999" style="width:80px"
               data-stock="${p.id}" aria-label="Stock for ${esc(p.name)}">
      </td>
      <td><button class="btn secondary small" data-save="${p.id}">Save</button></td>
    </tr>`;
}


/* ------------------------------------------------------------------ */
/* the two-buyers race                                                 */
/* ------------------------------------------------------------------ */

function raceOutcome(buyer) {
  const won = buyer.outcome === 'won';
  const kind = won ? 'won' : buyer.outcome === 'lost' ? 'lost' : 'broke';

  return `
    <div class="race-buyer ${kind}">
      <div class="race-buyer-name">${esc(buyer.buyer)}</div>
      <div class="race-verdict">${won ? 'Got it' : buyer.outcome === 'lost' ? 'Turned away' : 'Error'}</div>
      <p>${esc(buyer.message)}</p>
      ${buyer.order_id ? `<div class="race-order">order #${buyer.order_id}</div>` : ''}
    </div>`;
}

function raceResult(r) {
  const allPassed = Object.values(r.checks).every(Boolean);

  const checks = [
    ['Exactly one buyer succeeded', r.checks.exactly_one_winner],
    ['The other was told it had sold out', r.checks.exactly_one_told_sold_out],
    ['Stock landed on zero, never below', r.checks.stock_landed_on_zero],
  ]
    .map(
      ([label, ok]) =>
        `<li class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'} ${label}</li>`
    )
    .join('');

  return `
    <section class="panel">
      <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-bottom:6px">
        <h2 style="margin:0">${esc(r.product.brand)} ${esc(r.product.name)}</h2>
        <span class="pill ${allPassed ? 'paid' : 'cancelled'}">
          ${allPassed ? 'behaved correctly' : 'PROBLEM'}
        </span>
        <span style="margin-left:auto; color:var(--ink-soft)">
          both finished in ${r.elapsed_ms} ms
        </span>
      </div>
      <p style="color:var(--ink-soft); margin-top:0">
        Started with 1 in stock. Both buyers wanted it.
      </p>

      <div class="race-grid">${r.buyers.map(raceOutcome).join('')}</div>

      <ul class="race-checks">${checks}</ul>

      <p class="pay-note">
        Stock after the race: <strong>${r.stock_after}</strong>.
        Put back to <strong>${r.stock_restored_to}</strong>, and both throwaway
        accounts and their orders have been deleted.
      </p>
    </section>`;
}

async function loadRaceProducts() {
  const { products } = await apiGet('/api/admin/race');
  const select = document.getElementById('race-product');

  select.innerHTML = products
    .map(
      (p) =>
        `<option value="${p.id}">${esc(p.brand)} ${esc(p.name)} — ${p.stock} in stock</option>`
    )
    .join('');
}

async function runRace() {
  const button = document.getElementById('race-run');
  const productId = Number(document.getElementById('race-product').value);

  button.disabled = true;
  button.textContent = 'Racing…';
  document.getElementById('race-result').innerHTML = '';

  try {
    const result = await apiPost('/api/admin/race', { product_id: productId });
    hideNotice();
    document.getElementById('race-result').innerHTML = raceResult(result);
    await loadRaceProducts();
  } catch (err) {
    showNotice(err.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Run the race';
  }
}

async function loadOrders() {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.q) params.set('q', filters.q);

  const { orders } = await apiGet(`/api/admin/orders?${params}`);
  document.getElementById('orders').innerHTML = orders.length
    ? orders.map(orderCard).join('')
    : '<div class="empty">No orders match that.</div>';
}

async function saveStock(id, button) {
  const input = document.querySelector(`[data-stock="${id}"]`);
  const stock = Number(input.value);

  button.disabled = true;
  const label = button.textContent;
  button.textContent = 'Saving…';

  try {
    await apiPatch(`/api/admin/products/${id}/stock`, { stock });
    hideNotice();
    button.textContent = 'Saved ✓';
    setTimeout(() => {
      button.textContent = label;
      button.disabled = false;
    }, 1200);
  } catch (err) {
    showNotice(err.message);
    button.textContent = label;
    button.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = await whoAmI();

  if (!user) {
    window.location.href = '/login.html?next=%2Fadmin.html';
    return;
  }
  if (user.role !== 'owner') {
    document.getElementById('denied').hidden = false;
    return;
  }

  document.getElementById('content').hidden = false;

  try {
    const [stats, customers, products] = await Promise.all([
      apiGet('/api/admin/stats'),
      apiGet('/api/admin/customers'),
      apiGet('/api/admin/products'),
    ]);

    document.getElementById('stats').innerHTML = statsHtml(stats);
    document.getElementById('customers').innerHTML = customers.customers.length
      ? customers.customers.map(customerRow).join('')
      : '<tr><td colspan="6" style="color:var(--ink-soft)">Nobody has signed up yet.</td></tr>';
    document.getElementById('products').innerHTML = products.products.map(productRow).join('');

    await loadOrders();
    await loadRaceProducts();
  } catch (err) {
    showNotice(err.message);
  }

  document.getElementById('race-run').addEventListener('click', runRace);

  // section switching
  document.querySelectorAll('[data-section]').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('[data-section]').forEach((t) => {
        t.classList.toggle('active', t === tab);
      });
      document.querySelectorAll('[data-panel]').forEach((panel) => {
        panel.hidden = panel.dataset.panel !== tab.dataset.section;
      });
    });
  });

  document.getElementById('status-filter').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    filters.status = chip.dataset.status;
    document.querySelectorAll('#status-filter .chip').forEach((c) => {
      c.classList.toggle('active', c === chip);
    });
    loadOrders();
  });

  let typingTimer;
  document.getElementById('order-search').addEventListener('input', (e) => {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      filters.q = e.target.value.trim();
      loadOrders();
    }, 250);
  });

  document.getElementById('products').addEventListener('click', (e) => {
    const button = e.target.closest('[data-save]');
    if (button) saveStock(Number(button.dataset.save), button);
  });
});
