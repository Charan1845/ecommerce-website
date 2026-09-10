/**
 * Draws a product illustration for every item in data/products.json.
 *
 * Run with:  npm run images
 *
 * These are generated, not photographed. Real product photography belongs to
 * the brands that made it, and a demo shop has no right to it - so each
 * product gets a drawing of the right kind of thing (a 60% keyboard looks
 * like a 60% keyboard, a gaming mouse has its side button) in that brand's
 * colour.
 *
 * Output: public/images/products/<name>.svg
 */

const fs = require('node:fs');
const path = require('node:path');

const CATALOGUE = path.join(__dirname, '..', 'data', 'products.json');
const OUT_DIR = path.join(__dirname, '..', 'public', 'images', 'products');

const W = 800;
const H = 600;

/** A colour per brand, so the shelf does not look like one product repeated. */
const BRAND_COLOR = {
  Keychron: '#f0a500',
  Logitech: '#00b8fc',
  Zebronics: '#e8112d',
  Redragon: '#c8102e',
  Dell: '#0076ce',
  Corsair: '#facc15',
  'Ant Esports': '#ff4d00',
  'Cosmic Byte': '#8b5cf6',
  HP: '#0096d6',
  Razer: '#44d62c',
  Sony: '#1a1a1a',
  boAt: '#ff2e2e',
  OnePlus: '#eb0028',
  HyperX: '#e6162d',
  JBL: '#ff6600',
  Sennheiser: '#0a5c36',
  LG: '#a50034',
  Samsung: '#1428a0',
  Acer: '#83b81a',
  BenQ: '#8b5cf6',
  ASUS: '#00539b',
  MSI: '#ff0000',
  'Western Digital': '#0057b8',
  SanDisk: '#e30613',
};

const BODY_DARK = '#1f2937';
const BODY_MID = '#374151';
const BODY_LIGHT = '#4b5563';

const color = (brand) => BRAND_COLOR[brand] || '#64748b';

/* ------------------------------------------------------------------ */
/* keyboards                                                           */
/* ------------------------------------------------------------------ */

function keyboardLayout(name) {
  if (/mini|60%/i.test(name)) return { cols: 14, rows: 5, width: 520 };
  if (/tkl|tenkeyless|hot-swap|84/i.test(name)) return { cols: 16, rows: 5, width: 590 };
  if (/combo|multi-device|low-profile/i.test(name)) return { cols: 15, rows: 5, width: 540 };
  return { cols: 21, rows: 5, width: 660 }; // full size, with a number pad
}

function keyboard(product) {
  const accent = color(product.brand);
  const { cols, rows, width } = keyboardLayout(product.name);
  const mechanical = /mechanical/i.test(product.name);

  const keySize = (width - 30) / cols;
  const height = rows * keySize + 30;
  const x = (W - width) / 2;
  const y = (H - height) / 2;

  const keys = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // The bottom row is mostly one long space bar.
      if (r === rows - 1 && c > 3 && c < cols - 4) {
        if (c === 4) {
          keys.push(
            `<rect x="${x + 15 + c * keySize + 2}" y="${y + 15 + r * keySize + 2}"
                   width="${keySize * (cols - 8) - 4}" height="${keySize - 4}" rx="3"
                   fill="${mechanical ? '#e5e7eb' : '#d1d5db'}"/>`
          );
        }
        continue;
      }

      // Scatter a few accent keycaps: escape, the arrow cluster, enter.
      const isAccent = (r === 0 && c === 0) || (r === 1 && c === cols - 1) || (r === rows - 2 && c === cols - 1);

      keys.push(
        `<rect x="${x + 15 + c * keySize + 2}" y="${y + 15 + r * keySize + 2}"
               width="${keySize - 4}" height="${keySize - 4}" rx="3"
               fill="${isAccent ? accent : mechanical ? '#e5e7eb' : '#d1d5db'}"/>`
      );
    }
  }

  const backlight = /rgb|backlit|backlight|lighting|firefly|prodigy/i.test(product.name + product.description)
    ? `<rect x="${x}" y="${y + height - 6}" width="${width}" height="10" rx="5" fill="${accent}" opacity="0.55"/>`
    : '';

  const cable = /wired|usb/i.test(product.name + product.description)
    ? `<path d="M ${W / 2} ${y} C ${W / 2} ${y - 60}, ${W / 2 + 90} ${y - 70}, ${W / 2 + 90} ${y - 110}"
             stroke="${BODY_MID}" stroke-width="7" fill="none" stroke-linecap="round"/>`
    : '';

  return `
    ${cable}
    ${backlight}
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="12" fill="${BODY_DARK}"/>
    <rect x="${x + 6}" y="${y + 6}" width="${width - 12}" height="${height - 12}" rx="8" fill="${BODY_MID}"/>
    ${keys.join('\n')}`;
}

/* ------------------------------------------------------------------ */
/* mice                                                                */
/* ------------------------------------------------------------------ */

function mouse(product) {
  const accent = color(product.brand);
  const gaming = /gaming|strike|apex|cobra|lumen|feather/i.test(product.name);
  const compact = /pebble|lite|office|wired optical/i.test(product.name);

  const bodyW = compact ? 190 : 230;
  const bodyH = compact ? 300 : 360;
  const x = (W - bodyW) / 2;
  const y = (H - bodyH) / 2 + 10;

  const cable = /wired/i.test(product.name + product.description)
    ? `<path d="M ${W / 2} ${y} C ${W / 2} ${y - 50}, ${W / 2 + 70} ${y - 60}, ${W / 2 + 70} ${y - 100}"
             stroke="${BODY_MID}" stroke-width="7" fill="none" stroke-linecap="round"/>`
    : '';

  // A rounded blob, narrower at the top, wider at the palm.
  const body = `
    <path d="M ${W / 2} ${y}
             C ${x + bodyW * 0.05} ${y + bodyH * 0.12}, ${x} ${y + bodyH * 0.45}, ${x + bodyW * 0.06} ${y + bodyH * 0.78}
             C ${x + bodyW * 0.16} ${y + bodyH * 1.02}, ${x + bodyW * 0.84} ${y + bodyH * 1.02}, ${x + bodyW * 0.94} ${y + bodyH * 0.78}
             C ${x + bodyW} ${y + bodyH * 0.45}, ${x + bodyW * 0.95} ${y + bodyH * 0.12}, ${W / 2} ${y} Z"
          fill="${BODY_DARK}"/>`;

  const split = `
    <path d="M ${W / 2} ${y + 6} L ${W / 2} ${y + bodyH * 0.42}" stroke="${BODY_LIGHT}" stroke-width="4"/>
    <path d="M ${x + bodyW * 0.09} ${y + bodyH * 0.42} L ${x + bodyW * 0.91} ${y + bodyH * 0.42}"
          stroke="${BODY_LIGHT}" stroke-width="4" opacity="0.6"/>`;

  const wheel = `
    <rect x="${W / 2 - 11}" y="${y + bodyH * 0.14}" width="22" height="52" rx="11" fill="${accent}"/>`;

  const sideButtons = gaming
    ? `<rect x="${x + 4}" y="${y + bodyH * 0.3}" width="16" height="34" rx="7" fill="${BODY_LIGHT}"/>
       <rect x="${x + 4}" y="${y + bodyH * 0.44}" width="16" height="34" rx="7" fill="${BODY_LIGHT}"/>`
    : '';

  const glow = gaming
    ? `<ellipse cx="${W / 2}" cy="${y + bodyH * 0.82}" rx="${bodyW * 0.26}" ry="16" fill="${accent}" opacity="0.75"/>`
    : '';

  return `${cable}${body}${split}${wheel}${sideButtons}${glow}`;
}

/* ------------------------------------------------------------------ */
/* headsets                                                            */
/* ------------------------------------------------------------------ */

function earbuds(product) {
  const accent = color(product.brand);
  const cx = W / 2;
  const cy = H / 2;

  const bud = (ox) => `
    <g transform="translate(${ox}, 0)">
      <ellipse cx="${cx}" cy="${cy - 40}" rx="46" ry="52" fill="${BODY_DARK}"/>
      <ellipse cx="${cx}" cy="${cy - 46}" rx="26" ry="28" fill="${BODY_LIGHT}"/>
      <rect x="${cx - 13}" y="${cy}" width="26" height="96" rx="13" fill="${BODY_DARK}"/>
      <rect x="${cx - 13}" y="${cy + 60}" width="26" height="36" rx="13" fill="${accent}"/>
    </g>`;

  return `
    <rect x="${cx - 130}" y="${cy + 110}" width="260" height="86" rx="26" fill="${BODY_MID}"/>
    <rect x="${cx - 130}" y="${cy + 110}" width="260" height="16" rx="8" fill="${accent}" opacity="0.8"/>
    ${bud(-95)}
    ${bud(95)}`;
}

function headphones(product) {
  const accent = color(product.brand);
  const boom = /gaming|headset|mic|call|stinger|shark|immortal|stereo/i.test(product.name);

  const cx = W / 2;
  const cy = H / 2 + 20;
  const span = 150;

  const band = `
    <path d="M ${cx - span} ${cy}
             C ${cx - span} ${cy - 200}, ${cx + span} ${cy - 200}, ${cx + span} ${cy}"
          stroke="${BODY_DARK}" stroke-width="34" fill="none" stroke-linecap="round"/>
    <path d="M ${cx - span + 4} ${cy - 20}
             C ${cx - span + 4} ${cy - 178}, ${cx + span - 4} ${cy - 178}, ${cx + span - 4} ${cy - 20}"
          stroke="${accent}" stroke-width="10" fill="none" stroke-linecap="round" opacity="0.9"/>`;

  const cup = (side) => `
    <g>
      <rect x="${cx + side * span - 52}" y="${cy - 34}" width="104" height="150" rx="46" fill="${BODY_DARK}"/>
      <rect x="${cx + side * span - 38}" y="${cy - 20}" width="76" height="122" rx="36" fill="${BODY_MID}"/>
      <circle cx="${cx + side * span}" cy="${cy + 42}" r="19" fill="${accent}" opacity="0.85"/>
    </g>`;

  const mic = boom
    ? `<path d="M ${cx - span + 18} ${cy + 96}
                C ${cx - span - 40} ${cy + 150}, ${cx - 90} ${cy + 178}, ${cx - 42} ${cy + 168}"
             stroke="${BODY_DARK}" stroke-width="13" fill="none" stroke-linecap="round"/>
       <ellipse cx="${cx - 36}" cy="${cy + 167}" rx="20" ry="14" fill="${accent}"/>`
    : '';

  return `${band}${cup(-1)}${cup(1)}${mic}`;
}

/* ------------------------------------------------------------------ */
/* monitors                                                            */
/* ------------------------------------------------------------------ */

function monitor(product) {
  const accent = color(product.brand);
  const inches = Number((product.name.match(/(\d{2})-inch/) || [])[1] || 24);
  const gaming = /gaming|nitro|arena|odyssey|165hz|240hz/i.test(product.name + product.description);

  // Bigger screens are drawn bigger, within reason.
  const scale = 0.82 + (inches - 19) / 40;
  const screenW = Math.round(560 * scale);
  const screenH = Math.round(screenW * 0.5625); // 16:9

  const x = (W - screenW) / 2;
  const y = (H - screenH) / 2 - 40;
  const bezel = gaming ? 8 : 14;

  const standTop = y + screenH;

  return `
    <rect x="${x}" y="${y}" width="${screenW}" height="${screenH}" rx="10" fill="${BODY_DARK}"/>
    <rect x="${x + bezel}" y="${y + bezel}" width="${screenW - bezel * 2}" height="${screenH - bezel * 2 - 6}"
          rx="4" fill="url(#screen)"/>
    <rect x="${x + bezel}" y="${y + bezel}" width="${screenW - bezel * 2}" height="${screenH - bezel * 2 - 6}"
          rx="4" fill="${accent}" opacity="0.28"/>
    <rect x="${x}" y="${standTop - 22}" width="${screenW}" height="22" rx="6" fill="${BODY_MID}"/>
    ${gaming ? `<rect x="${x + screenW / 2 - 46}" y="${standTop - 15}" width="92" height="7" rx="3" fill="${accent}"/>` : ''}
    <rect x="${W / 2 - 26}" y="${standTop}" width="52" height="74" rx="8" fill="${BODY_MID}"/>
    <rect x="${W / 2 - 118}" y="${standTop + 66}" width="236" height="22" rx="11" fill="${BODY_DARK}"/>
    ${gaming ? `<ellipse cx="${W / 2}" cy="${standTop + 96}" rx="150" ry="14" fill="${accent}" opacity="0.3"/>` : ''}`;
}

/* ------------------------------------------------------------------ */

function drawing(product) {
  switch (product.category) {
    case 'Keyboards':
      return keyboard(product);
    case 'Mouse':
      return mouse(product);
    case 'Headsets':
      return /buds|earbud/i.test(product.name) ? earbuds(product) : headphones(product);
    case 'Monitors':
      return monitor(product);
    default:
      return '';
  }
}

function svg(product) {
  const accent = color(product.brand);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img"
     aria-label="${product.name}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f8fafc"/>
      <stop offset="100%" stop-color="#e2e8f0"/>
    </linearGradient>
    <linearGradient id="screen" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#334155"/>
    </linearGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#0f172a" flood-opacity="0.18"/>
    </filter>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <circle cx="${W - 110}" cy="110" r="150" fill="${accent}" opacity="0.10"/>
  <ellipse cx="${W / 2}" cy="${H - 70}" rx="250" ry="26" fill="#0f172a" opacity="0.07"/>

  <g filter="url(#soft)">
    ${drawing(product)}
  </g>
</svg>
`;
}

function main() {
  const products = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let written = 0;
  for (const product of products) {
    const filename = product.image.replace(/\.\w+$/, '.svg');
    fs.writeFileSync(path.join(OUT_DIR, filename), svg(product));
    written += 1;
  }

  console.log(`${written} product illustrations written to public/images/products/`);
}

main();
