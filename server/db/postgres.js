const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL || '';

// Whether to use SSL depends on the host, and gets it wrong across providers
// if we're not careful: Render/Neon/Supabase's public endpoints need SSL,
// but Railway's private internal network (host ends in .railway.internal)
// and plain localhost do not — and forcing SSL onto a connection that
// doesn't support it fails the connection entirely.
// PGSSL=true / PGSSL=false lets you override this detection if a host ever
// doesn't fit the pattern.
function shouldUseSSL() {
  if (process.env.PGSSL === 'true') return true;
  if (process.env.PGSSL === 'false') return false;
  return !/localhost|127\.0\.0\.1|\.railway\.internal/i.test(connectionString);
}

const pool = new Pool({
  connectionString,
  ssl: shouldUseSSL() ? { rejectUnauthorized: false } : false,
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

