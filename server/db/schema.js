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
    cast TEXT NOT NULL,
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
    cast TEXT NOT NULL,
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
`;

async function ensureSchema(db) {
  await db.exec(db.kind === 'postgres' ? pgSchema : sqliteSchema);
}

module.exports = { ensureSchema };
