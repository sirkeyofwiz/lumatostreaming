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
function posterBackground(item) {
  if (item.poster_url) return `url('${item.poster_url}') center/cover no-repeat, ${gradient(item.palette)}`;
  return gradient(item.palette);
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
function getVideoEmbed(url) {
  if (!url) return null;
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/);
  if (yt) return { type: 'iframe', src: `https://www.youtube.com/embed/${yt[1]}?autoplay=1` };
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return { type: 'iframe', src: `https://player.vimeo.com/video/${vimeo[1]}?autoplay=1` };
  return { type: 'video', src: url };
}

function openPlayer(item) {
  const embed = getVideoEmbed(item.video_url);
  if (!embed) {
    showToast('No video linked for this title yet.');
    return;
  }
  const root = document.getElementById('modal-root');
  const playerEl = embed.type === 'iframe'
    ? `<iframe src="${embed.src}" allow="autoplay; fullscreen" allowfullscreen style="position:absolute; inset:0; width:100%; height:100%; border:0;"></iframe>`
    : `<video src="${embed.src}" controls autoplay style="position:absolute; inset:0; width:100%; height:100%; background:#000;"></video>`;
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
  renderSidebarAdminLink();
}

function renderTopbar() {
  const el = document.getElementById('topbar-actions');
  if (state.user) {
    el.innerHTML = `
      <div class="user-chip">
        <div class="avatar">${state.user.username[0].toUpperCase()}</div>
        <span>${state.user.username}</span>
        ${state.user.is_admin ? '<span class="tag" style="color:#241706;background:var(--gold)">ADMIN</span>' : ''}
      </div>
      ${!state.user.email ? `<div class="auth-hint-link" id="add-email-link" style="font-size:12px;">Add recovery email</div>` : ''}
      <div class="btn btn-outline" id="logout-btn">Sign out</div>
    `;
    if (!state.user.email) {
      document.getElementById('add-email-link').onclick = () => openAddEmail();
    }
    document.getElementById('logout-btn').onclick = async () => {
      await api('/auth/logout', { method: 'POST' });
      state.user = null;
      renderTopbar();
      renderSidebarAdminLink();
      showToast('Signed out');
      if (state.route === 'watchlist') render();
    };
  } else {
    el.innerHTML = `<div class="btn btn-gold" id="signin-btn">Sign in</div>`;
    document.getElementById('signin-btn').onclick = () => openAuthModal('login');
  }
}

function renderSidebarAdminLink() {
  let link = document.getElementById('admin-nav-item');
  if (state.user && state.user.is_admin) {
    if (!link) {
      link = document.createElement('a');
      link.id = 'admin-nav-item';
      link.href = '/admin.html';
      link.className = 'nav-item';
      link.style.cursor = 'pointer';
      link.style.textDecoration = 'none';
      link.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v4H4zM4 10h10v4H4zM4 16h16v4H4z"/></svg>Admin panel`;
      link.addEventListener('click', (e) => {
        e.preventDefault();
        window.location.href = '/admin.html';
      });
      document.querySelector('.nav-divider').after(link);
    }
  } else if (link) {
    link.remove();
  }
}

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
      renderSidebarAdminLink();
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
      <div class="poster" style="background:${posterBackground(item)}">
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

async function openDetail(id) {
  const item = await api(`/titles/${id}`);
  const root = document.getElementById('modal-root');
  const meta = item.type === 'series'
    ? `<span class="tag">${item.seasons} season${item.seasons > 1 ? 's' : ''}</span><span class="tag">${item.genre}</span><span class="tag">${item.year}</span>`
    : `<span class="tag">${item.runtime}</span><span class="tag">${item.genre}</span><span class="tag">${item.year}</span>`;

  const episodes = item.type === 'series' ? await api(`/titles/${id}/episodes`) : [];
  const seasons = [...new Set(episodes.map(e => e.season_number))];

  const episodesHtml = episodes.length ? `
    <div class="modal-row" style="margin-top:20px; margin-bottom:8px;"><span class="label">Episodes</span></div>
    <div class="episode-list">
      ${seasons.map(s => `
        <div class="episode-season-label">Season ${s}</div>
        ${episodes.filter(e => e.season_number === s).map(e => `
          <div class="episode-row" data-video="${e.video_url || ''}">
            <div class="episode-play-icon">▶</div>
            <div style="min-width:0;">
              <div class="episode-name">S${e.season_number}E${e.episode_number} · ${e.name}</div>
              ${e.description ? `<div class="episode-desc">${e.description}</div>` : ''}
            </div>
          </div>
        `).join('')}
      `).join('')}
    </div>
  ` : '';

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
    if (episodes.length) openPlayer({ video_url: episodes[0].video_url, title: `${item.title} — S${episodes[0].season_number}E${episodes[0].episode_number}` });
    else openPlayer(item);
  };
  root.querySelectorAll('.episode-row').forEach(row => {
    row.addEventListener('click', () => {
      openPlayer({ video_url: row.dataset.video, title: item.title });
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

async function renderHero() {
  const slot = document.getElementById('hero-slot');
  clearInterval(heroTimer);
  const featured = await api('/titles/featured');
  if (!featured.length) { slot.innerHTML = ''; return; }
  let idx = 0;
  function paint() {
    const item = featured[idx];
    slot.innerHTML = `
      <div class="hero" style="background:${heroBackground(item)}">
        <div class="hero-content">
          <div class="hero-eyebrow">Featured today</div>
          <div class="hero-title">${item.title.toUpperCase()}</div>
          <div class="hero-meta">
            <span class="tag">${item.year}</span>
            <span class="tag">${item.genre}</span>
            <span class="tag">${item.type === 'series' ? (item.seasons + ' season' + (item.seasons > 1 ? 's' : '')) : item.runtime}</span>
          </div>
          <div class="hero-desc">${item.description}</div>
        </div>
        <div class="hero-dots">
          ${featured.map((_, i) => `<span class="${i === idx ? 'active' : ''}" data-i="${i}"></span>`).join('')}
        </div>
      </div>
    `;
    slot.querySelectorAll('.hero-dots span').forEach(dot => {
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        idx = Number(dot.dataset.i);
        paint();
        resetTimer();
      });
    });
    slot.querySelector('.hero').addEventListener('click', (e) => {
      if (!e.target.closest('.hero-dots')) openDetail(item.id);
    });
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

async function render() {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.route === state.route));
  const content = document.getElementById('content');
  const heroSlot = document.getElementById('hero-slot');
  const filterBar = document.getElementById('filter-bar');

  if (state.route !== 'home') clearInterval(heroTimer);

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
    renderHero();
    if (!state.genres.length) state.genres = await api('/genres');

    const [movies, series, newReleases, ...genreResults] = await Promise.all([
      api('/titles?type=movie&sort=rating'),
      api('/titles?type=series&sort=rating'),
      api('/titles?sort=year'),
      ...state.genres.map(g => api(`/titles?genre=${encodeURIComponent(g)}&sort=rating`)),
    ]);

    const genreSections = state.genres
      .map((g, i) => ({ title: g, items: genreResults[i].slice(0, 14) }))
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

let searchTimer;
document.getElementById('search-input').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = e.target.value.trim();
    if (state.query && state.route === 'home') state.route = 'movie';
    render();
  }, 250);
});

refreshUser().then(render);
