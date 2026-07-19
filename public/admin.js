const API = '/api';

async function api(path, opts) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error((data && data.error) || `Request failed: ${res.status}`);
  return data;
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 1800);
}

function closeIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
}

const GENRES = ['Action', 'Adventure', 'C-Drama', 'Comedy', 'Crime', 'Documentary', 'Donghua/Anime', 'Drama', 'Fantasy', 'Horror', 'K-Drama', 'Mystery', 'Romance', 'Sci-Fi', 'Thriller'];

let titles = [];

function row(t) {
  return `
    <tr data-id="${t.id}">
      <td>${t.title}</td>
      <td>${t.type}</td>
      <td>${t.year}</td>
      <td>${t.genre}</td>
      <td>${Number(t.rating).toFixed(1)}</td>
      <td><span class="pill ${t.premium ? 'pill-yes' : 'pill-no'}">${t.premium ? 'Yes' : 'No'}</span></td>
      <td><span class="pill ${t.featured ? 'pill-yes' : 'pill-no'}">${t.featured ? 'Yes' : 'No'}</span></td>
      <td class="row-actions">
        <div class="btn btn-outline" data-edit="${t.id}">Edit</div>
        <div class="btn btn-outline" data-delete="${t.id}" style="color:var(--red); border-color:var(--red);">Delete</div>
      </td>
    </tr>
  `;
}

function renderTable() {
  document.getElementById('admin-rows').innerHTML = titles.map(row).join('');
  document.querySelectorAll('[data-edit]').forEach(btn => {
    btn.onclick = () => openForm(titles.find(t => t.id === Number(btn.dataset.edit)));
  });
  document.querySelectorAll('[data-delete]').forEach(btn => {
    btn.onclick = () => deleteTitle(Number(btn.dataset.delete));
  });
}

async function loadTitles() {
  titles = await api('/admin/titles');
  renderTable();
}

async function deleteTitle(id) {
  const t = titles.find(x => x.id === id);
  if (!confirm(`Delete "${t.title}"? This can't be undone.`)) return;
  await api(`/admin/titles/${id}`, { method: 'DELETE' });
  showToast('Title deleted');
  loadTitles();
}

function openForm(existing, prefill) {
  const root = document.getElementById('modal-root');
  const t = existing || prefill || { type: 'movie', premium: 0, featured: 0, palette: 0, rating: 7.5, year: new Date().getFullYear() };
  const posterUrl = t.poster_url || t.posterUrl || null;
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal" style="max-width:560px;">
        <div class="modal-body">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
            <h2 style="font-family:'Bebas Neue', sans-serif; font-size:24px; font-weight:400; letter-spacing:.5px;">${existing ? 'Edit title' : prefill ? 'Review imported title' : 'Add title'}</h2>
            <div class="modal-close" id="form-close" style="position:static; background:var(--surface-2); color:var(--text);">${closeIcon()}</div>
          </div>
          <form id="title-form" class="admin-form">
            ${posterUrl ? `<img src="${posterUrl}" alt="" style="width:100px; border-radius:8px; align-self:flex-start; border:1px solid var(--border);" />` : ''}
            <div>
              <label>Title</label>
              <input name="title" value="${t.title || ''}" required />
            </div>
            <div class="admin-form-row">
              <div>
                <label>Type</label>
                <select name="type">
                  <option value="movie" ${t.type === 'movie' ? 'selected' : ''}>Movie</option>
                  <option value="series" ${t.type === 'series' ? 'selected' : ''}>Series</option>
                </select>
              </div>
              <div>
                <label>Year</label>
                <input name="year" type="number" value="${t.year || ''}" required />
              </div>
            </div>
            <div class="admin-form-row">
              <div>
                <label>Genre</label>
                <select name="genre">
                  ${GENRES.map(g => `<option value="${g}" ${t.genre === g ? 'selected' : ''}>${g}</option>`).join('')}
                </select>
              </div>
              <div>
                <label>Rating (0-10)</label>
                <input name="rating" type="number" step="0.1" min="0" max="10" value="${t.rating}" required />
              </div>
            </div>
            <div class="admin-form-row">
              <div>
                <label>Runtime (movies, e.g. 1h 52m)</label>
                <input name="runtime" value="${t.runtime || ''}" />
              </div>
              <div>
                <label>Seasons (series only)</label>
                <input name="seasons" type="number" value="${t.seasons || ''}" />
              </div>
            </div>
            <div>
              <label>Description</label>
              <textarea name="description">${t.description || ''}</textarea>
            </div>
            <div class="admin-form-row">
              <div>
                <label>Cast</label>
                <input name="cast" value="${t.cast || ''}" />
              </div>
              <div>
                <label>${t.type === 'series' ? 'Creator' : 'Director'}</label>
                <input name="director" value="${t.director || ''}" />
              </div>
            </div>
            <div>
              <label>Poster palette (0-7) — used only if there's no poster image above</label>
              <input name="palette" type="number" min="0" max="7" value="${t.palette ?? 0}" />
            </div>
            <input type="hidden" name="poster_url" value="${posterUrl || ''}" />
            <div style="display:flex; gap:20px;">
              <label class="admin-checkbox"><input type="checkbox" name="premium" ${t.premium ? 'checked' : ''}/> Premium</label>
              <label class="admin-checkbox"><input type="checkbox" name="featured" ${t.featured ? 'checked' : ''}/> Featured on homepage</label>
            </div>
            <div class="auth-error" id="form-error"></div>
            <button type="submit" class="btn btn-gold" style="justify-content:center; margin-top:6px;">
              ${existing ? 'Save changes' : 'Create title'}
            </button>
          </form>
        </div>
      </div>
    </div>
  `;
  root.querySelector('.modal-backdrop').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-backdrop')) root.innerHTML = '';
  });
  document.getElementById('form-close').onclick = () => root.innerHTML = '';

  document.getElementById('title-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      title: fd.get('title'),
      type: fd.get('type'),
      year: Number(fd.get('year')),
      genre: fd.get('genre'),
      rating: Number(fd.get('rating')),
      runtime: fd.get('runtime') || null,
      seasons: fd.get('seasons') ? Number(fd.get('seasons')) : null,
      description: fd.get('description'),
      cast: fd.get('cast'),
      director: fd.get('director'),
      palette: Number(fd.get('palette')) || 0,
      poster_url: fd.get('poster_url') || null,
      premium: fd.get('premium') === 'on',
      featured: fd.get('featured') === 'on',
    };
    const errEl = document.getElementById('form-error');
    try {
      if (existing) {
        await api(`/admin/titles/${existing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        showToast('Title updated');
      } else {
        await api('/admin/titles', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Title created');
      }
      root.innerHTML = '';
      loadTitles();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}

function openTmdbSearch() {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal" style="max-width:560px;">
        <div class="modal-body">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
            <h2 style="font-family:'Bebas Neue', sans-serif; font-size:24px; font-weight:400; letter-spacing:.5px;">Import from TMDB</h2>
            <div class="modal-close" id="tmdb-close" style="position:static; background:var(--surface-2); color:var(--text);">${closeIcon()}</div>
          </div>
          <div class="auth-tabs">
            <div class="auth-tab active" data-type="movie">Movies</div>
            <div class="auth-tab" data-type="series">TV Shows</div>
          </div>
          <input id="tmdb-query" placeholder="Search by title..." style="width:100%; background:var(--surface-2); border:1px solid var(--border); border-radius:8px; padding:10px 12px; color:var(--text); font-size:14px; margin-bottom:14px;" />
          <div id="tmdb-results" style="display:flex; flex-direction:column; gap:8px; max-height:50vh; overflow-y:auto;"></div>
          <div class="auth-error" id="tmdb-error"></div>
        </div>
      </div>
    </div>
  `;
  root.querySelector('.modal-backdrop').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-backdrop')) root.innerHTML = '';
  });
  document.getElementById('tmdb-close').onclick = () => root.innerHTML = '';

  let activeType = 'movie';
  root.querySelectorAll('.auth-tab').forEach(tab => {
    tab.onclick = () => {
      root.querySelectorAll('.auth-tab').forEach(x => x.classList.remove('active'));
      tab.classList.add('active');
      activeType = tab.dataset.type;
      runSearch();
    };
  });

  const resultsEl = document.getElementById('tmdb-results');
  const errEl = document.getElementById('tmdb-error');
  let searchTimer;

  async function runSearch() {
    const q = document.getElementById('tmdb-query').value.trim();
    errEl.textContent = '';
    if (!q) { resultsEl.innerHTML = ''; return; }
    resultsEl.innerHTML = `<div class="empty-state" style="padding:16px 0;">Searching...</div>`;
    try {
      const results = await api(`/admin/tmdb/search?q=${encodeURIComponent(q)}&type=${activeType}`);
      if (!results.length) {
        resultsEl.innerHTML = `<div class="empty-state" style="padding:16px 0;">No results.</div>`;
        return;
      }
      resultsEl.innerHTML = results.map(r => `
        <div class="tmdb-result" data-id="${r.tmdbId}" style="display:flex; gap:12px; padding:8px; border-radius:8px; cursor:pointer; align-items:center;">
          ${r.posterUrl ? `<img src="${r.posterUrl}" style="width:40px; height:60px; object-fit:cover; border-radius:4px; flex-shrink:0;" />` : `<div style="width:40px; height:60px; background:var(--surface-2); border-radius:4px; flex-shrink:0;"></div>`}
          <div style="min-width:0;">
            <div style="font-weight:600; font-size:13.5px;">${r.title}${r.year ? ` (${r.year})` : ''}</div>
            <div style="font-size:12px; color:var(--text-dim); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${r.overview || ''}</div>
          </div>
        </div>
      `).join('');
      resultsEl.querySelectorAll('.tmdb-result').forEach(el => {
        el.addEventListener('mouseenter', () => el.style.background = 'var(--surface)');
        el.addEventListener('mouseleave', () => el.style.background = 'transparent');
        el.addEventListener('click', () => importTitle(el.dataset.id));
      });
    } catch (err) {
      resultsEl.innerHTML = '';
      errEl.textContent = err.message;
    }
  }

  async function importTitle(tmdbId) {
    errEl.textContent = '';
    try {
      const data = await api(`/admin/tmdb/${activeType}/${tmdbId}`);
      openForm(null, data);
    } catch (err) {
      errEl.textContent = err.message;
    }
  }

  document.getElementById('tmdb-query').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 350);
  });
}

async function init() {
  const gate = document.getElementById('admin-gate');
  gate.hidden = false;
  let user;
  try {
    user = await api('/auth/me');
  } catch (e) {
    user = null;
  }
  if (!user || !user.is_admin) {
    gate.textContent = 'You need an admin account to view this page. Sign in with an admin account from the main site, then come back here.';
    return;
  }
  gate.hidden = true;
  document.getElementById('admin-content').hidden = false;
  document.getElementById('admin-user').innerHTML = `<span style="font-size:13px; color:var(--text-dim);">Signed in as <strong style="color:var(--text);">${user.username}</strong></span>`;
  document.getElementById('add-title-btn').onclick = () => openForm(null);
  document.getElementById('import-tmdb-btn').onclick = () => openTmdbSearch();
  await loadTitles();
}

init();
