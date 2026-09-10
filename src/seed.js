/**
 * Fills an empty database with the 48 products, and creates the shop owner.
 *
 * Run it with:  npm run seed
 *
 * Running it again resets every product's stock back to its starting number,
 * which is handy: the last-item-in-stock demo needs the MX Master back at 1.
 * Customers, carts and orders are left alone.
 */

require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');

const { applySchema, get, run, transaction, DB_FILE } = require('./db');

const CATALOGUE = path.join(__dirname, '..', 'data', 'products.json');

function seedProducts() {
  const products = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'));

  transaction(() => {
    for (const p of products) {
      run(
        `INSERT INTO products (id, name, brand, category, price_paise, description, image, stock)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           name        = excluded.name,
           brand       = excluded.brand,
           category    = excluded.category,
           price_paise = excluded.price_paise,
           description = excluded.description,
           image       = excluded.image,
           stock       = excluded.stock`,
        [p.id, p.name, p.brand, p.category, p.price_paise, p.description, p.image, p.stock]
      );
    }
  });

  return products.length;
}

function seedOwner() {
  const username = process.env.OWNER_USERNAME || 'owner';
  const email = process.env.OWNER_EMAIL || 'owner@devgear.local';

  const existing = get('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) return { username, password: null };

  // No hardcoded default password. Either you set one, or we invent a strong
  // one and print it once - so a deployed shop can never ship with a password
  // that is written down in a public repository.
  const password = process.env.OWNER_PASSWORD || crypto.randomBytes(9).toString('base64url');

  run(
    `INSERT INTO users (username, email, password_hash, role)
     VALUES (?, ?, ?, 'owner')`,
    [username, email, bcrypt.hashSync(password, 12)]
  );

  return { username, password };
}

/**
 * A shared account anyone can use to look around.
 *
 * It is an ordinary customer - never the owner - so the worst a visitor can do
 * with it is put things in a cart and place a pending order. Its password is
 * meant to be public, which is exactly why it must not be able to change stock
 * or read other people's orders.
 */
function seedDemo() {
  const username = process.env.DEMO_USERNAME || 'demo';
  const password = process.env.DEMO_PASSWORD || 'demo1234';
  const email = process.env.DEMO_EMAIL || 'demo@devgear.local';

  const existing = get('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) return { username, created: false };

  run(
    `INSERT INTO users (username, email, password_hash, phone, state, role)
     VALUES (?, ?, ?, ?, ?, 'customer')`,
    [username, email, bcrypt.hashSync(password, 12), '9000000000', 'Telangana']
  );

  return { username, password, created: true };
}

function main() {
  applySchema();

  const count = seedProducts();
  const owner = seedOwner();
  const demo = seedDemo();

  console.log(`database:  ${DB_FILE}`);
  console.log(`products:  ${count} loaded (stock reset to starting values)`);

  if (owner.password) {
    console.log(`owner:     ${owner.username}`);
    console.log(`password:  ${owner.password}   <- shown once, save it now`);
  } else {
    console.log(`owner:     ${owner.username} (already existed, password unchanged)`);
  }

  console.log(
    `demo:      ${demo.username}${demo.created ? ` / ${demo.password} (public on purpose)` : ' (already existed)'}`
  );
}

// Only run when started directly (npm run seed), not when the tests import it.
if (require.main === module) {
  main();
}

module.exports = { seedProducts, seedOwner, seedDemo };
