const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const tmdb = require('./tmdb');
const anilist = require('./anilist');

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
  // Note: the default MemoryStore is fine for local dev/demo use only —
  // it leaks memory and resets on restart. For a real deploy, swap in
  // connect-pg-simple (if using Postgres) or another persistent store.
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
  return { id: u.id, username: u.username, is_admin: !!u.is_admin };
}

// ---------- Auth ----------

app.post('/api/auth/register', ah(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || password.length < 6) {
    return res.status(400).json({ error: 'Username and a password of at least 6 characters are required.' });
  }
  const existing = await db.get('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) return res.status(409).json({ error: 'That username is already taken.' });

  const hash = await bcrypt.hash(password, 10);
  const result = await db.run(
    'INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 0) RETURNING id',
    [username, hash]
  );
  const user = { id: result.lastID, username, is_admin: 0 };
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
    `INSERT INTO titles (title, type, year, genre, runtime, seasons, rating, premium, description, "cast", director, palette, featured, poster_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [t.title, t.type, t.year, t.genre, t.runtime || null, t.seasons || null, t.rating,
     t.premium ? 1 : 0, t.description || '', t.cast || '', t.director || '', t.palette || 0, t.featured ? 1 : 0,
     t.posterUrl || t.poster_url || null]
  );
  const row = await db.get('SELECT * FROM titles WHERE id = ?', [result.lastID]);
  res.status(201).json(row);
}));

app.put('/api/admin/titles/:id', requireAdmin, ah(async (req, res) => {
  const t = req.body || {};
  const existing = await db.get('SELECT * FROM titles WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Title not found.' });

  await db.run(
    `UPDATE titles SET title=?, type=?, year=?, genre=?, runtime=?, seasons=?, rating=?, premium=?, description=?, "cast"=?, director=?, palette=?, featured=?, poster_url=?
     WHERE id=?`,
    [t.title ?? existing.title, t.type ?? existing.type, t.year ?? existing.year, t.genre ?? existing.genre,
     t.runtime ?? existing.runtime, t.seasons ?? existing.seasons, t.rating ?? existing.rating,
     t.premium !== undefined ? (t.premium ? 1 : 0) : existing.premium,
     t.description ?? existing.description, t.cast ?? existing.cast, t.director ?? existing.director,
     t.palette ?? existing.palette, t.featured !== undefined ? (t.featured ? 1 : 0) : existing.featured,
     (t.posterUrl ?? t.poster_url) ?? existing.poster_url,
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
