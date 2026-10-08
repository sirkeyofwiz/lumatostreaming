const API = '/api';

const palettes = [
  ['#3C2A55', '#211531'], ['#1E3A44', '#0F1F26'], ['#4A2418', '#241009'],
  ['#233A1E', '#101F0C'], ['#3A2A12', '#1C1305'], ['#1F2A44', '#0D1120'],
  ['#442035', '#210F1A'], ['#123B36', '#081E1A'],
];
function gradient(seed) {
  const [a, b] = palettes[seed % palettes.length];
  const angle = 120 + (seed * 17) % 90;
  return `linear-gradient(${angle}deg, ${a}, ${b})`;
}
// Cards are ~150px wide, so TMDB's w342 posters are plenty (even on 2x
// screens) and about half the download of the w500 ones stored on titles.
function cardPosterUrl(url) {
  return url ? url.replace('image.tmdb.org/t/p/w500/', 'image.tmdb.org/t/p/w342/') : url;
}

// Poster images load only as their card nears the screen; until then the
// card shows its gradient. Without this, every row on the home page —
// including all the genre rows far below — downloads its images at once.
const posterObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        observer.unobserve(el);
        el.style.background = `url('${el.dataset.poster}') center/cover no-repeat, ${el.style.background}`;
      });
    }, { rootMargin: '400px 200px' })
  : null;

function lazyLoadPosters(container) {
  container.querySelectorAll('.poster[data-poster]').forEach((el) => {
    if (posterObserver) posterObserver.observe(el);
    else el.style.background = `url('${el.dataset.poster}') center/cover no-repeat, ${el.style.background}`;
  });
}
function heroBackground(item) {
  // The hero banner and modal header are wide/landscape, but movie posters
  // are tall/portrait — `cover` on a mismatched aspect ratio crops almost
  // the whole image away and blows up whatever's left (e.g. one giant,
  // zoomed-in face). `contain` shows the whole poster with no cropping;
  // anchoring it to the right keeps it clear of the left-aligned title text.
  if (item.poster_url) return `url('${item.poster_url}') right center/contain no-repeat, ${gradient(item.palette)}`;
  return gradient(item.palette);
}

// Figures out how to play a video_url: a YouTube/Vimeo link becomes an
// iframe embed, anything else is treated as a direct video file URL and
// played with a native <video> element.
function buildSubtitleTracks(subtitles) {
  if (!subtitles || !subtitles.length) return '';
  return subtitles.map((s, i) => {
    return `<track kind="subtitles" src="${s.src || `/api/subtitles/${s.id}`}" srclang="${s.lang_code}" label="${s.label}" ${i === 0 ? 'default' : ''}></track>`;
  }).join('');
}
function getVideoEmbed(url) {
  if (!url) return null;
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/);
  if (yt) return { type: 'iframe', src: `https://www.youtube.com/embed/${yt[1]}?autoplay=1` };
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return { type: 'iframe', src: `https://player.vimeo.com/video/${vimeo[1]}?autoplay=1` };
  return { type: 'video', src: url };
}

async function openPlayer(item) {
  if (item.offlineKey) {
    const offline = await getOfflineVideo(item.offlineKey).catch(() => null);
    if (offline) {
      const objectUrl = URL.createObjectURL(offline.blob);
      // Subtitles saved alongside the video are served from blob URLs, so
      // they play without a network connection.
      const offlineSubs = (offline.subtitles || []).map(s => ({
        ...s, src: URL.createObjectURL(new Blob([s.vtt], { type: 'text/vtt' })),
      }));
      const revokeAll = () => { URL.revokeObjectURL(objectUrl); offlineSubs.forEach(s => URL.revokeObjectURL(s.src)); };
      const root = document.getElementById('modal-root');
      root.innerHTML = `
        <div class="modal-backdrop">
          <div class="modal" style="max-width:900px; width:100%; background:#000; padding:0;">
            <div style="position:relative; width:100%; aspect-ratio:16/9;">
              <div class="modal-close" id="player-close" style="z-index:5;">${closeIcon()}</div>
              <video src="${objectUrl}" controls autoplay crossorigin="anonymous" style="position:absolute; inset:0; width:100%; height:100%; background:#000;">${buildSubtitleTracks(offlineSubs)}</video>
            </div>
          </div>
        </div>
      `;
      root.querySelector('.modal-backdrop').addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-backdrop')) { root.innerHTML = ''; revokeAll(); }
      });
      document.getElementById('player-close').onclick = () => { root.innerHTML = ''; revokeAll(); };
      return;
    }
  }

  const embed = getVideoEmbed(item.video_url);
  if (!embed) {
    showToast('No video linked for this title yet.');
    return;
  }
  const root = document.getElementById('modal-root');
  const playerEl = embed.type === 'iframe'
    ? `<iframe src="${embed.src}" allow="autoplay; fullscreen" allowfullscreen style="position:absolute; inset:0; width:100%; height:100%; border:0;"></iframe>`
    : `<video src="${embed.src}" controls autoplay crossorigin="anonymous" style="position:absolute; inset:0; width:100%; height:100%; background:#000;">${buildSubtitleTracks(item.subtitles)}</video>`;
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal" style="max-width:900px; width:100%; background:#000; padding:0;">
        <div style="position:relative; width:100%; aspect-ratio:16/9;">
          <div class="modal-close" id="player-close" style="z-index:5;">${closeIcon()}</div>
          ${playerEl}
        </div>
      </div>
    </div>
  `;
  root.querySelector('.modal-backdrop').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-backdrop')) root.innerHTML = '';
  });
  document.getElementById('player-close').onclick = () => root.innerHTML = '';
}
function starIcon() {
  return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/></svg>`;
}
function plusIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>`;
}
function checkIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12l5 5L20 7"/></svg>`;
}
function closeIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
}
function userIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.5-7 8-7s8 3 8 7"/></svg>`;
}

const activeDownloads = new Map(); // key -> { title, progress, status }
let state = {
  route: 'home',
  genre: '',
  query: '',
  genres: [],
  user: null,
};

async function api(path, opts) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.status === 204 ? null : res.json();
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 1800);
}

async function refreshUser() {
  state.user = await api('/auth/me');
  renderTopbar();
}

// The account button at the end of the top nav: opens sign-in when signed
// out, or a menu (admin panel, recovery email, sign out) when signed in.
function renderTopbar() {
  const el = document.getElementById('topbar-actions');
  if (state.user) {
    el.innerHTML = `
      <div class="user-btn" id="user-btn" title="${state.user.username}">
        <div class="avatar">${state.user.username[0].toUpperCase()}</div>
      </div>
      <div class="user-menu" id="user-menu">
        <div class="user-menu-head">
          <div class="avatar">${state.user.username[0].toUpperCase()}</div>
          <span>${state.user.username}</span>
          ${state.user.is_admin ? '<span class="tag" style="color:#241706;background:var(--gold)">ADMIN</span>' : ''}
        </div>
        ${state.user.is_admin ? `<a class="user-menu-item" href="/admin.html">Admin panel</a>` : ''}
        ${!state.user.email ? `<div class="user-menu-item" id="add-email-link">Add recovery email</div>` : ''}
        <div class="user-menu-item" id="logout-btn">Sign out</div>
      </div>
    `;
    const menu = document.getElementById('user-menu');
    document.getElementById('user-btn').onclick = (e) => {
      e.stopPropagation();
      menu.classList.toggle('open');
    };
    if (!state.user.email) {
      document.getElementById('add-email-link').onclick = () => { menu.classList.remove('open'); openAddEmail(); };
    }
    document.getElementById('logout-btn').onclick = async () => {
      await api('/auth/logout', { method: 'POST' });
      state.user = null;
      renderTopbar();
      showToast('Signed out');
      if (state.route === 'watchlist') render();
    };
  } else {
    el.innerHTML = `
      <div class="user-btn" id="signin-btn" title="Sign in" aria-label="Sign in">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.5-7 8-7s8 3 8 7"/></svg>
      </div>
    `;
    document.getElementById('signin-btn').onclick = () => openAuthModal('login');
  }
}

document.addEventListener('click', (e) => {
  const menu = document.getElementById('user-menu');
  if (menu && !e.target.closest('#user-menu')) menu.classList.remove('open');
});

function openAuthModal(mode) {
  const root = document.getElementById('modal-root');
  const isLogin = mode === 'login';
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal" style="max-width:380px;">
        <div class="modal-body">
          <div class="auth-tabs">
            <div class="auth-tab ${isLogin ? 'active' : ''}" data-mode="login">Sign in</div>
            <div class="auth-tab ${!isLogin ? 'active' : ''}" data-mode="register">Create account</div>
          </div>
          <form id="auth-form">
            <input type="text" name="username" placeholder="Username" autocomplete="username" required />
            ${!isLogin ? `<input type="email" name="email" placeholder="Email (for password resets)" autocomplete="email" required />` : ''}
            <input type="password" name="password" placeholder="Password" autocomplete="${isLogin ? 'current-password' : 'new-password'}" required />
            <div class="auth-error" id="auth-error"></div>
            <button type="submit" class="btn btn-gold" style="width:100%; justify-content:center; margin-top:6px;">
              ${isLogin ? 'Sign in' : 'Create account'}
            </button>
          </form>
          <div class="auth-hint">${isLogin ? "New here?" : 'Already have an account?'} <span id="auth-switch">${isLogin ? 'Create an account' : 'Sign in'}</span></div>
          ${isLogin ? `<div class="auth-hint" style="margin-top:6px;"><span id="auth-forgot">Forgot your password?</span></div>` : ''}
        </div>
      </div>
    </div>
  `;
  root.querySelector('.modal-backdrop').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-backdrop')) root.innerHTML = '';
  });
  document.getElementById('auth-switch').onclick = () => openAuthModal(isLogin ? 'register' : 'login');
  if (isLogin) {
    document.getElementById('auth-forgot').onclick = () => openForgotPassword();
  }
  root.querySelectorAll('.auth-tab').forEach(tab => {
    tab.onclick = () => openAuthModal(tab.dataset.mode);
  });
  document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = JSON.stringify({ username: fd.get('username'), email: fd.get('email'), password: fd.get('password') });
    const errEl = document.getElementById('auth-error');
    errEl.textContent = '';
    try {
      const res = await fetch(`${API}/auth/${isLogin ? 'login' : 'register'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
      });
      const data = await res.json();
      if (!res.ok) { errEl.textContent = data.error || 'Something went wrong.'; return; }
      state.user = data;
      renderTopbar();
      root.innerHTML = '';
      showToast(isLogin ? `Welcome back, ${data.username}` : `Account created — welcome, ${data.username}`);
      if (state.route === 'watchlist') render();
    } catch (err) {
      errEl.textContent = 'Could not reach the server.';
    }
  });
}

function openAddEmail() {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal" style="max-width:380px;">
        <div class="modal-body">
          <h2 style="font-family:'Bebas Neue', sans-serif; font-size:22px; font-weight:400; letter-spacing:.5px; margin-bottom:6px;">Add a recovery email</h2>
          <p style="font-size:12.5px; color:var(--text-dim); margin-bottom:14px;">Your account doesn't have one yet — without it you can't reset your password if you forget it.</p>
          <form id="add-email-form">
            <input type="email" name="email" placeholder="you@example.com" required style="width:100%; background:var(--surface-2); border:1px solid var(--border); border-radius:8px; padding:11px 12px; color:var(--text); font-size:14px; margin-bottom:10px;" />
            <button type="submit" class="btn btn-gold" style="width:100%; justify-content:center;">Save</button>
          </form>
          <div class="auth-error" id="add-email-error" style="margin-top:8px;"></div>
        </div>
      </div>
    </div>
  `;
  root.querySelector('.modal-backdrop').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-backdrop')) root.innerHTML = '';
  });
  document.getElementById('add-email-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = new FormData(e.target).get('email');
    const errEl = document.getElementById('add-email-error');
    try {
      const updated = await api('/auth/email', { method: 'PUT', body: JSON.stringify({ email }) });
      state.user = updated;
      root.innerHTML = '';
      renderTopbar();
      showToast('Recovery email added');
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}

function openForgotPassword() {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal" style="max-width:380px;">
        <div class="modal-body">
          <h2 style="font-family:'Bebas Neue', sans-serif; font-size:22px; font-weight:400; letter-spacing:.5px; margin-bottom:14px;">Reset your password</h2>
          <form id="forgot-form">
            <input type="email" name="email" placeholder="Your account email" required style="width:100%; background:var(--surface-2); border:1px solid var(--border); border-radius:8px; padding:11px 12px; color:var(--text); font-size:14px; margin-bottom:10px;" />
            <button type="submit" class="btn btn-gold" style="width:100%; justify-content:center;">Send reset link</button>
          </form>
          <div class="auth-error" id="forgot-msg" style="margin-top:10px;"></div>
        </div>
      </div>
    </div>
  `;
  root.querySelector('.modal-backdrop').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-backdrop')) root.innerHTML = '';
  });
  document.getElementById('forgot-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = new FormData(e.target).get('email');
    const msgEl = document.getElementById('forgot-msg');
    try {
      const data = await api('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
      msgEl.style.color = 'var(--teal)';
      msgEl.textContent = data.message;
    } catch (err) {
      msgEl.style.color = 'var(--red)';
      msgEl.textContent = 'Something went wrong. Try again.';
    }
  });
}

async function toggleWatchlist(id, isOn, btnEl) {
  if (!state.user) {
    openAuthModal('login');
    return;
  }
  try {
    if (isOn) {
      await api(`/watchlist/${id}`, { method: 'DELETE' });
      showToast('Removed from watchlist');
    } else {
      await api('/watchlist', { method: 'POST', body: JSON.stringify({ titleId: id }) });
      showToast('Added to watchlist');
    }
    if (btnEl) btnEl.classList.toggle('on');
    if (state.route === 'watchlist') render();
  } catch (e) {
    showToast('Something went wrong');
  }
}

function posterCard(item) {
  const badge = item.premium ? `<div class="badge">PREMIUM</div>` : '';
  const subLine = item.type === 'series'
    ? `${item.seasons} season${item.seasons > 1 ? 's' : ''} · ${item.genre}`
    : `${item.year} · ${item.genre}`;
  return `
    <div class="card" data-id="${item.id}">
      <div class="poster" style="background:${gradient(item.palette)}"${item.poster_url ? ` data-poster="${cardPosterUrl(item.poster_url)}"` : ''}>
        ${badge}
        <div class="rating">${starIcon()}${item.rating.toFixed(1)}</div>
        <div class="watch-toggle ${item.in_watchlist ? 'on' : ''}" data-watch-id="${item.id}">
          ${item.in_watchlist ? checkIcon() : plusIcon()}
        </div>
        <div class="poster-label">${item.title}</div>
      </div>
      <div class="card-title">${item.title}</div>
      <div class="card-sub">${subLine}</div>
    </div>
  `;
}

function attachCardHandlers(container) {
  lazyLoadPosters(container);
  container.querySelectorAll('.watch-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!state.user) { openAuthModal('login'); return; }
      const id = btn.dataset.watchId;
      const isOn = btn.classList.contains('on');
      btn.innerHTML = isOn ? plusIcon() : checkIcon();
      toggleWatchlist(id, isOn, btn);
    });
  });
  container.querySelectorAll('.card').forEach(card => {
    card.addEventListener('click', () => openDetail(card.dataset.id));
  });
}

function isDirectFile(url) {
  if (!url) return false;
  const embed = getVideoEmbed(url);
  return embed && embed.type === 'video';
}

function downloadIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16"/></svg>`;
}

// ---------- Offline downloads (IndexedDB) ----------

const OFFLINE_DB_NAME = 'lumatostreaming-offline';
const OFFLINE_STORE = 'videos';
// In-progress downloads survive reloads and dropped connections: each job's
// state lives in PENDING_STORE and the bytes received so far are written to
// PARTS_STORE in PART_SIZE pieces, so a retry resumes with a Range request
// instead of starting over.
const PENDING_STORE = 'pending';
const PARTS_STORE = 'parts';
const PART_SIZE = 8 * 1024 * 1024;
const MAX_RETRIES = 10;

function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(OFFLINE_STORE)) {
        db.createObjectStore(OFFLINE_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(PENDING_STORE)) {
        db.createObjectStore(PENDING_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(PARTS_STORE)) {
        db.createObjectStore(PARTS_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Runs fn(store) in a transaction and resolves once it commits. onabort is
// needed as well as onerror: running out of storage aborts the transaction
// without an error event, which would otherwise leave the promise hanging.
async function offlineWrite(storeName, fn) {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Storage write aborted'));
  });
}

async function offlineRead(storeName, fn) {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(storeName, 'readonly').objectStore(storeName));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveOfflineVideo(key, blob, meta) {
  return offlineWrite(OFFLINE_STORE, (store) => store.put({ key, blob, ...meta, savedAt: Date.now() }));
}

async function getOfflineVideo(key) {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE, 'readonly');
    const req = tx.objectStore(OFFLINE_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function deleteOfflineVideo(key) {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE, 'readwrite');
    tx.objectStore(OFFLINE_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function listOfflineVideos() {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE, 'readonly');
    const req = tx.objectStore(OFFLINE_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function formatBytes(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return Math.round(mb) + ' MB';
  return (mb / 1024).toFixed(2) + ' GB';
}

const downloadControllers = new Map(); // key -> AbortController of the download currently running

function partId(key, index) {
  return `${key}#${index}`;
}

function getPendingDownload(key) {
  return offlineRead(PENDING_STORE, (store) => store.get(key)).then((job) => job || null);
}

function savePendingDownload(job) {
  return offlineWrite(PENDING_STORE, (store) => store.put(job));
}

function clearDownloadParts(job) {
  return offlineWrite(PARTS_STORE, (store) => {
    for (let i = 0; i < job.parts; i++) store.delete(partId(job.key, i));
  });
}

// Removes every trace of an unfinished download.
async function discardPendingDownload(key) {
  const job = await getPendingDownload(key);
  if (!job) return;
  await clearDownloadParts(job);
  await offlineWrite(PENDING_STORE, (store) => store.delete(key));
}

function setDownloadStatus(job, status, extra = {}) {
  const progress = job.total ? Math.min(100, Math.round((job.received / job.total) * 100)) : 0;
  activeDownloads.set(job.key, { title: job.meta.title, progress, status, ...extra });
}

function rerenderDownloads() {
  if (state.route === 'downloads') renderDownloadsPage();
}

// Keys of videos fully saved offline, kept in memory so every "Save offline"
// button can show its real state the moment it's drawn.
const savedOfflineKeys = new Set();
const savedOfflineReady = listOfflineVideos()
  .then((videos) => videos.forEach((v) => savedOfflineKeys.add(v.key)))
  .catch(() => {});

function offlineButtonState(key) {
  if (savedOfflineKeys.has(key)) return { cls: 'is-saved', html: `${checkIcon()} Downloaded` };
  const d = activeDownloads.get(key);
  if (d && d.status === 'failed') return { cls: 'is-paused', html: `${downloadIcon()} Paused – tap to resume` };
  if (d) return { cls: 'is-downloading', html: `${downloadIcon()} Downloading ${d.progress}%` };
  return { cls: '', html: `${downloadIcon()} Save offline` };
}

// HTML for a download button; `classes` are its base classes.
function offlineButtonHtml(key, classes, attrs = '') {
  const s = offlineButtonState(key);
  return `<div class="${classes} offline-btn ${s.cls}" data-key="${key}" ${attrs}>${s.html}</div>`;
}

// Redraws every visible download button for this video (a series' first
// episode can appear twice: the main button and its episode card).
function updateOfflineButtons(key) {
  const s = offlineButtonState(key);
  document.querySelectorAll(`.offline-btn[data-key="${key}"]`).forEach((btn) => {
    btn.classList.remove('is-saved', 'is-paused', 'is-downloading');
    if (s.cls) btn.classList.add(s.cls);
    btn.innerHTML = s.html;
  });
}

async function downloadForOffline(key, url, meta) {
  if (!url) { showToast('No video linked yet.'); return; }
  if (savedOfflineKeys.has(key)) { showToast('Already downloaded — find it on the Downloads page.'); return; }
  const existing = await getOfflineVideo(key).catch(() => null);
  if (existing) {
    savedOfflineKeys.add(key);
    updateOfflineButtons(key);
    showToast('Already downloaded — find it on the Downloads page.');
    return;
  }
  if (downloadControllers.has(key)) { showToast('Already downloading — check the Downloads page.'); return; }

  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }

  // An earlier attempt that failed or was cut off by a reload carries on
  // from where it stopped instead of starting over.
  const job = (await getPendingDownload(key).catch(() => null))
    || { key, url, meta, received: 0, total: 0, parts: 0, contentType: '' };
  showToast(job.received ? 'Resuming download — check the Downloads page.' : 'Download started — check the Downloads page for progress.');
  runDownload(job);
}

// Downloads whatever is still missing, waiting out dropped connections and
// retrying with backoff. Received bytes are already in storage, so a retry
// only asks the server for the rest.
async function runDownload(job) {
  const { key } = job;
  if (downloadControllers.has(key)) return;
  const controller = new AbortController();
  downloadControllers.set(key, controller);
  delete job.error;
  setDownloadStatus(job, 'downloading');
  updateOfflineButtons(key);
  rerenderDownloads();

  try {
    await savePendingDownload(job);
    let attempt = 0;
    while (true) {
      const receivedBefore = job.received;
      try {
        await fetchRemaining(job, controller.signal);
        break;
      } catch (err) {
        if (controller.signal.aborted || err.permanent) throw err;
        // Progress since the last try means the connection works on and off,
        // so the retry budget starts again rather than running out.
        attempt = job.received > receivedBefore ? 1 : attempt + 1;
        if (attempt > MAX_RETRIES) throw err;
        await waitBeforeRetry(job, attempt, controller.signal);
        setDownloadStatus(job, 'downloading');
        updateDownloadRow(key);
      }
    }
    await finishDownload(job);
    downloadControllers.delete(key);
    activeDownloads.delete(key);
    savedOfflineKeys.add(key);
    showToast(`Saved for offline viewing: ${job.meta.title}`);
  } catch (err) {
    downloadControllers.delete(key);
    if (controller.signal.aborted) {
      // Cancelled from the Downloads page.
      activeDownloads.delete(key);
      await discardPendingDownload(key).catch(() => {});
    } else {
      job.error = describeDownloadError(err);
      await savePendingDownload(job).catch(() => {});
      setDownloadStatus(job, 'failed', { error: job.error });
      showToast('Download paused — open Downloads to retry.');
    }
  }
  updateOfflineButtons(key);
  rerenderDownloads();
}

async function fetchRemaining(job, signal) {
  const headers = job.received ? { Range: `bytes=${job.received}-` } : {};
  const res = await fetch(job.url, { headers, signal });
  // 416 means there's nothing left past what we already have.
  if (res.status === 416 && job.total && job.received >= job.total) return;
  if (!res.ok || !res.body) {
    const err = new Error(`The video server responded with an error (${res.status}).`);
    // Other 4xx errors (missing file, no access) won't fix themselves on retry.
    err.permanent = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429;
    throw err;
  }

  const length = Number(res.headers.get('Content-Length')) || 0;
  if (res.status === 206) {
    if (!job.total && length) job.total = job.received + length;
  } else {
    // A full response: either the first attempt, or the server ignored the
    // Range header, in which case the saved pieces can't be reused.
    if (job.parts) {
      await clearDownloadParts(job);
      job.parts = 0;
      job.received = 0;
    }
    job.total = length;
  }
  if (!job.contentType) job.contentType = res.headers.get('Content-Type') || 'video/mp4';

  const reader = res.body.getReader();
  let buffer = [];
  let buffered = 0;
  const flush = async () => {
    if (!buffered) return;
    const blob = new Blob(buffer);
    await offlineWrite(PARTS_STORE, (store) => store.put({ id: partId(job.key, job.parts), blob }));
    job.parts += 1;
    job.received += buffered;
    buffer = [];
    buffered = 0;
    await savePendingDownload(job);
  };

  while (true) {
    const { done, value } = await reader.read(); // rejects when the connection drops
    if (done) break;
    buffer.push(value);
    buffered += value.length;
    if (buffered >= PART_SIZE) await flush();
    const pct = job.total ? Math.min(100, Math.round(((job.received + buffered) / job.total) * 100)) : 0;
    activeDownloads.set(job.key, { title: job.meta.title, progress: pct, status: 'downloading' });
    updateDownloadRow(job.key);
  }
  await flush();
  if (job.total && job.received < job.total) throw new Error('Connection closed before the download finished.');
}

async function waitBeforeRetry(job, attempt, signal) {
  let seconds = Math.min(30, 2 ** attempt);
  if (!navigator.onLine) {
    setDownloadStatus(job, 'waiting');
    updateDownloadRow(job.key);
    await new Promise((resolve) => {
      const done = () => {
        window.removeEventListener('online', done);
        signal.removeEventListener('abort', done);
        resolve();
      };
      window.addEventListener('online', done);
      signal.addEventListener('abort', done);
    });
    seconds = 2; // back online — give it a moment to settle, then go
  }
  while (seconds > 0 && !signal.aborted) {
    setDownloadStatus(job, 'retrying', { retryIn: seconds });
    updateDownloadRow(job.key);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    seconds--;
  }
  if (signal.aborted) throw new DOMException('Download cancelled', 'AbortError');
}

async function finishDownload(job) {
  const pieces = [];
  for (let i = 0; i < job.parts; i++) {
    const part = await offlineRead(PARTS_STORE, (store) => store.get(partId(job.key, i)));
    if (!part) {
      // The browser cleared some of the saved data; only a fresh start can fix it.
      await clearDownloadParts(job);
      Object.assign(job, { parts: 0, received: 0, total: 0 });
      throw Object.assign(new Error('Part of the saved download was lost. Retry to download it again.'), { permanent: true });
    }
    pieces.push(part.blob);
  }
  const blob = new Blob(pieces, { type: job.contentType || 'video/mp4' });
  // Store each subtitle's text with the video so it can play offline.
  // A subtitle that fails to fetch is skipped rather than failing the download.
  const subtitles = (await Promise.all((job.meta.subtitles || []).map(async (s) => {
    try {
      const r = await fetch(`${API}/subtitles/${s.id}`);
      return r.ok ? { label: s.label, lang_code: s.lang_code, vtt: await r.text() } : null;
    } catch { return null; }
  }))).filter(Boolean);
  await saveOfflineVideo(job.key, blob, { ...job.meta, subtitles });
  await discardPendingDownload(job.key);
}

function describeDownloadError(err) {
  if (err && err.name === 'QuotaExceededError') return 'Not enough storage space on this device.';
  if (err && err.permanent) return err.message;
  return 'The connection kept dropping.';
}

async function retryDownload(key) {
  const job = await getPendingDownload(key);
  if (job) runDownload(job);
}

async function cancelDownload(key) {
  const controller = downloadControllers.get(key);
  if (controller) {
    controller.abort(); // runDownload cleans up once the fetch stops
    return;
  }
  activeDownloads.delete(key);
  await discardPendingDownload(key);
  updateOfflineButtons(key);
  rerenderDownloads();
}

// Picks up downloads from an earlier visit: interrupted ones carry on by
// themselves, failed ones wait on the Downloads page for a retry.
async function resumePendingDownloads() {
  const jobs = await offlineRead(PENDING_STORE, (store) => store.getAll()).catch(() => []);
  for (const job of jobs) {
    if (job.error) setDownloadStatus(job, 'failed', { error: job.error });
    else runDownload(job);
  }
  if (jobs.length) rerenderDownloads();
}

function downloadStatusText(d) {
  if (d.status === 'waiting') return 'Waiting for connection…';
  if (d.status === 'retrying') return `Connection lost — retrying in ${d.retryIn}s`;
  if (d.status === 'failed') return `Paused at ${d.progress}%`;
  return d.progress + '%';
}

function updateDownloadRow(key) {
  const d = activeDownloads.get(key);
  if (!d) return;
  const bar = document.querySelector(`.download-progress-fill[data-key="${key}"]`);
  if (bar) bar.style.width = d.progress + '%';
  const label = document.querySelector(`.download-progress-label[data-key="${key}"]`);
  if (label) label.textContent = downloadStatusText(d);
  updateOfflineButtons(key);
}

function isDirectFile(url) {
  if (!url) return false;
  const embed = getVideoEmbed(url);
  return embed && embed.type === 'video';
}

function downloadIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16"/></svg>`;
}

// Episodes have no thumbnail images, so each card shows a frame from its own
// video instead: a still from ~10% in (skipping intros and black opening
// frames), with a muted clip playing on hover where hover exists. Videos only
// load once their card scrolls into view, so a long season doesn't fetch
// every episode at once.
let episodePreviewObserver = null;

function setupEpisodePreviews(root) {
  if (episodePreviewObserver) episodePreviewObserver.disconnect();
  const videos = root.querySelectorAll('.episode-card-preview');
  if (!videos.length) return;
  const canHover = window.matchMedia('(hover: hover)').matches;

  episodePreviewObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      observer.unobserve(entry.target);
      loadEpisodePreview(entry.target, canHover);
    });
  }, { rootMargin: '200px' });
  videos.forEach((video) => episodePreviewObserver.observe(video));
}

function loadEpisodePreview(video, canHover) {
  const thumb = video.closest('.episode-card-thumb');
  let previewTime = 0;
  video.addEventListener('loadedmetadata', () => {
    previewTime = Math.min(video.duration * 0.1, 120) || 0;
    video.currentTime = previewTime;
  }, { once: true });
  video.addEventListener('seeked', () => thumb.classList.add('has-preview'), { once: true });
  // Unplayable or unreachable video: keep the plain card.
  video.addEventListener('error', () => video.remove(), { once: true });
  video.preload = 'metadata';
  video.src = video.dataset.src;

  if (!canHover) return;
  thumb.addEventListener('mouseenter', () => {
    if (!thumb.classList.contains('has-preview')) return;
    video.play().catch(() => {});
  });
  thumb.addEventListener('mouseleave', () => {
    video.pause();
    video.currentTime = previewTime;
  });
}

async function openDetail(id) {
  const item = await api(`/titles/${id}`);
  const root = document.getElementById('modal-root');
  const meta = item.type === 'series'
    ? `<span class="tag">${item.seasons} season${item.seasons > 1 ? 's' : ''}</span><span class="tag">${item.genre}</span><span class="tag">${item.year}</span>`
    : `<span class="tag">${item.runtime}</span><span class="tag">${item.genre}</span><span class="tag">${item.year}</span>`;

    const episodes = item.type === 'series' ? await api(`/titles/${id}/episodes`) : [];
  const seasons = [...new Set(episodes.map(e => e.season_number))];
  await savedOfflineReady;

  const episodesHtml = episodes.length ? `
    <div class="modal-row" style="margin-top:20px; margin-bottom:8px;"><span class="label">Episodes</span></div>
    ${seasons.map(s => `
      <div class="episode-season-label">Season ${s}</div>
      <div class="row">
        ${episodes.filter(e => e.season_number === s).map(e => `
          <div class="episode-card">
            <div class="episode-card-thumb" data-ep-id="${e.id}" data-video="${e.video_url || ''}" data-title="${item.title} — S${e.season_number}E${e.episode_number}">
              ${isDirectFile(e.video_url) ? `<video class="episode-card-preview" data-src="${e.video_url}" muted playsinline preload="none"></video>` : ''}
              <div class="episode-card-num">E${e.episode_number}</div>
              <div class="episode-card-play">▶</div>
            </div>
            <div class="episode-card-name">${e.name}</div>
                      ${isDirectFile(e.video_url) ? `
              ${offlineButtonHtml(`episode-${e.id}`, 'episode-download-btn', `data-video="${e.video_url}" data-title="${item.title} — S${e.season_number}E${e.episode_number} — ${e.name}"`)}
            ` : ''}
          </div>
        `).join('')}
      </div>
    `).join('')}
  ` : '';

      const mainVideoUrl = episodes.length ? episodes[0].video_url : item.video_url;
  const mainOfflineKey = episodes.length ? `episode-${episodes[0].id}` : `title-${item.id}`;
  const showDownload = isDirectFile(mainVideoUrl);

  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-hero" style="background:${heroBackground(item)}">
          <div class="modal-close" id="modal-close">${closeIcon()}</div>
          <div class="modal-hero-title">${item.title}</div>
        </div>
        <div class="modal-body">
          <div class="modal-meta">${meta}${item.premium ? '<span class="tag" style="color:#241706;background:var(--gold)">PREMIUM</span>' : ''}</div>
          <div class="modal-desc">${item.description}</div>
          <div class="modal-row"><span class="label">Cast</span><span>${item.cast}</span></div>
          <div class="modal-row"><span class="label">${item.type === 'series' ? 'Creator' : 'Director'}</span><span>${item.director}</span></div>
          <div class="modal-row"><span class="label">Rating</span><span>${item.rating.toFixed(1)} / 10</span></div>
          <div class="modal-actions">
            <div class="btn btn-gold" id="modal-play">${episodes.length ? `Play S${episodes[0].season_number}E${episodes[0].episode_number}` : 'Play'}</div>
                        ${showDownload ? offlineButtonHtml(mainOfflineKey, 'btn btn-outline', 'id="modal-download"') : ''}
            <div class="btn btn-outline ${item.in_watchlist ? 'on' : ''}" id="modal-watch">
              ${item.in_watchlist ? 'In watchlist' : 'Add to watchlist'}
            </div>
          </div>
          ${episodesHtml}
        </div>
      </div>
    </div>
  `;
  document.getElementById('modal-close').onclick = () => root.innerHTML = '';
  root.querySelector('.modal-backdrop').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-backdrop')) root.innerHTML = '';
  });
  document.getElementById('modal-play').onclick = () => {
    if (episodes.length) openPlayer({ video_url: episodes[0].video_url, title: `${item.title} — S${episodes[0].season_number}E${episodes[0].episode_number}`, subtitles: episodes[0].subtitles });
    else openPlayer(item);
  };
   const downloadBtn = document.getElementById('modal-download');
  if (downloadBtn) {
    const mainSubtitles = episodes.length ? episodes[0].subtitles : item.subtitles;
    downloadBtn.onclick = () => downloadForOffline(mainOfflineKey, mainVideoUrl, { title: item.title, poster_url: item.poster_url, subtitles: mainSubtitles });
  }
  root.querySelectorAll('.episode-card-thumb').forEach(thumb => {
    thumb.addEventListener('click', () => {
      const ep = episodes.find(e => String(e.id) === thumb.dataset.epId);
      openPlayer({ video_url: thumb.dataset.video, title: thumb.dataset.title, subtitles: ep && ep.subtitles });
    });
  });
  setupEpisodePreviews(root);
    root.querySelectorAll('.episode-download-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ep = episodes.find(ep => `episode-${ep.id}` === btn.dataset.key);
      downloadForOffline(btn.dataset.key, btn.dataset.video, { title: btn.dataset.title, subtitles: ep && ep.subtitles });
    });
  });
  const watchBtn = document.getElementById('modal-watch');
  watchBtn.onclick = async () => {
    if (!state.user) { openAuthModal('login'); return; }
    const isOn = watchBtn.classList.contains('on');
    await toggleWatchlist(item.id, isOn);
    watchBtn.classList.toggle('on');
    watchBtn.textContent = isOn ? 'Add to watchlist' : 'In watchlist';
  };
}

let heroTimer = null;

// The full-width hero wants a landscape image: the TMDB backdrop when the
// title has one, otherwise the existing poster treatment.
function heroImage(item) {
  if (item.backdrop_url) {
    // Phones get TMDB's 780px backdrop instead of the stored 1280px one.
    const url = window.innerWidth < 860
      ? item.backdrop_url.replace('image.tmdb.org/t/p/w1280/', 'image.tmdb.org/t/p/w780/')
      : item.backdrop_url;
    return `url('${url}') center 25%/cover no-repeat, ${gradient(item.palette)}`;
  }
  return heroBackground(item);
}

// Plays a title straight from the hero: a movie's video, or a series' first
// episode. Falls back to the detail modal when there's nothing to play yet.
async function playTitle(id) {
  const item = await api(`/titles/${id}`);
  if (item.type === 'series') {
    const episodes = await api(`/titles/${id}/episodes`);
    const ep = episodes.find(e => e.video_url);
    if (!ep) return openDetail(id);
    return openPlayer({ video_url: ep.video_url, title: `${item.title} — S${ep.season_number}E${ep.episode_number}`, subtitles: ep.subtitles });
  }
  if (!item.video_url) return openDetail(id);
  openPlayer(item);
}

// topMovies / topSeries are the catalog sorted by rating, for the
// "#N in movies" badge.
function renderHero(featured, topMovies, topSeries) {
  const slot = document.getElementById('hero-slot');
  clearInterval(heroTimer);
  if (!featured.length) { slot.innerHTML = ''; return; }
  let idx = 0;
  function paint() {
    const item = featured[idx];
    const isSeries = item.type === 'series';
    const rank = (isSeries ? topSeries : topMovies).findIndex(t => t.id === item.id) + 1;
    const genres = (item.genre || '').split(/\s*[,/]\s*/).filter(Boolean);
    const meta = [
      item.rating ? `<span class="star">${starIcon()} ${Number(item.rating).toFixed(1)}</span>` : '',
      item.year,
      isSeries ? 'Series' : 'Movie',
      ...genres,
    ].filter(Boolean);
    const badges = [
      rank && rank <= 10 ? `<span class="badge-icon">TOP</span> #${rank} in ${isSeries ? 'shows' : 'movies'}` : '',
      item.premium ? `<span class="badge-icon">★</span> Premium` : '',
      isSeries && item.seasons ? `${item.seasons} season${item.seasons > 1 ? 's' : ''}` : (!isSeries && item.runtime ? item.runtime : ''),
    ].filter(Boolean).slice(0, 2);

    slot.innerHTML = `
      <div class="hero">
        <div class="hero-bg" style="background:${heroImage(item)}"></div>
        <div class="hero-content">
          <div class="hero-title">${item.title.toUpperCase()}</div>
          <div class="hero-meta">${meta.join('<span class="sep">·</span>')}</div>
          <div class="hero-desc">${item.description || ''}</div>
          <div class="hero-actions">
            <div class="hero-btn hero-btn-play" id="hero-play">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/></svg>
              Play
            </div>
            <div class="hero-btn hero-btn-info" id="hero-info">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>
              More info
            </div>
          </div>
        </div>
        ${badges.length ? `<div class="hero-badges">${badges.map(b => `<div class="hero-badge">${b}</div>`).join('')}</div>` : ''}
        ${featured.length > 1 ? `
          <div class="hero-dots">
            ${featured.map((_, i) => `<span class="${i === idx ? 'active' : ''}" data-i="${i}"></span>`).join('')}
          </div>
        ` : ''}
      </div>
    `;
    slot.querySelectorAll('.hero-dots span').forEach(dot => {
      dot.addEventListener('click', () => {
        idx = Number(dot.dataset.i);
        paint();
        resetTimer();
      });
    });
    document.getElementById('hero-play').onclick = () => playTitle(item.id);
    document.getElementById('hero-info').onclick = () => openDetail(item.id);
  }
  function advance() {
    idx = (idx + 1) % featured.length;
    paint();
  }
  function resetTimer() {
    clearInterval(heroTimer);
    if (featured.length > 1) heroTimer = setInterval(advance, 6000);
  }
  paint();
  resetTimer();
}

async function renderFilterBar() {
  const bar = document.getElementById('filter-bar');
  if (!state.genres.length) state.genres = await api('/genres');
  bar.hidden = false;
  bar.innerHTML = `<div class="chip ${state.genre === '' ? 'active' : ''}" data-genre="">All genres</div>` +
    state.genres.map(g => `<div class="chip ${state.genre === g ? 'active' : ''}" data-genre="${g}">${g}</div>`).join('');
  bar.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      state.genre = chip.dataset.genre;
      render();
    });
  });
}

async function renderDownloadsPage() {
  const heroSlot = document.getElementById('hero-slot');
  const filterBar = document.getElementById('filter-bar');
  const content = document.getElementById('content');
  heroSlot.innerHTML = '';
  filterBar.hidden = true;

  const saved = await listOfflineVideos();
  const inProgress = [...activeDownloads.entries()];

  if (!saved.length && !inProgress.length) {
    content.innerHTML = `
      <div class="section">
        <div class="section-head"><div class="section-title">Downloads</div></div>
        <div class="empty-state">Nothing saved for offline viewing yet. Open any title with a video and tap "Save offline."</div>
      </div>
    `;
    return;
  }

  const progressHtml = inProgress.length ? `
    <div class="section-head"><div class="section-title">Downloading</div></div>
    <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:24px;">
      ${inProgress.map(([key, d]) => `
        <div class="download-row" data-key="${key}">
          <div style="min-width:0; flex:1;">
            <div style="font-weight:600; font-size:14px; margin-bottom:8px;">${d.title}</div>
            <div class="download-progress-track">
              <div class="download-progress-fill${d.status === 'failed' ? ' paused' : ''}" data-key="${key}" style="width:${d.progress}%;"></div>
            </div>
            ${d.status === 'failed' ? `<div style="font-size:12px; color:var(--red); margin-top:6px;">${d.error}</div>` : ''}
          </div>
          <div class="download-progress-label" data-key="${key}" style="font-size:12px; color:var(--text-dim); flex-shrink:0;">${downloadStatusText(d)}</div>
          <div style="display:flex; gap:8px; flex-shrink:0;">
            ${d.status === 'failed' ? `<div class="btn btn-gold download-retry-btn" style="padding:8px 14px; font-size:12.5px;">Retry</div>` : ''}
            <div class="btn btn-outline download-cancel-btn" style="padding:8px 14px; font-size:12.5px; color:var(--red); border-color:var(--red);">${d.status === 'failed' ? 'Remove' : 'Cancel'}</div>
          </div>
        </div>
      `).join('')}
    </div>
  ` : '';

  content.innerHTML = `
    <div class="section">
      ${progressHtml}
      ${saved.length ? `
        <div class="section-head"><div class="section-title">Saved</div></div>
        <div style="display:flex; flex-direction:column; gap:10px;">
          ${saved.sort((a, b) => b.savedAt - a.savedAt).map(v => `
            <div class="download-row" data-key="${v.key}">
              <div style="min-width:0;">
                <div style="font-weight:600; font-size:14px;">${v.title}</div>
                <div style="font-size:12px; color:var(--text-dim); margin-top:2px;">${formatBytes(v.blob.size)} · saved ${new Date(v.savedAt).toLocaleDateString()}</div>
              </div>
              <div style="display:flex; gap:8px; flex-shrink:0;">
                <div class="btn btn-gold download-play-btn" style="padding:8px 14px; font-size:12.5px;">Play</div>
                <div class="btn btn-outline download-remove-btn" style="padding:8px 14px; font-size:12.5px; color:var(--red); border-color:var(--red);">Remove</div>
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;
  content.querySelectorAll('.download-play-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.download-row');
      const video = saved.find(v => v.key === row.dataset.key);
      openPlayer({ offlineKey: video.key });
    });
  });
  content.querySelectorAll('.download-retry-btn').forEach(btn => {
    btn.addEventListener('click', () => retryDownload(btn.closest('.download-row').dataset.key));
  });
  content.querySelectorAll('.download-cancel-btn').forEach(btn => {
    btn.addEventListener('click', () => cancelDownload(btn.closest('.download-row').dataset.key));
  });
  content.querySelectorAll('.download-remove-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.download-row');
      await deleteOfflineVideo(row.dataset.key);
      savedOfflineKeys.delete(row.dataset.key);
      showToast('Removed from downloads');
      renderDownloadsPage();
    });
  });
}
async function render() {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.route === state.route));
  // Slides the bottom nav's notch and bubble to the active tab.
  const bottomNav = document.getElementById('bottom-nav');
  const bottomIndex = [...bottomNav.querySelectorAll('.nav-item')].findIndex(n => n.dataset.route === state.route);
  if (bottomIndex >= 0) bottomNav.style.setProperty('--i', bottomIndex);
  const content = document.getElementById('content');
  const heroSlot = document.getElementById('hero-slot');
  const filterBar = document.getElementById('filter-bar');

  if (state.route !== 'home') clearInterval(heroTimer);

      if (state.route === 'downloads') {
    await renderDownloadsPage();
    return;
  }
  
  if (state.route === 'watchlist') {
    heroSlot.innerHTML = '';
    filterBar.hidden = true;
    if (!state.user) {
      content.innerHTML = `
        <div class="section">
          <div class="section-head"><div class="section-title">My watchlist</div></div>
          <div class="empty-state">Sign in to build a watchlist. <span class="auth-hint-link" id="watchlist-signin">Sign in</span></div>
        </div>
      `;
      document.getElementById('watchlist-signin').onclick = () => openAuthModal('login');
      return;
    }
    const items = await api('/watchlist');
    content.innerHTML = `
      <div class="section">
        <div class="section-head"><div class="section-title">My watchlist</div></div>
        ${items.length ? `<div class="grid">${items.map(posterCard).join('')}</div>` : `<div class="empty-state">Nothing saved yet. Tap the + on any title to add it.</div>`}
      </div>
    `;
    attachCardHandlers(content);
    return;
  }

  if (state.route === 'home') {
    filterBar.hidden = true;
    // The whole catalog is small, so the home page downloads it once and
    // builds every row from it, instead of one request per row and genre —
    // each request costs a full round trip to the server.
    const all = await api('/titles?sort=year');
    if (state.route !== 'home') return; // navigated away while loading
    const byRating = [...all].sort((a, b) => b.rating - a.rating);
    const movies = byRating.filter(t => t.type === 'movie');
    const series = byRating.filter(t => t.type === 'series');
    const newReleases = all;
    if (!state.genres.length) state.genres = [...new Set(all.map(t => t.genre).filter(Boolean))].sort();
    renderHero(all.filter(t => t.featured).sort((a, b) => a.id - b.id), movies, series);

    const genreSections = state.genres
      .map(g => ({ title: g, items: byRating.filter(t => t.genre === g).slice(0, 14) }))
      .filter(s => s.items.length > 0);

    const section = (title, items) => items.length ? `
      <div class="section">
        <div class="section-head"><div class="section-title">${title}</div></div>
        <div class="row">${items.map(posterCard).join('')}</div>
      </div>
    ` : '';

    content.innerHTML = [
      section('Popular movies', movies),
      section('Popular series', series),
      section('New releases', newReleases.slice(0, 14)),
      ...genreSections.map(s => section(s.title, s.items)),
    ].join('');
    attachCardHandlers(content);
    return;
  }

  if (state.route === 'search') {
    heroSlot.innerHTML = '';
    filterBar.hidden = true;
    const query = state.query;
    const items = await api(`/titles?q=${encodeURIComponent(query)}&sort=rating`);
    if (state.route !== 'search' || state.query !== query) return; // superseded by newer typing
    const shown = query.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    content.innerHTML = `
      <div class="section">
        <div class="section-head"><div class="section-title">Results for “${shown}”</div></div>
        ${items.length ? `<div class="grid">${items.map(posterCard).join('')}</div>` : `<div class="empty-state">No movies or shows match “${shown}”.</div>`}
      </div>
    `;
    attachCardHandlers(content);
    return;
  }

   if (state.route === 'Movie zilizotafsiriwa') {
    heroSlot.innerHTML = '';
    filterBar.hidden = true;
    const qs = new URLSearchParams();
    qs.set('genre', 'Movie zilizotafsiriwa');
    if (state.query) qs.set('q', state.query);
    const items = await api(`/titles?${qs.toString()}`);
    content.innerHTML = `
      <div class="section">
        <div class="section-head"><div class="section-title">MOVIE ZILIZOTAFSIRIWA</div></div>
        ${items.length ? `<div class="grid">${items.map(posterCard).join('')}</div>` : `<div class="empty-state">Hakuna filamu bado — no titles tagged Movie zilizotafsiriwa yet.</div>`}
      </div>
    `;
    attachCardHandlers(content);
    return;
  }
  
  // movie / series listing routes
  heroSlot.innerHTML = '';
  await renderFilterBar();
  const qs = new URLSearchParams();
  qs.set('type', state.route);
  if (state.genre) qs.set('genre', state.genre);
  if (state.query) qs.set('q', state.query);
  const items = await api(`/titles?${qs.toString()}`);
  content.innerHTML = `
    <div class="section">
      <div class="section-head"><div class="section-title">${state.route === 'movie' ? 'Movies' : 'TV shows'}</div></div>
      ${items.length ? `<div class="grid">${items.map(posterCard).join('')}</div>` : `<div class="empty-state">No titles match that search.</div>`}
    </div>
  `;
  attachCardHandlers(content);
}

document.querySelectorAll('.nav-item[data-route]').forEach(item => {
  item.addEventListener('click', () => {
    state.route = item.dataset.route;
    state.genre = '';
    render();
  });
});

document.querySelector('.topbar-logo').addEventListener('click', () => {
  state.route = 'home';
  state.genre = '';
  render();
});

// The top bar sits transparently over the hero and turns solid once content
// scrolls beneath it.
const topbar = document.getElementById('topbar');
const updateTopbar = () => topbar.classList.toggle('scrolled', window.scrollY > 40);
window.addEventListener('scroll', updateTopbar, { passive: true });
updateTopbar();

// Search collapses to an icon in the nav pill; it opens on click and stays
// open while it holds a query.
const searchBox = document.getElementById('search');
const searchInput = document.getElementById('search-input');
searchBox.addEventListener('click', () => {
  searchBox.classList.add('open');
  searchInput.focus();
});
searchInput.addEventListener('blur', () => {
  if (!searchInput.value) searchBox.classList.remove('open');
});

let searchTimer;
document.getElementById('search-input').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = e.target.value.trim();
    // From home, search everything (movies and shows); on the Movies or
    // Shows pages it narrows that page. Clearing it returns home.
    if (state.query && state.route === 'home') state.route = 'search';
    if (!state.query && state.route === 'search') state.route = 'home';
    render();
  }, 250);
});

// Sign-in state and page content load side by side; titles carry their
// watchlist flags from the session cookie either way.
refreshUser().then(() => { if (state.route === 'watchlist') render(); });
render();
resumePendingDownloads();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Non-fatal — the site works fine without the service worker,
      // it just won't be installable/offline-capable.
    });
  });
}
