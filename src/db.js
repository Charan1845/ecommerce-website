/**
 * The database connection.
 *
 * Locally this is SQLite, which ships inside Node 24 itself, so there is
 * nothing to install. When we deploy we swap this one file for PostgreSQL
 * and the rest of the app does not change - which is the reason every query
 * lives behind the small helpers at the bottom instead of being scattered
 * around the routes.
 */

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'devgear.db');

const db = new DatabaseSync(DB_FILE);

// SQLite ignores foreign keys unless you ask it not to. Without this, a
// cart row could point at a product that does not exist.
db.exec('PRAGMA foreign_keys = ON');

// Wait rather than fail if another connection is mid-write. Relevant to us:
// the two-buyers-at-once test opens several connections on purpose.
db.exec('PRAGMA busy_timeout = 5000');

/** Create any missing tables. Safe to run repeatedly. */
function applySchema() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
}

/** Every row a query returns. */
function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}

/** The first row, or undefined when there is none. */
function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}

/**
 * A write. Returns { changes, lastInsertRowid }.
 *
 * `changes` is the number of rows actually affected, and checkout leans on it
 * heavily: an UPDATE that changes 0 rows is how we learn somebody else took
 * the last one first.
 */
function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}

/**
 * Run several writes as one all-or-nothing unit.
 *
 * If the callback throws, every change inside it is undone. Checkout needs
 * this: taking stock, creating the order and emptying the cart must either
 * all happen or none of them happen. Half a checkout is worse than none.
 */
function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Close the connection. Tests need this before deleting their temp file. */
function close() {
  db.close();
}

module.exports = { db, applySchema, all, get, run, transaction, close, DB_FILE };
