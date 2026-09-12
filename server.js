/**
 * DevGear - starts the server.
 *
 * The application itself is built in src/app.js. This file gets the database
 * ready, then decides which port to listen on.
 */

require('dotenv').config();

const { createApp } = require('./src/app');
const { applySchema, get, describe } = require('./src/db');
const { seedProducts, addNewProducts, seedOwner, seedDemo } = require('./src/seed');
const { startSweeper, releaseExpired, holdsOn, holdMinutes } = require('./src/stock-holds');

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

  if (Number(existing.n) > 0) {
    // A shop that is already running. Do not re-seed it - that would reset
    // every stock count - but do add products the catalogue has gained since
    // this database was filled, or a new range would deploy as an empty
    // category and nobody would know why.
    const added = await addNewProducts();
    if (added) console.log(`added ${added} new products from the catalogue`);
    return;
  }

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

  // Anything that expired while the server was down is still holding stock.
  // Sweep once before opening the doors, so the shop does not spend its first
  // minute claiming things are sold out when they are not.
  if (holdsOn()) {
    const { released } = await releaseExpired();
    if (released.length) {
      console.log(`released ${released.length} unpaid order(s) held over from last time`);
    }
    startSweeper();
  }

  createApp().listen(PORT, () => {
    console.log(`DevGear listening on port ${PORT}`);
    console.log(`database: ${describe}`);
    console.log(
      holdsOn()
        ? `unpaid orders hold their stock for ${holdMinutes()} minutes`
        : 'stock holds are off - unpaid orders keep their stock indefinitely'
    );
  });
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
