const sqliteSchema = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS titles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('movie','series')),
    year INTEGER NOT NULL,
    genre TEXT NOT NULL,
    runtime TEXT,
    seasons INTEGER,
    rating REAL NOT NULL,
    premium INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL,
    "cast" TEXT NOT NULL,
    director TEXT NOT NULL,
    palette INTEGER NOT NULL DEFAULT 0,
    featured INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, title_id)
  );

  CREATE TABLE IF NOT EXISTS episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
    season_number INTEGER NOT NULL DEFAULT 1,
    episode_number INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    video_url TEXT,
    UNIQUE(title_id, season_number, episode_number)
  );
`;

const pgSchema = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS titles (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('movie','series')),
    year INTEGER NOT NULL,
    genre TEXT NOT NULL,
    runtime TEXT,
    seasons INTEGER,
    rating REAL NOT NULL,
    premium BOOLEAN NOT NULL DEFAULT FALSE,
    description TEXT NOT NULL,
    "cast" TEXT NOT NULL,
    director TEXT NOT NULL,
    palette INTEGER NOT NULL DEFAULT 0,
    featured BOOLEAN NOT NULL DEFAULT FALSE
  );

  CREATE TABLE IF NOT EXISTS watchlist (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, title_id)
  );

  CREATE TABLE IF NOT EXISTS episodes (
    id SERIAL PRIMARY KEY,
    title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
    season_number INTEGER NOT NULL DEFAULT 1,
    episode_number INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    video_url TEXT,
    UNIQUE(title_id, season_number, episode_number)
  );
`;

// Columns added after the tables were first created. CREATE TABLE IF NOT
// EXISTS above only helps brand-new databases — existing ones (like a live
// production DB) need an explicit ALTER TABLE, run only if the column isn't
// already there. Add new entries here instead of writing one-off ALTERs.
const COLUMN_ADDITIONS = [
  { table: 'titles', column: 'poster_url', type: 'TEXT' },
  { table: 'titles', column: 'backdrop_url', type: 'TEXT' },
  { table: 'titles', column: 'video_url', type: 'TEXT' },
  { table: 'titles', column: 'tmdb_id', type: 'INTEGER' },
  { table: 'users', column: 'email', type: 'TEXT' },
  { table: 'users', column: 'reset_token', type: 'TEXT' },
  { table: 'users', column: 'reset_token_expires', type: db => (db.kind === 'postgres' ? 'TIMESTAMPTZ' : 'TEXT') },
];

async function ensureSchema(db) {
  await db.exec(db.kind === 'postgres' ? pgSchema : sqliteSchema);
  await migrate(db);
}

async function migrate(db) {
  if (db.kind === 'postgres') {
    for (const { table, column, type } of COLUMN_ADDITIONS) {
      const t = typeof type === 'function' ? type(db) : type;
      await db.exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${t}`);
    }
  } else {
    const tableCols = {};
    for (const { table } of COLUMN_ADDITIONS) {
      if (!tableCols[table]) {
        tableCols[table] = (await db.all(`PRAGMA table_info(${table})`)).map(c => c.name);
      }
    }
    for (const { table, column, type } of COLUMN_ADDITIONS) {
      if (!tableCols[table].includes(column)) {
        const t = typeof type === 'function' ? type(db) : type;
        await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${t}`);
      }
    }
  }
}

module.exports = { ensureSchema };
