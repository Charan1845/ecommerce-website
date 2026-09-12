/**
 * "Customise your PC" - the REST side of the builder.
 *
 * Three routes: what you can choose from, what is wrong with what you have
 * chosen, and put the whole thing in my cart.
 *
 * The rules themselves are in src/pc-build.js. This file is only plumbing,
 * for the same reason checkout.js is separate from the orders route: the
 * interesting part should be testable without an HTTP request anywhere near
 * it.
 */

const express = require('express');
const { transaction } = require('../db');
const { requireAuth } = require('../auth');
const { SLOTS, SLOT_KEYS, parts, review } = require('../pc-build');

const router = express.Router();
router.use(requireAuth);

/** Only the slot keys are read out of the body, and only as numbers. */
function selectionFrom(body) {
  const selection = {};
  for (const key of SLOT_KEYS) {
    const id = Number(body?.[key]);
    if (Number.isInteger(id) && id > 0) selection[key] = id;
  }
  return selection;
}

/** GET /api/build/parts - every part that can go in each slot. */
router.get('/parts', async (_req, res, next) => {
  try {
    return res.json({ slots: await parts() });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/build/check - what is wrong with this build.
 *
 * A read, written as a POST because a build is eight ids and a query string
 * of eight ids is a worse thing to debug. Nothing is stored.
 */
router.post('/check', async (req, res, next) => {
  try {
    const result = await review(selectionFrom(req.body || {}));

    return res.json({
      issues: result.issues,
      total_paise: result.total_paise,
      part_count: result.part_count,
      estimated_watts: result.estimated_watts,
      blocked: result.blocked,
      complete: result.complete,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/build/cart - put every part of the build in the cart.
 *
 * Checked again here, even though the page has been checking all along. The
 * page's opinion arrives over the network and can be anything; this is the
 * only check that counts.
 *
 * One transaction, so a build either lands in the cart whole or not at all -
 * half a computer in a cart is worse than a rejection you can act on.
 */
router.post('/cart', async (req, res, next) => {
  try {
    const selection = selectionFrom(req.body || {});
    const result = await review(selection);

    if (result.part_count === 0) {
      return res.status(400).json({ error: 'Nothing has been chosen yet.' });
    }

    if (result.blocked) {
      return res.status(409).json({
        error: 'These parts do not go together. Fix the problems first.',
        issues: result.issues,
      });
    }

    if (!result.complete) {
      const missing = SLOTS.filter((s) => s.required && !result.chosen[s.key]).map((s) => s.asks);
      return res.status(400).json({
        error: `The build still needs ${missing.join(', ')}.`,
        issues: result.issues,
      });
    }

    const userId = req.user.id;

    await transaction(async (tx) => {
      for (const key of SLOT_KEYS) {
        const part = result.chosen[key];
        if (!part) continue;

        // One of each. Adding a build twice should not silently order two
        // processors, so this sets the line rather than adding to it.
        const existing = await tx.get(
          'SELECT id FROM cart_items WHERE user_id = ? AND product_id = ?',
          [userId, part.id]
        );

        if (existing) {
          await tx.run('UPDATE cart_items SET quantity = 1 WHERE id = ?', [existing.id]);
        } else {
          await tx.run(
            'INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, 1)',
            [userId, part.id]
          );
        }
      }
    });

    return res.status(201).json({
      added: result.part_count,
      total_paise: result.total_paise,
      issues: result.issues.filter((i) => i.level === 'warning'),
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
