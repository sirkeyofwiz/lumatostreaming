// Phone and computer notifications (web push). Viewers who tap "Allow" get a
// subscription saved here; the admin panel sends messages to all of them,
// and new episodes/movies announce themselves automatically.
const webpush = require('web-push');
const db = require('./db');

const DAY = 24 * 60 * 60 * 1000;
const SITE_URL = (process.env.SITE_URL || 'https://lumatostreaming.site').replace(/\/$/, '');

// ---------- Settings (key/value) ----------

async function getSetting(key) {
  const row = await db.get('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : null;
}
async function setSetting(key, value) {
  await db.run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
}

// ---------- Keys ----------
// Push needs one key pair for the whole site. Railway variables
// (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY) win if set; otherwise a pair is made
// once and kept in the database, so it survives deploys. Changing the keys
// would cut off every device that already said yes.
let keys = null;
async function getKeys() {
  if (keys) return keys;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY, from: 'railway' };
  } else {
    let pub = await getSetting('vapid_public');
    let priv = await getSetting('vapid_private');
    if (!pub || !priv) {
      const made = webpush.generateVAPIDKeys();
      await setSetting('vapid_public', made.publicKey);
      await setSetting('vapid_private', made.privateKey);
      // Another server instance may have saved its own pair at the same moment;
      // read back so everyone uses the one that was stored.
      pub = await getSetting('vapid_public');
      priv = await getSetting('vapid_private');
    }
    keys = { publicKey: pub, privateKey: priv, from: 'database' };
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || SITE_URL, keys.publicKey, keys.privateKey);
  return keys;
}

// ---------- Subscriptions ----------

const VISITOR_RE = /^[A-Za-z0-9-]{8,40}$/;

function deviceFrom(ua) {
  ua = ua || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iPhone/iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Macintosh|Mac OS/i.test(ua)) return 'Mac';
  if (/Linux|CrOS/i.test(ua)) return 'Linux/Chromebook';
  return 'Other';
}

function validSubscription(sub) {
  return sub && typeof sub.endpoint === 'string' && /^https:\/\//.test(sub.endpoint) && sub.endpoint.length < 1000
    && sub.keys && typeof sub.keys.p256dh === 'string' && typeof sub.keys.auth === 'string'
    && sub.keys.p256dh.length < 200 && sub.keys.auth.length < 100;
}

async function subscribe(req, sub, visitor) {
  if (!validSubscription(sub)) return false;
  const userId = req.session && req.session.user ? req.session.user.id : null;
  const v = typeof visitor === 'string' && VISITOR_RE.test(visitor) ? visitor : null;
  await db.run(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_id, visitor_id, device) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth,
       user_id = COALESCE(excluded.user_id, push_subscriptions.user_id), visitor_id = excluded.visitor_id, device = excluded.device`,
    [sub.endpoint, sub.keys.p256dh, sub.keys.auth, userId, v, deviceFrom(req.get('user-agent'))]
  );
  return true;
}

async function unsubscribe(endpoint) {
  if (typeof endpoint !== 'string') return;
  await db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
}

// ---------- Sending ----------

function clean(text, max) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// Sends one notification to every device (or only `onlyUserId`'s devices, for
// a test) and records it. Returns the stored row.
async function send({ kind, title, body, url, image, titleId, createdBy, onlyUserId }) {
  await getKeys();
  title = clean(title, 80);
  body = clean(body, 240);
  if (!title || !body) throw Object.assign(new Error('A title and a message are required.'), { status: 400 });

  const result = await db.run(
    `INSERT INTO notifications (kind, title, body, url, image, title_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [kind, title, body, url || '/', image || null, titleId || null, createdBy || null]
  );
  const id = result.lastID;
  // ?n= lets the site count opens; the service worker also reports them.
  const link = `${url || '/'}${(url || '/').includes('?') ? '&' : '?'}n=${id}`;
  const payload = JSON.stringify({ id, title, body, url: link, image: image || undefined, tag: kind === 'auto' && titleId ? `title-${titleId}` : `n-${id}` });

  const subs = onlyUserId
    ? await db.all('SELECT * FROM push_subscriptions WHERE user_id = ?', [onlyUserId])
    : await db.all('SELECT * FROM push_subscriptions');
  let delivered = 0;
  let removed = 0;
  for (let i = 0; i < subs.length; i += 50) {
    const batch = subs.slice(i, i + 50);
    const results = await Promise.allSettled(batch.map((s) => webpush.sendNotification(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      payload,
      { TTL: 2 * DAY / 1000, urgency: 'normal' }
    )));
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === 'fulfilled') { delivered++; continue; }
      // 404/410: the person turned notifications off or uninstalled — forget them.
      const code = r.reason && r.reason.statusCode;
      if (code === 404 || code === 410) {
        removed++;
        await unsubscribe(batch[j].endpoint);
      } else {
        console.error('Push failed:', code || '', r.reason && r.reason.message);
      }
    }
  }
  await db.run('UPDATE notifications SET sent = ?, delivered = ? WHERE id = ?', [subs.length, delivered, id]);
  return { id, title, body, url: url || '/', image, sent: subs.length, delivered, removed };
}

// Counted when someone taps a notification. Light per-IP limit.
const openedBy = new Map();
async function opened(req, id) {
  id = Number(id);
  if (!Number.isInteger(id) || id < 1) return;
  const key = `${req.ip}:${id}`;
  if (openedBy.has(key)) return;
  if (openedBy.size > 5000) openedBy.clear();
  openedBy.set(key, true);
  await db.run('UPDATE notifications SET opened = opened + 1 WHERE id = ?', [id]);
}

// ---------- Automatic: new episodes and movies ----------
// Videos often arrive in a burst (bulk upload of a whole season), so each
// title waits a few minutes and then sends one notification for all of them.
const WAIT_MS = Number(process.env.PUSH_WAIT_MS) || 3 * 60 * 1000;
const pending = new Map(); // titleId -> { episodeIds: Set, timer }

async function autoEnabled() {
  return (await getSetting('auto_notify')) !== 'off';
}

function videoAdded(titleId, episodeId) {
  titleId = Number(titleId);
  let entry = pending.get(titleId);
  if (!entry) {
    entry = { episodeIds: new Set(), timer: null };
    pending.set(titleId, entry);
  }
  if (episodeId) entry.episodeIds.add(Number(episodeId));
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    pending.delete(titleId);
    announce(titleId, [...entry.episodeIds]).catch((err) => console.error('Auto notification failed:', err.message));
  }, WAIT_MS);
  entry.timer.unref();
}

async function announce(titleId, episodeIds) {
  if (!(await autoEnabled())) return;
  const t = await db.get('SELECT * FROM titles WHERE id = ?', [titleId]);
  if (!t) return;
  const image = t.backdrop_url || t.poster_url || null;
  if (t.type === 'movie') {
    if (!t.video_url) return;
    await send({
      kind: 'auto', titleId, image, createdBy: 'automatic',
      title: `🍿 New movie: ${t.title}`,
      body: t.description ? clean(t.description, 140) : 'Now streaming on LumatoStreaming. Tap to watch.',
      url: `/?play=${titleId}`,
    });
    return;
  }
  const eps = [];
  for (const id of episodeIds) {
    const ep = await db.get('SELECT * FROM episodes WHERE id = ? AND title_id = ?', [id, titleId]);
    if (ep && ep.video_url) eps.push(ep);
  }
  if (!eps.length) return;
  eps.sort((a, b) => a.season_number - b.season_number || a.episode_number - b.episode_number);
  const first = eps[0];
  const one = eps.length === 1;
  await send({
    kind: 'auto', titleId, image, createdBy: 'automatic',
    title: one ? `🎬 New episode: ${t.title}` : `🎬 ${eps.length} new episodes: ${t.title}`,
    body: one
      ? `S${first.season_number} E${first.episode_number}${first.name ? ` · ${first.name}` : ''} is now streaming. Tap to watch.`
      : `S${first.season_number} E${first.episode_number} to S${eps[eps.length - 1].season_number} E${eps[eps.length - 1].episode_number} just dropped. Start watching now.`,
    url: `/?play=${titleId}&ep=${first.id}`,
  });
}

// ---------- Admin page ----------

async function overview() {
  const k = await getKeys();
  const subs = await db.all('SELECT device, COUNT(*) AS n FROM push_subscriptions GROUP BY device ORDER BY n DESC');
  const history = await db.all('SELECT * FROM notifications ORDER BY id DESC LIMIT 50');
  const total = subs.reduce((sum, r) => sum + Number(r.n), 0);
  return {
    subscribers: total,
    devices: subs.map((r) => ({ device: r.device || 'Other', count: Number(r.n) })),
    auto: await autoEnabled(),
    keysFrom: k.from,
    pendingAuto: [...pending.keys()].length,
    history: history.map((h) => ({ ...h, sent: Number(h.sent), delivered: Number(h.delivered), opened: Number(h.opened) })),
  };
}

// Real numbers for writing a message about one title.
async function titleInfo(titleId) {
  const t = await db.get('SELECT id, title, type, description, backdrop_url, poster_url FROM titles WHERE id = ?', [titleId]);
  if (!t) return null;
  const cutoff = (ms) => {
    const d = new Date(Date.now() - ms);
    return db.kind === 'postgres' ? d : d.toISOString().slice(0, 19).replace('T', ' ');
  };
  const count = async (ms) => Number((await db.get(
    `SELECT COUNT(DISTINCT COALESCE(visitor_id, CAST(user_id AS TEXT))) AS n FROM events WHERE type = 'play_start' AND title_id = ? AND created_at >= ?`,
    [titleId, cutoff(ms)]
  )).n || 0);
  const latest = t.type === 'series'
    ? await db.get(`SELECT id, season_number, episode_number, name, description FROM episodes WHERE title_id = ? AND video_url IS NOT NULL AND video_url <> ''
        ORDER BY season_number DESC, episode_number DESC LIMIT 1`, [titleId])
    : null;
  return { ...t, image: t.backdrop_url || t.poster_url || null, watchers24h: await count(DAY), watchers7d: await count(7 * DAY), latest };
}

module.exports = {
  getKeys, subscribe, unsubscribe, send, opened, videoAdded, overview, titleInfo, setSetting,
};
