/** One product, with a quantity picker and an add-to-cart button. */

function stockLine(stock) {
  if (stock === 0) return '<p class="stock-line out">Sold out</p>';
  if (stock <= 3) return `<p class="stock-line low">Hurry - only ${stock} left in stock</p>`;
  return `<p class="stock-line ok">In stock (${stock} available)</p>`;
}

function render(product) {
  const soldOut = product.stock === 0;
  const max = Math.min(product.stock, 10);

  document.title = `${product.name} - DevGear`;

  document.getElementById('detail').innerHTML = `
    <div class="detail">
      <div>${thumbHtml(product, false)}</div>
      <div>
        <div class="card-brand">${esc(product.brand)} &middot; ${esc(product.category)}</div>
        <h1>${esc(product.name)}</h1>
        <div class="price-big">${rupees(product.price_paise)}</div>
        ${stockLine(product.stock)}

        <div class="buy-row">
          <div class="qty">
            <label for="qty">Qty</label>
            <input type="number" id="qty" value="1" min="1" max="${max || 1}" ${soldOut ? 'disabled' : ''}>
          </div>
          <button class="btn" id="add" ${soldOut ? 'disabled' : ''}>
            ${soldOut ? 'Sold out' : 'Add to cart'}
          </button>
        </div>

        <div class="spec">
          <h2>About this product</h2>
          <p>${esc(product.description)}</p>
        </div>
      </div>
    </div>`;

  document.getElementById('add')?.addEventListener('click', () => add(product));
}

async function add(product) {
  const user = await whoAmI();
  if (!user) {
    const here = window.location.pathname + window.location.search;
    window.location.href = `/login.html?next=${encodeURIComponent(here)}`;
    return;
  }

  const button = document.getElementById('add');
  const quantity = Number(document.getElementById('qty').value) || 1;

  button.disabled = true;
  button.textContent = 'Adding…';

  try {
    await apiPost('/api/cart', { product_id: product.id, quantity });
    hideNotice();
    showNotice(`Added ${quantity} × ${product.name} to your cart.`, 'success');
    button.textContent = 'Added ✓';
    await renderHeader();
    setTimeout(() => {
      button.textContent = 'Add to cart';
      button.disabled = false;
    }, 1200);
  } catch (err) {
    showNotice(err.message);
    button.textContent = 'Add to cart';
    button.disabled = false;
  }
}

function renderRelated(products) {
  if (!products.length) return;

  document.getElementById('related-section').hidden = false;
  document.getElementById('related').innerHTML = products
    .map(
      (p) => `
      <article class="card">
        <a href="/product.html?id=${p.id}">${thumbHtml(p)}</a>
        <div class="card-body">
          <div class="card-brand">${esc(p.brand)}</div>
          <div class="card-name"><a href="/product.html?id=${p.id}">${esc(p.name)}</a></div>
          <div class="card-price">${rupees(p.price_paise)}</div>
        </div>
      </article>`
    )
    .join('');
}

document.addEventListener('DOMContentLoaded', async () => {
  const id = new URLSearchParams(window.location.search).get('id');

  try {
    const { product, related } = await apiGet(`/api/products/${encodeURIComponent(id)}`);
    render(product);
    renderRelated(related);
  } catch (err) {
    document.getElementById('detail').innerHTML =
      '<div class="empty"><h2>Product not found</h2><p>It may have been removed. <a href="/">Back to the shop</a>.</p></div>';
    showNotice(err.message);
  }
});
