const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const tmdb = require('./tmdb');
const anilist = require('./anilist');
const mailer = require('./mailer');
const storage = require('./storage');

const app = express();
const PORT = process.env.PORT || 3000;

// Safety net: log unexpected errors instead of letting them crash the
// whole process. Express 4 doesn't catch rejected promises from async
// route handlers on its own — every route below is wrapped with `ah()`
// to route errors into Express's error handler, but this is a backstop
// for anything that slips through (e.g. errors outside a request).
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

app.use(cors({ origin: true, credentials: true }));

// Railway/Render/most hosts terminate HTTPS at a proxy and forward plain
// HTTP to the app. Without this, Express can't tell the original request
// was HTTPS, and since our session cookie is `secure: true` in production,
// it would silently refuse to set the cookie at all — logins would appear
// to work but never actually persist.
app.set('trust proxy', 1);

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'lumatostreaming-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    secure: process.env.NODE_ENV === 'production',
  },
  // On Postgres, sessions persist in a real "session" table (auto-created
  // below) so logins survive deploys/restarts. Locally on SQLite there's
  // no persistent store wired up, so it falls back to express-session's
  // in-memory default — fine for local dev, where restarts are expected anyway.
  store: db.kind === 'postgres'
    ? new PgSession({ pool: db.pool, tableName: 'session', createTableIfMissing: true })
    : undefined,
}));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(async (req, res, next) => {
  await db.ready();
  next();
});

// Wraps an async route handler so a rejected promise (e.g. a failed DB
// query) is passed to Express's error handler instead of crashing the
// process.
function ah(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Sign in required.' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Sign in required.' });
  if (!req.session.user.is_admin) return res.status(403).json({ error: 'Admins only.' });
  next();
}

function publicUser(u) {
  return { id: u.id, username: u.username, is_admin: !!u.is_admin, email: u.email || null };
}

// ---------- Auth ----------

app.post('/api/auth/register', ah(async (req, res) => {
  const { username, email, password } = req.body || {};
  if (!username || !password || password.length < 6) {
    return res.status(400).json({ error: 'Username and a password of at least 6 characters are required.' });
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email is required (used for password resets).' });
  }
  const existingUsername = await db.get('SELECT id FROM users WHERE username = ?', [username]);
  if (existingUsername) return res.status(409).json({ error: 'That username is already taken.' });
  const existingEmail = await db.get('SELECT id FROM users WHERE email = ?', [email]);
  if (existingEmail) return res.status(409).json({ error: 'That email is already registered.' });

  const hash = await bcrypt.hash(password, 10);
  const result = await db.run(
    'INSERT INTO users (username, email, password_hash, is_admin) VALUES (?, ?, ?, FALSE) RETURNING id',
    [username, email, hash]
  );
  const user = { id: result.lastID, username, email, is_admin: 0 };
  req.session.user = publicUser(user);
  res.status(201).json(req.session.user);
}));

app.post('/api/auth/login', ah(async (req, res) => {
  const { username, password } = req.body || {};
  const user = await db.get('SELECT * FROM users WHERE username = ?', [username || '']);
  if (!user) return res.status(401).json({ error: 'Incorrect username or password.' });
  const ok = await bcrypt.compare(password || '', user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Incorrect username or password.' });
  req.session.user = publicUser(user);
  res.json(req.session.user);
}));

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', (req, res) => {
  res.json(req.session.user || null);
});

// Lets an already-signed-in user add/update their email — mainly for
// accounts created before email was required (e.g. the seeded admin).
app.put('/api/auth/email', requireAuth, ah(async (req, res) => {
  const { email } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email.' });
  }
  const existing = await db.get('SELECT id FROM users WHERE email = ? AND id != ?', [email, req.session.user.id]);
  if (existing) return res.status(409).json({ error: 'That email is already registered to another account.' });

  await db.run('UPDATE users SET email = ? WHERE id = ?', [email, req.session.user.id]);
  req.session.user.email = email;
  res.json(req.session.user);
}));

app.post('/api/auth/forgot-password', ah(async (req, res) => {
  const { email } = req.body || {};
  // Always return the same generic response whether or not the email is
  // registered — otherwise this endpoint would let anyone check which
  // emails have accounts here.
  const generic = { ok: true, message: 'If that email is registered, a reset link has been sent.' };
  if (!email) return res.json(generic);

  const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user) return res.json(generic);

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  await db.run('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?', [
    token, db.kind === 'postgres' ? expires : expires.toISOString(), user.id,
  ]);

  const origin = `${req.protocol}://${req.get('host')}`;
  const resetLink = `${origin}/reset.html?token=${token}`;

  try {
    await mailer.sendEmail({
      to: email,
      subject: 'Reset your LumatoStreaming password',
      html: `
        <p>Someone requested a password reset for your LumatoStreaming account.</p>
        <p><a href="${resetLink}">Click here to choose a new password</a>. This link expires in 1 hour.</p>
        <p>If you didn't request this, you can safely ignore this email.</p>
      `,
    });
  } catch (err) {
    // Don't leak configuration/delivery errors to the client — same
    // generic response either way, but log server-side for debugging.
    console.error('Password reset email failed:', err.message);
  }

  res.json(generic);
}));

app.post('/api/auth/reset-password', ah(async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password || password.length < 6) {
    return res.status(400).json({ error: 'A new password of at least 6 characters is required.' });
  }
  const user = await db.get('SELECT * FROM users WHERE reset_token = ?', [token]);
  if (!user) return res.status(400).json({ error: 'This reset link is invalid or has already been used.' });

  const expires = new Date(user.reset_token_expires);
  if (Number.isNaN(expires.getTime()) || expires < new Date()) {
    return res.status(400).json({ error: 'This reset link has expired. Request a new one.' });
  }

  const hash = await bcrypt.hash(password, 10);
  await db.run('UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?', [hash, user.id]);
  res.json({ ok: true });
}));

// Lets an already-logged-in user without an email (e.g. the seeded admin
// account) add one later, so password reset becomes available to them too.
app.put('/api/auth/email', requireAuth, ah(async (req, res) => {
  const { email } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email is required.' });
  }
  const existing = await db.get('SELECT id FROM users WHERE email = ? AND id != ?', [email, req.session.user.id]);
  if (existing) return res.status(409).json({ error: 'That email is already registered to another account.' });

  await db.run('UPDATE users SET email = ? WHERE id = ?', [email, req.session.user.id]);
  req.session.user.email = email;
  res.json(req.session.user);
}));

app.post('/api/auth/forgot-password', ah(async (req, res) => {
  const { email } = req.body || {};
  const genericResponse = { ok: true, message: 'If that email is registered, a reset link has been sent.' };

  if (!email) return res.json(genericResponse);
  const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user) return res.json(genericResponse); // don't reveal whether the email exists

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  await db.run(
    'UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?',
    [token, expires.toISOString(), user.id]
  );

  const resetUrl = `${req.protocol}://${req.get('host')}/reset.html?token=${token}`;
  try {
    await mailer.sendEmail({
      to: email,
      subject: 'Reset your LumatoStreaming password',
      html: `
        <p>Someone requested a password reset for your LumatoStreaming account.</p>
        <p><a href="${resetUrl}">Click here to choose a new password</a>. This link expires in 1 hour.</p>
        <p>If you didn't request this, you can safely ignore this email.</p>
      `,
    });
  } catch (err) {
    // Don't leak email-service errors to the client — that would confirm
    // whether the address is registered. Log it server-side instead.
    console.error('Failed to send password reset email:', err.message);
  }

  res.json(genericResponse);
}));

app.post('/api/auth/reset-password', ah(async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password || password.length < 6) {
    return res.status(400).json({ error: 'A valid token and a password of at least 6 characters are required.' });
  }
  const user = await db.get('SELECT * FROM users WHERE reset_token = ?', [token]);
  if (!user || !user.reset_token_expires || new Date(user.reset_token_expires) < new Date()) {
    return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
  }

  const hash = await bcrypt.hash(password, 10);
  await db.run(
    'UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?',
    [hash, user.id]
  );
  res.json({ ok: true });
}));

// ---------- Titles (public reads) ----------

async function withWatchlistFlag(rows, userId) {
  if (!userId) return rows.map(r => ({ ...r, in_watchlist: false }));
  const owned = await db.all('SELECT title_id FROM watchlist WHERE user_id = ?', [userId]);
  const ownedIds = new Set(owned.map(r => r.title_id));
  return rows.map(r => ({ ...r, in_watchlist: ownedIds.has(r.id) }));
}

app.get('/api/genres', ah(async (req, res) => {
  const rows = await db.all('SELECT DISTINCT genre FROM titles ORDER BY genre');
  res.json(rows.map(r => r.genre));
}));

app.get('/api/titles', ah(async (req, res) => {
  const { type, genre, q, sort } = req.query;
  let sql = 'SELECT * FROM titles WHERE 1=1';
  const params = [];

  if (type) { sql += ' AND type = ?'; params.push(type); }
  if (genre) { sql += ' AND genre = ?'; params.push(genre); }
  if (q) { sql += ' AND title LIKE ?'; params.push(`%${q}%`); }

  sql += sort === 'rating' ? ' ORDER BY rating DESC'
    : sort === 'year' ? ' ORDER BY year DESC'
    : ' ORDER BY id ASC';

  const rows = await db.all(sql, params);
  res.json(await withWatchlistFlag(rows, req.session.user && req.session.user.id));
}));

app.get('/api/titles/featured', ah(async (req, res) => {
  const rows = await db.all('SELECT * FROM titles WHERE featured');
  res.json(await withWatchlistFlag(rows, req.session.user && req.session.user.id));
}));

app.get('/api/titles/:id', ah(async (req, res) => {
  const row = await db.get('SELECT * FROM titles WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Title not found.' });
  const [withFlag] = await withWatchlistFlag([row], req.session.user && req.session.user.id);
  res.json(withFlag);
}));

// Public — anyone viewing a series can see its episode list.
app.get('/api/titles/:id/episodes', ah(async (req, res) => {
  const rows = await db.all(
    'SELECT * FROM episodes WHERE title_id = ? ORDER BY season_number ASC, episode_number ASC',
    [req.params.id]
  );
  res.json(rows);
}));

// ---------- Episode management (admin only) ----------

app.post('/api/admin/titles/:id/episodes', requireAdmin, ah(async (req, res) => {
  const t = req.body || {};
  if (!t.name || !t.episode_number) {
    return res.status(400).json({ error: 'name and episode_number are required.' });
  }
  const title = await db.get('SELECT id FROM titles WHERE id = ?', [req.params.id]);
  if (!title) return res.status(404).json({ error: 'Title not found.' });

  const result = await db.run(
    `INSERT INTO episodes (title_id, season_number, episode_number, name, description, video_url)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    [req.params.id, t.season_number || 1, t.episode_number, t.name, t.description || null, t.video_url || null]
  );
  const row = await db.get('SELECT * FROM episodes WHERE id = ?', [result.lastID]);
  res.status(201).json(row);
}));

app.put('/api/admin/episodes/:id', requireAdmin, ah(async (req, res) => {
  const t = req.body || {};
  const existing = await db.get('SELECT * FROM episodes WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Episode not found.' });

  await db.run(
    `UPDATE episodes SET season_number=?, episode_number=?, name=?, description=?, video_url=? WHERE id=?`,
    [t.season_number ?? existing.season_number, t.episode_number ?? existing.episode_number,
     t.name ?? existing.name, t.description ?? existing.description, t.video_url ?? existing.video_url,
     req.params.id]
  );
  const row = await db.get('SELECT * FROM episodes WHERE id = ?', [req.params.id]);
  res.json(row);
}));

app.delete('/api/admin/episodes/:id', requireAdmin, ah(async (req, res) => {
  await db.run('DELETE FROM episodes WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

// Bulk-imports a season's episode list from TMDB (names/descriptions only —
// video_url is left blank for the admin to fill in per episode afterward).
// Only works for titles that were themselves imported from TMDB.
app.post('/api/admin/titles/:id/episodes/import-tmdb', requireAdmin, ah(async (req, res) => {
  const { season_number } = req.body || {};
  const title = await db.get('SELECT * FROM titles WHERE id = ?', [req.params.id]);
  if (!title) return res.status(404).json({ error: 'Title not found.' });
  if (!title.tmdb_id) return res.status(400).json({ error: 'This title was not imported from TMDB, so there\'s no season data to pull.' });

  let episodes;
  try {
    episodes = await tmdb.seasonEpisodes(title.tmdb_id, season_number || 1);
  } catch (err) {
    if (err.code === 'NO_TMDB_KEY') return res.status(501).json({ error: err.message });
    return res.status(502).json({ error: 'Could not reach TMDB. Try again in a moment.' });
  }

  let imported = 0;
  for (const ep of episodes) {
    const result = await db.run(
      `INSERT INTO episodes (title_id, season_number, episode_number, name, description)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT (title_id, season_number, episode_number) DO NOTHING`,
      [req.params.id, season_number || 1, ep.episode_number, ep.name, ep.description]
    );
    if (result.changes) imported++;
  }
  const rows = await db.all(
    'SELECT * FROM episodes WHERE title_id = ? ORDER BY season_number ASC, episode_number ASC',
    [req.params.id]
  );
  res.json({ imported, skipped: episodes.length - imported, episodes: rows });
}));

// ---------- Watchlist (per signed-in user) ----------

app.get('/api/watchlist', requireAuth, ah(async (req, res) => {
  const rows = await db.all(`
    SELECT t.* FROM titles t
    JOIN watchlist w ON w.title_id = t.id
    WHERE w.user_id = ?
    ORDER BY w.added_at DESC
  `, [req.session.user.id]);
  res.json(await withWatchlistFlag(rows, req.session.user.id));
}));

app.post('/api/watchlist', requireAuth, ah(async (req, res) => {
  const { titleId } = req.body || {};
  const title = await db.get('SELECT id FROM titles WHERE id = ?', [titleId]);
  if (!title) return res.status(404).json({ error: 'Title not found.' });
  const exists = await db.get('SELECT id FROM watchlist WHERE user_id = ? AND title_id = ?', [req.session.user.id, titleId]);
  if (!exists) await db.run('INSERT INTO watchlist (user_id, title_id) VALUES (?, ?)', [req.session.user.id, titleId]);
  res.status(201).json({ ok: true });
}));

app.delete('/api/watchlist/:titleId', requireAuth, ah(async (req, res) => {
  await db.run('DELETE FROM watchlist WHERE user_id = ? AND title_id = ?', [req.session.user.id, req.params.titleId]);
  res.json({ ok: true });
}));

// ---------- TMDB import (admin only — fetches real data to prefill the add-title form) ----------

app.get('/api/admin/tmdb/search', requireAdmin, ah(async (req, res) => {
  const { q, type } = req.query;
  if (!q) return res.json([]);
  try {
    const results = await tmdb.search(q, type === 'series' ? 'series' : 'movie');
    res.json(results);
  } catch (err) {
    if (err.code === 'NO_TMDB_KEY') return res.status(501).json({ error: err.message });
    res.status(502).json({ error: 'Could not reach TMDB. Try again in a moment.' });
  }
}));

app.get('/api/admin/tmdb/:type/:id', requireAdmin, ah(async (req, res) => {
  const type = req.params.type === 'series' ? 'series' : 'movie';
  try {
    const data = await tmdb.details(req.params.id, type);
    res.json(data);
  } catch (err) {
    if (err.code === 'NO_TMDB_KEY') return res.status(501).json({ error: err.message });
    res.status(502).json({ error: 'Could not reach TMDB. Try again in a moment.' });
  }
}));

app.get('/api/admin/anilist/search', requireAdmin, ah(async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);
  try {
    res.json(await anilist.search(q));
  } catch (err) {
    res.status(502).json({ error: 'Could not reach AniList. Try again in a moment.' });
  }
}));

app.get('/api/admin/anilist/:id', requireAdmin, ah(async (req, res) => {
  try {
    res.json(await anilist.details(req.params.id));
  } catch (err) {
    res.status(502).json({ error: 'Could not reach AniList. Try again in a moment.' });
  }
}));

// ---------- File uploads (admin only) ----------

app.post('/api/admin/uploads/presign', requireAdmin, ah(async (req, res) => {
  const { filename, contentType, kind } = req.body || {};
  if (!filename || !contentType) {
    return res.status(400).json({ error: 'filename and contentType are required.' });
  }
  if (!storage.isConfigured()) {
    return res.status(501).json({ error: 'File uploads are not configured on this server.' });
  }
  const isVideo = contentType.startsWith('video/');
  const isImage = contentType.startsWith('image/');
  if (!isVideo && !isImage) {
    return res.status(400).json({ error: 'Only image and video files are supported.' });
  }
  const folder = kind === 'video' || isVideo ? 'videos' : 'posters';
  try {
    const result = await storage.presignUpload({ filename, contentType, folder });
    res.json(result);
  } catch (err) {
    if (err.code === 'NO_R2_CONFIG') return res.status(501).json({ error: err.message });
    res.status(502).json({ error: 'Could not prepare the upload. Try again.' });
  }
}));

// ---------- Admin catalog management ----------

app.get('/api/admin/titles', requireAdmin, ah(async (req, res) => {
  const rows = await db.all('SELECT * FROM titles ORDER BY id DESC');
  res.json(rows);
}));

app.post('/api/admin/titles', requireAdmin, ah(async (req, res) => {
  const t = req.body || {};
  if (!t.title || !t.type || !t.year || !t.genre || !t.rating) {
    return res.status(400).json({ error: 'title, type, year, genre, and rating are required.' });
  }
  const result = await db.run(
    `INSERT INTO titles (title, type, year, genre, runtime, seasons, rating, premium, description, "cast", director, palette, featured, poster_url, backdrop_url, video_url, tmdb_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [t.title, t.type, t.year, t.genre, t.runtime || null, t.seasons || null, t.rating,
     t.premium ? 1 : 0, t.description || '', t.cast || '', t.director || '', t.palette || 0, t.featured ? 1 : 0,
     t.posterUrl || t.poster_url || null, t.backdropUrl || t.backdrop_url || null, t.video_url || null,
     t.tmdbId || t.tmdb_id || null]
  );
  const row = await db.get('SELECT * FROM titles WHERE id = ?', [result.lastID]);
  res.status(201).json(row);
}));

app.put('/api/admin/titles/:id', requireAdmin, ah(async (req, res) => {
  const t = req.body || {};
  const existing = await db.get('SELECT * FROM titles WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Title not found.' });

  await db.run(
    `UPDATE titles SET title=?, type=?, year=?, genre=?, runtime=?, seasons=?, rating=?, premium=?, description=?, "cast"=?, director=?, palette=?, featured=?, poster_url=?, backdrop_url=?, video_url=?
     WHERE id=?`,
    [t.title ?? existing.title, t.type ?? existing.type, t.year ?? existing.year, t.genre ?? existing.genre,
     t.runtime ?? existing.runtime, t.seasons ?? existing.seasons, t.rating ?? existing.rating,
     t.premium !== undefined ? (t.premium ? 1 : 0) : existing.premium,
     t.description ?? existing.description, t.cast ?? existing.cast, t.director ?? existing.director,
     t.palette ?? existing.palette, t.featured !== undefined ? (t.featured ? 1 : 0) : existing.featured,
     (t.posterUrl ?? t.poster_url) ?? existing.poster_url,
     (t.backdropUrl ?? t.backdrop_url) ?? existing.backdrop_url,
     (t.video_url) ?? existing.video_url,
     req.params.id]
  );
  const row = await db.get('SELECT * FROM titles WHERE id = ?', [req.params.id]);
  res.json(row);
}));

app.delete('/api/admin/titles/:id', requireAdmin, ah(async (req, res) => {
  await db.run('DELETE FROM titles WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

// Final error handler — anything passed to next(err) via `ah()` lands here
// instead of crashing the process.
app.use((err, req, res, next) => {
  console.error('Request error:', err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

app.listen(PORT, () => {
  console.log(`LumatoStreaming server running at http://localhost:${PORT}`);
});
