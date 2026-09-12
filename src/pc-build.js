/**
 * Customise your PC: the rules that decide whether a heap of parts is
 * actually a computer.
 *
 * All of this lives on the server, and the page asks it after every change.
 * Putting the rules in the browser would be faster and would be a mistake:
 * "add this build to my cart" has to be checked somewhere the customer cannot
 * edit, and a second copy of the rules in the page is a second copy that will
 * eventually disagree with the first.
 *
 * So the page renders what this says and never decides anything itself.
 *
 * Two levels of complaint, and the difference matters:
 *
 *   error   - these parts cannot be assembled. The socket is wrong, the card
 *             does not fit in the case. Adding the build to a cart is blocked.
 *   warning - it will build and run, but you probably do not want it. A 95 W
 *             cooler on a 125 W processor works, briefly, and then throttles.
 *             Said out loud, not blocked: it is the customer's money.
 */

const { all } = require('./db');
const { withSpecs } = require('./catalogue');

/**
 * The slots, in the order the page shows them - roughly the order you would
 * actually choose parts in, since the processor decides the socket and the
 * socket decides most of what follows.
 */
const SLOTS = [
  { key: 'cpu', category: 'Processors', label: 'Processor', asks: 'a processor', required: true },
  { key: 'motherboard', category: 'Motherboards', label: 'Motherboard', asks: 'a motherboard', required: true },
  // `asks` rather than gluing "a " onto the label: memory and storage are
  // mass nouns, and "choose a memory" is not a sentence anybody writes.
  { key: 'memory', category: 'Memory', label: 'Memory', asks: 'memory', required: true },
  { key: 'storage', category: 'Storage', label: 'Storage', asks: 'storage', required: true },
  { key: 'gpu', category: 'Graphics Cards', label: 'Graphics card', asks: 'a graphics card', required: false },
  { key: 'cooler', category: 'Cooling', label: 'CPU cooler', asks: 'a CPU cooler', required: false },
  { key: 'psu', category: 'Power Supplies', label: 'Power supply', asks: 'a power supply', required: true },
  { key: 'cabinet', category: 'Cabinets', label: 'Cabinet', asks: 'a cabinet', required: true },
];

const SLOT_KEYS = SLOTS.map((s) => s.key);

/** Everything the builder can offer, grouped by slot. */
async function parts() {
  const categories = SLOTS.map((s) => s.category);
  const placeholders = categories.map(() => '?').join(', ');

  const rows = await all(
    `SELECT id, name, brand, category, price_paise, stock, image, description, specs
     FROM products
     WHERE category IN (${placeholders})
     ORDER BY price_paise ASC, name ASC`,
    categories
  );

  const products = rows.map(withSpecs);

  return SLOTS.map((slot) => ({
    ...slot,
    options: products.filter((p) => p.category === slot.category),
  }));
}

/**
 * Look up the chosen parts by id.
 *
 * Prices and stock come from the database, never from the request. A page that
 * posted its own totals would be a page that could be edited to post better
 * ones.
 */
async function resolve(selection) {
  const ids = SLOT_KEYS.map((key) => Number(selection?.[key])).filter((id) => Number.isInteger(id));

  if (ids.length === 0) return {};

  const rows = await all(
    `SELECT id, name, brand, category, price_paise, stock, image, specs
     FROM products WHERE id IN (${ids.map(() => '?').join(', ')})`,
    ids
  );

  const byId = new Map(rows.map((r) => [Number(r.id), withSpecs(r)]));
  const chosen = {};

  for (const slot of SLOTS) {
    const id = Number(selection?.[slot.key]);
    const product = byId.get(id);

    // A part only counts for the slot it actually belongs to. Otherwise
    // posting {cpu: <a keyboard id>} would put a keyboard in the socket check.
    if (product && product.category === slot.category) chosen[slot.key] = product;
  }

  return chosen;
}

/** Rough draw of everything that is not the processor or the graphics card. */
const BASE_WATTS = 80;

/** Headroom below which a power supply is legal but unwise. */
const COMFORTABLE = 1.25;

/**
 * Check a resolved build and describe everything wrong with it.
 *
 * Pure: it is handed the parts and returns findings, so it can be tested
 * without a database anywhere near it.
 */
function inspect(chosen) {
  const issues = [];
  const say = (level, slots, message) => issues.push({ level, slots, message });

  const { cpu, motherboard, memory, storage, gpu, cooler, psu, cabinet } = chosen;
  const spec = (part) => (part && part.specs) || {};

  // ---------------------------------------------------------- completeness
  for (const slot of SLOTS) {
    if (slot.required && !chosen[slot.key]) {
      say('incomplete', [slot.key], `Choose ${slot.asks}.`);
    }
  }

  // ------------------------------------------------------------ in stock
  for (const slot of SLOTS) {
    const part = chosen[slot.key];
    if (part && part.stock <= 0) {
      say('error', [slot.key], `${part.name} is sold out.`);
    }
  }

  // -------------------------------------------------------------- socket
  if (cpu && motherboard) {
    const cpuSocket = spec(cpu).socket;
    const boardSocket = spec(motherboard).socket;
    if (cpuSocket && boardSocket && cpuSocket !== boardSocket) {
      say(
        'error',
        ['cpu', 'motherboard'],
        `The ${cpu.name} is an ${cpuSocket} chip and this board is ${boardSocket}. They do not fit.`
      );
    }
  }

  // -------------------------------------------------------- memory type
  if (memory && motherboard) {
    const memType = spec(memory).memory_type;
    const boardType = spec(motherboard).memory_type;
    if (memType && boardType && memType !== boardType) {
      say(
        'error',
        ['memory', 'motherboard'],
        `This board takes ${boardType} and that kit is ${memType}. ${memType} will not go in a ${boardType} slot.`
      );
    }
  }

  // --------------------------------------------------- board fits the case
  if (motherboard && cabinet) {
    const form = spec(motherboard).form_factor;
    const accepts = spec(cabinet).form_factors || [];
    if (form && accepts.length && !accepts.includes(form)) {
      say(
        'error',
        ['motherboard', 'cabinet'],
        `The ${cabinet.name} takes ${accepts.join(', ')} boards, and this one is ${form}.`
      );
    }
  }

  // ---------------------------------------------------- card fits the case
  if (gpu && cabinet) {
    const length = spec(gpu).length_mm;
    const clearance = spec(cabinet).max_gpu_mm;
    if (length && clearance && length > clearance) {
      say(
        'error',
        ['gpu', 'cabinet'],
        `That card is ${length} mm long and the ${cabinet.name} has room for ${clearance} mm.`
      );
    }
  }

  // -------------------------------------------------------------- cooling
  if (cpu && cooler) {
    const sockets = spec(cooler).sockets || [];
    const cpuSocket = spec(cpu).socket;
    if (cpuSocket && sockets.length && !sockets.includes(cpuSocket)) {
      say(
        'error',
        ['cpu', 'cooler'],
        `The ${cooler.name} has no ${cpuSocket} mounting hardware.`
      );
    }

    const capacity = spec(cooler).tdp_watts;
    const heat = spec(cpu).tdp_watts;
    if (capacity && heat && capacity < heat) {
      say(
        'warning',
        ['cpu', 'cooler'],
        `The ${cooler.name} is rated for ${capacity} W and the ${cpu.name} puts out ${heat} W. It will run hot and slow down.`
      );
    }
  }

  if (cooler && cabinet) {
    const type = spec(cooler).cooler_type;

    if (type === 'air') {
      const height = spec(cooler).height_mm;
      const clearance = spec(cabinet).max_cooler_mm;
      if (height && clearance && height > clearance) {
        say(
          'error',
          ['cooler', 'cabinet'],
          `That cooler is ${height} mm tall and the side panel closes at ${clearance} mm.`
        );
      }
    }

    if (type === 'aio') {
      const radiator = spec(cooler).radiator_mm;
      const supported = spec(cabinet).radiators || [];
      if (radiator && supported.length && !supported.includes(radiator)) {
        say(
          'error',
          ['cooler', 'cabinet'],
          `The ${cabinet.name} has no mount for a ${radiator} mm radiator (it takes ${supported.join(', ')} mm).`
        );
      }
    }
  }

  if (cpu && !cooler) {
    say('warning', ['cooler'], 'No cooler chosen. Most of these processors do not include one.');
  }

  // ---------------------------------------------------------------- power
  const cpuWatts = spec(cpu).tdp_watts || 0;
  const gpuWatts = spec(gpu).tdp_watts || 0;
  const draw = cpu || gpu ? cpuWatts + gpuWatts + BASE_WATTS : 0;

  if (psu && draw) {
    const supply = spec(psu).watts || 0;

    if (supply && supply < draw) {
      say(
        'error',
        ['psu'],
        `This build draws about ${draw} W and the ${psu.name} supplies ${supply} W.`
      );
    } else if (supply && supply < draw * COMFORTABLE) {
      say(
        'warning',
        ['psu'],
        `${supply} W for a build drawing about ${draw} W leaves very little headroom. Consider more.`
      );
    }

    const recommended = spec(gpu).psu_recommended_watts;
    if (supply && recommended && supply < recommended) {
      say(
        'warning',
        ['psu', 'gpu'],
        `${gpu.brand} recommend at least ${recommended} W for that card.`
      );
    }
  }

  // ------------------------------------------------------- display output
  if (cpu && !gpu && spec(cpu).igpu === false) {
    say(
      'error',
      ['cpu', 'gpu'],
      `The ${cpu.name} has no built-in graphics, so without a graphics card this machine has nothing to plug a monitor into.`
    );
  }

  // ------------------------------------------------------------- storage
  if (storage && motherboard) {
    const iface = spec(storage).storage_type;
    const slots = spec(motherboard).m2_slots;
    if (iface === 'NVMe' && slots === 0) {
      say('error', ['storage', 'motherboard'], 'This board has no M.2 slot for an NVMe drive.');
    }
  }

  return issues;
}

/** The parts, what is wrong with them, and what it all comes to. */
async function review(selection) {
  const chosen = await resolve(selection);
  const issues = inspect(chosen);

  const picked = SLOT_KEYS.map((key) => chosen[key]).filter(Boolean);
  const total = picked.reduce((sum, part) => sum + part.price_paise, 0);

  // Same condition as `draw` in inspect(), deliberately: a figure in the
  // summary that disagrees with the rule beside it is worse than no figure.
  const cpuWatts = chosen.cpu?.specs?.tdp_watts || 0;
  const gpuWatts = chosen.gpu?.specs?.tdp_watts || 0;
  const drawing = Boolean(chosen.cpu || chosen.gpu);

  return {
    chosen,
    issues,
    total_paise: total,
    part_count: picked.length,
    estimated_watts: drawing ? cpuWatts + gpuWatts + BASE_WATTS : 0,
    // Missing parts are listed separately from mistakes: an unfinished build
    // is not a wrong one, and the page says so differently.
    blocked: issues.some((i) => i.level === 'error'),
    complete: SLOTS.every((s) => !s.required || chosen[s.key]),
  };
}

module.exports = { SLOTS, SLOT_KEYS, parts, resolve, inspect, review, BASE_WATTS };
