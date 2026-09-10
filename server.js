/**
 * DevGear - starts the server.
 *
 * The application itself is built in src/app.js. This file gets the database
 * ready, then decides which port to listen on.
 */

require('dotenv').config();

const { createApp } = require('./src/app');
const { applySchema, get, describe } = require('./src/db');
const { seedProducts, seedOwner, seedDemo } = require('./src/seed');

const PORT = process.env.PORT || 3000;

/**
 * A brand new deployment points at an empty database: no tables, no products,
 * no way to log in. Rather than needing a shell on the server to fix that,
 * fill it in on the first boot.
 *
 * Only when the catalogue is completely empty, so a restart never disturbs a
 * shop that is already running. Set SEED_ON_BOOT=off to do it by hand.
 */
async function prepareDatabase() {
  await applySchema();

  if (process.env.SEED_ON_BOOT === 'off') return;

  const existing = await get('SELECT COUNT(*) AS n FROM products');
  if (Number(existing.n) > 0) return;

  console.log('empty database - setting it up');

  const count = await seedProducts();
  const owner = await seedOwner();
  const demo = await seedDemo();

  console.log(`seeded ${count} products`);
  if (owner.password) {
    console.log(`owner "${owner.username}" password: ${owner.password}`);
    console.log('^ this is the only time it is shown. Save it now.');
  } else if (owner.chosen) {
    console.log(`owner "${owner.username}" created with the password from OWNER_PASSWORD`);
  }
  if (demo.created) {
    console.log(`demo account "${demo.username}" is ready`);
  }
}

async function main() {
  await prepareDatabase();

  createApp().listen(PORT, () => {
    console.log(`DevGear listening on port ${PORT}`);
    console.log(`database: ${describe}`);
  });
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
