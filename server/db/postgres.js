const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});

// Our query strings are written with SQLite-style `?` placeholders so the
// same call sites work against either driver. Convert to Postgres's
// positional `$1, $2, ...` style here.
function toPgSql(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

module.exports = {
  kind: 'postgres',

  async all(sql, params = []) {
    const res = await pool.query(toPgSql(sql), params);
    return res.rows;
  },

  async get(sql, params = []) {
    const res = await pool.query(toPgSql(sql), params);
    return res.rows[0];
  },

  async run(sql, params = []) {
    const res = await pool.query(toPgSql(sql), params);
    return { lastID: res.rows[0] ? res.rows[0].id : undefined, changes: res.rowCount };
  },

  async exec(sql) {
    await pool.query(sql);
  },

  // Postgres transactions are async, unlike better-sqlite3's synchronous
  // ones, so this isn't used on this driver — call sites that need a
  // transaction on Postgres should be rewritten with an explicit client
  // checkout if this app grows beyond its current simple writes.
  transaction(fn) {
    return fn;
  },
};
