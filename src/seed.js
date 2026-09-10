/**
 * Fills an empty database with the 48 products, the shop owner and the shared
 * demo account.
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

const { applySchema, get, run, transaction, describe } = require('./db');

const CATALOGUE = path.join(__dirname, '..', 'data', 'products.json');

async function seedProducts() {
  const products = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'));

  await transaction(async (tx) => {
    for (const p of products) {
      await tx.run(
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

async function seedOwner() {
  const username = process.env.OWNER_USERNAME || 'owner';
  const email = process.env.OWNER_EMAIL || 'owner@devgear.local';

  const existing = await get('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) return { username, password: null };

  // No hardcoded default password. Either you set one, or we invent a strong
  // one and print it once - so a deployed shop can never ship with a password
  // that is written down in a public repository.
  const chosen = Boolean(process.env.OWNER_PASSWORD);
  const password = process.env.OWNER_PASSWORD || crypto.randomBytes(9).toString('base64url');

  await run(
    `INSERT INTO users (username, email, password_hash, role)
     VALUES (?, ?, ?, 'owner')`,
    [username, email, bcrypt.hashSync(password, 12)]
  );

  // If you chose the password yourself, you already know it - printing it
  // would only put it into a terminal log for no reason.
  return { username, password: chosen ? null : password, chosen };
}

/**
 * A shared account anyone can use to look around.
 *
 * It is an ordinary customer - never the owner - so the worst a visitor can do
 * with it is put things in a cart and place a pending order. Its password is
 * meant to be public, which is exactly why it must not be able to change stock
 * or read other people's orders.
 */
async function seedDemo() {
  const username = process.env.DEMO_USERNAME || 'demo';
  const password = process.env.DEMO_PASSWORD || 'demo1234';
  const email = process.env.DEMO_EMAIL || 'demo@devgear.local';

  const existing = await get('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) return { username, created: false };

  await run(
    `INSERT INTO users (username, email, password_hash, phone, state, role)
     VALUES (?, ?, ?, ?, ?, 'customer')`,
    [username, email, bcrypt.hashSync(password, 12), '9000000000', 'Telangana']
  );

  return { username, password, created: true };
}

async function main() {
  await applySchema();

  const count = await seedProducts();
  const owner = await seedOwner();
  const demo = await seedDemo();

  console.log(`database:  ${describe}`);
  console.log(`products:  ${count} loaded (stock reset to starting values)`);

  if (owner.password) {
    console.log(`owner:     ${owner.username}`);
    console.log(`password:  ${owner.password}   <- shown once, save it now`);
  } else if (owner.chosen) {
    console.log(`owner:     ${owner.username} (password taken from OWNER_PASSWORD)`);
  } else {
    console.log(`owner:     ${owner.username} (already existed, password unchanged)`);
  }

  console.log(
    `demo:      ${demo.username}${demo.created ? ` / ${demo.password} (public on purpose)` : ' (already existed)'}`
  );
}

// Only run when started directly (npm run seed), not when the tests import it.
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seeding failed:', err);
      process.exit(1);
    });
}

module.exports = { seedProducts, seedOwner, seedDemo };
