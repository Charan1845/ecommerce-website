/**
 * Downloads a product photo for every item in data/products.json.
 *
 * Run with:  npm run photos
 *
 * Photographs come from Wikimedia Commons, which is searchable without an API
 * key and where every file carries its licence in machine-readable form. Only
 * licences that permit reuse are accepted, and the photographer and licence
 * for each file are written to data/photo-credits.json so the site can credit
 * them - which most of these licences require, and which is the right thing to
 * do regardless.
 *
 * These are photographs of the general kind of thing each product is: a
 * mechanical keyboard, a gaming mouse. They are not photographs of DevGear
 * products, because DevGear is not a real company and has never manufactured
 * anything. The product page says so.
 */

const fs = require('node:fs');
const path = require('node:path');

const CATALOGUE = path.join(__dirname, '..', 'data', 'products.json');
const OUT_DIR = path.join(__dirname, '..', 'public', 'images', 'products');
const CREDITS = path.join(__dirname, '..', 'data', 'photo-credits.json');

// Wikimedia asks that tools identify themselves and say who to contact.
const USER_AGENT =
  'DevGear-portfolio-project/1.0 (student project; https://github.com/Charan1845/ecommerce-website)';

/** Licences that allow reuse. Anything else is skipped, whatever it looks like. */
const ALLOWED_LICENCES = [
  /^cc0/i,
  /^public domain/i,
  /^cc by(-sa)? [1-4]/i,
  /^cc-by(-sa)?-[1-4]/i,
];

/** What to search for, per category. Several queries so there is a choice. */
const SEARCHES = {
  Keyboards: [
    'mechanical keyboard',
    'computer keyboard backlit',
    'wireless computer keyboard',
    'gaming keyboard rgb',
    'keyboard keycaps',
    'keyboard desk setup',
  ],
  Mouse: [
    'computer mouse peripheral',
    'gaming mouse',
    'wireless computer mouse',
    'optical computer mouse',
    'mouse pad desk',
  ],
  Headsets: [
    'headphones',
    'gaming headset microphone',
    'wireless earbuds',
    'over-ear headphones',
    'headphones desk',
  ],
  Monitors: [
    'computer monitor',
    'lcd monitor display',
    'desktop computer monitor',
    'widescreen monitor',
    'monitor desk setup',
  ],
};

/**
 * Titles that are not a usable product shot.
 *
 * The first pass of this script came back with ceramic mouse ornaments, real
 * field mice, a cat sitting in front of a monitor, two broken CRTs and a
 * monitor in the snow. Searching for "mouse" gets you the animal, and Commons
 * is a photo archive rather than a catalogue.
 */
const REJECT_SUBJECT =
  /(aisle|store|shop|shelf|museum|layout|diagram|map|logo|icon|person|man |woman |child|cat[ -]|dog|mice |mouse ornament|majolica|field|snow|water|broken|damaged|repair|dump|waste|recycl|vintage|retro|1980|1990|amiga|commodore|atari|typewriter|cycling|street|remix|transparent|unsplash)/i;

/**
 * Photographs of identifiable branded hardware.
 *
 * A photo of a real Razer mouse sold as a DevGear product is the same
 * misrepresentation as a DevGear photo sold as a Razer one - which is the
 * whole reason this catalogue stopped using real brand names. If the brand is
 * visible in the title, it is visible in the picture.
 */
const REJECT_BRAND =
  /(razer|logitech|bose|jbl|jlab|eizo|kensington|samsung|apple|imac|macbook|mac |dell|hp |asus|acer|msi|benq|lg |sony|corsair|keychron|redragon|steelseries|hyperx|sennheiser|audioquest|anker|xiaomi|huawei|lenovo|microsoft|ibm|nec|philips|beyerdynamic|akg|shure|zebronics|cooler master|ducky|varmilo|leopold)/i;

const REJECT = new RegExp(`${REJECT_SUBJECT.source}|${REJECT_BRAND.source}`, 'i');

const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

async function search(query) {
  const url =
    'https://commons.wikimedia.org/w/api.php?' +
    new URLSearchParams({
      action: 'query',
      format: 'json',
      generator: 'search',
      gsrsearch: `filetype:bitmap ${query}`,
      gsrlimit: '25',
      gsrnamespace: '6',
      prop: 'imageinfo',
      iiprop: 'url|extmetadata|size|mime',
      iiurlwidth: '900',
    });

  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Commons search failed: ${res.status}`);

  const body = await res.json();
  return Object.values(body.query?.pages || {});
}

function usable(page) {
  const info = page.imageinfo?.[0];
  if (!info) return null;

  const meta = info.extmetadata || {};
  const licence = stripHtml(meta.LicenseShortName?.value);

  if (!ALLOWED_LICENCES.some((re) => re.test(licence))) return null;
  // JPEG only. A transparent PNG arrived as a .jpg last time and looked wrong
  // against the card background.
  if (info.mime !== 'image/jpeg') return null;

  // Product shots are wider than they are tall, and big enough to not be mush.
  if (!info.thumburl || info.width < 900) return null;

  // Product shots sit in a 4:3 card. Anything much taller or much wider than
  // that gets cropped into nonsense.
  const ratio = info.width / info.height;
  if (ratio < 1.05 || ratio > 2.1) return null;

  if (REJECT.test(page.title)) return null;

  return {
    title: page.title.replace(/^File:/, ''),
    thumburl: info.thumburl,
    licence,
    licence_url: stripHtml(meta.LicenseUrl?.value) || null,
    artist: stripHtml(meta.Artist?.value) || 'Unknown',
    file_page: info.descriptionurl,
  };
}

async function download(url, destination) {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!res.ok) throw new Error(`download failed: ${res.status}`);

  const type = res.headers.get('content-type') || '';
  if (!type.startsWith('image/')) throw new Error(`not an image: ${type}`);

  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 5000) throw new Error('suspiciously small');

  fs.writeFileSync(destination, bytes);
  return bytes.length;
}

async function main() {
  const products = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const credits = {};
  const seen = new Set();

  for (const [category, queries] of Object.entries(SEARCHES)) {
    const wanted = products.filter((p) => p.category === category);

    // Gather candidates from every query for this category, de-duplicated.
    const candidates = [];
    for (const query of queries) {
      const pages = await search(query);
      for (const page of pages) {
        const ok = usable(page);
        if (ok && !seen.has(ok.title)) {
          seen.add(ok.title);
          candidates.push(ok);
        }
      }
      if (candidates.length >= wanted.length + 6) break;
    }

    console.log(`${category}: ${candidates.length} usable candidates for ${wanted.length} products`);

    let index = 0;
    for (const product of wanted) {
      const pick = candidates[index++];
      if (!pick) {
        console.log(`  ! no photo left for ${product.name}`);
        continue;
      }

      const file = path.join(OUT_DIR, product.image);
      try {
        const size = await download(pick.thumburl, file);
        credits[product.image] = {
          product: product.name,
          source: 'Wikimedia Commons',
          title: pick.title,
          photographer: pick.artist,
          licence: pick.licence,
          licence_url: pick.licence_url,
          file_page: pick.file_page,
        };
        console.log(`  ${product.image}  ${(size / 1024).toFixed(0)}KB  ${pick.licence}  ${pick.title.slice(0, 45)}`);
      } catch (err) {
        console.log(`  ! ${product.image}: ${err.message}`);
      }
    }
  }

  fs.writeFileSync(CREDITS, `${JSON.stringify(credits, null, 2)}\n`);
  console.log(`\ncredits for ${Object.keys(credits).length} photos written to data/photo-credits.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
