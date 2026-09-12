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
  Intel: '#0071c5',
  AMD: '#ed1c24',
  Gigabyte: '#e85b0c',
  ASRock: '#8a2be2',
  ZOTAC: '#f5a623',
  Sapphire: '#0a5ad6',
  PowerColor: '#e4002b',
  'G.Skill': '#b3131b',
  Crucial: '#0072ce',
  Kingston: '#c8102e',
  Seagate: '#6ebe4a',
  'Cooler Master': '#6b21a8',
  NZXT: '#7c3aed',
  'Lian Li': '#0ea5e9',
  Deepcool: '#0f766e',
  Antec: '#1d4ed8',
  Noctua: '#8b5a2b',
  'be quiet!': '#f97316',
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
/* the parts half of the catalogue                                     */
/*                                                                     */
/* These are drawn rather than photographed, for a reason worth writing */
/* down. A keyboard photographed on a desk is just a keyboard, so the   */
/* peripherals could use stock photography. A graphics card cannot be:  */
/* every photograph of one is a photograph of somebody's actual card,   */
/* with the maker's name across the shroud. Fetching these from Pexels  */
/* produced an RTX 2080 for a 4060, a Seagate drive for a Samsung one,  */
/* and a liquid cooler for an air cooler.                               */
/*                                                                      */
/* A drawing has none of those problems, and can do something a stock   */
/* photo never could: read the product's own specs. The 320 mm card is  */
/* drawn longer than the 200 mm one, a 32 GB kit gets two sticks, and   */
/* an all-in-one gets a radiator while a tower cooler gets fins.        */
/* ------------------------------------------------------------------ */

/** Everything below reads specs, which only the parts half of the shop has. */
const spec = (product) => product.specs || {};

/** A fan: blades round a hub, used by four of the drawings below. */
function fan(cx, cy, r, accent, blades = 9, width = 8) {
  const spokes = Array.from({ length: blades }, (_, b) => {
    const a = (b / blades) * Math.PI * 2;
    const x = (cx + Math.cos(a) * (r - 8)).toFixed(1);
    const y = (cy + Math.sin(a) * (r - 8)).toFixed(1);
    return `<path d="M ${cx} ${cy} L ${x} ${y}" stroke="${BODY_LIGHT}" stroke-width="${width}" stroke-linecap="round"/>`;
  }).join('');

  return `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#0f172a"/>
    ${spokes}
    <circle cx="${cx}" cy="${cy}" r="${Math.round(r * 0.24)}" fill="${accent}"/>`;
}

function processor(product) {
  const accent = color(product.brand);

  // The heat spreader, and the substrate it sits on. The border between them
  // is where the detail goes: an earlier version drew a pin grid across the
  // whole substrate and then covered every pin with the spreader, leaving two
  // plain squares.
  const size = 230;
  const border = 34;
  const x = (W - size) / 2;
  const y = (H - size) / 2 - 10;

  const ox = x - border;
  const oy = y - border;
  const outer = size + border * 2;

  // Contact pads around the visible edge of the substrate.
  const perSide = 13;
  const step = (outer - 36) / (perSide - 1);
  const pad = (cx, cy) =>
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5" fill="${accent}" opacity="0.5"/>`;

  const pads = Array.from({ length: perSide }, (_, i) => {
    const along = ox + 18 + i * step;
    const down = oy + 18 + i * step;
    return (
      pad(along, oy + 17) +
      pad(along, oy + outer - 17) +
      pad(ox + 17, down) +
      pad(ox + outer - 17, down)
    );
  }).join('');

  // A few surface-mount parts in one corner, the way a real package has them.
  const smd = Array.from({ length: 6 }, (_, i) =>
    `<rect x="${x + size - 74 + (i % 3) * 22}" y="${y + size + 8 + Math.floor(i / 3) * 13}" width="14" height="8" rx="2" fill="${BODY_LIGHT}"/>`
  ).join('');

  return `
    <rect x="${ox}" y="${oy}" width="${outer}" height="${outer}" rx="10" fill="${BODY_DARK}"/>
    ${pads}
    ${smd}
    <rect x="${x}" y="${y}" width="${size}" height="${size}" rx="6" fill="url(#metal)"/>
    <rect x="${x + 16}" y="${y + 16}" width="${size - 32}" height="${size - 32}" rx="4"
          fill="none" stroke="${accent}" stroke-width="2.5" opacity="0.8"/>
    <rect x="${x + 34}" y="${y + 34}" width="${size - 68}" height="${size - 68}" rx="3"
          fill="${accent}" opacity="0.10"/>
    <!-- the orientation triangle every socket has -->
    <path d="M ${ox + 14} ${oy + outer - 34} l 20 0 l 0 20 z" fill="${accent}" opacity="0.9"/>`;
}

function motherboard(product) {
  const accent = color(product.brand);
  const atx = spec(product).form_factor === 'ATX';
  const bw = atx ? 470 : 400;
  const bh = 400;
  const x = (W - bw) / 2;
  const y = (H - bh) / 2;
  const slots = spec(product).memory_slots || 4;

  const memory = Array.from({ length: slots }, (_, i) =>
    `<rect x="${x + 200 + i * 22}" y="${y + 46}" width="12" height="200" rx="3" fill="${accent}" opacity="${i % 2 ? 0.55 : 0.85}"/>`
  ).join('');

  const heatsink = Array.from({ length: 6 }, (_, i) =>
    `<rect x="${x + 50 + i * 14}" y="${y + 258}" width="7" height="74" rx="2" fill="${BODY_LIGHT}"/>`
  ).join('');

  return `
    <rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="10" fill="#14532d"/>
    <rect x="${x + 10}" y="${y + 10}" width="${bw - 20}" height="${bh - 20}" rx="6"
          fill="none" stroke="${accent}" stroke-width="1.5" opacity="0.3"/>

    <rect x="${x + 42}" y="${y + 56}" width="120" height="120" rx="6" fill="${BODY_DARK}"/>
    <rect x="${x + 58}" y="${y + 72}" width="88" height="88" rx="4" fill="url(#metal)"/>

    ${memory}

    <rect x="${x + 42}" y="${y + 250}" width="90" height="90" rx="6" fill="${BODY_MID}"/>
    ${heatsink}
    <rect x="${x + 160}" y="${y + 286}" width="${bw - 220}" height="18" rx="4" fill="${accent}" opacity="0.85"/>
    <rect x="${x + 160}" y="${y + 330}" width="${bw - 290}" height="14" rx="4" fill="${BODY_MID}"/>

    <rect x="${x + 16}" y="${y + 16}" width="150" height="30" rx="4" fill="${BODY_DARK}"/>`;
}

function graphicsCard(product) {
  const accent = color(product.brand);
  const mm = spec(product).length_mm || 250;

  // Longer cards really are drawn longer: 200mm -> 430px, 320mm -> 640px.
  const cw = Math.round(430 + (mm - 200) * 1.75);
  const ch = 210;
  const x = (W - cw) / 2;
  const y = (H - ch) / 2;
  const count = mm >= 290 ? 3 : 2;
  const spacing = cw / count;

  const fans = Array.from({ length: count }, (_, i) => {
    const cx = x + spacing * (i + 0.5);
    const cy = y + ch / 2;
    return `
      <circle cx="${cx}" cy="${cy}" r="62" fill="${BODY_MID}"/>
      <circle cx="${cx}" cy="${cy}" r="54" fill="none" stroke="${accent}" stroke-width="2" opacity="0.6"/>
      ${fan(cx, cy, 52, accent)}`;
  }).join('');

  return `
    <rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="12" fill="${BODY_DARK}"/>
    <rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="12" fill="none" stroke="${accent}" stroke-width="3"/>
    ${fans}
    <rect x="${x - 16}" y="${y - 10}" width="16" height="${ch + 20}" rx="3" fill="url(#metal)"/>
    <rect x="${x + 40}" y="${y + ch}" width="150" height="16" rx="2" fill="#d4a017"/>`;
}

function memory(product) {
  const accent = color(product.brand);
  const sticks = spec(product).sticks || 2;
  const sw = 132;
  const sh = 330;
  const gap = 34;
  const total = sticks * sw + (sticks - 1) * gap;
  const startX = (W - total) / 2;
  const y = (H - sh) / 2;

  return Array.from({ length: sticks }, (_, i) => {
    const x = startX + i * (sw + gap);
    const chips = Array.from({ length: 4 }, (_, c) =>
      `<rect x="${x + 14}" y="${y + 34 + c * 52}" width="${sw - 28}" height="34" rx="3" fill="#0f172a" opacity="0.45"/>`
    ).join('');

    return `
      <rect x="${x}" y="${y}" width="${sw}" height="${sh}" rx="8" fill="#14532d"/>
      <rect x="${x - 8}" y="${y}" width="${sw + 16}" height="${sh - 70}" rx="8" fill="${accent}"/>
      <rect x="${x + 4}" y="${y + 18}" width="${sw - 8}" height="${sh - 106}" rx="5" fill="${BODY_DARK}" opacity="0.28"/>
      ${chips}
      <rect x="${x}" y="${y + sh - 26}" width="${sw * 0.42}" height="26" rx="2" fill="#d4a017"/>
      <rect x="${x + sw * 0.5}" y="${y + sh - 26}" width="${sw * 0.5}" height="26" rx="2" fill="#d4a017"/>`;
  }).join('');
}

function storage(product) {
  const accent = color(product.brand);
  const kind = spec(product).storage_type;

  if (kind === 'NVMe') {
    const dw = 520;
    const dh = 130;
    const x = (W - dw) / 2;
    const y = (H - dh) / 2;
    const chips = Array.from({ length: 4 }, (_, i) =>
      `<rect x="${x + 96 + i * 100}" y="${y + 34}" width="76" height="62" rx="4" fill="${BODY_DARK}" opacity="0.55"/>`
    ).join('');

    return `
      <rect x="${x}" y="${y}" width="${dw}" height="${dh}" rx="8" fill="#14532d"/>
      <rect x="${x + 70}" y="${y + 16}" width="${dw - 100}" height="${dh - 32}" rx="5" fill="${accent}" opacity="0.9"/>
      ${chips}
      <rect x="${x}" y="${y + 34}" width="46" height="26" rx="2" fill="#d4a017"/>
      <rect x="${x}" y="${y + 70}" width="46" height="26" rx="2" fill="#d4a017"/>`;
  }

  const dw = kind === 'HDD' ? 430 : 380;
  const dh = kind === 'HDD' ? 310 : 280;
  const x = (W - dw) / 2;
  const y = (H - dh) / 2;

  const inside = kind === 'HDD'
    ? `<circle cx="${x + dw / 2}" cy="${y + dh / 2}" r="${dh / 2 - 40}" fill="#0f172a"/>
       <circle cx="${x + dw / 2}" cy="${y + dh / 2}" r="26" fill="url(#metal)"/>
       <path d="M ${x + dw - 60} ${y + 52} q -70 70 -120 110" stroke="${accent}" stroke-width="12"
             fill="none" stroke-linecap="round"/>`
    : `<rect x="${x + 46}" y="${y + 46}" width="${dw - 92}" height="${dh - 92}" rx="4" fill="${accent}" opacity="0.85"/>`;

  const screws = Array.from({ length: 4 }, (_, i) =>
    `<circle cx="${x + (i % 2 ? dw - 16 : 16)}" cy="${y + (i < 2 ? 16 : dh - 16)}" r="6" fill="${BODY_DARK}"/>`
  ).join('');

  return `
    <rect x="${x}" y="${y}" width="${dw}" height="${dh}" rx="10" fill="url(#metal)"/>
    <rect x="${x + 18}" y="${y + 18}" width="${dw - 36}" height="${dh - 36}" rx="6" fill="${BODY_MID}"/>
    ${inside}
    ${screws}`;
}

function powerSupply(product) {
  const accent = color(product.brand);
  const pw = 400;
  const ph = 300;
  const x = (W - pw) / 2;
  const y = (H - ph) / 2;
  const cx = x + pw / 2;
  const cy = y + ph / 2;

  const grille = Array.from({ length: 9 }, (_, i) =>
    `<circle cx="${cx}" cy="${cy}" r="${18 + i * 11}" fill="none" stroke="${BODY_MID}" stroke-width="2" opacity="0.55"/>`
  ).join('');

  return `
    <rect x="${x}" y="${y}" width="${pw}" height="${ph}" rx="10" fill="${BODY_DARK}"/>
    <rect x="${x}" y="${y}" width="${pw}" height="${ph}" rx="10" fill="none" stroke="${accent}" stroke-width="3"/>
    ${fan(cx, cy, 105, accent, 7, 14)}
    ${grille}`;
}

function cabinet(product) {
  const accent = color(product.brand);
  const big = (spec(product).form_factors || []).includes('ATX');
  const cw = big ? 340 : 300;
  const ch = big ? 470 : 400;
  const x = (W - cw) / 2;
  const y = (H - ch) / 2;

  const intake = Array.from({ length: big ? 3 : 2 }, (_, i) =>
    `<circle cx="${x + cw - 42}" cy="${y + 70 + i * 92}" r="30" fill="${BODY_MID}"/>
     <circle cx="${x + cw - 42}" cy="${y + 70 + i * 92}" r="22" fill="none" stroke="${accent}" stroke-width="3" opacity="0.8"/>`
  ).join('');

  return `
    <rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="12" fill="${BODY_DARK}"/>
    <rect x="${x + 18}" y="${y + 18}" width="${cw - 36}" height="${ch - 36}" rx="8" fill="#0f172a" opacity="0.85"/>
    <rect x="${x + 18}" y="${y + 18}" width="${cw - 36}" height="${ch - 36}" rx="8"
          fill="none" stroke="${accent}" stroke-width="2" opacity="0.6"/>

    <rect x="${x + 40}" y="${y + 44}" width="${cw - 110}" height="${Math.round(ch * 0.42)}" rx="5" fill="#14532d" opacity="0.75"/>
    <rect x="${x + 52}" y="${y + Math.round(ch * 0.55)}" width="${cw - 120}" height="42" rx="5" fill="${accent}" opacity="0.7"/>
    <rect x="${x + 34}" y="${y + ch - 96}" width="${cw - 68}" height="58" rx="6" fill="${BODY_MID}"/>

    ${intake}

    <rect x="${x + 20}" y="${y + ch}" width="46" height="14" rx="4" fill="${BODY_MID}"/>
    <rect x="${x + cw - 66}" y="${y + ch}" width="46" height="14" rx="4" fill="${BODY_MID}"/>`;
}

function cooling(product) {
  const accent = color(product.brand);

  if (spec(product).cooler_type === 'aio') {
    const size = spec(product).radiator_mm || 240;
    const count = size >= 360 ? 3 : 2;
    const fanSize = 118;
    const rw = count * fanSize + 26;
    const rh = fanSize + 26;
    const x = (W - rw) / 2;
    const y = 110;

    const fans = Array.from({ length: count }, (_, i) => {
      const cx = x + 13 + fanSize * (i + 0.5);
      const cy = y + rh / 2;
      return `
        <rect x="${cx - fanSize / 2 + 4}" y="${cy - fanSize / 2 + 4}" width="${fanSize - 8}" height="${fanSize - 8}" rx="6" fill="${BODY_DARK}"/>
        ${fan(cx, cy, fanSize / 2 - 12, accent)}`;
    }).join('');

    const pumpY = y + rh + 160;

    return `
      <rect x="${x}" y="${y}" width="${rw}" height="${rh}" rx="8" fill="${BODY_MID}"/>
      ${fans}
      <path d="M ${x + 24} ${y + rh} q -46 120 ${W / 2 - x - 90} 150" stroke="${BODY_MID}" stroke-width="18" fill="none" stroke-linecap="round"/>
      <path d="M ${x + rw - 24} ${y + rh} q 46 120 ${-(x + rw - W / 2) - 90} 150" stroke="${BODY_MID}" stroke-width="18" fill="none" stroke-linecap="round"/>
      <circle cx="${W / 2}" cy="${pumpY}" r="72" fill="${BODY_DARK}"/>
      <circle cx="${W / 2}" cy="${pumpY}" r="56" fill="none" stroke="${accent}" stroke-width="4"/>
      <circle cx="${W / 2}" cy="${pumpY}" r="30" fill="${accent}" opacity="0.85"/>`;
  }

  // An air tower: a fin stack with a fan bolted to the side. Taller coolers
  // are drawn taller, which is the spec the case cares about.
  const height = spec(product).height_mm || 155;
  const tw = 240;
  const th = Math.round(230 + (height - 150) * 2.4);
  const x = (W - tw) / 2 - 50;
  const y = (H - th) / 2 - 10;
  const fins = 16;

  const stack = Array.from({ length: fins }, (_, i) =>
    `<rect x="${x + 6}" y="${(y + 8 + i * ((th - 16) / fins)).toFixed(1)}" width="${tw - 12}" height="${((th - 16) / fins - 5).toFixed(1)}" rx="2" fill="url(#metal)" opacity="0.92"/>`
  ).join('');

  const pipes = Array.from({ length: 4 }, (_, i) =>
    `<rect x="${x + 36 + i * 48}" y="${y - 12}" width="17" height="${th + 14}" rx="8" fill="#b45309"/>`
  ).join('');

  return `
    <rect x="${x + 30}" y="${y + th}" width="${tw - 60}" height="26" rx="5" fill="url(#metal)"/>
    <rect x="${x}" y="${y}" width="${tw}" height="${th}" rx="6" fill="${BODY_MID}"/>
    ${stack}
    ${pipes}
    <rect x="${x + tw + 10}" y="${y + th / 2 - 64}" width="128" height="128" rx="8" fill="${BODY_DARK}"/>
    ${fan(x + tw + 74, y + th / 2, 54, accent)}`;
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
    case 'Processors':
      return processor(product);
    case 'Motherboards':
      return motherboard(product);
    case 'Graphics Cards':
      return graphicsCard(product);
    case 'Memory':
      return memory(product);
    case 'Storage':
      return storage(product);
    case 'Power Supplies':
      return powerSupply(product);
    case 'Cabinets':
      return cabinet(product);
    case 'Cooling':
      return cooling(product);
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
    <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#e2e8f0"/>
      <stop offset="45%" stop-color="#94a3b8"/>
      <stop offset="100%" stop-color="#cbd5e1"/>
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
  let skipped = 0;

  for (const product of products) {
    // Half the catalogue is photographed and half is drawn, and which is
    // which is recorded in the catalogue itself. Writing a drawing for a
    // product whose image is a .jpg would quietly leave an orphan SVG beside
    // a photograph nothing points at.
    if (!/\.svg$/i.test(product.image)) {
      skipped += 1;
      continue;
    }

    fs.writeFileSync(path.join(OUT_DIR, product.image), svg(product));
    written += 1;
  }

  if (skipped) console.log(`${skipped} photographed product(s) left alone`);

  console.log(`${written} product illustrations written to public/images/products/`);
}

main();
