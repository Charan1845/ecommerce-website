/**
 * The customer's own order history.
 *
 * Every price shown here comes from the order itself, not from the catalogue.
 * That is why an old order still shows the price that was actually paid even
 * after the shop changes it.
 */

function when(value) {
  // SQLite hands back "YYYY-MM-DD HH:MM:SS" in UTC.
  const date = new Date(String(value).replace(' ', 'T') + 'Z');
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
    </section>`;
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = await whoAmI();
  if (!user) {
    window.location.href = '/login.html?next=%2Forders.html';
    return;
  }

  const placed = new URLSearchParams(window.location.search).get('placed');
  if (placed) {
    showNotice(`Order #${placed} placed. It is recorded as pending - no payment was taken.`, 'success');
  }

  try {
    const { orders } = await apiGet('/api/orders');

    document.getElementById('empty').hidden = orders.length > 0;
    document.getElementById('sub').textContent = orders.length
      ? `${orders.length} order${orders.length === 1 ? '' : 's'}, newest first.`
      : '';
    document.getElementById('orders').innerHTML = orders.map(orderCard).join('');
  } catch (err) {
    showNotice(err.message);
  }
});
