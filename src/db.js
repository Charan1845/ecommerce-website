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

    async columns(table) {
      const r = await pool.query(
        'SELECT column_name FROM information_schema.columns WHERE table_name = $1',
        [table]
      );
      return r.rows.map((row) => row.column_name);
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

  /**
   * SQLite has one connection here, and one connection can only be inside one
   * transaction at a time. Starting a second while the first is open throws
   * "cannot start a transaction within a transaction".
   *
   * Ordinary requests never manage it - each handler runs to completion before
   * the next one starts, because every SQLite call resolves immediately and so
   * never yields to another request. But anything that starts two checkouts in
   * the same tick does, and the owner's race demonstration does exactly that.
   *
   * So transactions queue up and take their turn. That matches how SQLite
   * actually behaves - one writer - rather than pretending otherwise.
   *
   * PostgreSQL needs none of this: it hands out a separate connection per
   * transaction, so they genuinely overlap. Which is the honest difference
   * between the two, and worth knowing when reading the race results.
   */
  let queue = Promise.resolve();

  return {
    ...api,

    transaction(fn) {
      const turn = queue.then(async () => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const result = await fn(api);
          db.exec('COMMIT');
          return result;
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
      });

      // The queue must keep moving even when this transaction fails, so it
      // chains on the settled outcome rather than the rejection.
      queue = turn.catch(() => {});
      return turn;
    },

    async applySchema() {
      db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    },

    async columns(table) {
      return db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
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

/**
 * Columns added after a database was already created.
 *
 * CREATE TABLE IF NOT EXISTS does nothing to a table that already exists, so a
 * new column in the schema file only reaches a fresh database. Live databases
 * need to be told separately. Each entry here is checked before it is applied,
 * so this is safe to run on every boot, forever.
 */
const LATER_COLUMNS = [
  { table: 'orders', column: 'razorpay_order_id', sqlite: 'TEXT', pg: 'VARCHAR(80)' },
  { table: 'orders', column: 'razorpay_payment_id', sqlite: 'TEXT', pg: 'VARCHAR(80)' },
  // Matches placed_at rather than being TEXT on one engine and a real
  // timestamp on the other. A column whose type depends on how old the
  // database is would come back as a string in one place and a Date in
  // another, and nothing would tell you which.
  { table: 'orders', column: 'paid_at', sqlite: 'TEXT', pg: 'TIMESTAMPTZ' },
  { table: 'orders', column: 'payment_provider', sqlite: 'TEXT', pg: 'VARCHAR(20)' },
  // Lets a password reset cut off sessions that were opened before it. A
  // login cookie is self-contained and cannot be revoked, so the only way to
  // end one early is to check it against something in the database.
  { table: 'users', column: 'password_changed_at', sqlite: 'TEXT', pg: 'TIMESTAMPTZ' },
  // Google's permanent id for an account. Matched on instead of email,
  // because people change their email address and Google keeps this.
  { table: 'users', column: 'google_sub', sqlite: 'TEXT', pg: 'VARCHAR(40)' },
  // A PC part's specification, as JSON text. See the note in schema.sql for
  // why this is not JSONB on PostgreSQL.
  { table: 'products', column: 'specs', sqlite: 'TEXT', pg: 'TEXT' },
];

async function migrate() {
  const applied = [];

  for (const spec of LATER_COLUMNS) {
    const existing = await backend.columns(spec.table);
    if (existing.includes(spec.column)) continue;

    const type = USE_POSTGRES ? spec.pg : spec.sqlite;
    await backend.run(`ALTER TABLE ${spec.table} ADD COLUMN ${spec.column} ${type}`);
    applied.push(`${spec.table}.${spec.column}`);
  }

  return applied;
}

/** Create any missing tables, then add any columns added since. */
const applySchema = async () => {
  await backend.applySchema();
  const added = await migrate();
  if (added.length) console.log('added missing columns:', added.join(', '));
  return added;
};

const close = () => backend.close();

module.exports = {
  all,
  get,
  run,
  transaction,
  applySchema,
  migrate,
  close,
  usingPostgres: USE_POSTGRES,
  describe: backend.describe,
};
