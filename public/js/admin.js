/**
 * The owner dashboard.
 *
 * Hiding this page from customers is only a convenience. The real protection
 * is on the server: every /api/admin route checks the role before answering,
 * so typing the address by hand gets you nothing.
 */

function statsHtml(s) {
  return [
    ['Revenue', rupees(s.revenue_paise)],
    ['Orders', s.orders],
    ['Customers', s.customers],
    ['Sold out', s.out_of_stock],
  ]
    .map(
      ([label, value]) =>
        `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`
    )
    .join('');
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

function orderCard(order) {
  const rows = order.items
    .map(
      (i) => `<tr>
        <td>${esc(i.product_name)}</td>
        <td class="num">${rupees(i.unit_price_paise)}</td>
        <td class="num">${i.quantity}</td>
      </tr>`
    )
    .join('');

  return `
    <section class="panel" style="margin-bottom:18px">
      <div style="display:flex; flex-wrap:wrap; gap:12px; align-items:center; margin-bottom:12px">
        <h2 style="margin:0">Order #${order.id}</h2>
        <span class="pill ${esc(order.status)}">${esc(order.status)}</span>
        <span style="color:var(--ink-soft)">
          ${esc(order.username)} &middot; ${esc(order.shipping_name)},
          ${esc(order.shipping_state)} ${esc(order.shipping_pincode)}
        </span>
        <strong style="margin-left:auto">${rupees(order.total_paise)}</strong>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Product</th><th class="num">Price paid</th><th class="num">Qty</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>`;
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
    const [stats, products, orders] = await Promise.all([
      apiGet('/api/admin/stats'),
      apiGet('/api/admin/products'),
      apiGet('/api/admin/orders'),
    ]);

    document.getElementById('stats').innerHTML = statsHtml(stats);
    document.getElementById('products').innerHTML = products.products.map(productRow).join('');
    document.getElementById('orders').innerHTML = orders.orders.length
      ? orders.orders.map(orderCard).join('')
      : '<div class="empty">No orders have been placed yet.</div>';
  } catch (err) {
    showNotice(err.message);
  }

  document.getElementById('products').addEventListener('click', (e) => {
    const button = e.target.closest('[data-save]');
    if (button) saveStock(Number(button.dataset.save), button);
  });
});
