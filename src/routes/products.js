/**
 * REST routes for browsing the catalogue.
 *
 * The shop is behind the login, so these need an account too. Without this the
 * pages would redirect to the login screen while the data behind them stayed
 * readable by anyone who knew the address - a lock on the door and an open
 * window beside it.
 */

const express = require('express');
const { all, get } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

const CATEGORIES = ['Keyboards', 'Mouse', 'Headsets', 'Monitors'];

const SORTS = {
  featured: 'category, brand, name',
  'price-low': 'price_paise ASC',
  'price-high': 'price_paise DESC',
  name: 'name ASC',
};

/**
 * GET /api/products
 * Optional filters: ?category=Mouse&brand=Logitech&q=wireless&sort=price-low
 */
router.get('/', async (req, res, next) => {
  try {
    const conditions = [];
    const params = [];

    const { category, brand, q } = req.query;

    if (category && CATEGORIES.includes(category)) {
      conditions.push('category = ?');
      params.push(category);
    }
    if (brand) {
      conditions.push('brand = ?');
      params.push(brand);
    }
    if (q) {
      // LOWER on both sides so searching works the same on SQLite and
      // PostgreSQL - SQLite's LIKE ignores case, PostgreSQL's does not.
      //
      // Values always travel as parameters, never glued into the SQL text.
      // Gluing user input into a query is how SQL injection happens.
      conditions.push(
        '(LOWER(name) LIKE LOWER(?) OR LOWER(brand) LIKE LOWER(?) OR LOWER(description) LIKE LOWER(?))'
      );
      const like = `%${q}%`;
      params.push(like, like, like);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderBy = SORTS[req.query.sort] || SORTS.featured;

    const products = await all(`SELECT * FROM products ${where} ORDER BY ${orderBy}`, params);
    return res.json({ products, count: products.length });
  } catch (err) {
    return next(err);
  }
});

/** The category list, with how many products are in each. */
router.get('/meta/categories', async (_req, res, next) => {
  try {
    const rows = await all(
      `SELECT category, COUNT(*) AS count
       FROM products GROUP BY category ORDER BY category`
    );
    // PostgreSQL returns COUNT(*) as a string, because a bigint does not
    // always fit in a JavaScript number. These counts are tiny, so make them
    // numbers before they reach the page.
    return res.json({ categories: rows.map((r) => ({ ...r, count: Number(r.count) })) });
  } catch (err) {
    return next(err);
  }
});

/** Every brand we stock, for the filter dropdown. */
router.get('/meta/brands', async (_req, res, next) => {
  try {
    const rows = await all('SELECT DISTINCT brand FROM products ORDER BY brand');
    return res.json({ brands: rows.map((r) => r.brand) });
  } catch (err) {
    return next(err);
  }
});

/** GET /api/products/:id - one product. */
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'Bad product id.' });
    }

    const product = await get('SELECT * FROM products WHERE id = ?', [id]);
    if (!product) {
      return res.status(404).json({ error: 'No such product.' });
    }

    const related = await all(
      'SELECT * FROM products WHERE category = ? AND id != ? ORDER BY RANDOM() LIMIT 4',
      [product.category, product.id]
    );

    return res.json({ product, related });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
module.exports.CATEGORIES = CATEGORIES;
