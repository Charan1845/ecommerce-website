/**
 * Builds the Express application.
 *
 * Kept separate from server.js so tests can start their own copy on their own
 * port with their own database file, instead of talking to whatever happens
 * to be running on your laptop.
 */

const path = require('node:path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { loadUser } = require('./auth');

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const cartRoutes = require('./routes/cart');
const orderRoutes = require('./routes/orders');
const adminRoutes = require('./routes/admin');
const paymentRoutes = require('./routes/payments');
const buildRoutes = require('./routes/build');

// The only page a logged-out visitor may open. Everything else sends them
// here first. Stylesheets, scripts and images stay reachable, otherwise the
// login page itself would render as bare text.
const OPEN_PAGES = new Set(['/login.html']);

// Pages only the shop owner may open. The real protection is on the /api/admin
// routes - hiding a page proves nothing, since anyone can read the JavaScript
// that fetches from it. This just means a customer who guesses the address
// gets sent home instead of watching a dashboard fail to load.
const OWNER_PAGES = new Set(['/admin.html']);

/**
 * The front door. A visitor who is not logged in gets the login page,
 * whatever page they asked for - and where they were heading is remembered
 * in ?next so they land there after logging in.
 */
function requireLoginForPages(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();

  const isPage = req.path === '/' || req.path.endsWith('.html');
  if (!isPage || OPEN_PAGES.has(req.path)) return next();

  if (!req.user) {
    return res.redirect(`/login.html?next=${encodeURIComponent(req.originalUrl)}`);
  }

  if (OWNER_PAGES.has(req.path) && req.user.role !== 'owner') {
    return res.redirect('/');
  }

  return next();
}

/**
 * Build the app. The caller is responsible for having run applySchema()
 * first - creating tables is a database round trip now, so it cannot happen
 * inside this synchronous function.
 */
function createApp() {
  const app = express();

  // Behind Render, Cloud Run or any proxy, the client's real address arrives
  // in X-Forwarded-For. Without this every request looks like it came from
  // the proxy, which would let one attacker's failures lock out everybody.
  // Only trust it when we are actually deployed - locally it would let anyone
  // spoof their address and slip past the rate limit.
  if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

  app.use(express.json());
  app.use(cookieParser());

  // Reads the login cookie, if there is one, and puts the user on req.user.
  // Runs on every request, including logged-out ones.
  app.use(loadUser);

  app.use('/api/auth', authRoutes);
  app.use('/api/products', productRoutes);
  app.use('/api/cart', cartRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/build', buildRoutes);

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  // Anything under /api that got this far does not exist. Answer with JSON,
  // not the HTML 404 page - the front end is expecting JSON.
  app.use('/api', (_req, res) => res.status(404).json({ error: 'No such endpoint.' }));

  app.use(requireLoginForPages);
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Last resort. Log the real error for us, tell the browser nothing useful -
  // error text often leaks table names and file paths.
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on our side.' });
  });

  return app;
}

module.exports = { createApp };
