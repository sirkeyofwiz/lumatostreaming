const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const insights = require('./insights');
const tmdb = require('./tmdb');
const anilist = require('./anilist');
const mailer = require('./mailer');
const storage = require('./storage');
const push = require('./push');

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
  // Usernames are shown on pages; keep them to plain characters. (Existing
  // accounts with other characters can still sign in — this only gates new ones.)
  if (!/^[A-Za-z0-9_.-]{3,30}$/.test(username)) {
    return res.status(400).json({ error: 'Usernames can use letters, numbers, dots, dashes and underscores (3–30 characters).' });
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
  insights.recordServerEvent('signup', { userId: result.lastID });
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

  const { link } = await issueResetLink(req, user);
  // Don't leak configuration/delivery errors to the client — same generic
  // response either way (emailResetLink logs failures server-side).
  await emailResetLink(email, link);
  res.json(generic);
}));

// Viewer activity for the admin Analytics page. Accepts small batches from
// the site (sent with navigator.sendBeacon, so the reply is never read).
app.post('/api/events', ah(async (req, res) => {
  await insights.recordBrowserEvents(req, req.body);
  res.status(204).end();
}));

// ---------- Notifications (web push) ----------
app.get('/api/push/key', ah(async (req, res) => {
  res.json({ publicKey: (await push.getKeys()).publicKey });
}));
app.post('/api/push/subscribe', ah(async (req, res) => {
  const ok = await push.subscribe(req, req.body && req.body.subscription, req.body && req.body.v);
  res.status(ok ? 201 : 400).json({ ok });
}));
app.post('/api/push/unsubscribe', ah(async (req, res) => {
  await push.unsubscribe(req.body && req.body.endpoint);
  res.json({ ok: true });
}));
app.post('/api/push/opened', ah(async (req, res) => {
  await push.opened(req, req.body && req.body.id);
  res.status(204).end();
}));

// A one-time password reset link for a user, valid for 1 hour. Used by
// "Forgot your password?" and by the admin panel's "Send reset link".
async function issueResetLink(req, user) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  await db.run('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?', [
    token, db.kind === 'postgres' ? expires : expires.toISOString(), user.id,
  ]);
  const origin = `${req.protocol}://${req.get('host')}`;
  return { link: `${origin}/reset.html?token=${token}`, expires };
}

// Returns whether the email went out.
async function emailResetLink(to, link) {
  try {
    await mailer.sendEmail({
      to,
      subject: 'Reset your LumatoStreaming password',
      html: `
        <p>Someone requested a password reset for your LumatoStreaming account.</p>
        <p><a href="${link}">Click here to choose a new password</a>. This link expires in 1 hour.</p>
        <p>If you didn't request this, you can safely ignore this email.</p>
      `,
    });
    return true;
  } catch (err) {
    console.error('Password reset email failed:', err.message);
    return false;
  }
}

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
  // LOWER on both sides: Postgres LIKE is case-sensitive (SQLite's isn't),
  // so without it "spider" wouldn't find "Spider-Man" in production.
  if (q) { sql += ' AND LOWER(title) LIKE LOWER(?)'; params.push(`%${q}%`); }

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
  const subtitles = await db.all('SELECT id, label, lang_code FROM subtitles WHERE title_id = ?', [req.params.id]);
  res.json({ ...withFlag, subtitles });
}));

// Public — anyone viewing a series can see its episode list.
app.get('/api/titles/:id/episodes', ah(async (req, res) => {
  const rows = await db.all(
    'SELECT * FROM episodes WHERE title_id = ? ORDER BY season_number ASC, episode_number ASC',
    [req.params.id]
  );
  const withSubs = await Promise.all(rows.map(async (ep) => {
    const subtitles = await db.all('SELECT id, label, lang_code FROM subtitles WHERE episode_id = ?', [ep.id]);
    return { ...ep, subtitles };
  }));
  res.json(withSubs);
}));

// ---------- Episode management (admin only) ----------

app.post('/api/admin/titles/:id/episodes', requireAdmin, ah(async (req, res) => {
  const t = req.body || {};
  if (!t.name || !t.episode_number) {
    return res.status(400).json({ error: 'name and episode_number are required.' });
  }
  const title = await db.get('SELECT id, title FROM titles WHERE id = ?', [req.params.id]);
  if (!title) return res.status(404).json({ error: 'Title not found.' });

  const result = await db.run(
    `INSERT INTO episodes (title_id, season_number, episode_number, name, description, video_url)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    [req.params.id, t.season_number || 1, t.episode_number, t.name, t.description || null, t.video_url || null]
  );
  const row = await db.get('SELECT * FROM episodes WHERE id = ?', [result.lastID]);
  const label = `${title.title} — S${row.season_number}E${row.episode_number}`;
  await insights.logAdmin(req, 'episode.create', label);
  if (row.video_url) {
    await insights.logAdmin(req, 'video.set', label, 'episode video added');
    push.videoAdded(row.title_id, row.id);
  }
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
  const label = await episodeLabel(row);
  if (row.video_url && row.video_url !== existing.video_url) await insights.logAdmin(req, 'video.set', label, 'episode video changed');
  else await insights.logAdmin(req, 'episode.update', label);
  // Only an episode's first video is news; replacing a file isn't.
  if (row.video_url && !existing.video_url) push.videoAdded(row.title_id, row.id);
  res.json(row);
}));

app.delete('/api/admin/episodes/:id', requireAdmin, ah(async (req, res) => {
  const existing = await db.get('SELECT * FROM episodes WHERE id = ?', [req.params.id]);
  await db.run('DELETE FROM episodes WHERE id = ?', [req.params.id]);
  if (existing) await insights.logAdmin(req, 'episode.delete', await episodeLabel(existing));
  res.json({ ok: true });
}));

async function episodeLabel(ep) {
  const t = await db.get('SELECT title FROM titles WHERE id = ?', [ep.title_id]);
  return `${t ? t.title : 'Series'} — S${ep.season_number}E${ep.episode_number}`;
}

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
  if (imported) await insights.logAdmin(req, 'episodes.import', title.title, `${imported} episodes from TMDB (season ${season_number || 1})`);
  res.json({ imported, skipped: episodes.length - imported, episodes: rows });
}));

app.post('/api/admin/titles/:id/subtitles', requireAdmin, ah(async (req, res) => {
  const { label, lang_code, vtt_content } = req.body || {};
  if (!label || !lang_code || !vtt_content) {
    return res.status(400).json({ error: 'label, lang_code, and vtt_content are required.' });
  }
  const result = await db.run(
    'INSERT INTO subtitles (title_id, label, lang_code, vtt_content) VALUES (?, ?, ?, ?) RETURNING id',
    [req.params.id, label, lang_code, vtt_content]
  );
  const st = await db.get('SELECT title FROM titles WHERE id = ?', [req.params.id]);
  await insights.logAdmin(req, 'subtitle.add', st ? st.title : null, label);
  res.status(201).json({ id: result.lastID, label, lang_code });
}));

app.post('/api/admin/episodes/:id/subtitles', requireAdmin, ah(async (req, res) => {
  const { label, lang_code, vtt_content } = req.body || {};
  if (!label || !lang_code || !vtt_content) {
    return res.status(400).json({ error: 'label, lang_code, and vtt_content are required.' });
  }
  const result = await db.run(
    'INSERT INTO subtitles (episode_id, label, lang_code, vtt_content) VALUES (?, ?, ?, ?) RETURNING id',
    [req.params.id, label, lang_code, vtt_content]
  );
  const sep = await db.get('SELECT * FROM episodes WHERE id = ?', [req.params.id]);
  await insights.logAdmin(req, 'subtitle.add', sep ? await episodeLabel(sep) : null, label);
  res.status(201).json({ id: result.lastID, label, lang_code });
}));

app.get('/api/subtitles/:id', ah(async (req, res) => {
  const row = await db.get('SELECT vtt_content FROM subtitles WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).send('Not found');
  res.set('Content-Type', 'text/vtt; charset=utf-8');
  res.send(row.vtt_content);
}));

app.delete('/api/admin/subtitles/:id', requireAdmin, ah(async (req, res) => {
  const sub = await db.get('SELECT label FROM subtitles WHERE id = ?', [req.params.id]);
  await db.run('DELETE FROM subtitles WHERE id = ?', [req.params.id]);
  if (sub) await insights.logAdmin(req, 'subtitle.delete', null, sub.label);
  res.json({ ok: true });
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

// ---------- Admin overview: dashboard, missing videos, users ----------

// SQLite stores timestamps as "YYYY-MM-DD HH:MM:SS" (UTC, no zone);
// Postgres returns Date objects. Normalise both to a Date.
function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const s = String(value);
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z');
}

app.get('/api/admin/stats', requireAdmin, ah(async (req, res) => {
  const [titles, episodes, users] = await Promise.all([
    db.all('SELECT id, type, video_url FROM titles'),
    db.all('SELECT title_id, video_url FROM episodes'),
    db.all('SELECT created_at, email, is_admin FROM users'),
  ]);
  const series = titles.filter(t => t.type === 'series');
  const episodeCount = new Map();
  for (const e of episodes) episodeCount.set(e.title_id, (episodeCount.get(e.title_id) || 0) + 1);
  const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  res.json({
    titles: titles.length,
    movies: titles.length - series.length,
    series: series.length,
    episodes: episodes.length,
    episodesMissingVideo: episodes.filter(e => !e.video_url).length,
    seriesWithMissing: new Set(episodes.filter(e => !e.video_url).map(e => e.title_id)).size,
    seriesWithoutEpisodes: series.filter(s => !episodeCount.get(s.id)).length,
    moviesMissingVideo: titles.filter(t => t.type !== 'series' && !t.video_url).length,
    users: users.length,
    admins: users.filter(u => u.is_admin).length,
    newUsers30d: users.filter(u => (toDate(u.created_at) || 0) >= monthAgo).length,
    usersWithoutEmail: users.filter(u => !u.email).length,
  });
}));

// Everything viewers can see but can't play yet.
app.get('/api/admin/missing', requireAdmin, ah(async (req, res) => {
  const [titles, episodes] = await Promise.all([
    db.all('SELECT id, title, type, genre, video_url, tmdb_id FROM titles ORDER BY title'),
    db.all('SELECT title_id, video_url FROM episodes'),
  ]);
  const counts = new Map();
  for (const e of episodes) {
    const c = counts.get(e.title_id) || { total: 0, missing: 0 };
    c.total++; if (!e.video_url) c.missing++;
    counts.set(e.title_id, c);
  }
  const series = titles.filter(t => t.type === 'series');
  res.json({
    seriesMissingEpisodes: series
      .filter(s => counts.get(s.id) && counts.get(s.id).missing)
      .map(s => ({ id: s.id, title: s.title, genre: s.genre, ...counts.get(s.id) }))
      .sort((a, b) => b.missing - a.missing),
    seriesWithoutEpisodes: series
      .filter(s => !counts.get(s.id))
      .map(s => ({ id: s.id, title: s.title, genre: s.genre, canImport: !!s.tmdb_id })),
    moviesWithoutVideo: titles
      .filter(t => t.type !== 'series' && !t.video_url)
      .map(t => ({ id: t.id, title: t.title, genre: t.genre })),
  });
}));

app.get('/api/admin/users', requireAdmin, ah(async (req, res) => {
  const rows = await db.all(
    `SELECT u.id, u.username, u.email, u.is_admin, u.created_at,
            (SELECT COUNT(*) FROM watchlist w WHERE w.user_id = u.id) AS watchlist_count
     FROM users u ORDER BY u.id DESC`
  );
  res.json(rows.map(u => ({
    id: u.id,
    username: u.username,
    email: u.email || null,
    is_admin: !!u.is_admin,
    created_at: toDate(u.created_at),
    watchlist_count: Number(u.watchlist_count) || 0,
  })));
}));

// Creates a one-time reset link for a user and emails it when they have an
// address. The link is also returned so the admin can pass it on directly
// (e.g. on WhatsApp) when email isn't set up or the user has no address.
app.post('/api/admin/users/:id/reset-link', requireAdmin, ah(async (req, res) => {
  const user = await db.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const { link, expires } = await issueResetLink(req, user);
  const emailed = user.email ? await emailResetLink(user.email, link) : false;
  await insights.logAdmin(req, 'user.reset_link', user.username, emailed ? 'emailed' : 'link shown to admin');
  res.json({ link, expires, emailed, hasEmail: !!user.email });
}));

app.get('/api/admin/analytics', requireAdmin, ah(async (req, res) => {
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const tz = Math.max(-840, Math.min(840, Number(req.query.tz) || 0));
  res.json(await insights.analytics(days, tz));
}));
app.get('/api/admin/activity', requireAdmin, ah(async (req, res) => {
  res.json(await insights.activity(Math.min(200, Number(req.query.limit) || 100)));
}));
app.get('/api/admin/uploads', requireAdmin, ah(async (req, res) => {
  res.json(await insights.uploads());
}));
app.get('/api/admin/health', requireAdmin, ah(async (req, res) => {
  res.json(await insights.health());
}));

app.get('/api/admin/notifications', requireAdmin, ah(async (req, res) => {
  res.json(await push.overview());
}));
app.get('/api/admin/notifications/title/:id', requireAdmin, ah(async (req, res) => {
  const info = await push.titleInfo(req.params.id);
  if (!info) return res.status(404).json({ error: 'Title not found.' });
  res.json(info);
}));
// Sends to every device that allowed notifications, or with test: true only
// to the signed-in admin's own devices.
app.post('/api/admin/notifications', requireAdmin, ah(async (req, res) => {
  const b = req.body || {};
  const titleId = Number(b.title_id) || null;
  const t = titleId ? await db.get('SELECT id, title, type, backdrop_url, poster_url FROM titles WHERE id = ?', [titleId]) : null;
  const url = t ? `/?play=${t.id}` : '/';
  const image = b.image === false ? null : (t ? (t.backdrop_url || t.poster_url) : null);
  try {
    const sent = await push.send({
      kind: b.test ? 'test' : 'manual', title: b.title, body: b.body, url, image, titleId: t ? t.id : null,
      createdBy: req.session.user.username, onlyUserId: b.test ? req.session.user.id : null,
    });
    await insights.logAdmin(req, b.test ? 'notification.test' : 'notification.send', sent.title, `${sent.delivered} of ${sent.sent} devices`);
    res.json(sent);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    throw err;
  }
}));
app.put('/api/admin/notifications/settings', requireAdmin, ah(async (req, res) => {
  const on = !!(req.body && req.body.auto);
  await push.setSetting('auto_notify', on ? 'on' : 'off');
  await insights.logAdmin(req, 'notification.auto', on ? 'Automatic notifications on' : 'Automatic notifications off');
  res.json({ auto: on });
}));

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
  await insights.logAdmin(req, 'title.create', row.title, row.type);
  if (row.video_url) {
    await insights.logAdmin(req, 'video.set', row.title, 'movie video added');
    if (row.type === 'movie') push.videoAdded(row.id);
  }
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
  await insights.logAdmin(req, 'title.update', row.title);
  if (row.video_url && row.video_url !== existing.video_url) await insights.logAdmin(req, 'video.set', row.title, 'movie video changed');
  if (row.type === 'movie' && row.video_url && !existing.video_url) push.videoAdded(row.id);
  res.json(row);
}));

app.delete('/api/admin/titles/:id', requireAdmin, ah(async (req, res) => {
  const existing = await db.get('SELECT title FROM titles WHERE id = ?', [req.params.id]);
  await db.run('DELETE FROM titles WHERE id = ?', [req.params.id]);
  if (existing) await insights.logAdmin(req, 'title.delete', existing.title);
  res.json({ ok: true });
}));

// Final error handler — anything passed to next(err) via `ah()` lands here
// instead of crashing the process.
app.use((err, req, res, next) => {
  console.error('Request error:', err);
  const isDuplicate = err.code === '23505' || (err.message && err.message.includes('UNIQUE constraint failed'));
  if (isDuplicate) {
    return res.status(409).json({ error: 'That already exists — check for a duplicate (e.g. this season/episode number is already added).' });
  }
  // A malformed request (bad JSON, too large…) is the sender's problem, not a
  // server error — answer 4xx and keep it out of System health's error count.
  if (err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: 'That request could not be read.' });
  }
  insights.noteServerError(req, err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

db.ready().then(() => {
  insights.cleanup();
  setInterval(() => insights.cleanup(), 24 * 60 * 60 * 1000).unref();
}).catch(() => {});

app.listen(PORT, () => {
  console.log(`LumatoStreaming server running at http://localhost:${PORT}`);
});
