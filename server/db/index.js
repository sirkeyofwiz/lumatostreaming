const { ensureSchema } = require('./schema');

// Set DATABASE_URL to point at Postgres (e.g. in production). With no
// DATABASE_URL, everything runs against a local SQLite file — zero setup
// for development.
const driver = process.env.DATABASE_URL
  ? require('./postgres')
  : require('./sqlite');

let ready = ensureSchema(driver);

module.exports = {
  ...driver,
  ready: () => ready,
};
