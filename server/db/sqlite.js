const Database = require('better-sqlite3');
const path = require('path');

const raw = new Database(path.join(__dirname, '..', '..', 'reelhouse.db'));
raw.pragma('journal_mode = WAL');
raw.pragma('foreign_keys = ON');

// better-sqlite3 is synchronous; wrap everything so callers can `await`
// the same interface the Postgres driver exposes.
module.exports = {
  kind: 'sqlite',

  async all(sql, params = []) {
    return raw.prepare(sql).all(...params);
  },

  async get(sql, params = []) {
    return raw.prepare(sql).get(...params);
  },

  async run(sql, params = []) {
    const info = raw.prepare(sql).run(...params);
    return { lastID: info.lastInsertRowid, changes: info.changes };
  },

  async exec(sql) {
    raw.exec(sql);
  },

  transaction(fn) {
    return raw.transaction(fn);
  },
};
