/**
 * What the shop sells, and how a row from the products table turns into
 * something the rest of the code can use.
 *
 * This exists because three places now need the same two facts - the route
 * that lists products, the PC builder, and the admin screens - and the list of
 * categories had started to live in whichever file happened to need it first.
 */

/**
 * The catalogue in two halves.
 *
 * The split is not decoration: the builder only ever offers things from the
 * "PC parts" side, and the shop's filter chips read better in two short rows
 * than in one row of twelve.
 */
const CATEGORY_GROUPS = {
  Peripherals: ['Keyboards', 'Mouse', 'Headsets', 'Monitors'],
  'PC parts': [
    'Processors',
    'Motherboards',
    'Graphics Cards',
    'Memory',
    'Storage',
    'Power Supplies',
    'Cabinets',
    'Cooling',
  ],
};

const CATEGORIES = Object.values(CATEGORY_GROUPS).flat();

/** Which half a category belongs to, for the filter chips. */
const groupOf = (category) =>
  Object.keys(CATEGORY_GROUPS).find((name) => CATEGORY_GROUPS[name].includes(category)) || 'Other';

/**
 * Turn the specs column back into an object.
 *
 * It is stored as text (see schema.sql for why), so every reader would
 * otherwise have to remember to parse it - and the one that forgot would
 * quietly compare a string to a number and decide every build was fine.
 *
 * A row with no specs, or with specs that will not parse, comes back with
 * `specs: null`. A keyboard legitimately has none, so that is not an error.
 */
function withSpecs(row) {
  if (!row) return row;

  let specs = null;
  if (row.specs) {
    try {
      specs = typeof row.specs === 'string' ? JSON.parse(row.specs) : row.specs;
    } catch {
      specs = null;
    }
  }

  return { ...row, specs };
}

module.exports = { CATEGORIES, CATEGORY_GROUPS, groupOf, withSpecs };
