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

const GENRES = ['Action', 'Adventure', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Fantasy', 'Horror', 'Mystery', 'Romance', 'Sci-Fi', 'Thriller'];

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

function openForm(existing) {
  const root = document.getElementById('modal-root');
  const t = existing || { type: 'movie', premium: 0, featured: 0, palette: 0, rating: 7.5, year: new Date().getFullYear() };
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal" style="max-width:560px;">
        <div class="modal-body">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
            <h2 style="font-family:'Bebas Neue', sans-serif; font-size:24px; font-weight:400; letter-spacing:.5px;">${existing ? 'Edit title' : 'Add title'}</h2>
            <div class="modal-close" id="form-close" style="position:static; background:var(--surface-2); color:var(--text);">${closeIcon()}</div>
          </div>
          <form id="title-form" class="admin-form">
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
              <label>Poster palette (0-7)</label>
              <input name="palette" type="number" min="0" max="7" value="${t.palette ?? 0}" />
            </div>
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
  await loadTitles();
}

init();
