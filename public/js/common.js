/**
 * Shared front-end helpers: talking to the API, formatting money, and drawing
 * the header. Every page loads this first.
 */

/** Call the REST API and unwrap the JSON. Throws on any non-2xx reply. */
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const err = new Error(data?.error || 'Something went wrong.');
    err.status = res.status;
    err.fields = data?.fields || {};
    err.data = data;
    throw err;
  }

  return data;
}

const apiGet = (url) => api('GET', url);
const apiPost = (url, body) => api('POST', url, body);
const apiPatch = (url, body) => api('PATCH', url, body);
const apiDelete = (url) => api('DELETE', url);

/**
 * Paise to rupees, grouped the Indian way: 12,34,567 rather than 1,234,567.
 *
 * Money is stored as whole paise everywhere in this project, so this is the
 * only place that turns it back into something with a decimal point.
 */
function rupees(paise) {
  const negative = paise < 0;
  const whole = Math.floor(Math.abs(paise) / 100);
  const pennies = String(Math.abs(paise) % 100).padStart(2, '0');

  const digits = String(whole);
  let grouped;
  if (digits.length <= 3) {
    grouped = digits;
  } else {
    const last3 = digits.slice(-3);
    const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    grouped = `${rest},${last3}`;
  }

  const amount = pennies === '00' ? grouped : `${grouped}.${pennies}`;
  return `${negative ? '-' : ''}₹${amount}`;
}

/** Escape text before putting it into HTML, so a product name cannot inject markup. */
function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** First letters of a brand, used on the stand-in product tile. */
function initials(brand) {
  return String(brand || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

/** The picture area of a card: a real photo when we have one, a tile when we do not. */
function thumbHtml(product, badge = true) {
  let inner;
  if (product.image) {
    // A photograph fills the card; a drawing sits inside it with room to
    // breathe. Cropping an illustration cuts the product in half, and
    // letterboxing a photograph leaves grey bands down the sides.
    const kind = /\.svg$/i.test(product.image) ? 'art' : 'photo';

    inner = `<img class="${kind}" src="/images/products/${esc(product.image)}"
              alt="${esc(product.name)}" loading="lazy"
              onerror="this.replaceWith(Object.assign(document.createElement('span'),
                       {className:'initials', textContent:'${esc(initials(product.brand))}'}))">`;
  } else {
    inner = `<span class="initials">${esc(initials(product.brand))}</span>`;
  }

  let flag = '';
  if (badge && product.stock === 0) {
    flag = '<span class="badge out">Sold out</span>';
  } else if (badge && product.stock <= 3) {
    flag = `<span class="badge low">Only ${product.stock} left</span>`;
  }

  return `<div class="thumb" data-category="${esc(product.category)}">${flag}${inner}</div>`;
}

function showNotice(text, kind = 'error') {
  const box = document.getElementById('notice');
  if (!box) return;
  box.className = `notice ${kind}`;
  box.textContent = text;
  box.hidden = false;
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function hideNotice() {
  const box = document.getElementById('notice');
  if (box) box.hidden = true;
}

/**
 * Who is logged in, fetched once per page and reused.
 *
 * The in-flight promise is cached, not the answer. Two callers starting at the
 * same moment - the header and the page itself - would otherwise both see
 * "not fetched yet" and fire the same request twice.
 */
let userPromise;
async function whoAmI() {
  if (!userPromise) {
    userPromise = apiGet('/api/auth/me').then((r) => r.user);
  }
  return userPromise;
}

/**
 * Light/dark theme toggle.
 *
 * The initial theme is decided before this file even loads - see the
 * inline script in each page's <head>, which reads localStorage (falling
 * back to the OS preference) and stamps it onto <html> early enough that
 * nothing ever flashes light-then-dark. This file only owns the button:
 * flipping the attribute, remembering the choice, and drawing an icon
 * that matches wherever the button happens to live.
 */
function isDarkTheme() {
  return document.documentElement.dataset.theme === 'dark';
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('theme', theme);
  } catch {
    /* private browsing, storage disabled, etc - the toggle still works
       for this page load, it just won't be remembered */
  }
}

function themeToggleHtml(extraClass) {
  const icon = isDarkTheme() ? '☀️' : '🌙';
  return `<button type="button" id="theme-toggle" class="theme-toggle ${extraClass || ''}"
            aria-label="Switch to ${isDarkTheme() ? 'light' : 'dark'} mode"
            title="Switch to ${isDarkTheme() ? 'light' : 'dark'} mode">${icon}</button>`;
}

function wireThemeToggle() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    setTheme(isDarkTheme() ? 'light' : 'dark');
    btn.outerHTML = themeToggleHtml(btn.classList.contains('fab') ? 'fab' : '');
    wireThemeToggle();
  });
}

/**
 * Pages built around <nav id="nav"> get the toggle drawn inside
 * renderHeader(), alongside the rest of the nav. A page with no header
 * (login.html) gets a small floating button instead, added here since
 * renderHeader never runs for it.
 */
function ensureThemeToggle() {
  if (document.getElementById('theme-toggle')) return;
  if (document.getElementById('nav')) return; // renderHeader() will add it
  document.body.insertAdjacentHTML('beforeend', themeToggleHtml('fab'));
  wireThemeToggle();
}

/** Draw the top bar to match who is logged in. */
async function renderHeader() {
  const user = await whoAmI();
  const nav = document.getElementById('nav');
  if (!nav) return;

  const parts = ['<a href="/">Shop</a>'];

  if (user) {
    let count = 0;
    try {
      count = (await apiGet('/api/cart')).item_count;
    } catch {
      /* header must render even if the cart call fails */
    }

    parts.push(
      `<a href="/cart.html">Cart<span class="cart-count" ${count ? '' : 'hidden'}>${count}</span></a>`,
      '<a href="/orders.html">My orders</a>'
    );
    if (user.role === 'owner') {
      parts.push('<a href="/admin.html">Owner<span class="owner-tag">admin</span></a>');
    }
    parts.push(`<button type="button" id="logout">Log out (${esc(user.username)})</button>`);
  } else {
    parts.push('<a href="/cart.html">Cart</a>', '<a href="/login.html">Log in</a>');
  }

  parts.push(themeToggleHtml());
  nav.innerHTML = parts.join('');

  document.getElementById('logout')?.addEventListener('click', async () => {
    await apiPost('/api/auth/logout');
    window.location.href = '/';
  });
  wireThemeToggle();
}

document.addEventListener('DOMContentLoaded', () => {
  renderHeader();
  ensureThemeToggle();
});
