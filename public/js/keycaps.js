/**
 * The keycaps on the login panel.
 *
 * Two bits of life, and one deliberate limit.
 *
 * They lean towards the pointer, and one of them presses down each time you
 * type. What they never do is press the key you actually pressed.
 *
 * That restraint is the whole reason this file has a comment. Lighting the
 * matching legend would look better and would turn a decoration into a
 * shoulder-surfing aid: the password field is dotted out precisely so the
 * person behind you cannot read it, and an animation that mirrors every
 * keystroke hands it straight back. So a keystroke lights a cap chosen at
 * random. It says "something was typed" and nothing more, which is all a
 * decoration is entitled to know.
 *
 * All of it stands still for anyone who has asked for reduced motion.
 */

(function () {
  const stage = document.getElementById('keys-stage');
  if (!stage) return;

  const caps = Array.from(stage.querySelectorAll('.keycap'));
  const panel = stage.closest('.auth-brand');
  if (!panel || caps.length === 0) return;

  const still = window.matchMedia('(prefers-reduced-motion: reduce)');

  // Where the row sits when nothing is happening. Read out of the stylesheet
  // rather than written down twice: these started as copies, the CSS was
  // retuned, and the caps then jumped the first time the pointer moved.
  const rest = (name, fallback) => {
    const value = parseFloat(getComputedStyle(stage).getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  };

  const BASE_TILT = rest('--rest-tilt', 50);
  const BASE_SPIN = rest('--rest-spin', -28);

  // How far the pointer can push it. Small on purpose - this is a login page,
  // not a showreel.
  const TILT_RANGE = 14;
  const SPIN_RANGE = 22;

  /* ---------------------------------------------------------------- lean -- */

  let pending = null;

  function lean(event) {
    if (still.matches) return;

    // One update per frame at most. mousemove fires far more often than the
    // screen refreshes, and every extra one is a layout nobody sees.
    if (pending) cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      pending = null;

      const box = panel.getBoundingClientRect();
      if (!box.width || !box.height) return;

      const clamp = (n) => Math.max(-0.5, Math.min(0.5, n));
      const x = clamp((event.clientX - box.left) / box.width - 0.5);
      const y = clamp((event.clientY - box.top) / box.height - 0.5);

      stage.style.setProperty('--tilt', `${BASE_TILT + y * TILT_RANGE}deg`);
      stage.style.setProperty('--spin', `${BASE_SPIN + x * SPIN_RANGE}deg`);
    });
  }

  /** Back to rest, letting the CSS default take over again. */
  function settle() {
    stage.style.removeProperty('--tilt');
    stage.style.removeProperty('--spin');
  }

  // Listening on the window rather than the panel, because the pointer spends
  // its time over on the form side and the caps should still notice.
  window.addEventListener('mousemove', lean, { passive: true });
  document.addEventListener('mouseleave', settle);

  /* --------------------------------------------------------------- press -- */

  let previous = -1;

  /** Press one cap, chosen at random. See the note at the top of this file. */
  function tap() {
    if (still.matches) return;

    let index = Math.floor(Math.random() * caps.length);
    if (index === previous && caps.length > 1) index = (index + 1) % caps.length;
    previous = index;

    const cap = caps[index];
    cap.classList.add('down');
    setTimeout(() => cap.classList.remove('down'), 110);
  }

  const form = document.getElementById('form');
  if (form) {
    form.addEventListener('keydown', (event) => {
      // Tab, Shift and the arrow keys are moving around, not typing.
      if (event.key.length === 1 || event.key === 'Backspace') tap();
    });
  }

  // If the visitor changes their mind about motion, put everything back.
  still.addEventListener('change', () => {
    if (still.matches) {
      settle();
      caps.forEach((cap) => cap.classList.remove('down'));
    }
  });
})();
