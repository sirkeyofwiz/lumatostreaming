const API = '/api';
// Text from TMDB/AniList imports and the database is shown as text, never as
// HTML: esc() turns <, >, &, quotes into entities (also inside value="").
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function srtToVtt(srtText) {
  let vtt = srtText.replace(/\r+/g, '');
  vtt = vtt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return 'WEBVTT\n\n' + vtt.trim() + '\n';
}

function renderSubtitleList(subtitles) {
  if (!subtitles || !subtitles.length) return `<div style="font-size:12px; color:var(--text-dim);">No subtitles added yet.</div>`;
  return subtitles.map(s => `
    <div style="display:flex; align-items:center; justify-content:space-between; padding:6px 10px; background:var(--surface-2); border-radius:6px; margin-bottom:6px;">
      <span style="font-size:12.5px;">${esc(s.label)} (${esc(s.lang_code)})</span>
      <span class="subtitle-remove-btn" data-id="${s.id}" style="color:var(--red); font-size:11.5px; cursor:pointer;">Remove</span>
    </div>
  `).join('');
}

function wireSubtitleUpload(fileInputId, statusId, listId, endpoint, currentList) {
  document.getElementById(fileInputId).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const label = prompt('Label for this subtitle (e.g. "English"):');
    if (!label) return;
    const langCode = prompt('Language code (e.g. "en", "zh", "ko"):', 'en');
    if (!langCode) return;
    const statusEl = document.getElementById(statusId);
    statusEl.textContent = 'Uploading...';
    try {
      const text = await file.text();
      const vtt = file.name.toLowerCase().endsWith('.vtt') ? text : srtToVtt(text);
      const created = await api(endpoint, {
        method: 'POST',
        body: JSON.stringify({ label, lang_code: langCode, vtt_content: vtt }),
      });
      currentList.push(created);
      document.getElementById(listId).innerHTML = renderSubtitleList(currentList);
      wireSubtitleRemoveButtons(listId, currentList);
      statusEl.textContent = 'Added.';
      e.target.value = '';
    } catch (err) {
      statusEl.textContent = err.message;
    }
  });
}

function wireSubtitleRemoveButtons(listId, currentList) {
  document.querySelectorAll(`#${listId} .subtitle-remove-btn`).forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Remove this subtitle?')) return;
      await api(`/admin/subtitles/${btn.dataset.id}`, { method: 'DELETE' });
      const idx = currentList.findIndex(s => String(s.id) === btn.dataset.id);
      if (idx > -1) currentList.splice(idx, 1);
      document.getElementById(listId).innerHTML = renderSubtitleList(currentList);
      wireSubtitleRemoveButtons(listId, currentList);
    };
  });
}
async function api(path, opts) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error((data && data.error) || `Request failed: ${res.status}`);
  return data;
}

// Gets a presigned URL from our server, then PUTs the file directly to R2
// (not through our server — important for large video files). Returns the
// permanent public URL once upload completes.
async function uploadFile(file, kind, onProgress) {
  const presign = await api('/admin/uploads/presign', {
    method: 'POST',
    body: JSON.stringify({ filename: file.name, contentType: file.type, kind }),
  });
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', presign.uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300)
      ? resolve()
      : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error('Upload failed — network error.'));
    xhr.send(file);
  });
  return presign.publicUrl;
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

const GENRES = ['Action', 'Adventure', 'C-Drama', 'Comedy', 'Crime', 'Documentary', 'Donghua/Anime', 'Drama', 'Fantasy', 'Horror', 'K-Drama', 'Mystery', 'Romance', 'Sci-Fi', 'Movie zilizotafsiriwa', 'Thriller'];

let titles = [];

function row(t) {
  return `
    <tr data-id="${t.id}">
      <td>${esc(t.title)}</td>
      <td>${esc(t.type)}</td>
      <td>${t.year}</td>
      <td>${esc(t.genre)}</td>
      <td>${Number(t.rating).toFixed(1)}</td>
      <td><span class="pill ${t.premium ? 'pill-yes' : 'pill-no'}">${t.premium ? 'Yes' : 'No'}</span></td>
      <td><span class="pill ${t.featured ? 'pill-yes' : 'pill-no'}">${t.featured ? 'Yes' : 'No'}</span></td>
      <td class="row-actions">
        ${t.type === 'series' ? `<div class="btn btn-outline" data-episodes="${t.id}">Episodes</div>` : ''}
        <div class="btn btn-outline" data-edit="${t.id}">Edit</div>
        <div class="btn btn-outline" data-delete="${t.id}" style="color:var(--red); border-color:var(--red);">Delete</div>
      </td>
    </tr>
  `;
}

// Every word typed must appear somewhere in the title, genre, year or type,
// so "action 2024" narrows to 2024 action titles. Case is ignored.
function filteredTitles() {
  const words = document.getElementById('admin-search').value.toLowerCase().split(/\s+/).filter(Boolean);
  const type = document.getElementById('admin-type-filter').value;
  return titles.filter(t => {
    if (type && t.type !== type) return false;
    const haystack = `${t.title} ${t.genre} ${t.year} ${t.type}`.toLowerCase();
    return words.every(w => haystack.includes(w));
  });
}

function renderTable() {
  const shown = filteredTitles();
  const filtering = shown.length !== titles.length;
  document.getElementById('admin-count').textContent = filtering
    ? `${shown.length} of ${titles.length} titles`
    : `${titles.length} titles`;
  document.getElementById('admin-rows').innerHTML = shown.length
    ? shown.map(row).join('')
    : `<tr><td colspan="8" class="admin-empty">No titles match your search.</td></tr>`;
  document.querySelectorAll('[data-edit]').forEach(btn => {
    btn.onclick = () => openForm(titles.find(t => t.id === Number(btn.dataset.edit)));
  });
  document.querySelectorAll('[data-delete]').forEach(btn => {
    btn.onclick = () => deleteTitle(Number(btn.dataset.delete));
  });
  document.querySelectorAll('[data-episodes]').forEach(btn => {
    btn.onclick = () => openEpisodeManager(titles.find(t => t.id === Number(btn.dataset.episodes)));
  });
}

async function loadTitles() {
  titles = await api('/admin/titles');
  renderTable();
  // An edit or delete can change what's missing — keep those pages current.
  if (currentView === 'missing') renderMissing();
  if (currentView === 'dashboard') renderDashboard();
}

// The catalog without redrawing the table (for pages that only need lookups).
async function ensureTitles() {
  if (!titles.length) titles = await api('/admin/titles');
}

// The search stays applied when the table reloads after an edit or delete.
document.getElementById('admin-search').addEventListener('input', renderTable);
document.getElementById('admin-type-filter').addEventListener('change', renderTable);

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
  const backdropUrl = t.backdrop_url || t.backdropUrl || null;
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal" style="max-width:560px;">
        <div class="modal-body">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
            <h2 style="font-family:'Bebas Neue', sans-serif; font-size:24px; font-weight:400; letter-spacing:.5px;">${existing ? 'Edit title' : prefill ? 'Review imported title' : 'Add title'}</h2>
            <div class="modal-close" id="form-close" style="position:static; background:var(--surface-2); color:var(--text);">${closeIcon()}</div>
          </div>
          <form id="title-form" class="admin-form">
            ${posterUrl ? `<img src="${esc(posterUrl)}" alt="" style="width:100px; border-radius:8px; align-self:flex-start; border:1px solid var(--border);" />` : ''}
            <div>
              <label>Title</label>
              <input name="title" value="${esc(t.title)}" required />
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
                <input name="year" type="number" value="${esc(t.year)}" required />
              </div>
            </div>
            <div class="admin-form-row">
              <div>
                <label>Genre</label>
                <select name="genre">
                  ${GENRES.map(g => `<option value="${esc(g)}" ${t.genre === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}
                </select>
              </div>
              <div>
                <label>Rating (0-10)</label>
                <input name="rating" type="number" step="0.1" min="0" max="10" value="${esc(t.rating)}" required />
              </div>
            </div>
            <div class="admin-form-row">
              <div>
                <label>Runtime (movies, e.g. 1h 52m)</label>
                <input name="runtime" value="${esc(t.runtime)}" />
              </div>
              <div>
                <label>Seasons (series only)</label>
                <input name="seasons" type="number" value="${esc(t.seasons)}" />
              </div>
            </div>
            <div>
              <label>Description</label>
              <textarea name="description">${esc(t.description)}</textarea>
            </div>
            <div class="admin-form-row">
              <div>
                <label>Cast</label>
                <input name="cast" value="${esc(t.cast)}" />
              </div>
              <div>
                <label>${t.type === 'series' ? 'Creator' : 'Director'}</label>
                <input name="director" value="${esc(t.director)}" />
              </div>
            </div>
            <div>
              <label>Poster palette (0-7) — used only if there's no poster image above</label>
              <input name="palette" type="number" min="0" max="7" value="${t.palette ?? 0}" />
            </div>
            <div>
              <label>Poster image</label>
              <div style="display:flex; align-items:center; gap:10px;">
                <img id="poster-preview" src="${esc(posterUrl)}" style="width:44px; height:64px; object-fit:cover; border-radius:6px; background:var(--surface-2); ${posterUrl ? '' : 'display:none;'}" />
                <input type="file" id="poster-file-input" accept="image/*" style="flex:1;" />
              </div>
              <div id="poster-upload-status" style="font-size:11.5px; color:var(--text-dim); margin-top:4px;"></div>
              <input type="hidden" name="poster_url" id="poster-url-hidden" value="${esc(posterUrl)}" />
            </div>
            <input type="hidden" name="tmdb_id" value="${esc(t.tmdb_id || t.tmdbId)}" />
             <div>
              <label>Subtitles</label>
              <div id="title-subtitle-list">${renderSubtitleList(t.subtitles)}</div>
              ${existing ? `
                <input type="file" id="title-subtitle-file" accept=".srt,.vtt" style="margin-top:6px;" />
                <div id="title-subtitle-status" style="font-size:11.5px; color:var(--text-dim); margin-top:4px;"></div>
              ` : `<div style="font-size:11.5px; color:var(--text-dim);">Save the title first, then edit it again to add subtitles.</div>`}
            </div>
            <div>
              <label>Backdrop image URL (used for the homepage hero — wide image, different from the poster above)</label>
              <input name="backdrop_url" value="${esc(backdropUrl)}" placeholder="https://..." />
            </div>
            <div>
              <label>Video URL — YouTube/Vimeo link, or a direct link to a video file you host</label>
              <input name="video_url" id="video-url-input" value="${esc(t.video_url)}" placeholder="https://youtube.com/watch?v=... or https://.../file.mp4" />
              <div style="display:flex; align-items:center; gap:10px; margin-top:6px;">
                <span style="font-size:11.5px; color:var(--text-dim);">or upload a file:</span>
                <input type="file" id="video-file-input" accept="video/*" style="flex:1;" />
              </div>
              <div id="video-upload-status" style="font-size:11.5px; color:var(--text-dim); margin-top:4px;"></div>
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
    if (existing) {
    const subList = existing.subtitles || [];
    wireSubtitleUpload('title-subtitle-file', 'title-subtitle-status', 'title-subtitle-list', `/admin/titles/${existing.id}/subtitles`, subList);
    wireSubtitleRemoveButtons('title-subtitle-list', subList);
  }

  document.getElementById('poster-file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const statusEl = document.getElementById('poster-upload-status');
    statusEl.textContent = 'Uploading... 0%';
    try {
      const url = await uploadFile(file, 'poster', (pct) => statusEl.textContent = `Uploading... ${pct}%`);
      document.getElementById('poster-url-hidden').value = url;
      const preview = document.getElementById('poster-preview');
      preview.src = url;
      preview.style.display = '';
      statusEl.textContent = 'Uploaded.';
    } catch (err) {
      statusEl.textContent = err.message;
    }
  });

  document.getElementById('video-file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const statusEl = document.getElementById('video-upload-status');
    statusEl.textContent = 'Uploading... 0%';
    try {
      const url = await uploadFile(file, 'video', (pct) => statusEl.textContent = `Uploading... ${pct}%`);
      document.getElementById('video-url-input').value = url;
      statusEl.textContent = 'Uploaded — video URL filled in above.';
    } catch (err) {
      statusEl.textContent = err.message;
    }
  });

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
      tmdb_id: fd.get('tmdb_id') ? Number(fd.get('tmdb_id')) : null,
      backdrop_url: fd.get('backdrop_url') || null,
      video_url: fd.get('video_url') || null,
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
            <h2 style="font-family:'Bebas Neue', sans-serif; font-size:24px; font-weight:400; letter-spacing:.5px;">Import a title</h2>
            <div class="modal-close" id="tmdb-close" style="position:static; background:var(--surface-2); color:var(--text);">${closeIcon()}</div>
          </div>
          <div class="auth-tabs">
            <div class="auth-tab active" data-source="tmdb-movie">Movies</div>
            <div class="auth-tab" data-source="tmdb-series">TV Shows</div>
            <div class="auth-tab" data-source="anilist">Anime (AniList)</div>
          </div>
          <input id="tmdb-query" placeholder="Search by title..." style="width:100%; background:var(--surface-2); border:1px solid var(--border); border-radius:8px; padding:10px 12px; color:var(--text); font-size:14px; margin-bottom:14px;" />
          <div id="tmdb-results" style="display:flex; flex-direction:column; gap:8px; max-height:50vh; overflow-y:auto;"></div>
          <div class="auth-error" id="tmdb-error"></div>
          <p style="margin-top:14px; font-size:11px; color:var(--text-dim);">
            Movie/TV data from <a href="https://www.themoviedb.org" target="_blank" style="color:var(--text-dim);">TMDB</a>. Anime data from <a href="https://anilist.co" target="_blank" style="color:var(--text-dim);">AniList</a>.
          </p>
        </div>
      </div>
    </div>
  `;
  root.querySelector('.modal-backdrop').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-backdrop')) root.innerHTML = '';
  });
  document.getElementById('tmdb-close').onclick = () => root.innerHTML = '';

  let activeSource = 'tmdb-movie';
  root.querySelectorAll('.auth-tab').forEach(tab => {
    tab.onclick = () => {
      root.querySelectorAll('.auth-tab').forEach(x => x.classList.remove('active'));
      tab.classList.add('active');
      activeSource = tab.dataset.source;
      document.getElementById('tmdb-results').innerHTML = '';
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
      const results = activeSource === 'anilist'
        ? await api(`/admin/anilist/search?q=${encodeURIComponent(q)}`)
        : await api(`/admin/tmdb/search?q=${encodeURIComponent(q)}&type=${activeSource === 'tmdb-series' ? 'series' : 'movie'}`);
      const idKey = activeSource === 'anilist' ? 'anilistId' : 'tmdbId';
      if (!results.length) {
        resultsEl.innerHTML = `<div class="empty-state" style="padding:16px 0;">No results.</div>`;
        return;
      }
      resultsEl.innerHTML = results.map(r => `
        <div class="tmdb-result" data-id="${r[idKey]}" style="display:flex; gap:12px; padding:8px; border-radius:8px; cursor:pointer; align-items:center;">
          ${r.posterUrl ? `<img src="${esc(r.posterUrl)}" style="width:40px; height:60px; object-fit:cover; border-radius:4px; flex-shrink:0;" />` : `<div style="width:40px; height:60px; background:var(--surface-2); border-radius:4px; flex-shrink:0;"></div>`}
          <div style="min-width:0;">
            <div style="font-weight:600; font-size:13.5px;">${esc(r.title)}${r.year ? ` (${r.year})` : ''}</div>
            <div style="font-size:12px; color:var(--text-dim); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(r.overview)}</div>
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

  async function importTitle(id) {
    errEl.textContent = '';
    try {
      const data = activeSource === 'anilist'
        ? await api(`/admin/anilist/${id}`)
        : await api(`/admin/tmdb/${activeSource === 'tmdb-series' ? 'series' : 'movie'}/${id}`);
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

async function openEpisodeManager(title) {
  const root = document.getElementById('modal-root');
  let episodes = await api(`/titles/${title.id}/episodes`);

  function renderEpisodeList() {
    const seasons = [...new Set(episodes.map(e => e.season_number))].sort((a, b) => a - b);
    return episodes.length ? seasons.map(s => `
      <div style="font-size:11px; font-weight:700; color:var(--text-dim); text-transform:uppercase; letter-spacing:.5px; margin:14px 0 6px;">Season ${s}</div>
      ${episodes.filter(e => e.season_number === s).sort((a, b) => a.episode_number - b.episode_number).map(e => `
                <div style="display:flex; align-items:center; gap:10px; padding:8px; border-radius:8px; border:1px solid var(--border); margin-bottom:6px; flex-wrap:wrap;">
          <div style="flex:1; min-width:0;">
            <div style="font-size:13px; font-weight:600;">E${e.episode_number} · ${esc(e.name)}</div>
            <div style="font-size:11.5px; color:var(--text-dim); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(e.video_url || 'No video linked')}</div>
            <div style="margin-top:6px; display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
              ${(e.subtitles || []).map(s => `<span style="font-size:10.5px; background:var(--surface-2); padding:2px 8px; border-radius:10px;">${esc(s.label)} <span class="ep-sub-remove" data-sub-id="${s.id}" data-ep-id="${e.id}" style="color:var(--red); cursor:pointer; margin-left:4px;">×</span></span>`).join('')}
              <label style="font-size:10.5px; color:var(--teal); cursor:pointer;">
                + Subtitle
                <input type="file" accept=".srt,.vtt" class="ep-sub-file" data-ep-id="${e.id}" style="display:none;" />
              </label>
            </div>
          </div>
          <div class="btn btn-outline" style="padding:6px 10px; font-size:11.5px;" data-edit-ep="${e.id}">Edit</div>
          <div class="btn btn-outline" style="padding:6px 10px; font-size:11.5px; color:var(--red); border-color:var(--red);" data-delete-ep="${e.id}">Delete</div>
        </div>
      `).join('')}
    `).join('') : `<div class="empty-state" style="padding:20px 0;">No episodes added yet.</div>`;
  }

  function paint() {
    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal" style="max-width:560px;">
          <div class="modal-body">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <h2 style="font-family:'Bebas Neue', sans-serif; font-size:24px; font-weight:400; letter-spacing:.5px;">Episodes — ${esc(title.title)}</h2>
              <div class="modal-close" id="ep-close" style="position:static; background:var(--surface-2); color:var(--text);">${closeIcon()}</div>
            </div>
            <div id="ep-list" style="max-height:35vh; overflow-y:auto; margin-bottom:16px;">${renderEpisodeList()}</div>
            ${title.tmdb_id ? `
              <div style="display:flex; gap:8px; align-items:flex-end; margin-bottom:18px; padding:12px; background:var(--surface-2); border-radius:8px;">
                <div style="flex:1;">
                  <label style="font-size:11.5px; color:var(--text-dim); display:block; margin-bottom:5px;">Import season from TMDB (names only — you still add video links)</label>
                  <input id="tmdb-season-input" type="number" min="1" value="1" style="width:100%; background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:8px 10px; color:var(--text); font-size:13px;" />
                </div>
                <div class="btn btn-outline" id="tmdb-import-season-btn" style="padding:8px 14px; font-size:12.5px;">Import</div>
              </div>
            ` : ''}
            <div style="font-size:11px; font-weight:700; color:var(--text-dim); text-transform:uppercase; letter-spacing:.5px; margin-bottom:8px;">Add episode</div>
            <form id="ep-form" class="admin-form">
              <div class="admin-form-row">
                <div><label>Season</label><input name="season_number" type="number" min="1" value="1" required /></div>
                <div><label>Episode</label><input name="episode_number" type="number" min="1" required /></div>
              </div>
              <div><label>Name</label><input name="name" required /></div>
              <div>
                <label>Video URL</label>
                <input name="video_url" id="ep-video-url-input" placeholder="https://youtube.com/watch?v=... or direct file URL" />
                <div style="display:flex; align-items:center; gap:10px; margin-top:6px;">
                  <span style="font-size:11.5px; color:var(--text-dim);">or upload a file:</span>
                  <input type="file" id="ep-video-file-input" accept="video/*" style="flex:1;" />
                </div>
                <div id="ep-video-upload-status" style="font-size:11.5px; color:var(--text-dim); margin-top:4px;"></div>
              </div>
              <div><label>Description (optional)</label><input name="description" /></div>
              <div class="auth-error" id="ep-error"></div>
              <button type="submit" class="btn btn-gold" style="justify-content:center; margin-top:4px;">Add episode</button>
            </form>
          </div>
        </div>
      </div>
    `;
    if (title.tmdb_id) {
      document.getElementById('tmdb-import-season-btn').onclick = async () => {
        const seasonNum = Number(document.getElementById('tmdb-season-input').value) || 1;
        const btn = document.getElementById('tmdb-import-season-btn');
        btn.textContent = 'Importing...';
        try {
          const result = await api(`/admin/titles/${title.id}/episodes/import-tmdb`, {
            method: 'POST',
            body: JSON.stringify({ season_number: seasonNum }),
          });
          episodes = result.episodes;
          showToast(`Imported ${result.imported} episode(s)${result.skipped ? `, ${result.skipped} already existed` : ''}`);
          paint();
        } catch (err) {
          showToast(err.message);
          btn.textContent = 'Import';
        }
      };
    }
    root.querySelector('.modal-backdrop').addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-backdrop')) root.innerHTML = '';
    });
    document.getElementById('ep-close').onclick = () => root.innerHTML = '';

    document.getElementById('ep-video-file-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const statusEl = document.getElementById('ep-video-upload-status');
      statusEl.textContent = 'Uploading... 0%';
      try {
        const url = await uploadFile(file, 'video', (pct) => statusEl.textContent = `Uploading... ${pct}%`);
        document.getElementById('ep-video-url-input').value = url;
        statusEl.textContent = 'Uploaded — video URL filled in above.';
      } catch (err) {
        statusEl.textContent = err.message;
      }
    });

    document.querySelectorAll('[data-delete-ep]').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Delete this episode?')) return;
        await api(`/admin/episodes/${btn.dataset.deleteEp}`, { method: 'DELETE' });
        episodes = episodes.filter(e => e.id !== Number(btn.dataset.deleteEp));
        paint();
      };
    });
    document.querySelectorAll('[data-edit-ep]').forEach(btn => {
      btn.onclick = () => {
        const ep = episodes.find(e => e.id === Number(btn.dataset.editEp));
        const newVideoUrl = prompt('Video URL for this episode:', ep.video_url || '');
        if (newVideoUrl === null) return;
        api(`/admin/episodes/${ep.id}`, { method: 'PUT', body: JSON.stringify({ video_url: newVideoUrl }) })
          .then(updated => { ep.video_url = updated.video_url; paint(); showToast('Episode updated'); });
      };
    });
        document.querySelectorAll('.ep-sub-file').forEach(input => {
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const epId = input.dataset.epId;
        const label = prompt('Label for this subtitle (e.g. "English"):');
        if (!label) return;
        const langCode = prompt('Language code (e.g. "en", "zh", "ko"):', 'en');
        if (!langCode) return;
        try {
          const text = await file.text();
          const vtt = file.name.toLowerCase().endsWith('.vtt') ? text : srtToVtt(text);
          const created = await api(`/admin/episodes/${epId}/subtitles`, {
            method: 'POST',
            body: JSON.stringify({ label, lang_code: langCode, vtt_content: vtt }),
          });
          const ep = episodes.find(e => e.id === Number(epId));
          if (ep) { ep.subtitles = ep.subtitles || []; ep.subtitles.push(created); }
          paint();
          showToast('Subtitle added');
        } catch (err) {
          showToast(err.message);
        }
      };
    });
    document.querySelectorAll('.ep-sub-remove').forEach(el => {
      el.onclick = async () => {
        if (!confirm('Remove this subtitle?')) return;
        await api(`/admin/subtitles/${el.dataset.subId}`, { method: 'DELETE' });
        const ep = episodes.find(e => e.id === Number(el.dataset.epId));
        if (ep && ep.subtitles) ep.subtitles = ep.subtitles.filter(s => String(s.id) !== el.dataset.subId);
        paint();
      };
    });

    document.getElementById('ep-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errEl = document.getElementById('ep-error');
      try {
        const created = await api(`/admin/titles/${title.id}/episodes`, {
          method: 'POST',
          body: JSON.stringify({
            season_number: Number(fd.get('season_number')) || 1,
            episode_number: Number(fd.get('episode_number')),
            name: fd.get('name'),
            description: fd.get('description') || null,
            video_url: fd.get('video_url') || null,
          }),
        });
        episodes.push(created);
        showToast('Episode added');
        paint();
      } catch (err) {
        errEl.textContent = err.message;
      }
    });
  }

  paint();
}

// ---------- Sections: the sidebar switches between them via the address (#users etc.) ----------
const VIEWS = ['dashboard', 'analytics', 'catalog', 'missing', 'uploads', 'users', 'notifications', 'activity', 'health'];
let currentView = null;

function showView() {
  const hash = location.hash.slice(1);
  const view = VIEWS.includes(hash) ? hash : 'dashboard';
  currentView = view;
  document.querySelectorAll('.admin-view').forEach((s) => { s.hidden = s.dataset.view !== view; });
  document.querySelectorAll('.admin-nav[data-view]').forEach((a) => {
    const on = a.dataset.view === view;
    a.classList.toggle('is-active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
  if (view === 'dashboard') renderDashboard();
  if (view === 'catalog') loadTitles();
  if (view === 'missing') renderMissing();
  if (view === 'users') renderUsers();
  if (view === 'analytics') renderAnalytics();
  if (view === 'uploads') renderUploads();
  if (view === 'notifications') renderNotifications();
  if (view === 'activity') renderActivity();
  if (view === 'health') renderHealth();
}
window.addEventListener('hashchange', showView);

const fmtNum = (n) => Number(n || 0).toLocaleString();
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const plural = (n, one, many) => `${fmtNum(n)} ${n === 1 ? one : many}`;
const ICON_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/></svg>';
const ICON_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>';
const ICON_CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';

function updateBadges(stats) {
  const toFix = stats.episodesMissingVideo + stats.seriesWithoutEpisodes + stats.moviesMissingVideo;
  const missing = document.getElementById('nav-missing-count');
  missing.hidden = !toFix;
  missing.textContent = fmtNum(toFix);
  const usersBadge = document.getElementById('nav-users-count');
  usersBadge.hidden = false;
  usersBadge.textContent = fmtNum(stats.users);
}

// ---------- Dashboard ----------
async function renderDashboard() {
  document.getElementById('dash-date').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const body = document.getElementById('dash-body');
  let s;
  try { s = await api('/admin/stats'); } catch (e) {
    body.innerHTML = `<div class="admin-loading">Couldn't load the dashboard: ${esc(e.message)}</div>`;
    return;
  }
  if (currentView !== 'dashboard') return;
  updateBadges(s);
  const toFix = s.episodesMissingVideo + s.seriesWithoutEpisodes + s.moviesMissingVideo;
  const problems = [
    s.episodesMissingVideo ? `<strong>${plural(s.episodesMissingVideo, 'episode has', 'episodes have')} no video</strong>` : '',
    s.seriesWithoutEpisodes ? `${plural(s.seriesWithoutEpisodes, 'series has', 'series have')} no episodes yet` : '',
    s.moviesMissingVideo ? `${plural(s.moviesMissingVideo, 'movie has', 'movies have')} no video` : '',
  ].filter(Boolean);
  const alert = toFix
    ? `<a class="admin-alert" href="#missing">${ICON_WARN}<span class="admin-alert-text">${problems.join(', ')}. Viewers see these titles but can't play them.</span><span class="admin-alert-cta">Fix in Missing videos →</span></a>`
    : `<div class="admin-alert is-ok">${ICON_OK}<span class="admin-alert-text">Every title has a video. Nice work.</span></div>`;

  body.innerHTML = `
    ${alert}
    <div class="admin-stats">
      <a class="admin-stat" href="#users">
        <span class="admin-stat-label">Registered users</span>
        <span class="admin-stat-value">${fmtNum(s.users)}</span>
        <span class="admin-stat-note">${fmtNum(s.newUsers30d)} joined in the last 30 days</span>
      </a>
      <a class="admin-stat" href="#catalog">
        <span class="admin-stat-label">Catalog</span>
        <span class="admin-stat-value">${plural(s.titles, 'title', 'titles')}</span>
        <span class="admin-stat-note">${fmtNum(s.movies)} movies · ${fmtNum(s.series)} series · ${fmtNum(s.episodes)} episodes</span>
      </a>
      <a class="admin-stat" href="#missing">
        <span class="admin-stat-label">Episodes with no video</span>
        <span class="admin-stat-value ${s.episodesMissingVideo ? 'is-alert' : ''}">${fmtNum(s.episodesMissingVideo)}</span>
        <span class="admin-stat-note">of ${fmtNum(s.episodes)} · in ${plural(s.seriesWithMissing, 'series', 'series')}</span>
      </a>
      <a class="admin-stat" href="#missing">
        <span class="admin-stat-label">Series with no episodes</span>
        <span class="admin-stat-value ${s.seriesWithoutEpisodes ? 'is-gold' : ''}">${fmtNum(s.seriesWithoutEpisodes)}</span>
        <span class="admin-stat-note">of ${fmtNum(s.series)} series</span>
      </a>
    </div>
    <div class="admin-row">
      <section class="admin-card admin-grow-1">
        <h2>Quick actions</h2>
        <p class="admin-card-sub">The things you do most.</p>
        <div class="admin-quick">
          <button type="button" class="btn btn-gold" data-quick="add">Add title</button>
          <button type="button" class="btn btn-outline" data-quick="import">Import title</button>
          <a class="btn btn-outline" href="/bulk-upload.html">Bulk upload episodes</a>
          <a class="btn btn-outline" href="#users">Send a reset link</a>
        </div>
        ${s.usersWithoutEmail ? `<p class="admin-card-sub" style="margin:16px 0 0;"><span class="admin-warn-text">${plural(s.usersWithoutEmail, 'user has', 'users have')} no recovery email</span> — they can't reset a forgotten password themselves. You can send them a reset link from Users.</p>` : ''}
      </section>
      <section class="admin-card admin-grow-1" id="dash-week">
        <h2>Last 7 days</h2>
        <p class="admin-card-sub">Loading viewer activity…</p>
      </section>
    </div>
  `;
  // The week's activity fills in separately so the rest shows straight away.
  api(`/admin/analytics?days=7&tz=${new Date().getTimezoneOffset()}`).then((a) => {
    const box = document.getElementById('dash-week');
    if (!box) return;
    const t = a.totals;
    const empty = !t.visits && !t.plays && !t.searches;
    box.innerHTML = `
      <h2>Last 7 days</h2>
      <p class="admin-card-sub">${empty ? 'No viewer activity recorded yet — numbers appear as people use the site.' : 'Viewer activity on the site.'}</p>
      <div class="admin-mini-stats">
        <div><span class="admin-mini-value">${fmtNum(t.visitors)}</span><span class="admin-mini-label">visitors</span></div>
        <div><span class="admin-mini-value">${fmtNum(t.plays)}</span><span class="admin-mini-label">plays</span></div>
        <div><span class="admin-mini-value">${fmtNum(t.searches)}</span><span class="admin-mini-label">searches</span></div>
        <div><span class="admin-mini-value">${fmtNum(t.downloads)}</span><span class="admin-mini-label">downloads</span></div>
      </div>
      <a class="btn btn-outline" href="#analytics" style="margin-top:14px; display:inline-flex; text-decoration:none;">Open Analytics</a>`;
  }).catch(() => {});
  body.querySelector('[data-quick="add"]').onclick = () => { location.hash = '#catalog'; openForm(null); };
  body.querySelector('[data-quick="import"]').onclick = () => { location.hash = '#catalog'; openTmdbSearch(); };
}

// ---------- Missing videos ----------
async function renderMissing() {
  const body = document.getElementById('missing-body');
  let m;
  try {
    [m] = await Promise.all([api('/admin/missing'), ensureTitles()]);
  } catch (e) {
    body.innerHTML = `<div class="admin-loading">Couldn't load missing videos: ${esc(e.message)}</div>`;
    return;
  }
  if (currentView !== 'missing') return;
  const episodesMissing = m.seriesMissingEpisodes.reduce((a, s) => a + s.missing, 0);
  const episodesTotal = m.seriesMissingEpisodes.reduce((a, s) => a + s.total, 0);
  const nothing = !episodesMissing && !m.seriesWithoutEpisodes.length && !m.moviesWithoutVideo.length;
  if (nothing) {
    body.innerHTML = `<div class="admin-alert is-ok">${ICON_OK}<span class="admin-alert-text">Every title has a video. Nothing to upload right now.</span></div>`;
    return;
  }

  const seriesRows = m.seriesMissingEpisodes.map((s) => {
    const have = s.total - s.missing;
    const pct = s.total ? Math.round((have / s.total) * 100) : 0;
    return `
      <tr>
        <td><div style="font-weight:600;">${esc(s.title)}</div><div class="admin-muted" style="font-size:12px;">${esc(s.genre)} · ${plural(s.total, 'episode', 'episodes')}</div></td>
        <td><div class="admin-bar"><div class="admin-bar-track"><div class="admin-bar-fill" style="width:${pct}%"></div></div><span class="admin-bar-label">${fmtNum(have)} / ${fmtNum(s.total)}</span></div></td>
        <td class="admin-num-alert" style="text-align:right;">${fmtNum(s.missing)}</td>
        <td><div class="row-actions">
          <button type="button" class="btn btn-outline" data-episodes="${s.id}">Episodes</button>
          <a class="btn btn-gold" style="text-decoration:none;" href="/bulk-upload.html?series=${s.id}">Upload</a>
        </div></td>
      </tr>`;
  }).join('');

  body.innerHTML = `
    <div class="admin-stats">
      <div class="admin-stat"><span class="admin-stat-label">Episodes with no video</span><span class="admin-stat-value ${episodesMissing ? 'is-alert' : ''}">${fmtNum(episodesMissing)}</span><span class="admin-stat-note">in ${plural(m.seriesMissingEpisodes.length, 'series', 'series')}</span></div>
      <div class="admin-stat"><span class="admin-stat-label">Series with no episodes</span><span class="admin-stat-value ${m.seriesWithoutEpisodes.length ? 'is-gold' : ''}">${fmtNum(m.seriesWithoutEpisodes.length)}</span><span class="admin-stat-note">add or import their episode list</span></div>
      <div class="admin-stat"><span class="admin-stat-label">Movies with no video</span><span class="admin-stat-value">${fmtNum(m.moviesWithoutVideo.length)}</span><span class="admin-stat-note">add a video link or upload</span></div>
    </div>
    ${m.seriesMissingEpisodes.length ? `
    <section class="admin-card">
      <h2>Series missing episode videos</h2>
      <p class="admin-card-sub">Sorted by how many episodes still need a video (${fmtNum(episodesMissing)} of ${fmtNum(episodesTotal)} episodes in these series).</p>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>Series</th><th>Videos uploaded</th><th style="text-align:right;">Missing</th><th></th></tr></thead>
          <tbody>${seriesRows}</tbody>
        </table>
      </div>
    </section>` : ''}
    <div class="admin-row">
      ${m.seriesWithoutEpisodes.length ? `
      <section class="admin-card admin-grow-2">
        <h2>Series with no episodes (${fmtNum(m.seriesWithoutEpisodes.length)})</h2>
        <p class="admin-card-sub">Open one to add episodes, or import its episode list from TMDB, then upload the videos.</p>
        <div class="admin-pill-list">
          ${m.seriesWithoutEpisodes.map((s) => `<span class="admin-pill-item">${esc(s.title)} <button type="button" class="btn btn-outline" data-episodes="${s.id}">Episodes</button></span>`).join('')}
        </div>
      </section>` : ''}
      ${m.moviesWithoutVideo.length ? `
      <section class="admin-card admin-grow-1">
        <h2>Movies with no video (${fmtNum(m.moviesWithoutVideo.length)})</h2>
        <p class="admin-card-sub">Edit a movie to add its video.</p>
        <div class="admin-list">
          ${m.moviesWithoutVideo.map((t) => `<div class="admin-list-item"><span>${esc(t.title)}</span><button type="button" class="btn btn-outline" data-edit="${t.id}">Add video</button></div>`).join('')}
        </div>
      </section>` : ''}
    </div>
  `;
  body.querySelectorAll('[data-episodes]').forEach((btn) => {
    btn.onclick = () => {
      const t = titles.find((x) => x.id === Number(btn.dataset.episodes));
      if (t) openEpisodeManager(t);
    };
  });
  body.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.onclick = () => {
      const t = titles.find((x) => x.id === Number(btn.dataset.edit));
      if (t) openForm(t);
    };
  });
}

// ---------- Users ----------
let users = [];
let userFilter = 'all';

async function renderUsers() {
  try { users = await api('/admin/users'); } catch (e) {
    document.getElementById('users-rows').innerHTML = `<tr><td colspan="6" class="admin-empty">Couldn't load users: ${esc(e.message)}</td></tr>`;
    return;
  }
  const admins = users.filter((u) => u.is_admin).length;
  document.getElementById('users-sub').textContent = `${plural(users.length, 'account', 'accounts')} · ${plural(admins, 'admin', 'admins')}`;
  drawUsers();
}

function drawUsers() {
  const words = document.getElementById('users-search').value.toLowerCase().split(/\s+/).filter(Boolean);
  const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const shown = users.filter((u) => {
    if (userFilter === 'new' && !(u.created_at && new Date(u.created_at).getTime() >= monthAgo)) return false;
    if (userFilter === 'noemail' && u.email) return false;
    if (userFilter === 'admins' && !u.is_admin) return false;
    const hay = `${u.username} ${u.email || ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  document.getElementById('users-count').textContent = shown.length === users.length ? plural(users.length, 'user', 'users') : `${fmtNum(shown.length)} of ${fmtNum(users.length)} users`;
  document.getElementById('users-rows').innerHTML = shown.length ? shown.map((u) => `
    <tr>
      <td><div class="admin-userline"><div class="avatar">${esc(u.username[0].toUpperCase())}</div><span style="font-weight:600;">${esc(u.username)}</span></div></td>
      <td>${u.email ? `<span class="admin-muted">${esc(u.email)}</span>` : '<span class="admin-warn-text">No recovery email</span>'}</td>
      <td class="admin-muted">${fmtDate(u.created_at)}</td>
      <td class="admin-muted">${u.watchlist_count ? plural(u.watchlist_count, 'title', 'titles') : '—'}</td>
      <td><span class="admin-role ${u.is_admin ? 'is-owner' : ''}">${u.is_admin ? 'Admin' : 'Viewer'}</span></td>
      <td><div class="row-actions"><button type="button" class="btn btn-outline" data-reset="${u.id}">Send reset link</button></div></td>
    </tr>`).join('') : `<tr><td colspan="6" class="admin-empty">No users match.</td></tr>`;
  document.querySelectorAll('#users-rows [data-reset]').forEach((btn) => {
    btn.onclick = () => sendResetLink(users.find((u) => u.id === Number(btn.dataset.reset)), btn);
  });
}

document.getElementById('users-search').addEventListener('input', drawUsers);
document.querySelectorAll('[data-user-filter]').forEach((chip) => {
  chip.addEventListener('click', () => {
    userFilter = chip.dataset.userFilter;
    document.querySelectorAll('[data-user-filter]').forEach((c) => c.classList.toggle('is-on', c === chip));
    drawUsers();
  });
});

// Creates a one-hour reset link; it's emailed when the user has an address,
// and always shown here so you can send it yourself (e.g. on WhatsApp).
async function sendResetLink(user, btn) {
  if (!user) return;
  btn.disabled = true;
  btn.textContent = 'Creating…';
  let r;
  try {
    r = await api(`/admin/users/${user.id}/reset-link`, { method: 'POST' });
  } catch (e) {
    showToast(e.message);
    return;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send reset link';
  }
  const status = r.emailed
    ? `Emailed to <strong>${esc(user.email)}</strong>. You can also send the link yourself:`
    : r.hasEmail
      ? `<span class="admin-warn-text">The email couldn't be sent</span> (your email service may only deliver to its own account until your domain is verified). Send this link to <strong>${esc(user.username)}</strong> yourself:`
      : `<strong>${esc(user.username)}</strong> has no recovery email, so send this link to them yourself (WhatsApp, SMS…):`;
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal" style="max-width:520px;">
        <div class="modal-body">
          <h2 style="font-family:'Bebas Neue', sans-serif; font-size:26px; font-weight:400; letter-spacing:.5px; margin-bottom:10px;">Reset link for ${esc(user.username)}</h2>
          <p style="font-size:13.5px; line-height:1.55; color:var(--text);">${status}</p>
          <div class="admin-link-box">
            <input type="text" readonly value="${esc(r.link)}" aria-label="Reset link" id="reset-link-input" />
            <button type="button" class="btn btn-gold" id="reset-link-copy">Copy</button>
          </div>
          <p style="font-size:12.5px; color:var(--text-dim); margin-top:12px; line-height:1.5;">Works once and expires in 1 hour. Anyone with this link can set this account's password, so only send it to its owner.</p>
          <div style="display:flex; justify-content:flex-end; margin-top:16px;"><button type="button" class="btn btn-outline" id="reset-link-done">Done</button></div>
        </div>
      </div>
    </div>`;
  const close = () => { root.innerHTML = ''; };
  root.querySelector('.modal-backdrop').addEventListener('click', (e) => { if (e.target.classList.contains('modal-backdrop')) close(); });
  document.getElementById('reset-link-done').onclick = close;
  document.getElementById('reset-link-copy').onclick = async () => {
    const input = document.getElementById('reset-link-input');
    try { await navigator.clipboard.writeText(input.value); } catch { input.select(); document.execCommand('copy'); }
    showToast('Link copied');
  };
}

// ---------- Analytics ----------
let analyticsDays = 30;

// Change vs the previous period of the same length, e.g. "▲ 18%".
function delta(now, before) {
  if (!before) return now ? '<span class="admin-delta is-up">New</span>' : '';
  const pct = Math.round(((now - before) / before) * 100);
  if (!pct) return '<span class="admin-delta">No change</span>';
  return `<span class="admin-delta ${pct > 0 ? 'is-up' : 'is-down'}">${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}%</span>`;
}

// A two-line chart (visitors and plays per day) drawn as inline SVG.
function lineChart(daily) {
  const w = 640, h = 200, pad = 8;
  const max = Math.max(1, ...daily.map((d) => Math.max(d.visitors, d.plays)));
  const x = (i) => pad + (i * (w - 2 * pad)) / Math.max(1, daily.length - 1);
  const y = (v) => h - pad - (v / max) * (h - 2 * pad);
  const line = (key) => daily.map((d, i) => `${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ');
  const grid = [0.25, 0.5, 0.75].map((f) => `<line x1="0" x2="${w}" y1="${(h - pad - f * (h - 2 * pad)).toFixed(1)}" y2="${(h - pad - f * (h - 2 * pad)).toFixed(1)}" stroke="#20252D" />`).join('');
  const label = (d) => new Date(d.date + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const mid = daily[Math.floor(daily.length / 2)];
  return `
    <svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" role="img" aria-label="Visitors and plays per day">
      ${grid}
      <polyline fill="none" stroke="#5B8DEF" stroke-width="2.5" stroke-linejoin="round" points="${line('visitors')}" vector-effect="non-scaling-stroke" />
      <polyline fill="none" stroke="var(--gold)" stroke-width="2.5" stroke-linejoin="round" points="${line('plays')}" vector-effect="non-scaling-stroke" />
    </svg>
    <div class="admin-chart-axis"><span>${label(daily[0])}</span><span>${label(mid)}</span><span>${label(daily[daily.length - 1])}</span></div>
    <div class="admin-chart-max">Peak: ${fmtNum(max)} per day</div>`;
}

function barList(items, labelKey, valueKey, suffix = '') {
  const max = Math.max(1, ...items.map((i) => i[valueKey]));
  return items.map((i) => `
    <div class="admin-hbar">
      <div class="admin-hbar-top"><span>${esc(i[labelKey])}</span><span class="admin-muted">${fmtNum(i[valueKey])}${suffix}</span></div>
      <div class="admin-bar-track"><div class="admin-bar-fill is-gold" style="width:${Math.max(2, Math.round((i[valueKey] / max) * 100))}%"></div></div>
    </div>`).join('');
}

async function renderAnalytics() {
  const body = document.getElementById('analytics-body');
  let a;
  try { a = await api(`/admin/analytics?days=${analyticsDays}&tz=${new Date().getTimezoneOffset()}`); } catch (e) {
    body.innerHTML = `<div class="admin-loading">Couldn't load analytics: ${esc(e.message)}</div>`;
    return;
  }
  if (currentView !== 'analytics') return;
  const t = a.totals, p = a.previous;
  const nothing = !t.visits && !t.plays && !t.searches && !t.downloads && !t.signups;
  const notice = nothing
    ? `<div class="admin-alert is-info">${ICON_CLOCK}<span class="admin-alert-text">${a.trackingSince ? 'No activity in this period yet.' : '<strong>Tracking has started.</strong> Numbers appear here as people visit, search and watch — check back in a day or two.'}</span></div>`
    : '';
  const hoursMax = Math.max(1, ...a.hours);
  body.innerHTML = `
    ${notice}
    <div class="admin-stats">
      <div class="admin-stat"><span class="admin-stat-label">Visitors</span><span class="admin-stat-value">${fmtNum(t.visitors)}</span><span class="admin-stat-note">${fmtNum(t.visits)} visits ${delta(t.visitors, p.visitors)}</span></div>
      <div class="admin-stat"><span class="admin-stat-label">Plays</span><span class="admin-stat-value">${fmtNum(t.plays)}</span><span class="admin-stat-note">${t.completionRate == null ? 'no plays yet' : `${t.completionRate}% watched to the end`} ${delta(t.plays, p.plays)}</span></div>
      <div class="admin-stat"><span class="admin-stat-label">Searches</span><span class="admin-stat-value">${fmtNum(t.searches)}</span><span class="admin-stat-note">${fmtNum(t.noResultSearches)} found nothing</span></div>
      <div class="admin-stat"><span class="admin-stat-label">Downloads</span><span class="admin-stat-value">${fmtNum(t.downloads)}</span><span class="admin-stat-note">saved for offline ${delta(t.downloads, p.downloads)}</span></div>
      <div class="admin-stat"><span class="admin-stat-label">New sign-ups</span><span class="admin-stat-value">${fmtNum(t.signups)}</span><span class="admin-stat-note">${delta(t.signups, p.signups) || '&nbsp;'}</span></div>
      <div class="admin-stat"><span class="admin-stat-label">Failed plays</span><span class="admin-stat-value ${t.playErrors ? 'is-alert' : ''}">${fmtNum(t.playErrors)}</span><span class="admin-stat-note">videos that wouldn't load</span></div>
    </div>
    <div class="admin-row">
      <section class="admin-card admin-grow-2">
        <div class="admin-card-head"><h2>Visitors and plays per day</h2><div class="admin-legend"><span><i style="background:#5B8DEF"></i>Visitors</span><span><i style="background:var(--gold)"></i>Plays</span></div></div>
        ${lineChart(a.daily)}
      </section>
      <section class="admin-card admin-grow-1">
        <h2>Where visitors come from</h2>
        <p class="admin-card-sub">Share links with <code>?utm_source=…</code> to tell campaigns apart.</p>
        ${a.sources.length ? barList(a.sources, 'source', 'pct', '%') : '<p class="admin-muted" style="font-size:13px;">No visits recorded yet.</p>'}
      </section>
    </div>
    <section class="admin-card">
      <h2>Most-watched titles</h2>
      <p class="admin-card-sub">Plays in this period, and how many people watched to the end.</p>
      ${a.topTitles.length ? `
      <div class="admin-table-wrap"><table class="admin-table">
        <thead><tr><th>Title</th><th>Type</th><th style="text-align:right;">Opened</th><th style="text-align:right;">Plays</th><th>Watched to end</th></tr></thead>
        <tbody>${a.topTitles.map((r) => `
          <tr><td style="font-weight:600;">${esc(r.title)}</td><td class="admin-muted">${r.type === 'series' ? 'Series' : 'Movie'}</td><td style="text-align:right;">${fmtNum(r.opens)}</td><td style="text-align:right;">${fmtNum(r.plays)}</td>
          <td><div class="admin-bar"><div class="admin-bar-track"><div class="admin-bar-fill" style="width:${r.completionRate}%"></div></div><span class="admin-bar-label">${r.completionRate}%</span></div></td></tr>`).join('')}
        </tbody></table></div>` : '<p class="admin-muted" style="font-size:13px;">No plays recorded yet.</p>'}
    </section>
    <div class="admin-row">
      <section class="admin-card admin-grow-1">
        <h2>Searched, not found</h2>
        <p class="admin-card-sub">What viewers looked for that you don't have — your upload ideas.</p>
        ${a.noResultSearches.length ? `<div class="admin-list">${a.noResultSearches.map((s) => `<div class="admin-list-item"><span>${esc(s.query)}</span><span class="muted">${plural(s.count, 'search', 'searches')}</span></div>`).join('')}</div>` : '<p class="admin-muted" style="font-size:13px;">Nothing yet.</p>'}
      </section>
      <section class="admin-card admin-grow-1">
        <h2>Top searches</h2>
        <p class="admin-card-sub">What people search for most.</p>
        ${a.topSearches.length ? `<div class="admin-list">${a.topSearches.map((s) => `<div class="admin-list-item"><span>${esc(s.query)}</span><span class="muted">${plural(s.count, 'search', 'searches')}</span></div>`).join('')}</div>` : '<p class="admin-muted" style="font-size:13px;">Nothing yet.</p>'}
      </section>
    </div>
    <div class="admin-row">
      <section class="admin-card admin-grow-2">
        <h2>Busiest hours</h2>
        <p class="admin-card-sub">When people press play (your time zone) — a good time to post new episodes.</p>
        <div class="admin-hours" role="img" aria-label="Plays by hour of day">
          ${a.hours.map((n, h) => `<div class="admin-hour" title="${String(h).padStart(2, '0')}:00 — ${plural(n, 'play', 'plays')}"><div class="admin-hour-bar" style="height:${Math.round((n / hoursMax) * 100)}%"></div><span>${h % 6 === 0 ? String(h).padStart(2, '0') : ''}</span></div>`).join('')}
        </div>
      </section>
      <section class="admin-card admin-grow-1">
        <h2>Videos that failed to play</h2>
        <p class="admin-card-sub">Check these links in Catalog or Missing videos.</p>
        ${a.playErrors.length ? `<div class="admin-list">${a.playErrors.map((e) => `<div class="admin-list-item"><span>${esc(e.title)}${e.episodeId ? ' <span class="muted">(an episode)</span>' : ''}</span><span class="muted" style="color:#F08A80;">${plural(e.count, 'time', 'times')}</span></div>`).join('')}</div>` : '<p class="admin-muted" style="font-size:13px;">None — every play loaded.</p>'}
      </section>
    </div>`;
}

document.querySelectorAll('[data-range]').forEach((chip) => {
  chip.addEventListener('click', () => {
    analyticsDays = Number(chip.dataset.range);
    document.querySelectorAll('[data-range]').forEach((c) => c.classList.toggle('is-on', c === chip));
    renderAnalytics();
  });
});

// ---------- Activity log ----------
let activityItems = [];
let activityFilter = 'all';

// How each kind of change reads in the log, and which filter it belongs to.
const ACTIONS = {
  'title.create': ['added the title', 'content', 'gold'],
  'title.update': ['edited', 'content', 'blue'],
  'title.delete': ['deleted the title', 'content', 'red'],
  'episode.create': ['added the episode', 'content', 'gold'],
  'episode.update': ['edited the episode', 'content', 'blue'],
  'episode.delete': ['deleted the episode', 'content', 'red'],
  'episodes.import': ['imported episodes for', 'content', 'gold'],
  'subtitle.add': ['added subtitles to', 'content', 'blue'],
  'subtitle.delete': ['removed subtitles', 'content', 'red'],
  'video.set': ['uploaded a video for', 'uploads', 'teal'],
  'user.reset_link': ['created a reset link for', 'users', 'blue'],
  'user.signup': ['signed up', 'users', 'teal'],
  'notification.send': ['sent the notification', 'content', 'gold'],
  'notification.test': ['sent a test notification', 'content', 'blue'],
  'notification.auto': ['changed a setting:', 'content', 'blue'],
};

async function renderActivity() {
  try { activityItems = await api('/admin/activity?limit=200'); } catch (e) {
    document.getElementById('activity-body').innerHTML = `<div class="admin-loading">Couldn't load activity: ${esc(e.message)}</div>`;
    return;
  }
  drawActivity();
}

function timeAgo(d) {
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function drawActivity() {
  const body = document.getElementById('activity-body');
  const items = activityItems.filter((i) => activityFilter === 'all' || (ACTIONS[i.action] || [])[1] === activityFilter);
  if (!items.length) {
    body.innerHTML = `<div class="admin-card"><p class="admin-muted" style="font-size:14px;">Nothing here yet. Changes made in the admin panel from now on will appear in this log.</p></div>`;
    return;
  }
  // Group by day.
  const groups = new Map();
  for (const i of items) {
    const key = new Date(i.at).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }
  body.innerHTML = [...groups.entries()].map(([day, list]) => `
    <section class="admin-card">
      <h2 class="admin-feed-day">${esc(day)}</h2>
      <div class="admin-feed">
        ${list.map((i) => {
          const [verb, , color] = ACTIONS[i.action] || [i.action, '', 'blue'];
          const text = i.action === 'user.signup'
            ? `New user <strong>${esc(i.actor)}</strong> signed up`
            : `<strong>${esc(i.actor || 'An admin')}</strong> ${esc(verb)}${i.target ? ` <strong>${esc(i.target)}</strong>` : ''}${i.detail ? ` <span class="admin-muted">· ${esc(i.detail)}</span>` : ''}`;
          return `<div class="admin-feed-item"><span class="admin-feed-dot is-${color}"></span><span class="admin-feed-text">${text}</span><span class="admin-feed-time">${timeAgo(i.at)}</span></div>`;
        }).join('')}
      </div>
    </section>`).join('');
}

document.querySelectorAll('[data-activity-filter]').forEach((chip) => {
  chip.addEventListener('click', () => {
    activityFilter = chip.dataset.activityFilter;
    document.querySelectorAll('[data-activity-filter]').forEach((c) => c.classList.toggle('is-on', c === chip));
    drawActivity();
  });
});

// ---------- Uploads ----------
async function renderUploads() {
  const body = document.getElementById('uploads-body');
  let u;
  try { u = await api('/admin/uploads'); } catch (e) {
    body.innerHTML = `<div class="admin-loading">Couldn't load uploads: ${esc(e.message)}</div>`;
    return;
  }
  if (currentView !== 'uploads') return;
  const badge = document.getElementById('nav-uploads-failed');
  badge.hidden = !u.failed.length;
  badge.textContent = fmtNum(u.failed.length);
  body.innerHTML = `
    <div class="admin-stats">
      <div class="admin-stat"><span class="admin-stat-label">Videos added this week</span><span class="admin-stat-value">${fmtNum(u.thisWeek)}</span><span class="admin-stat-note">episodes and movies</span></div>
      <div class="admin-stat"><span class="admin-stat-label">Failed uploads this week</span><span class="admin-stat-value ${u.failed.length ? 'is-alert' : ''}">${fmtNum(u.failed.length)}</span><span class="admin-stat-note">${u.failed.length ? 'retry them in Bulk upload' : 'none'}</span></div>
      <a class="admin-stat" href="#missing"><span class="admin-stat-label">Still to upload</span><span class="admin-stat-value is-gold" id="uploads-todo">…</span><span class="admin-stat-note">see Missing videos</span></a>
    </div>
    <div class="admin-row">
      <section class="admin-card admin-grow-2">
        <h2>Recently added videos</h2>
        <p class="admin-card-sub">The latest 50 — from Bulk upload, the episode manager or the title form.</p>
        ${u.recent.length ? `<div class="admin-feed">${u.recent.map((r) => `
          <div class="admin-feed-item"><span class="admin-feed-dot is-teal"></span><span class="admin-feed-text"><strong>${esc(r.target || '')}</strong> <span class="admin-muted">· ${esc(r.detail || '')} by ${esc(r.actor || 'an admin')}</span></span><span class="admin-feed-time">${fmtDate(r.at)}</span></div>`).join('')}</div>`
          : '<p class="admin-muted" style="font-size:13px;">No uploads recorded yet — videos added from now on appear here.</p>'}
      </section>
      <section class="admin-card admin-grow-1">
        <h2>Failed uploads</h2>
        <p class="admin-card-sub">Files that didn't finish uploading in the last 7 days.</p>
        ${u.failed.length ? `<div class="admin-list">${u.failed.map((f) => `<div class="admin-list-item"><span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(f.file || 'Unknown file')}</span><span class="muted">${timeAgo(f.at)}</span></div>`).join('')}</div>` : '<p class="admin-muted" style="font-size:13px;">None.</p>'}
      </section>
    </div>`;
  api('/admin/stats').then((s) => {
    const el = document.getElementById('uploads-todo');
    if (el) el.textContent = fmtNum(s.episodesMissingVideo + s.moviesMissingVideo);
  }).catch(() => {});
}

// ---------- Notifications ----------
let pushData = null;
let pushTitle = null; // the title the message is about, with real watch numbers

// Ready-made messages. Each fills the title and message from the chosen
// title; they're starting points to edit, not fixed text.
const PUSH_IDEAS = [
  {
    key: 'trending', label: '🔥 Trending', needsTitle: true,
    make: (t) => {
      const n = t.watchers24h >= 3 ? t.watchers24h : t.watchers7d;
      const when = t.watchers24h >= 3 ? 'today' : 'this week';
      return {
        title: `🔥 ${t.title} is trending`,
        body: n >= 3 ? `${n} people watched it ${when}. Hop on before the spoilers find you!` : 'Everyone is talking about it. Hop on before the spoilers find you!',
      };
    },
  },
  {
    key: 'friends', label: '👀 Friends are watching', needsTitle: true,
    make: (t) => ({ title: `👀 Your friends are watching ${t.title}`, body: "Don't be the last one to know. Hop on and catch up tonight." }),
  },
  {
    key: 'cliffhanger', label: '🕵️ Cliffhanger teaser', needsTitle: true,
    make: (t) => {
      const ep = t.latest;
      return {
        title: `🕵️ ${t.title}: the truth is about to come out`,
        body: ep
          ? `In ${ep.name ? `"${ep.name}"` : `episode ${ep.episode_number}`}, a secret is about to be uncovered. Will you be there when it happens? Check it out.`
          : 'A secret is about to be uncovered. Will you be there when it happens? Check it out.',
      };
    },
  },
  {
    key: 'episode', label: '🎬 New episode', needsTitle: true,
    make: (t) => (t.latest
      ? { title: `🎬 New episode: ${t.title}`, body: `S${t.latest.season_number} E${t.latest.episode_number}${t.latest.name ? ` · ${t.latest.name}` : ''} is now streaming. Tap to watch.` }
      : { title: `🎬 Now streaming: ${t.title}`, body: 'Tap to start watching.' }),
  },
  {
    key: 'weekend', label: '🍿 Weekend pick', needsTitle: true,
    make: (t) => ({ title: `🍿 Your weekend pick: ${t.title}`, body: (t.description || 'Grab the popcorn, this one is worth it.').slice(0, 200) }),
  },
  {
    key: 'comeback', label: '⏯️ Come back', needsTitle: false,
    make: () => ({ title: '⏯️ Pick up where you left off', body: 'Your shows are waiting, and new episodes have landed since your last visit.' }),
  },
];

async function renderNotifications() {
  const body = document.getElementById('notifications-body');
  try { pushData = await api('/admin/notifications'); } catch (e) {
    body.innerHTML = `<div class="admin-loading">Couldn't load notifications: ${esc(e.message)}</div>`;
    return;
  }
  if (currentView !== 'notifications') return;
  await ensureTitles();
  if (currentView !== 'notifications') return;
  updatePushBadge(pushData.subscribers);
  syncPushSelfButton();

  const d = pushData;
  const manual = d.history.filter((h) => h.kind !== 'test');
  const delivered = manual.reduce((s, h) => s + h.delivered, 0);
  const opened = manual.reduce((s, h) => s + h.opened, 0);
  const month = manual.filter((h) => Date.now() - new Date(h.created_at).getTime() < 30 * 864e5).length;
  const playable = titles.slice().sort((a, b) => a.title.localeCompare(b.title));

  body.innerHTML = `
    <div class="admin-stats">
      <div class="admin-stat"><span class="admin-stat-label">Devices that allowed notifications</span><span class="admin-stat-value is-gold">${fmtNum(d.subscribers)}</span><span class="admin-stat-note">${d.devices.length ? d.devices.map((x) => `${esc(x.device)} ${fmtNum(x.count)}`).join(' · ') : 'none yet'}</span></div>
      <div class="admin-stat"><span class="admin-stat-label">Sent in the last 30 days</span><span class="admin-stat-value">${fmtNum(month)}</span><span class="admin-stat-note">messages, including automatic ones</span></div>
      <div class="admin-stat"><span class="admin-stat-label">Opened</span><span class="admin-stat-value">${delivered ? `${Math.round((opened / delivered) * 100)}%` : '—'}</span><span class="admin-stat-note">${fmtNum(opened)} taps from ${fmtNum(delivered)} delivered</span></div>
    </div>

    <div class="admin-row">
      <section class="admin-card admin-grow-2">
        <h2>Write a notification</h2>
        <p class="admin-card-sub">Goes to all ${plural(d.subscribers, 'device', 'devices')}. Pick a title to link it, then start from an idea or write your own.</p>
        <form id="push-form" class="admin-form push-form" autocomplete="off">
          <div>
            <label for="push-title-pick">About a title (optional, tapping the notification opens it)</label>
            <input id="push-title-pick" list="push-title-list" placeholder="Start typing a movie or series…" />
            <datalist id="push-title-list">${playable.map((t) => `<option value="${esc(t.title)} (${t.type === 'series' ? 'Series' : 'Movie'} · ${esc(t.year)})"></option>`).join('')}</datalist>
            <div id="push-title-facts" class="push-facts"></div>
          </div>
          <div>
            <label>Ideas</label>
            <div class="admin-chips push-ideas">${PUSH_IDEAS.map((i) => `<button type="button" class="admin-chip" data-idea="${i.key}">${esc(i.label)}</button>`).join('')}</div>
          </div>
          <div>
            <label for="push-heading">Title <span class="push-count" id="push-heading-count">0/80</span></label>
            <input id="push-heading" maxlength="80" placeholder="e.g. 🕵️ Wednesday is about to uncover the secret" required />
          </div>
          <div>
            <label for="push-body">Message <span class="push-count" id="push-body-count">0/240</span></label>
            <textarea id="push-body" maxlength="240" rows="3" placeholder="e.g. Who really killed Rowan? Find out tonight. Check it out." required></textarea>
          </div>
          <label class="admin-checkbox"><input type="checkbox" id="push-image" checked /> Show the title's picture (Android and computers)</label>
          <div class="push-actions">
            <button type="button" class="btn btn-outline" id="push-test">Send a test to my devices</button>
            <button type="submit" class="btn btn-gold" id="push-send" ${d.subscribers ? '' : 'disabled'}>Send to all ${plural(d.subscribers, 'device', 'devices')}</button>
          </div>
          <p class="admin-muted push-note" id="push-status"></p>
        </form>
      </section>
      <section class="admin-card admin-grow-1">
        <h2>Preview</h2>
        <p class="admin-card-sub">Roughly how it looks on a phone.</p>
        <div class="push-preview" id="push-preview"></div>
      </section>
    </div>

    <section class="admin-card">
      <div class="push-auto">
        <div>
          <h2>Announce new episodes and movies automatically</h2>
          <p class="admin-card-sub" style="margin:0;">When a video is added, everyone is told it's streaming. Uploads close together (like a whole season) wait 3 minutes and go out as one message.</p>
        </div>
        <button type="button" class="push-switch ${d.auto ? 'is-on' : ''}" id="push-auto" role="switch" aria-checked="${d.auto}" aria-label="Automatic notifications"><span></span></button>
      </div>
    </section>

    <section class="admin-card admin-table-wrap">
      <h2 style="padding:8px 0 4px;">Sent notifications</h2>
      ${d.history.length ? `<table class="admin-table">
        <thead><tr><th>When</th><th>Notification</th><th>Type</th><th>Delivered</th><th>Opened</th></tr></thead>
        <tbody>${d.history.map((h) => `<tr>
          <td style="white-space:nowrap;">${fmtDate(h.created_at)}<div class="admin-muted" style="font-size:12px;">${timeAgo(h.created_at)}</div></td>
          <td><strong>${esc(h.title)}</strong><div class="admin-muted" style="font-size:12.5px;">${esc(h.body)}</div></td>
          <td><span class="admin-tag">${h.kind === 'auto' ? 'Automatic' : h.kind === 'test' ? 'Test' : `By ${esc(h.created_by || 'admin')}`}</span></td>
          <td>${fmtNum(h.delivered)} <span class="admin-muted">of ${fmtNum(h.sent)}</span></td>
          <td>${fmtNum(h.opened)}</td>
        </tr>`).join('')}</tbody></table>`
        : '<p class="admin-muted" style="font-size:13px; padding-bottom:10px;">Nothing sent yet.</p>'}
    </section>`;

  wirePushForm(playable);
}

function wirePushForm(playable) {
  const pick = document.getElementById('push-title-pick');
  const heading = document.getElementById('push-heading');
  const text = document.getElementById('push-body');
  const imageBox = document.getElementById('push-image');
  const status = document.getElementById('push-status');
  const facts = document.getElementById('push-title-facts');

  const drawPreview = () => {
    document.getElementById('push-heading-count').textContent = `${heading.value.length}/80`;
    document.getElementById('push-body-count').textContent = `${text.value.length}/240`;
    const img = imageBox.checked && pushTitle && pushTitle.image;
    document.getElementById('push-preview').innerHTML = `
      <div class="push-mock">
        <div class="push-mock-top"><img src="/icons/icon-192.png" alt="" /><span>LumatoStreaming</span><span class="admin-muted">· now</span></div>
        <div class="push-mock-title">${esc(heading.value || 'Your title appears here')}</div>
        <div class="push-mock-body">${esc(text.value || 'And your message here.')}</div>
        ${img ? `<img class="push-mock-image" src="${esc(img)}" alt="" />` : ''}
      </div>
      <p class="admin-muted" style="font-size:12px; margin-top:10px;">Tapping it opens ${pushTitle ? `<strong>${esc(pushTitle.title)}</strong> in the player` : 'the home page'}.</p>`;
  };

  pick.addEventListener('change', async () => {
    const t = playable.find((x) => `${x.title} (${x.type === 'series' ? 'Series' : 'Movie'} · ${x.year})` === pick.value);
    pushTitle = null;
    facts.innerHTML = '';
    if (t) {
      try {
        pushTitle = await api(`/admin/notifications/title/${t.id}`);
        facts.innerHTML = `
          <span class="admin-tag">👀 ${plural(pushTitle.watchers24h, 'viewer', 'viewers')} today</span>
          <span class="admin-tag">${plural(pushTitle.watchers7d, 'viewer', 'viewers')} this week</span>
          ${pushTitle.latest ? `<span class="admin-tag">Latest: S${pushTitle.latest.season_number} E${pushTitle.latest.episode_number}${pushTitle.latest.name ? ` · ${esc(pushTitle.latest.name)}` : ''}</span>` : ''}`;
      } catch (e) { showToast(e.message); }
    }
    drawPreview();
  });

  document.querySelectorAll('[data-idea]').forEach((chip) => {
    chip.onclick = () => {
      const idea = PUSH_IDEAS.find((i) => i.key === chip.dataset.idea);
      if (idea.needsTitle && !pushTitle) { showToast('Pick a title first, then choose this idea.'); pick.focus(); return; }
      const made = idea.make(pushTitle || {});
      heading.value = made.title.slice(0, 80);
      text.value = made.body.slice(0, 240);
      drawPreview();
    };
  });
  heading.oninput = drawPreview;
  text.oninput = drawPreview;
  imageBox.onchange = drawPreview;
  drawPreview();

  const sendIt = async (test) => {
    if (!heading.value.trim() || !text.value.trim()) { showToast('Write a title and a message first.'); return; }
    if (!test && !confirm(`Send this to all ${pushData.subscribers} devices now? This can't be undone.`)) return;
    const btns = document.querySelectorAll('#push-test, #push-send');
    btns.forEach((b) => { b.disabled = true; });
    status.textContent = test ? 'Sending a test…' : 'Sending…';
    try {
      const r = await api('/admin/notifications', {
        method: 'POST',
        body: JSON.stringify({ title: heading.value, body: text.value, title_id: pushTitle ? pushTitle.id : null, image: imageBox.checked, test }),
      });
      if (test && !r.sent) {
        status.textContent = 'This account has no devices with notifications on yet. Use "Get notifications on this device" above (or allow them on the main site while signed in), then test again.';
      } else {
        status.textContent = '';
        showToast(test ? `Test sent to ${plural(r.delivered, 'device', 'devices')}` : `Sent to ${plural(r.delivered, 'device', 'devices')}`);
        if (!test) renderNotifications();
      }
    } catch (e) {
      status.textContent = `Couldn't send: ${e.message}`;
    }
    btns.forEach((b) => { b.disabled = false; });
    if (!pushData.subscribers) document.getElementById('push-send').disabled = true;
  };
  document.getElementById('push-test').onclick = () => sendIt(true);
  document.getElementById('push-form').onsubmit = (e) => { e.preventDefault(); sendIt(false); };

  document.getElementById('push-auto').onclick = async (e) => {
    const btn = e.currentTarget;
    const on = !btn.classList.contains('is-on');
    try {
      await api('/admin/notifications/settings', { method: 'PUT', body: JSON.stringify({ auto: on }) });
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-checked', String(on));
      showToast(on ? 'New videos will be announced automatically' : 'Automatic announcements are off');
    } catch (err) { showToast(err.message); }
  };
}

function updatePushBadge(n) {
  const badge = document.getElementById('nav-push-count');
  badge.hidden = !n;
  badge.textContent = fmtNum(n);
}

// Lets the admin receive notifications on this device, so tests reach them.
function urlBase64ToUint8Array(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
async function syncPushSelfButton() {
  const btn = document.getElementById('push-self-btn');
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { btn.hidden = true; return; }
  const reg = await navigator.serviceWorker.register('/sw.js').catch(() => null);
  const sub = reg && await reg.pushManager.getSubscription().catch(() => null);
  btn.hidden = !!(sub && Notification.permission === 'granted');
  btn.onclick = async () => {
    try {
      if (await Notification.requestPermission() !== 'granted') { showToast('Notifications are blocked in this browser\'s settings.'); return; }
      const { publicKey } = await api('/push/key');
      const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      await api('/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: s.toJSON() }) });
      showToast('Notifications are on for this device');
      renderNotifications();
    } catch (e) { showToast(`Couldn't turn on notifications: ${e.message}`); }
  };
}

// ---------- System health ----------
function fmtBytes(b) {
  if (b == null) return 'Unknown';
  if (b < 1048576) return `${Math.round(b / 1024)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
}
function fmtUptime(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
}

async function renderHealth() {
  const body = document.getElementById('health-body');
  let h;
  const t0 = performance.now();
  try { h = await api('/admin/health'); } catch (e) {
    body.innerHTML = `<div class="admin-alert">${ICON_WARN}<span class="admin-alert-text"><strong>The server didn't answer.</strong> ${esc(e.message)}</span></div>`;
    return;
  }
  const roundTrip = Math.round(performance.now() - t0);
  if (currentView !== 'health') return;
  const problems = [];
  if (!h.database.ok) problems.push('the database is not responding');
  if (h.errors.server24h) problems.push(`${plural(h.errors.server24h, 'server error', 'server errors')} in the last 24 hours`);
  if (h.errors.playback24h) problems.push(`${plural(h.errors.playback24h, 'video', 'videos')} failed to play in the last 24 hours`);
  if (!h.storage.videoUploads) problems.push('video uploads are not set up');
  document.getElementById('nav-health-dot').hidden = !problems.length;
  document.getElementById('health-sub').textContent = `Checked ${new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  const card = (ok, label, value, note) => `
    <div class="admin-stat"><span class="admin-stat-label"><span class="admin-status-dot ${ok === true ? 'is-ok' : ok === false ? 'is-bad' : 'is-warn'}"></span>${label}</span><span class="admin-stat-value admin-stat-value-sm">${value}</span><span class="admin-stat-note">${note}</span></div>`;
  body.innerHTML = `
    ${problems.length
      ? `<div class="admin-alert">${ICON_WARN}<span class="admin-alert-text"><strong>Needs attention:</strong> ${problems.join('; ')}.</span></div>`
      : `<div class="admin-alert is-ok">${ICON_OK}<span class="admin-alert-text">Everything is running normally.</span></div>`}
    <div class="admin-stats">
      ${card(true, 'Website', 'Online', `up for ${fmtUptime(h.server.uptimeSec)} · answered in ${roundTrip} ms`)}
      ${card(h.database.ok, 'Database', h.database.ok ? 'Healthy' : 'Not responding', h.database.ok ? `${fmtBytes(h.database.sizeBytes)} · ${h.database.latencyMs} ms check` : esc(h.database.error || ''))}
      ${card(h.storage.videoUploads, 'Video storage', h.storage.videoUploads ? 'Connected' : 'Not set up', h.storage.videoUploads ? 'uploads go to Cloudflare R2' : 'add the R2 settings in Railway')}
      ${card(h.storage.email ? (h.storage.emailFromOwnDomain ? true : null) : false, 'Email', h.storage.email ? (h.storage.emailFromOwnDomain ? 'Ready' : 'Limited') : 'Not set up', h.storage.email ? (h.storage.emailFromOwnDomain ? 'reset emails reach everyone' : 'reset emails only reach the Resend account owner until your domain is verified') : 'reset emails can\'t be sent')}
      ${card(!h.errors.server24h, 'Server errors (24 h)', fmtNum(h.errors.server24h || 0), h.errors.server24h ? 'details below' : 'none')}
      ${card(!h.errors.playback24h, 'Failed plays (24 h)', fmtNum(h.errors.playback24h || 0), h.errors.playback24h ? 'see Analytics for which videos' : 'none')}
    </div>
    <div class="admin-row">
      <section class="admin-card admin-grow-2">
        <h2>Recent server errors</h2>
        <p class="admin-card-sub">Since the server last started.</p>
        ${h.errors.recent.length ? `<div class="admin-list">${h.errors.recent.map((e) => `<div class="admin-list-item" style="align-items:flex-start;"><span><strong>${esc(e.method)} ${esc(e.path)}</strong><br><span class="muted">${esc(e.message)}</span></span><span class="muted" style="white-space:nowrap;">${timeAgo(e.at)}</span></div>`).join('')}</div>` : '<p class="admin-muted" style="font-size:13px;">None.</p>'}
      </section>
      <section class="admin-card admin-grow-1">
        <h2>Version and server</h2>
        <div class="admin-kv">
          <div><span>Live version</span><span>${h.deploy.commit ? esc(h.deploy.commit) : 'Unknown'}</span></div>
          ${h.deploy.message ? `<div><span>Latest change</span><span>${esc(h.deploy.message)}</span></div>` : ''}
          <div><span>Running since</span><span>${new Date(h.server.startedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>
          ${h.deploy.region ? `<div><span>Server region</span><span>${esc(h.deploy.region)}</span></div>` : ''}
          <div><span>Memory in use</span><span>${fmtNum(h.server.memoryMB)} MB</span></div>
          <div><span>Database</span><span>${h.database.kind === 'postgres' ? 'PostgreSQL' : 'SQLite (local)'}</span></div>
          <div><span>Activity records</span><span>${h.eventsStored == null ? 'Unknown' : fmtNum(h.eventsStored)} <span class="admin-muted">(kept 90 days)</span></span></div>
          <div><span>Node.js</span><span>${esc(h.server.node)}</span></div>
        </div>
      </section>
    </div>`;
}

document.getElementById('health-refresh').addEventListener('click', renderHealth);

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
  document.getElementById('admin-user').innerHTML = `
    <div class="avatar">${esc(user.username[0].toUpperCase())}</div>
    <div class="admin-user-text"><div class="admin-user-name">${esc(user.username)}</div><div class="admin-user-role">Admin</div></div>`;
  document.getElementById('add-title-btn').onclick = () => openForm(null);
  document.getElementById('import-tmdb-btn').onclick = () => openTmdbSearch();
  showView();
  // The sidebar badges, whichever section opened first.
  api('/admin/stats').then(updateBadges).catch(() => {});
  api('/admin/health').then((h) => {
    document.getElementById('nav-health-dot').hidden = h.database.ok && !h.errors.server24h && !h.errors.playback24h;
  }).catch(() => {});
  api('/admin/notifications').then((n) => updatePushBadge(n.subscribers)).catch(() => {});
  api('/admin/uploads').then((u) => {
    const badge = document.getElementById('nav-uploads-failed');
    badge.hidden = !u.failed.length;
    badge.textContent = fmtNum(u.failed.length);
  }).catch(() => {});
}

init();
