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

  const src = photo.src?.large || photo.src?.medium;
  if (!src) return null;

  return {
    id: photo.id,
    src,
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
  const products = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const credits = {};
  const seen = blocklist();
  if (seen.size) console.log(`skipping ${seen.size} photo(s) rejected by eye`);
  let failures = 0;

  for (const [category, queries] of Object.entries(SEARCHES)) {
    const wanted = products.filter((p) => p.category === category);
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
        console.log(`  ${filename}  ${(size / 1024).toFixed(0)}KB  ${pick.photographer}  "${pick.alt.slice(0, 40)}"`);
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

  // Only once every product has a photograph: point the catalogue at them.
  // A half-photographed shop looks worse than one that is all drawings.
  const updated = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8')).map((p) => ({
    ...p,
    image: p.image.replace(/\.\w+$/, '.jpg'),
  }));

  const text = fs.readFileSync(CATALOGUE, 'utf8').replace(/\.svg"/g, '.jpg"');
  fs.writeFileSync(CATALOGUE, text);

  fs.writeFileSync(CREDITS, `${JSON.stringify(credits, null, 2)}\n`);

  console.log(`\n${updated.length} photographs downloaded and credited.`);
  console.log('data/products.json now points at them. Run  npm run seed  to update the database.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
