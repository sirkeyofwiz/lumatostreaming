// What the admin panel's Analytics, Activity log, Uploads and System health
// pages read from: viewer activity (the events table), admin changes (the
// admin_log table) and recent server errors.
const db = require('./db');
const storage = require('./storage');

const startedAt = new Date();

// ---------- Time helpers (SQLite stores UTC text, Postgres real timestamps) ----------

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const s = String(value);
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z');
}

// A cutoff value comparable with created_at in either database.
function since(ms) {
  const d = new Date(Date.now() - ms);
  return db.kind === 'postgres' ? d : d.toISOString().slice(0, 19).replace('T', ' ');
}
const DAY = 24 * 60 * 60 * 1000;

// ---------- Recording viewer activity ----------

// Only these come from browsers; signups are recorded by the server itself.
const BROWSER_EVENTS = new Set(['visit', 'title_open', 'play_start', 'play_complete', 'play_error', 'search', 'download', 'upload_failed']);
const VISITOR_RE = /^[A-Za-z0-9-]{8,40}$/;

// A light per-IP limit so nobody can flood the table.
const recent = new Map();
function allowed(ip, count) {
  const now = Date.now();
  const entry = recent.get(ip) || { start: now, n: 0 };
  if (now - entry.start > 60 * 1000) { entry.start = now; entry.n = 0; }
  entry.n += count;
  recent.set(ip, entry);
  if (recent.size > 5000) recent.clear();
  return entry.n <= 300;
}

async function recordBrowserEvents(req, body) {
  const list = Array.isArray(body && body.events) ? body.events.slice(0, 25) : [];
  const visitor = body && typeof body.v === 'string' && VISITOR_RE.test(body.v) ? body.v : null;
  if (!list.length || !allowed(req.ip, list.length)) return 0;
  const userId = req.session && req.session.user ? req.session.user.id : null;
  const int = (x) => (Number.isInteger(x) && x >= 0 && x < 2 ** 31 ? x : null);
  let saved = 0;
  for (const e of list) {
    if (!e || !BROWSER_EVENTS.has(e.t)) continue;
    let value = typeof e.value === 'string' ? e.value.trim().slice(0, 100) || null : null;
    // Searches group together regardless of capitals ("Spider" = "spider").
    if (value && (e.t === 'search' || e.t === 'visit')) value = value.toLowerCase();
    await db.run(
      'INSERT INTO events (type, visitor_id, user_id, title_id, episode_id, value, num) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [e.t, visitor, userId, int(e.title_id), int(e.episode_id), value, int(e.num)]
    );
    saved++;
  }
  return saved;
}

async function recordServerEvent(type, { userId = null, value = null } = {}) {
  try {
    await db.run('INSERT INTO events (type, user_id, value) VALUES (?, ?, ?)', [type, userId, value && String(value).slice(0, 200)]);
  } catch (err) {
    console.error('Could not record event:', err.message);
  }
}

// ---------- Admin activity log ----------

async function logAdmin(req, action, target, detail) {
  const u = req.session && req.session.user;
  try {
    await db.run(
      'INSERT INTO admin_log (user_id, username, action, target, detail) VALUES (?, ?, ?, ?, ?)',
      [u ? u.id : null, u ? u.username : null, action, target ? String(target).slice(0, 200) : null, detail ? String(detail).slice(0, 300) : null]
    );
  } catch (err) {
    console.error('Could not write admin log:', err.message);
  }
}

// ---------- Server errors (kept in memory for System health, and counted) ----------

const errorRing = [];
function noteServerError(req, err) {
  errorRing.unshift({ at: new Date(), method: req.method, path: req.path, message: String(err && err.message || err).slice(0, 200) });
  errorRing.length = Math.min(errorRing.length, 25);
  recordServerEvent('server_error', { value: `${req.method} ${req.path}: ${err && err.message}` });
}

// ---------- Analytics ----------

// Groups traffic sources into names people recognise.
function sourceName(value) {
  if (!value) return 'Direct';
  const v = value.toLowerCase();
  if (v.includes('whatsapp') || v === 'wa.me' || v.endsWith('.wl.co')) return 'WhatsApp';
  if (v.includes('google')) return 'Google';
  if (v.includes('facebook') || v === 'fb' || v.startsWith('fb.') || v.includes('m.me')) return 'Facebook';
  if (v.includes('instagram')) return 'Instagram';
  if (v.includes('tiktok')) return 'TikTok';
  if (v.includes('youtube') || v === 'youtu.be') return 'YouTube';
  if (v === 't.co' || v.includes('twitter') || v === 'x.com') return 'X / Twitter';
  if (v.includes('telegram') || v === 't.me') return 'Telegram';
  if (v === 'direct') return 'Direct';
  return 'Other websites';
}

async function analytics(days, tzOffsetMin) {
  const windowMs = days * DAY;
  const [rows, titles] = await Promise.all([
    db.all(
      'SELECT type, visitor_id, user_id, title_id, episode_id, value, num, created_at FROM events WHERE created_at >= ? ORDER BY id LIMIT 300000',
      [since(2 * windowMs)]
    ),
    db.all('SELECT id, title, type FROM titles'),
  ]);
  const titleById = new Map(titles.map((t) => [t.id, t]));
  const cutoff = Date.now() - windowMs;
  const cur = [], prev = [];
  for (const r of rows) {
    const at = toDate(r.created_at).getTime();
    (at >= cutoff ? cur : prev).push({ ...r, at });
  }

  const totalsFor = (list) => {
    const visitors = new Set(list.filter((e) => e.visitor_id).map((e) => e.visitor_id));
    const count = (t) => list.filter((e) => e.type === t).length;
    const searches = list.filter((e) => e.type === 'search');
    const plays = count('play_start'), completes = count('play_complete');
    return {
      visitors: visitors.size,
      visits: count('visit'),
      plays,
      completes,
      completionRate: plays ? Math.round((completes / plays) * 100) : null,
      searches: searches.length,
      noResultSearches: searches.filter((e) => e.num === 0).length,
      downloads: count('download'),
      signups: count('signup'),
      playErrors: count('play_error'),
    };
  };

  // Day buckets in the admin's own time zone.
  const shift = -tzOffsetMin * 60 * 1000; // getTimezoneOffset is minutes behind UTC
  const dayKey = (at) => new Date(at + shift).toISOString().slice(0, 10);
  const daily = [];
  for (let i = days - 1; i >= 0; i--) {
    daily.push({ date: dayKey(Date.now() - i * DAY), visitors: new Set(), plays: 0 });
  }
  const dayIndex = new Map(daily.map((d, i) => [d.date, i]));
  const hours = Array(24).fill(0);
  for (const e of cur) {
    const d = daily[dayIndex.get(dayKey(e.at))];
    if (d && e.visitor_id && e.type === 'visit') d.visitors.add(e.visitor_id);
    if (e.type === 'play_start') {
      if (d) d.plays++;
      hours[new Date(e.at + shift).getUTCHours()]++;
    }
  }

  const tally = (list, keyFn) => {
    const m = new Map();
    for (const e of list) { const k = keyFn(e); if (k != null) m.set(k, (m.get(k) || 0) + 1); }
    return m;
  };
  const playsBy = tally(cur.filter((e) => e.type === 'play_start'), (e) => e.title_id);
  const completesBy = tally(cur.filter((e) => e.type === 'play_complete'), (e) => e.title_id);
  const opensBy = tally(cur.filter((e) => e.type === 'title_open'), (e) => e.title_id);
  const topTitles = [...playsBy.entries()]
    .filter(([id]) => titleById.has(id))
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([id, plays]) => ({
      id, title: titleById.get(id).title, type: titleById.get(id).type, plays,
      opens: opensBy.get(id) || 0,
      completionRate: Math.round(((completesBy.get(id) || 0) / plays) * 100),
    }));

  const searchList = cur.filter((e) => e.type === 'search' && e.value);
  const topList = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([query, count]) => ({ query, count }));
  const sourceCounts = tally(cur.filter((e) => e.type === 'visit'), (e) => sourceName(e.value));
  const visitTotal = [...sourceCounts.values()].reduce((a, b) => a + b, 0);
  const errorsBy = tally(cur.filter((e) => e.type === 'play_error'), (e) => (e.title_id ? `${e.title_id}:${e.episode_id || ''}` : null));

  return {
    days,
    trackingSince: rows.length ? toDate(rows[0].created_at) : null,
    totals: totalsFor(cur),
    previous: totalsFor(prev),
    daily: daily.map((d) => ({ date: d.date, visitors: d.visitors.size, plays: d.plays })),
    hours,
    topTitles,
    noResultSearches: topList(tally(searchList.filter((e) => e.num === 0), (e) => e.value), 10),
    topSearches: topList(tally(searchList, (e) => e.value), 10),
    sources: [...sourceCounts.entries()].sort((a, b) => b[1] - a[1]).map(([source, count]) => ({ source, count, pct: Math.round((count / visitTotal) * 100) })),
    playErrors: [...errorsBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([key, count]) => {
      const [tid, eid] = key.split(':');
      const t = titleById.get(Number(tid));
      return { title: t ? t.title : `Title #${tid}`, episodeId: eid ? Number(eid) : null, count };
    }),
  };
}

// ---------- Activity log (admin changes + sign-ups) ----------

async function activity(limit) {
  const [log, signups] = await Promise.all([
    db.all('SELECT username, action, target, detail, created_at FROM admin_log ORDER BY id DESC LIMIT ?', [limit]),
    db.all('SELECT username, is_admin, created_at FROM users ORDER BY id DESC LIMIT ?', [limit]),
  ]);
  const items = [
    ...log.map((r) => ({ at: toDate(r.created_at), actor: r.username, action: r.action, target: r.target, detail: r.detail })),
    // Admin accounts are created at setup, not signed up for.
    ...signups.filter((u) => !u.is_admin).map((u) => ({ at: toDate(u.created_at), actor: u.username, action: 'user.signup', target: u.username, detail: null })),
  ];
  return items.sort((a, b) => b.at - a.at).slice(0, limit);
}

async function uploads() {
  const [recentVideos, failed, weekCount] = await Promise.all([
    db.all("SELECT username, target, detail, created_at FROM admin_log WHERE action = 'video.set' ORDER BY id DESC LIMIT 50"),
    db.all("SELECT value, created_at FROM events WHERE type = 'upload_failed' AND created_at >= ? ORDER BY id DESC LIMIT 30", [since(7 * DAY)]),
    db.get("SELECT COUNT(*) AS n FROM admin_log WHERE action = 'video.set' AND created_at >= ?", [since(7 * DAY)]),
  ]);
  return {
    thisWeek: Number(weekCount && weekCount.n) || 0,
    recent: recentVideos.map((r) => ({ at: toDate(r.created_at), actor: r.username, target: r.target, detail: r.detail })),
    failed: failed.map((r) => ({ at: toDate(r.created_at), file: r.value })),
  };
}

// ---------- System health ----------

async function health() {
  const t0 = Date.now();
  let dbOk = true, dbError = null, sizeBytes = null;
  try {
    await db.get('SELECT 1 AS ok');
    if (db.kind === 'postgres') {
      const r = await db.get('SELECT pg_database_size(current_database()) AS size');
      sizeBytes = Number(r.size);
    } else {
      const pc = await db.get('PRAGMA page_count'), ps = await db.get('PRAGMA page_size');
      sizeBytes = Number(pc.page_count) * Number(ps.page_size);
    }
  } catch (err) {
    dbOk = false; dbError = err.message;
  }
  const dbLatencyMs = Date.now() - t0;
  let serverErrors24h = null, playErrors24h = null, eventsTotal = null;
  try {
    const [se, pe, et] = await Promise.all([
      db.get("SELECT COUNT(*) AS n FROM events WHERE type = 'server_error' AND created_at >= ?", [since(DAY)]),
      db.get("SELECT COUNT(*) AS n FROM events WHERE type = 'play_error' AND created_at >= ?", [since(DAY)]),
      db.get('SELECT COUNT(*) AS n FROM events'),
    ]);
    serverErrors24h = Number(se.n); playErrors24h = Number(pe.n); eventsTotal = Number(et.n);
  } catch { /* reported as unknown */ }
  const commit = process.env.RAILWAY_GIT_COMMIT_SHA || null;
  return {
    server: { ok: true, startedAt, uptimeSec: Math.round(process.uptime()), node: process.version, memoryMB: Math.round(process.memoryUsage().rss / 1048576) },
    database: { ok: dbOk, kind: db.kind, latencyMs: dbLatencyMs, sizeBytes, error: dbError },
    storage: { videoUploads: storage.isConfigured(), email: !!process.env.RESEND_API_KEY, emailFromOwnDomain: !!process.env.RESEND_FROM },
    deploy: {
      commit: commit ? commit.slice(0, 7) : null,
      message: process.env.RAILWAY_GIT_COMMIT_MESSAGE ? process.env.RAILWAY_GIT_COMMIT_MESSAGE.split('\n')[0].slice(0, 120) : null,
      region: process.env.RAILWAY_REPLICA_REGION || null,
    },
    errors: { server24h: serverErrors24h, playback24h: playErrors24h, recent: errorRing.slice(0, 10) },
    eventsStored: eventsTotal,
  };
}

// ---------- Housekeeping: raw activity is kept 90 days, the admin log a year ----------

async function cleanup() {
  try {
    await db.run('DELETE FROM events WHERE created_at < ?', [since(90 * DAY)]);
    await db.run('DELETE FROM admin_log WHERE created_at < ?', [since(365 * DAY)]);
  } catch (err) {
    console.error('Cleanup failed:', err.message);
  }
}

module.exports = { recordBrowserEvents, recordServerEvent, logAdmin, noteServerError, analytics, activity, uploads, health, cleanup };
