/**
 * Customise your PC.
 *
 * This page deliberately decides nothing. Every time a choice changes it
 * posts the whole selection to /api/build/check and renders whatever comes
 * back. The compatibility rules live in src/pc-build.js and exist in exactly
 * one place, so the page and the server can never come to different
 * conclusions about whether a build is buildable.
 *
 * The selection lives in the URL as well as in memory, so a build can be
 * bookmarked or sent to somebody who knows more about this than you do.
 */

/** Slot definitions from the server: key, label, category, options. */
let slots = [];

/** key -> product id. The build itself. */
const selection = {};

/** The last verdict, kept so "add to cart" knows whether it may run. */
let verdict = { blocked: true, complete: false };

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ url -- */

function readUrl() {
  const params = new URLSearchParams(window.location.search);
  for (const slot of slots) {
    const id = Number(params.get(slot.key));
    if (Number.isInteger(id) && id > 0) selection[slot.key] = id;
  }
}

function writeUrl() {
  const params = new URLSearchParams();
  for (const slot of slots) {
    if (selection[slot.key]) params.set(slot.key, selection[slot.key]);
  }

  const query = params.toString();
  const url = query ? `${window.location.pathname}?${query}` : window.location.pathname;

  // replaceState, not pushState: choosing a processor should not put an entry
  // in the back button for every click.
  window.history.replaceState(null, '', url);
}

/* --------------------------------------------------------------- render -- */

/** A short line of specification for the option list, per category. */
function specLine(part) {
  const s = part.specs || {};
  const bits = [];

  if (s.socket) bits.push(s.socket);
  if (s.cores) bits.push(`${s.cores} cores`);
  if (s.form_factor) bits.push(s.form_factor);
  if (s.memory_type && part.category !== 'Memory') bits.push(s.memory_type);
  if (part.category === 'Memory' && s.capacity_gb) {
    bits.push(`${s.capacity_gb} GB ${s.memory_type} ${s.speed_mhz} MHz`);
  }
  if (s.vram_gb) bits.push(`${s.vram_gb} GB`);
  if (s.length_mm) bits.push(`${s.length_mm} mm`);
  if (part.category === 'Storage' && s.capacity_gb) {
    bits.push(`${s.capacity_gb >= 1000 ? `${s.capacity_gb / 1000} TB` : `${s.capacity_gb} GB`} ${s.storage_type}`);
  }
  if (s.watts) bits.push(`${s.watts} W ${s.rating || ''}`.trim());
  if (s.max_gpu_mm) bits.push(`card up to ${s.max_gpu_mm} mm`);
  if (s.cooler_type) bits.push(s.cooler_type === 'aio' ? `${s.radiator_mm} mm radiator` : `${s.height_mm} mm tall`);
  if (s.tdp_watts && part.category === 'Processors') bits.push(`${s.tdp_watts} W`);

  return bits.join(' · ');
}

function optionHtml(slot, part) {
  const chosen = selection[slot.key] === part.id;
  const sold = part.stock <= 0;

  return `<button type="button" class="part ${chosen ? 'chosen' : ''} ${sold ? 'sold' : ''}"
            data-slot="${esc(slot.key)}" data-id="${part.id}" ${sold ? 'disabled' : ''}>
      <span class="part-main">
        <span class="part-name">${esc(part.name)}</span>
        <span class="part-brand">${esc(part.brand)}</span>
      </span>
      <span class="part-spec">${esc(specLine(part))}</span>
      <span class="part-price">${rupees(part.price_paise)}${sold ? ' · sold out' : ''}</span>
    </button>`;
}

function renderSlots() {
  $('slots').innerHTML = slots
    .map((slot) => {
      const chosen = slot.options.find((p) => p.id === selection[slot.key]);

      return `<section class="slot" id="slot-${esc(slot.key)}">
          <header class="slot-head">
            <h2>${esc(slot.label)}${slot.required ? '' : ' <span class="optional">optional</span>'}</h2>
            <p class="slot-chosen">${
              chosen
                ? `${esc(chosen.name)} &middot; ${rupees(chosen.price_paise)}
                   <button type="button" class="link clear" data-clear="${esc(slot.key)}">clear</button>`
                : 'Nothing chosen'
            }</p>
          </header>
          <div class="parts">${slot.options.map((p) => optionHtml(slot, p)).join('')}</div>
        </section>`;
    })
    .join('');
}

/** Repaint just the chosen states, without rebuilding every option button. */
function refreshChosen() {
  for (const slot of slots) {
    const section = $(`slot-${slot.key}`);
    if (!section) continue;

    section.querySelectorAll('.part').forEach((button) => {
      button.classList.toggle('chosen', Number(button.dataset.id) === selection[slot.key]);
    });

    const chosen = slot.options.find((p) => p.id === selection[slot.key]);
    section.querySelector('.slot-chosen').innerHTML = chosen
      ? `${esc(chosen.name)} &middot; ${rupees(chosen.price_paise)}
         <button type="button" class="link clear" data-clear="${esc(slot.key)}">clear</button>`
      : 'Nothing chosen';
  }
}

/** Mark the slots an issue points at, so the complaint has somewhere to land. */
function markProblemSlots(issues) {
  const bad = new Set();
  for (const issue of issues) {
    if (issue.level === 'incomplete') continue;
    for (const key of issue.slots || []) bad.add(key);
  }

  for (const slot of slots) {
    $(`slot-${slot.key}`)?.classList.toggle('has-problem', bad.has(slot.key));
  }
}

function renderVerdict(result) {
  const required = slots.filter((s) => s.required).length;
  const chosenRequired = slots.filter((s) => s.required && selection[s.key]).length;

  $('fig-parts').textContent = `${result.part_count} of ${slots.length}`;
  $('fig-watts').textContent = result.estimated_watts ? `${result.estimated_watts} W` : '—';
  $('fig-total').textContent = rupees(result.total_paise);

  const errors = result.issues.filter((i) => i.level === 'error');
  const warnings = result.issues.filter((i) => i.level === 'warning');
  const missing = result.issues.filter((i) => i.level === 'incomplete');

  const blocks = [];

  if (errors.length) {
    blocks.push(
      `<div class="issue-group error">
         <h3>${errors.length} problem${errors.length === 1 ? '' : 's'}</h3>
         <ul>${errors.map((i) => `<li>${esc(i.message)}</li>`).join('')}</ul>
       </div>`
    );
  }

  if (warnings.length) {
    blocks.push(
      `<div class="issue-group warning">
         <h3>Worth knowing</h3>
         <ul>${warnings.map((i) => `<li>${esc(i.message)}</li>`).join('')}</ul>
       </div>`
    );
  }

  if (missing.length) {
    blocks.push(
      `<div class="issue-group missing">
         <h3>Still to choose</h3>
         <ul>${missing.map((i) => `<li>${esc(i.message)}</li>`).join('')}</ul>
       </div>`
    );
  }

  if (!blocks.length && result.part_count > 0) {
    blocks.push(
      `<div class="issue-group ok">
         <h3>Everything fits</h3>
         <p>Socket, memory, clearance and power all check out.</p>
       </div>`
    );
  }

  if (!result.part_count) {
    blocks.push('<p class="small">Nothing chosen yet. Start with the processor.</p>');
  }

  $('verdict').innerHTML = blocks.join('');

  const button = $('add-build');
  if (added) return;

  button.disabled = result.blocked || !result.complete || result.part_count === 0;
  button.textContent = result.blocked
    ? 'Fix the problems first'
    : result.complete
      ? 'Add this build to my cart'
      : `Choose ${required - chosenRequired} more part${required - chosenRequired === 1 ? '' : 's'}`;

  markProblemSlots(result.issues);
}

/* ---------------------------------------------------------------- check -- */

/**
 * Ask the server what it thinks, and draw that.
 *
 * Each call carries a sequence number, because clicking quickly starts
 * several of these and they are not guaranteed to come back in order. An
 * older answer arriving last would paint a verdict for a build that is no
 * longer on screen.
 */
let sequence = 0;

async function check() {
  const mine = ++sequence;

  try {
    const result = await apiPost('/api/build/check', selection);
    if (mine !== sequence) return;

    verdict = result;
    renderVerdict(result);
  } catch (err) {
    if (mine !== sequence) return;
    showNotice(err.message);
  }
}

/* --------------------------------------------------------------- events -- */

function choose(key, id) {
  selection[key] = id;
  writeUrl();
  refreshChosen();
  check();
}

function clear(key) {
  delete selection[key];
  writeUrl();
  refreshChosen();
  check();
}

/**
 * True once the build is in the cart, so the one button can become a link to
 * it. Swapping the handler instead would leave two of them attached, and the
 * second press would both navigate and add the build again.
 */
let added = false;

async function addBuild() {
  const button = $('add-build');

  if (added) {
    window.location.href = '/cart.html';
    return;
  }

  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Adding…';

  try {
    const result = await apiPost('/api/build/cart', selection);

    showNotice(
      `${result.added} parts added to your cart — ${rupees(result.total_paise)}.`,
      'success'
    );

    // The header shows a cart count, and it is now wrong.
    await renderHeader();

    added = true;
    button.textContent = 'Added — view your cart';
    button.disabled = false;
  } catch (err) {
    showNotice(err.message);
    button.disabled = false;
    button.textContent = label;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    ({ slots } = await apiGet('/api/build/parts'));
  } catch (err) {
    showNotice(err.message);
    return;
  }

  readUrl();
  renderSlots();
  check();

  $('slots').addEventListener('click', (event) => {
    const clearer = event.target.closest('[data-clear]');
    if (clearer) return clear(clearer.dataset.clear);

    const part = event.target.closest('.part');
    if (!part || part.disabled) return;

    const key = part.dataset.slot;
    const id = Number(part.dataset.id);

    // Clicking the chosen part again unchooses it.
    if (selection[key] === id) clear(key);
    else choose(key, id);
  });

  $('add-build').addEventListener('click', addBuild);

  $('reset').addEventListener('click', () => {
    for (const slot of slots) delete selection[slot.key];
    added = false;
    writeUrl();
    refreshChosen();
    check();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});
