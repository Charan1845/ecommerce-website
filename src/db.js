/**
 * The database, with two backends behind one set of helpers.
 *
 *   No DATABASE_URL  ->  SQLite, which ships inside Node 24. Nothing to
 *                        install, so `npm install && npm run dev` just works
 *                        and the tests run in a couple of seconds.
 *   DATABASE_URL set ->  PostgreSQL. What the deployed site uses, because
 *                        free hosting wipes the disk on every restart and a
 *                        SQLite file would take every account and order with
 *                        it.
 *
 * Every helper is async, even the SQLite one where the work is immediate.
 * PostgreSQL cannot be anything else - it is on the other side of a network -
 * so the routes are written for the slower of the two and both fit.
 *
 * Queries are written once, with `?` placeholders, and the PostgreSQL adapter
 * rewrites them to $1, $2 on the way through.
 */

const fs = require('node:fs');
const path = require('node:path');

const USE_POSTGRES = Boolean(process.env.DATABASE_URL);

/* ------------------------------------------------------------------ */
/* PostgreSQL                                                          */
/* ------------------------------------------------------------------ */

function createPostgres() {
  // Only required when actually used, so a local checkout does not need the
  // driver installed to run.
  const { Pool } = require('pg');

  let url = process.env.DATABASE_URL;
  // Some hosts still hand out the old prefix, which the driver rejects.
  if (url.startsWith('postgres://')) url = url.replace('postgres://', 'postgresql://', 1);

  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);

  const pool = new Pool({
    connectionString: url,
    // Managed Postgres (Neon, Supabase, Cloud SQL) uses certificates from a
    // real authority, so the chain can be verified properly. Set
    // PG_SSL_NO_VERIFY=1 only if your provider uses a self-signed one.
    ssl: isLocal ? false : { rejectUnauthorized: process.env.PG_SSL_NO_VERIFY !== '1' },
    max: Number(process.env.PG_POOL_MAX || 5),
  });

  /** `?, ?` -> `$1, $2`. None of our queries contain a literal question mark. */
  const toPgPlaceholders = (sql) => {
    let n = 0;
    return sql.replace(/\?/g, () => `$${++n}`);
  };

  const query = async (runner, sql, params) => runner.query(toPgPlaceholders(sql), params);

  const wrap = (runner) => ({
    all: async (sql, params = []) => (await query(runner, sql, params)).rows,
    get: async (sql, params = []) => (await query(runner, sql, params)).rows[0],
    run: async (sql, params = []) => {
      const result = await query(runner, sql, params);
      return { changes: result.rowCount, rows: result.rows };
    },
  });

  return {
    ...wrap(pool),

    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(wrap(client));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    async applySchema() {
      const sql = fs.readFileSync(path.join(__dirname, 'schema.pg.sql'), 'utf8');
      await pool.query(sql);
    },

    close: () => pool.end(),
    describe: 'PostgreSQL',
  };
}

/* ------------------------------------------------------------------ */
/* SQLite                                                              */
/* ------------------------------------------------------------------ */

function createSqlite() {
  const { DatabaseSync } = require('node:sqlite');

  const file = process.env.DB_FILE || path.join(__dirname, '..', 'devgear.db');
  const db = new DatabaseSync(file);

  // SQLite ignores foreign keys unless you ask it not to. Without this a cart
  // row could point at a product that does not exist.
  db.exec('PRAGMA foreign_keys = ON');
  // Wait rather than fail if another connection is mid-write.
  db.exec('PRAGMA busy_timeout = 5000');

  const api = {
    all: async (sql, params = []) => db.prepare(sql).all(...params),
    get: async (sql, params = []) => db.prepare(sql).get(...params),
    run: async (sql, params = []) => {
      const result = db.prepare(sql).run(...params);
      return { changes: Number(result.changes), rows: [] };
    },
  };

  return {
    ...api,

    async transaction(fn) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn(api);
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    async applySchema() {
      db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    },

    close: async () => db.close(),
    describe: `SQLite (${file})`,
  };
}

/* ------------------------------------------------------------------ */

const backend = USE_POSTGRES ? createPostgres() : createSqlite();

/** Every row a query returns. */
const all = (sql, params) => backend.all(sql, params);

/** The first row, or undefined when there is none. */
const get = (sql, params) => backend.get(sql, params);

/**
 * A write. Resolves to { changes, rows }.
 *
 * `changes` is the number of rows actually affected, and checkout leans on it
 * heavily: an UPDATE that changes zero rows is how we learn somebody else took
 * the last one first.
 */
const run = (sql, params) => backend.run(sql, params);

/**
 * Run several writes as one all-or-nothing unit.
 *
 * The callback is handed its own { all, get, run } and must use those, not the
 * module-level ones - on PostgreSQL a transaction lives on one connection, and
 * a stray query outside it would run on a different connection and not be part
 * of the transaction at all.
 *
 * If the callback throws, every change inside it is undone.
 */
const transaction = (fn) => backend.transaction(fn);

/** Create any missing tables. Safe to run repeatedly. */
const applySchema = () => backend.applySchema();

const close = () => backend.close();

module.exports = {
  all,
  get,
  run,
  transaction,
  applySchema,
  close,
  usingPostgres: USE_POSTGRES,
  describe: backend.describe,
};
