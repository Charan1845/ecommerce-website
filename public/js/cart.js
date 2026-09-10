/** The cart page, and the checkout form beside it. */

const $c = (id) => document.getElementById(id);

function lineRow(item) {
  const warning = item.available
    ? ''
    : `<div class="err">Only ${item.stock} left - reduce the quantity to continue.</div>`;

  return `
    <tr data-product="${item.product_id}">
      <td>
        <div class="card-brand">${esc(item.brand)}</div>
        <a href="/product.html?id=${item.product_id}">${esc(item.name)}</a>
        ${warning}
      </td>
      <td class="num">${rupees(item.price_paise)}</td>
      <td>
        <div class="qty">
          <input type="number" value="${item.quantity}" min="1" max="10"
                 data-qty="${item.product_id}" aria-label="Quantity for ${esc(item.name)}">
        </div>
      </td>
      <td class="num">${rupees(item.line_total_paise)}</td>
      <td><button class="btn danger small" data-remove="${item.product_id}">Remove</button></td>
    </tr>`;
}

function render(cart) {
  const empty = cart.items.length === 0;

  $c('empty').hidden = !empty;
  $c('layout').hidden = empty;
  $c('sub').textContent = empty
    ? ''
    : `${cart.item_count} item${cart.item_count === 1 ? '' : 's'} ready to order.`;

  if (empty) return;

  $c('lines').innerHTML = cart.items.map(lineRow).join('');
  $c('item-count').textContent = cart.item_count;
  $c('total').textContent = rupees(cart.total_paise);
  $c('place').disabled = cart.has_problems;

  if (cart.has_problems) {
    showNotice('Some items are no longer available in the quantity you asked for.', 'error');
  }
}

async function refresh() {
  render(await apiGet('/api/cart'));
  await renderHeader();
}

async function setQuantity(productId, quantity) {
  try {
    render(await apiPatch(`/api/cart/${productId}`, { quantity }));
    hideNotice();
    await renderHeader();
  } catch (err) {
    showNotice(err.message);
    await refresh();
  }
}

async function placeOrder(event) {
  event.preventDefault();
  document.querySelectorAll('.err').forEach((el) => { el.textContent = ''; });
  hideNotice();

  const button = $c('place');
  button.disabled = true;
  button.textContent = 'Placing your order…';

  try {
    const { order } = await apiPost('/api/orders', {
      shipping_name: $c('shipping_name').value,
      shipping_phone: $c('shipping_phone').value,
      shipping_address: $c('shipping_address').value,
      shipping_state: $c('shipping_state').value,
      shipping_pincode: $c('shipping_pincode').value,
    });

    window.location.href = `/orders.html?placed=${order.id}`;
  } catch (err) {
    // 409 means somebody else took the stock while this order was being filled
    // in. The cart is left untouched, so refreshing shows what is still there.
    showNotice(err.message, err.status === 409 ? 'error' : 'error');

    for (const [name, message] of Object.entries(err.fields || {})) {
      const box = $c(`err-${name}`);
      if (box) box.textContent = message;
    }

    button.textContent = 'Place order';
    button.disabled = false;
    if (err.status === 409) await refresh();
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = await whoAmI();
  if (!user) {
    window.location.href = '/login.html?next=%2Fcart.html';
    return;
  }

  $c('shipping_name').value = user.username;
  if (user.phone) $c('shipping_phone').value = user.phone;
  if (user.state) $c('shipping_state').value = user.state;

  await refresh();

  $c('lines').addEventListener('change', (e) => {
    const input = e.target.closest('[data-qty]');
    if (input) setQuantity(Number(input.dataset.qty), Number(input.value));
  });

  $c('lines').addEventListener('click', async (e) => {
    const button = e.target.closest('[data-remove]');
    if (!button) return;
    render(await apiDelete(`/api/cart/${button.dataset.remove}`));
    await renderHeader();
  });

  $c('checkout').addEventListener('submit', placeOrder);
});
