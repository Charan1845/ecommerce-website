/**
 * Tests for the PC builder's compatibility rules.
 *
 * These never touch the database. `inspect` is deliberately a pure function -
 * parts in, complaints out - so the interesting half of the builder can be
 * checked without a server, a login or a transaction anywhere near it.
 *
 * Two things are being asserted, and the second matters more than it looks:
 *
 *   1. Each rule fires when it should, and says something a human can act on.
 *   2. Each rule is REACHABLE with the catalogue as it actually stands. A rule
 *      that no combination of stocked parts can trigger is a rule that only
 *      looks like it works, and the last two below are there because exactly
 *      that was true when they were written - no card was longer than any
 *      case's clearance, and no build could out-draw the smallest supply.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { inspect, SLOTS, BASE_WATTS } = require('../src/pc-build');

/** A part, as `inspect` expects to receive one. */
const P = (category, specs, name = category) => ({
  id: 1,
  name,
  brand: 'Brand',
  category,
  price_paise: 100000,
  stock: 5,
  specs,
});

const cpu = {
  noGraphics: P('Processors', { socket: 'LGA1700', tdp_watts: 65, igpu: false }, 'Core i5-12400F'),
  hot: P('Processors', { socket: 'LGA1700', tdp_watts: 125, igpu: true }, 'Core i7-13700K'),
  am5: P('Processors', { socket: 'AM5', tdp_watts: 120, igpu: true }, 'Ryzen 7 7800X3D'),
};

const board = {
  ddr4: P('Motherboards', { socket: 'LGA1700', form_factor: 'mATX', memory_type: 'DDR4', m2_slots: 2 }),
  atxDdr5: P('Motherboards', { socket: 'LGA1700', form_factor: 'ATX', memory_type: 'DDR5', m2_slots: 4 }),
  am5: P('Motherboards', { socket: 'AM5', form_factor: 'ATX', memory_type: 'DDR5', m2_slots: 3 }),
  noM2: P('Motherboards', { socket: 'LGA1700', form_factor: 'ATX', memory_type: 'DDR5', m2_slots: 0 }),
};

const memory = {
  ddr4: P('Memory', { memory_type: 'DDR4', capacity_gb: 16 }),
  ddr5: P('Memory', { memory_type: 'DDR5', capacity_gb: 16 }),
};

const storage = {
  nvme: P('Storage', { storage_type: 'NVMe', capacity_gb: 1000 }),
};

const gpu = {
  modest: P('Graphics Cards', { tdp_watts: 115, length_mm: 227, psu_recommended_watts: 550 }),
  long: P('Graphics Cards', { tdp_watts: 263, length_mm: 320, psu_recommended_watts: 700 }, 'RX 7800 XT'),
  thirsty: P('Graphics Cards', { tdp_watts: 285, length_mm: 308, psu_recommended_watts: 750 }, 'RTX 4070 Ti SUPER'),
};

const cooler = {
  tall: P('Cooling', { cooler_type: 'air', sockets: ['LGA1700', 'AM4', 'AM5'], height_mm: 165, tdp_watts: 250 }, 'NH-D15'),
  small: P('Cooling', { cooler_type: 'air', sockets: ['LGA1700', 'AM4'], height_mm: 154, tdp_watts: 95 }, 'ICE-C612 V2'),
  aio360: P('Cooling', { cooler_type: 'aio', sockets: ['LGA1700', 'AM4', 'AM5'], radiator_mm: 360, tdp_watts: 300 }, 'LE720'),
  fine: P('Cooling', { cooler_type: 'air', sockets: ['LGA1700', 'AM4', 'AM5'], height_mm: 155, tdp_watts: 220 }),
};

const psu = {
  tiny: P('Power Supplies', { watts: 450, rating: '80+ Bronze' }, 'CV450'),
  snug: P('Power Supplies', { watts: 550, rating: '80+ Gold' }),
  mid: P('Power Supplies', { watts: 650, rating: '80+ Bronze' }),
  big: P('Power Supplies', { watts: 1000, rating: '80+ Gold' }),
};

const cabinet = {
  roomy: P('Cabinets', { form_factors: ['ATX', 'mATX', 'ITX'], max_gpu_mm: 392, max_cooler_mm: 180, radiators: [240, 280, 360] }, 'LANCOOL 216'),
  small: P('Cabinets', { form_factors: ['mATX', 'ITX'], max_gpu_mm: 300, max_cooler_mm: 160, radiators: [240] }, '211 Air'),
};

/** A build with nothing wrong with it, which each test then breaks once. */
const SOUND = {
  cpu: cpu.hot,
  motherboard: board.atxDdr5,
  memory: memory.ddr5,
  storage: storage.nvme,
  gpu: gpu.modest,
  cooler: cooler.tall,
  psu: psu.big,
  cabinet: cabinet.roomy,
};

/** SOUND with some slots replaced; `undefined` removes a slot entirely. */
const build = (changes) =>
  Object.fromEntries(Object.entries({ ...SOUND, ...changes }).filter(([, part]) => part));

/** Assert that a build raises an issue of `level` whose message matches. */
function raises(changes, level, pattern) {
  const issues = inspect(build(changes));
  const hit = issues.find((i) => i.level === level && pattern.test(i.message));

  assert.ok(
    hit,
    `expected a ${level} matching ${pattern}\ngot: ${JSON.stringify(
      issues.map((i) => `${i.level}: ${i.message}`),
      null,
      2
    )}`
  );

  return hit;
}

/* ----------------------------------------------------------- the happy path */

test('a sound build raises nothing at all', () => {
  const issues = inspect(build({})).filter((i) => i.level !== 'incomplete');
  assert.deepEqual(issues, [], 'a build with nothing wrong with it should be silent');
});

/* -------------------------------------------------------------- what fits */

test('an AM5 chip is refused on an LGA1700 board', () => {
  raises({ cpu: cpu.am5 }, 'error', /AM5 chip and this board is LGA1700/);
});

test('DDR4 is refused in a DDR5 board', () => {
  raises({ memory: memory.ddr4 }, 'error', /takes DDR5 and that kit is DDR4/);
});

test('an ATX board is refused in a micro tower', () => {
  raises({ cabinet: cabinet.small }, 'error', /takes mATX, ITX boards/);
});

test('a card longer than the case is refused', () => {
  raises(
    { gpu: gpu.long, cabinet: cabinet.small, motherboard: board.ddr4, memory: memory.ddr4 },
    'error',
    /320 mm long and .* has room for 300 mm/
  );
});

test('a cooler taller than the side panel is refused', () => {
  raises(
    { cabinet: cabinet.small, motherboard: board.ddr4, memory: memory.ddr4 },
    'error',
    /165 mm tall and the side panel closes at 160 mm/
  );
});

test('a radiator with nowhere to mount is refused', () => {
  raises(
    { cooler: cooler.aio360, cabinet: cabinet.small, motherboard: board.ddr4, memory: memory.ddr4 },
    'error',
    /no mount for a 360 mm radiator/
  );
});

test('a cooler without the right mounting hardware is refused', () => {
  raises(
    { cpu: cpu.am5, motherboard: board.am5, cooler: cooler.small },
    'error',
    /no AM5 mounting hardware/
  );
});

test('an NVMe drive is refused on a board with no M.2 slot', () => {
  raises({ motherboard: board.noM2 }, 'error', /no M\.2 slot for an NVMe drive/);
});

/* --------------------------------------------------------------- warnings */

test('an under-rated cooler warns but does not block', () => {
  const issue = raises({ cooler: cooler.small }, 'warning', /rated for 95 W and .* puts out 125 W/);
  assert.equal(issue.level, 'warning', 'it will run - badly - so this must not be an error');
});

test('choosing no cooler warns', () => {
  raises({ cooler: undefined }, 'warning', /No cooler chosen/);
});

/* ------------------------------------------------------------------ power */

test('a supply smaller than the draw is refused', () => {
  raises(
    { gpu: gpu.thirsty, psu: psu.tiny },
    'error',
    /draws about 490 W and .* supplies 450 W/
  );
});

test('a supply with barely any headroom warns', () => {
  raises({ gpu: gpu.thirsty, psu: psu.snug }, 'warning', /leaves very little headroom/);
});

test('a supply below what the card maker asks for warns', () => {
  raises({ gpu: gpu.thirsty, psu: psu.mid, cooler: cooler.fine }, 'warning', /recommend at least 750 W/);
});

test('the estimate is the two hot parts plus a fixed base', () => {
  const issue = raises({ gpu: gpu.thirsty, psu: psu.tiny }, 'error', /draws about/);
  const expected = cpu.hot.specs.tdp_watts + gpu.thirsty.specs.tdp_watts + BASE_WATTS;
  assert.match(issue.message, new RegExp(`about ${expected} W`));
});

/* ------------------------------------------------------------ the obvious */

test('a processor with no graphics and no card has nothing to display on', () => {
  raises({ cpu: cpu.noGraphics, gpu: undefined }, 'error', /nothing to plug a monitor into/);
});

test('a processor with built-in graphics and no card is fine', () => {
  const issues = inspect(build({ gpu: undefined }));
  assert.ok(
    !issues.some((i) => /plug a monitor into/.test(i.message)),
    'the i7 has integrated graphics, so no card is a choice rather than a mistake'
  );
});

test('a sold out part is refused', () => {
  raises({ gpu: { ...gpu.modest, stock: 0, name: 'Dual RTX 4060' } }, 'error', /is sold out/);
});

test('every required slot is asked for when the build is empty', () => {
  const issues = inspect({});
  const missing = issues.filter((i) => i.level === 'incomplete');
  const required = SLOTS.filter((s) => s.required);

  assert.equal(missing.length, required.length);
  for (const slot of required) {
    assert.ok(
      missing.some((i) => i.slots.includes(slot.key)),
      `nothing asked for the ${slot.label}`
    );
  }
});

/* ------------------------------------------------------- rules must be live

   The catalogue and the rules can drift apart silently: lower a card's length
   or raise a case's clearance and a rule stops being reachable without a
   single test failing. These two read the real catalogue and check that the
   two size-based rules still have something to catch.
------------------------------------------------------------------------- */

const CATALOGUE = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'products.json'), 'utf8')
);

const specsIn = (category) =>
  CATALOGUE.filter((p) => p.category === category && p.specs).map((p) => p.specs);

test('some card in the catalogue is too long for some case', () => {
  const longest = Math.max(...specsIn('Graphics Cards').map((s) => s.length_mm));
  const tightest = Math.min(...specsIn('Cabinets').map((s) => s.max_gpu_mm));

  assert.ok(
    longest > tightest,
    `the longest card is ${longest} mm and the tightest case takes ${tightest} mm, ` +
      'so the clearance rule can never fire against real stock'
  );
});

test('some build in the catalogue can out-draw the smallest supply', () => {
  const hottestCpu = Math.max(...specsIn('Processors').map((s) => s.tdp_watts));
  const hottestGpu = Math.max(...specsIn('Graphics Cards').map((s) => s.tdp_watts));
  const smallest = Math.min(...specsIn('Power Supplies').map((s) => s.watts));

  assert.ok(
    hottestCpu + hottestGpu + BASE_WATTS > smallest,
    `the heaviest build draws ${hottestCpu + hottestGpu + BASE_WATTS} W and the smallest ` +
      `supply is ${smallest} W, so the power rule can never fire against real stock`
  );
});
