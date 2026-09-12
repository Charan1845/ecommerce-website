/**
 * Downloads a product photograph for every item in data/products.json.
 *
 * Run with:  npm run photos      (needs PEXELS_API_KEY in .env)
 *
 * Pexels is a stock photography library. Its licence allows free use,
 * including commercially, without attribution - but the photographers are
 * credited anyway, in data/photo-credits.json and on the product page,
 * because someone took these pictures.
 *
 * -------------------------------------------------------------------------
 * WHAT THESE PHOTOGRAPHS ARE, AND ARE NOT
 *
 * They are photographs of the general kind of thing each product is: a
 * mechanical keyboard, a pair of over-ear headphones. They are NOT
 * photographs of DevGear products, because DevGear does not exist and has
 * never manufactured anything.
 *
 * That is why the catalogue stopped using real brand names. A stock photo of
 * some keyboard sold as a "Keychron K2" is a lie about a real company's
 * product. A stock photo of some keyboard sold as a "DevGear Forge 84", in a
 * shop that says on every page that it is a demo, is a placeholder.
 *
 * The filter below rejects photographs whose description names a real
 * manufacturer, for the same reason: a recognisable Razer mouse sold as a
 * DevGear one puts the problem straight back.
 *
 * An earlier version of this script used Wikimedia Commons, which needs no
 * API key. It was abandoned: Commons is an archive rather than a catalogue,
 * and it returned ceramic mouse ornaments, a cat in front of a monitor,
 * broken CRTs and macro shots of LCD pixels. Kept in the git history.
 * -------------------------------------------------------------------------
 */

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');

const CATALOGUE = path.join(__dirname, '..', 'data', 'products.json');
const OUT_DIR = path.join(__dirname, '..', 'public', 'images', 'products');
const CREDITS = path.join(__dirname, '..', 'data', 'photo-credits.json');
const BLOCKLIST = path.join(__dirname, '..', 'data', 'photo-blocklist.json');

const API = 'https://api.pexels.com/v1/search';

/**
 * Photographs rejected by eye, and never to be used again.
 *
 * The text filters below cannot see. A stock photo of a Logitech MX Master
 * whose description says only "a sleek black wireless mouse" passes every
 * automated check and still puts a visible logi logo on a product called
 * DevGear Glide. Same for two pairs of Marshall headphones and an
 * Audio-Technica - the brand is in the picture, not in the words.
 *
 * So the last filter is a person looking at all 48 and writing ids down here.
 * Rebuilding the catalogue then skips them.
 */
/** Whatever attribution has already been recorded. */
function loadCredits() {
  try {
    return JSON.parse(fs.readFileSync(CREDITS, 'utf8'));
  } catch {
    return {};
  }
}

function blocklist() {
  try {
    return new Set(JSON.parse(fs.readFileSync(BLOCKLIST, 'utf8')).map((e) => String(e.id)));
  } catch {
    return new Set();
  }
}

/** Searches per category. Several, so there is a choice to filter down from. */
const SEARCHES = {
  Keyboards: [
    'mechanical keyboard',
    'computer keyboard',
    'keyboard rgb backlit',
    'keyboard closeup desk',
  ],
  Mouse: ['computer mouse', 'gaming mouse', 'wireless mouse desk', 'mouse and mousepad'],
  Headsets: ['headphones', 'gaming headset', 'wireless earbuds', 'over ear headphones'],
  Monitors: [
    'computer monitor',
    'desktop monitor screen',
    'monitor on desk',
    'led monitor display',
    'gaming monitor',
    'widescreen monitor desk',
  ],

  // The parts half of the catalogue. Harder to photograph honestly than
  // peripherals: a keyboard photographed on a desk is just a keyboard, but
  // most stock photographs of a graphics card are of somebody's actual
  // graphics card, with the maker's name across the shroud.
  Processors: ['computer processor', 'cpu chip', 'microprocessor', 'cpu socket motherboard'],
  Motherboards: ['motherboard', 'computer motherboard', 'pc motherboard closeup', 'mainboard'],
  'Graphics Cards': ['graphics card', 'gpu computer', 'video card pc', 'graphics card closeup'],
  Memory: ['ram memory', 'computer ram stick', 'memory module', 'ddr ram'],
  Storage: ['ssd drive', 'solid state drive', 'hard drive disk', 'nvme ssd', 'hard disk drive'],
  'Power Supplies': ['power supply computer', 'pc power supply unit', 'computer psu'],
  Cabinets: ['computer case', 'pc tower case', 'gaming pc build', 'desktop computer tower'],
  Cooling: ['cpu cooler', 'pc cooling fan', 'computer fan', 'liquid cooling pc', 'heatsink'],
};

/**
 * Photographs showing identifiable branded hardware.
 *
 * If the description names the manufacturer, the logo is usually in shot.
 */
const REJECT_BRAND =
  /(razer|logitech|bose|jbl|jlab|eizo|kensington|samsung|apple|imac|macbook|\bmac\b|dell|\bhp\b|asus|acer|msi|benq|\blg\b|sony|corsair|keychron|redragon|steelseries|hyperx|sennheiser|audioquest|anker|xiaomi|huawei|lenovo|microsoft|ibm|\bnec\b|philips|beyerdynamic|\bakg\b|shure|zebronics|cooler master|ducky|varmilo|leopold|beats|airpods|galaxy|iphone)/i;

/**
 * Photographs of a person, of obsolete hardware, or of something else
 * entirely. The monitor searches are the ones that need this: asking a stock
 * library for "computer monitor" also returns data centres, control rooms,
 * computer labs and rows of CRTs from 1998.
 */
const REJECT_SUBJECT =
  /(\bman\b|\bwoman\b|\bboy\b|\bgirl\b|people|person|hand|holding|portrait|child|worker|operator|engineer|programmer|developer|student|\bcat\b|\bdog\b|animal|mouse trap|field mouse|rodent|broken|trash|garbage|waste|abstract|texture|wallpaper|vintage|retro|\bcrt\b|\bold\b|classic|data cent|server|control room|\blab\b|cable|network|surveillance|security camera|medical|bmrib|scan|hospital|radiolog|x-ray)/i;

/**
 * The photograph has to actually be of the thing being sold.
 *
 * Without this, "computer monitor" returns a photograph of cabling in a data
 * centre - technically a search result, useless as a product picture.
 */
const MUST_MENTION = {
  Keyboards: /keyboard|keycap/i,
  Mouse: /\bmouse\b|\bmice\b/i,
  Headsets: /headphone|headset|earbud|earphone/i,
  Monitors: /monitor|screen|display/i,
  Processors: /processor|cpu|chip|microprocessor/i,
  Motherboards: /motherboard|mainboard|circuit board/i,
  'Graphics Cards': /graphic|gpu|video card/i,
  Memory: /ram|memory|module/i,
  Storage: /ssd|hard.?d(rive|isk)|hdd|nvme|solid.state|storage|disk/i,
  'Power Supplies': /power supply|psu/i,
  Cabinets: /case|tower|chassis|desktop computer/i,
  Cooling: /cooler|cooling|fan|heatsink|radiator/i,
};

function apiKey() {
  const key = process.env.PEXELS_API_KEY;
  if (!key) {
    console.error(
      [
        'PEXELS_API_KEY is not set.',
        '',
        'Get one - it is free and takes about two minutes:',
        '  1. https://www.pexels.com/api/  ->  Get Started',
        '  2. Sign up (email only; no card, no documents)',
        '  3. Copy the API key it shows you',
        '  4. Put it in .env as   PEXELS_API_KEY=your-key',
        '',
        'Then run  npm run photos  again.',
      ].join('\n')
    );
    process.exit(1);
  }
  return key;
}

async function search(query, key) {
  const url = `${API}?${new URLSearchParams({
    query,
    per_page: '40',
    orientation: 'landscape',
    size: 'medium',
  })}`;

  const res = await fetch(url, { headers: { authorization: key } });
  if (!res.ok) {
    throw new Error(`Pexels search failed (${res.status}). Check the API key.`);
  }

  const body = await res.json();
  return body.photos || [];
}

function usable(photo, category) {
  const description = `${photo.alt || ''} ${photo.url || ''}`;

  const mustMention = MUST_MENTION[category];
  if (mustMention && !mustMention.test(description)) return null;

  if (REJECT_BRAND.test(description)) return null;
  if (REJECT_SUBJECT.test(description)) return null;

  // Big enough not to look soft in a card, and roughly the card's shape.
  if (photo.width < 900) return null;
  const ratio = photo.width / photo.height;
  if (ratio < 1.1 || ratio > 2.2) return null;

  // Two sizes. `large` is about 940px wide, which suits the product page;
  // `medium` is about a third of the bytes and is all a 280px card needs.
  const src = photo.src?.large || photo.src?.medium;
  const cardSrc = photo.src?.medium || src;
  if (!src) return null;

  return {
    id: photo.id,
    src,
    cardSrc,
    alt: photo.alt || '',
    photographer: photo.photographer || 'Unknown',
    photographer_url: photo.photographer_url || null,
    page: photo.url,
  };
}

/**
 * How well a photograph suits one particular product.
 *
 * Taking candidates in order gave the Echo Buds - earbuds - a photograph of
 * over-ear headphones, because both are "Headsets" and it happened to be
 * next in the list. The category is not specific enough on its own.
 *
 * So each product asks for what it actually is, and the best-matching unused
 * photograph wins. Higher is better; 0 means nothing in common.
 */
const PRODUCT_WANTS = [
  [/earbud/i, /earbud|in.?ear|\bbuds\b/i, 6],
  [/headset/i, /headset|microphone|\bmic\b|gaming/i, 4],
  [/headphone/i, /headphone|over.?ear|on.?ear/i, 3],
  [/mechanical/i, /mechanical|keycap|switch/i, 3],
  [/wireless/i, /wireless|bluetooth/i, 2],
  [/wired/i, /wired|cable|\busb\b/i, 2],
  [/gaming/i, /gaming|\brgb\b|backlit/i, 2],
  [/\bmini\b|60%/i, /compact|small|mini|60/i, 2],
  [/combo/i, /keyboard and mouse|combo|setup/i, 2],
  [/curved|27-inch/i, /curved|ultrawide|large/i, 1],
  [/liquid cooler/i, /liquid|water|radiator|aio/i, 5],
  [/cpu cooler/i, /heatsink|tower|air|fan/i, 3],
  [/nvme|m\.2/i, /nvme|m\.2|stick|small/i, 4],
  [/hard drive/i, /hard.?d(rive|isk)|hdd|platter|mechanical/i, 5],
  [/sata ssd/i, /ssd|solid.state|2\.5/i, 3],
  [/mid tower|micro tower/i, /tower|case|chassis/i, 3],
  [/ddr5/i, /ddr5|ram|memory/i, 2],
  [/graphics card/i, /graphic|gpu|video card/i, 3],
];

function suitability(product, candidate) {
  let score = 0;
  for (const [productPattern, altPattern, weight] of PRODUCT_WANTS) {
    if (productPattern.test(product.name) && altPattern.test(candidate.alt)) {
      score += weight;
    }
    // Actively wrong: an earbuds product must not get an over-ear photo.
    if (/earbud/i.test(product.name) && /over.?ear|on.?ear|studio/i.test(candidate.alt)) {
      score -= 8;
    }
  }
  return score;
}

/** "kb-01.jpg" -> "kb-01-card.jpg" */
function cardName(filename) {
  return filename.replace(/\.jpg$/, '-card.jpg');
}

/**
 * Fetch only the small card version for photographs already chosen.
 *
 * Re-running the whole selection would pick different photographs and
 * reshuffle a catalogue somebody has already looked at. This reads the
 * existing credits, asks Pexels for each photograph by id, and downloads the
 * smaller size beside the one already there.
 */
async function topUpCardSizes(key) {
  const credits = JSON.parse(fs.readFileSync(CREDITS, 'utf8'));
  let added = 0;
  let skipped = 0;

  for (const [filename, credit] of Object.entries(credits)) {
    const target = path.join(OUT_DIR, cardName(filename));
    if (fs.existsSync(target)) {
      skipped += 1;
      continue;
    }

    const res = await fetch(`https://api.pexels.com/v1/photos/${credit.id}`, {
      headers: { authorization: key },
    });
    if (!res.ok) {
      console.log(`  ! ${filename}: Pexels returned ${res.status}`);
      continue;
    }

    const photo = await res.json();
    const src = photo.src?.medium || photo.src?.large;
    const size = await download(src, target);
    added += 1;
    console.log(`  ${cardName(filename)}  ${(size / 1024).toFixed(0)}KB`);
  }

  console.log(`\n${added} card-sized photographs added, ${skipped} already there.`);
}

async function download(url, destination) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);

  const type = res.headers.get('content-type') || '';
  if (!type.startsWith('image/')) throw new Error(`not an image: ${type}`);

  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 5000) throw new Error('suspiciously small');

  fs.writeFileSync(destination, bytes);
  return bytes.length;
}

async function main() {
  const key = apiKey();

  // `npm run photos -- --cards-only` tops up the small sizes without
  // choosing different photographs.
  if (process.argv.includes('--cards-only')) {
    return topUpCardSizes(key);
  }

  const products = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  /**
   * `npm run photos -- --only="Processors,Memory"` fetches just those.
   *
   * Without it, adding a range to the catalogue means re-running the whole
   * thing, which re-picks photographs for products that already have good
   * ones - throwing away the work that went into choosing them by eye.
   */
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg
    ? new Set(onlyArg.slice('--only='.length).split(',').map((c) => c.trim()).filter(Boolean))
    : null;

  if (only) {
    const unknown = [...only].filter((c) => !SEARCHES[c]);
    if (unknown.length) throw new Error(`no searches defined for: ${unknown.join(', ')}`);
    console.log(`only fetching: ${[...only].join(', ')}`);
  }

  // Existing credits are merged into rather than replaced, so a partial run
  // does not erase attribution for photographs it never touched.
  const credits = only ? loadCredits() : {};
  const seen = blocklist();
  if (seen.size) console.log(`skipping ${seen.size} photo(s) rejected by eye`);
  let failures = 0;

  for (const [category, queries] of Object.entries(SEARCHES)) {
    if (only && !only.has(category)) continue;

    const wanted = products.filter((p) => p.category === category);
    if (!wanted.length) continue;
    const candidates = [];

    for (const query of queries) {
      for (const photo of await search(query, key)) {
        const ok = usable(photo, category);
        if (ok && !seen.has(String(ok.id))) {
          seen.add(String(ok.id));
          candidates.push(ok);
        }
      }
      if (candidates.length >= wanted.length + 4) break;
    }

    console.log(`\n${category}: ${candidates.length} usable photos for ${wanted.length} products`);

    // Hardest-to-please products choose first, so the one product that needs
    // a photograph of earbuds is not left with whatever is last.
    const order = [...wanted].sort(
      (a, b) => Math.max(...candidates.map((c) => suitability(b, c)))
             - Math.max(...candidates.map((c) => suitability(a, c)))
    );

    const taken = new Set();
    const chosen = new Map();

    for (const product of order) {
      let best = null;
      let bestScore = -Infinity;

      for (const candidate of candidates) {
        if (taken.has(candidate.id)) continue;
        const score = suitability(product, candidate);
        if (score > bestScore) {
          bestScore = score;
          best = candidate;
        }
      }

      if (best) {
        taken.add(best.id);
        chosen.set(product.id, best);
      }
    }

    for (const product of wanted) {
      const pick = chosen.get(product.id);
      const filename = product.image.replace(/\.\w+$/, '.jpg');

      if (!pick) {
        console.log(`  ! nothing left for ${product.name}`);
        failures += 1;
        continue;
      }

      try {
        const size = await download(pick.src, path.join(OUT_DIR, filename));
        const cardSize = await download(
          pick.cardSrc,
          path.join(OUT_DIR, cardName(filename))
        );
        credits[filename] = {
          product: product.name,
          source: 'Pexels',
          id: pick.id,
          photographer: pick.photographer,
          photographer_url: pick.photographer_url,
          page: pick.page,
          licence: 'Pexels licence',
          licence_url: 'https://www.pexels.com/license/',
          alt: pick.alt,
        };
        console.log(
          `  ${filename}  ${(size / 1024).toFixed(0)}KB` +
            ` + card ${(cardSize / 1024).toFixed(0)}KB  ${pick.photographer}`
        );
      } catch (err) {
        console.log(`  ! ${filename}: ${err.message}`);
        failures += 1;
      }
    }
  }

  if (failures) {
    console.log(`\n${failures} product(s) have no photograph. Leaving the catalogue on illustrations.`);
    console.log('Widen the searches in this file and run it again.');
    return;
  }

  // A whole run points the catalogue at the photographs once every product
  // has one - a half-photographed shop looks worse than one that is all
  // drawings. A partial run leaves the catalogue alone: the filenames it is
  // filling in were already .jpg before it started.
  if (!only) {
    const text = fs.readFileSync(CATALOGUE, 'utf8').replace(/\.svg"/g, '.jpg"');
    fs.writeFileSync(CATALOGUE, text);
  }

  fs.writeFileSync(CREDITS, `${JSON.stringify(credits, null, 2)}\n`);

  console.log('\nDone. Run  npm run seed  to update the database.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
