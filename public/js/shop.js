/** The catalogue page: category chips, search, sort, and the product grid. */

const state = {
  category: '',
  q: '',
  sort: 'featured',
};

function productCard(p) {
  const soldOut = p.stock === 0;

  return `
    <article class="card">
      <a href="/product.html?id=${p.id}" aria-label="${esc(p.name)}">${thumbHtml(p)}</a>
      <div class="card-body">
        <div class="card-brand">${esc(p.brand)}</div>
        <div class="card-name"><a href="/product.html?id=${p.id}">${esc(p.name)}</a></div>
        <div class="card-price">${rupees(p.price_paise)}</div>
        <button class="btn" data-add="${p.id}" ${soldOut ? 'disabled' : ''}>
          ${soldOut ? 'Sold out' : 'Add to cart'}
        </button>
      </div>
    </article>`;
}

async function loadProducts() {
  const params = new URLSearchParams();
  if (state.category) params.set('category', state.category);
  if (state.q) params.set('q', state.q);
  if (state.sort) params.set('sort', state.sort);

  const grid = document.getElementById('grid');

  try {
    const { products, count } = await apiGet(`/api/products?${params}`);

    document.getElementById('count').textContent = count
      ? `${count} product${count === 1 ? '' : 's'}${state.category ? ` in ${state.category}` : ''}`
      : 'Nothing matched that search.';

    grid.innerHTML = products.length
      ? products.map(productCard).join('')
      : '<div class="empty">No products found. Try a different search.</div>';
  } catch (err) {
    showNotice(err.message);
  }
}

async function loadCategories() {
  const { categories } = await apiGet('/api/products/meta/categories');
  const chips = document.getElementById('categories');

  const all = [{ category: '', count: null, label: 'All' }, ...categories];
  chips.innerHTML = all
    .map(
      (c) => `<button class="chip ${c.category === state.category ? 'active' : ''}"
                 data-category="${esc(c.category)}">${esc(c.label || c.category)}${
                   c.count ? ` (${c.count})` : ''
                 }</button>`
    )
    .join('');
}

async function addToCart(productId, button) {
  const user = await whoAmI();
  if (!user) {
    window.location.href = `/login.html?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    return;
  }

  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Adding…';

  try {
    await apiPost('/api/cart', { product_id: productId, quantity: 1 });
    hideNotice();
    button.textContent = 'Added ✓';
    await renderHeader();
    setTimeout(() => {
      button.textContent = original.trim();
      button.disabled = false;
    }, 1200);
  } catch (err) {
    showNotice(err.message);
    button.textContent = original.trim();
    button.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadCategories();
  await loadProducts();

  document.getElementById('categories').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.category = chip.dataset.category;
    document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
    loadProducts();
  });

  let typingTimer;
  document.getElementById('search').addEventListener('input', (e) => {
    // Wait until they stop typing rather than firing a request per keystroke.
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      state.q = e.target.value.trim();
      loadProducts();
    }, 250);
  });

  document.getElementById('sort').addEventListener('change', (e) => {
    state.sort = e.target.value;
    loadProducts();
  });

  document.getElementById('grid').addEventListener('click', (e) => {
    const button = e.target.closest('[data-add]');
    if (button) addToCart(Number(button.dataset.add), button);
  });
});
