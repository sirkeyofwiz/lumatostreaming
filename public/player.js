// ---------------------------------------------------------------------------
// LumatoStreaming video player: full-screen, custom controls, subtitles,
// playback speed, an Episodes panel (seasons, search, autoplay, spoiler
// mode) and autoplay of the next episode. Loaded after app.js and uses its
// helpers (showModal, trackProgress, episodePlayItem, trackEvent…).
// ---------------------------------------------------------------------------

const PLAYER_PREFS_KEY = 'lumato-player';
const PLAYER_DEFAULTS = { autoplay: true, hideSpoilers: true, volume: 1, muted: false, subSize: 'medium', subLang: null, speed: 1 };

function playerPrefs() {
  try { return { ...PLAYER_DEFAULTS, ...JSON.parse(localStorage.getItem(PLAYER_PREFS_KEY)) }; } catch { return { ...PLAYER_DEFAULTS }; }
}
function savePlayerPrefs(changes) {
  try { localStorage.setItem(PLAYER_PREFS_KEY, JSON.stringify({ ...playerPrefs(), ...changes })); } catch { /* private mode */ }
}

const PI = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4" width="4.5" height="16" rx="1.2" fill="currentColor"/><rect x="13.5" y="4" width="4.5" height="16" rx="1.2" fill="currentColor"/></svg>',
  replay: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4h4"/></svg>',
  back10: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 12a7 7 0 1 0 2-4.9"/><path d="M5 4v4h4"/><text x="12" y="16.5" fill="currentColor" stroke="none" font-size="7" font-family="Inter,sans-serif" font-weight="700" text-anchor="middle">10</text></svg>',
  fwd10: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M19 12a7 7 0 1 1-2-4.9"/><path d="M19 4v4h-4"/><text x="12" y="16.5" fill="currentColor" stroke="none" font-size="7" font-family="Inter,sans-serif" font-weight="700" text-anchor="middle">10</text></svg>',
  volume: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
  mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M17 9l5 6M22 9l-5 6"/></svg>',
  full: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>',
  exitFull: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/></svg>',
  arrowBack: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M20 12H5M11 5l-7 7 7 7"/></svg>',
  quality: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5v5l4.5-2.5z" fill="currentColor"/></svg>',
  cc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="7"/><path d="M10.5 10.2a2.3 2.3 0 1 0 0 3.6M16.5 10.2a2.3 2.3 0 1 0 0 3.6"/></svg>',
  chevronLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M5 5l10 7-10 7z" fill="currentColor"/><path d="M19 5v14"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 6.1A10 10 0 0 1 12 6c5 0 9 4.5 10 6a17 17 0 0 1-3.2 3.7M6.6 6.6A17 17 0 0 0 2 12c1 1.5 5 6 10 6a9.8 9.8 0 0 0 4.4-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 12c1-1.5 5-6 10-6s9 4.5 10 6c-1 1.5-5 6-10 6s-9-4.5-10-6z"/><circle cx="12" cy="12" r="3"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/></svg>',
};

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const SUB_SIZES = [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']];

// What the header shows: the show (or movie) and, for an episode, "S1 E2 Name".
function playerHeading(item) {
  const w = item.watch;
  if (w && w.episodes && w.episodes[w.index]) {
    const ep = w.episodes[w.index];
    return { title: w.show.title, sub: `S${ep.season_number} E${ep.episode_number}${ep.name ? ` ${ep.name}` : ''}` };
  }
  return { title: item.title || '', sub: item.year ? String(item.year) : '' };
}

function playerBackdrop(item) {
  const show = item.watch && item.watch.show;
  const url = (show && (show.backdrop_url || show.poster_url)) || item.backdrop_url || item.poster_url || '';
  return url ? `url('${cssUrl(url)}')` : 'none';
}

let activePlayer = null; // tears down the open player (listeners, timers)

async function openPlayer(item) {
  // ---------- Where the video comes from ----------
  let src;
  let subtitles = item.subtitles || [];
  let releaseOffline = null;
  if (item.offlineKey) {
    const offline = await getOfflineVideo(item.offlineKey).catch(() => null);
    if (!offline) { showToast('This download is no longer on this device.'); return; }
    src = URL.createObjectURL(offline.blob);
    // Subtitles saved with the video play from blob URLs, so they work offline.
    subtitles = (offline.subtitles || []).map((s) => ({ ...s, src: URL.createObjectURL(new Blob([s.vtt], { type: 'text/vtt' })) }));
    releaseOffline = () => { URL.revokeObjectURL(src); subtitles.forEach((s) => URL.revokeObjectURL(s.src)); };
    item = { ...item, title: offline.title };
  } else {
    const embed = getVideoEmbed(item.video_url);
    if (!embed) { showToast('No video linked for this title yet.'); return; }
    if (embed.type === 'iframe') return openEmbedPlayer(item, embed);
    src = embed.src;
  }

  const prefs = playerPrefs();
  const heading = playerHeading(item);
  const w = item.watch || null;
  const isEpisode = !!(w && w.episodes);
  const nextItem = w ? nextEpisodeItem(w) : null;
  const curEp = isEpisode ? w.episodes[w.index] : null;

  const root = showModal(`
    <div class="lp lp-paused lp-fresh lp-sub-${prefs.subSize}" tabindex="-1" role="region" aria-label="Video player">
      <video class="lp-video" playsinline crossorigin="anonymous" preload="auto">${buildSubtitleTracks(subtitles).replace(/ default/g, '')}</video>
      <div class="lp-poster" style="background-image:${playerBackdrop(item)}"></div>
      <div class="lp-shade"></div>
      <div class="lp-spinner" hidden><span></span></div>
      <div class="lp-tap-hint lp-tap-left" aria-hidden="true">${PI.back10}</div>
      <div class="lp-tap-hint lp-tap-right" aria-hidden="true">${PI.fwd10}</div>
      <button type="button" class="lp-big-play" aria-label="Play">${PI.play}</button>

      <div class="lp-top lp-chrome">
        <div class="lp-top-left">
          <div class="lp-heading">
            <div class="lp-title">${esc(heading.title)}</div>
            ${heading.sub ? `<div class="lp-sub">${esc(heading.sub)}</div>` : ''}
          </div>
          <button type="button" class="lp-icon-btn lp-back" aria-label="Back">${PI.arrowBack}</button>
        </div>
        <div class="lp-top-actions">
          <div class="lp-menu-wrap">
            <button type="button" class="lp-top-btn" data-menu="quality" aria-haspopup="true" aria-expanded="false">${PI.quality}<span class="lp-top-label">Quality</span><span class="lp-dim" data-res>Auto</span></button>
            <div class="lp-menu" data-menu-panel="quality" hidden></div>
          </div>
          <div class="lp-menu-wrap">
            <button type="button" class="lp-top-btn" data-menu="subs" aria-haspopup="true" aria-expanded="false">${PI.cc}<span class="lp-top-label">Audio &amp; Subtitles</span></button>
            <div class="lp-menu" data-menu-panel="subs" hidden></div>
          </div>
        </div>
      </div>

      ${isEpisode ? `
      <button type="button" class="lp-episodes-tab lp-chrome" aria-label="Show episodes">
        <span class="lp-tab-chevron">${PI.chevronLeft}</span>
        <span class="lp-tab-text">EPISODES <span>S${curEp.season_number} · E${curEp.episode_number}</span></span>
      </button>
      <aside class="lp-panel" aria-label="Episodes" hidden></aside>` : ''}

      <div class="lp-next-pill" hidden>
        <button type="button" class="lp-next-pill-btn">${PI.next}<span>Next episode</span></button>
      </div>
      <div class="lp-upnext" hidden role="dialog" aria-label="Next episode">
        <div class="lp-upnext-label">Next episode in <strong data-count>5</strong></div>
        <div class="lp-upnext-title"></div>
        <div class="lp-upnext-actions">
          <button type="button" class="lp-btn lp-btn-light" data-upnext="play">${PI.play} Play now</button>
          <button type="button" class="lp-btn lp-btn-glass" data-upnext="cancel">Cancel</button>
        </div>
      </div>
      <div class="lp-error" hidden role="alert">
        <div class="lp-error-icon">${PI.alert}</div>
        <div class="lp-error-title">This video couldn't be played</div>
        <div class="lp-error-text">Check your connection and try again. If it keeps happening, the video file may be missing.</div>
        <div class="lp-upnext-actions">
          <button type="button" class="lp-btn lp-btn-light" data-error="retry">Try again</button>
          <button type="button" class="lp-btn lp-btn-glass" data-error="back">Go back</button>
        </div>
      </div>

      <div class="lp-bottom lp-chrome">
        <div class="lp-time-row"><span class="lp-time" aria-live="off">0:00 / 0:00</span></div>
        <div class="lp-progress" role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0">
          <div class="lp-track"><div class="lp-buffered"></div><div class="lp-played"></div></div>
          <div class="lp-knob"></div>
          <div class="lp-hover-time" hidden>0:00</div>
        </div>
        <div class="lp-controls">
          <div class="lp-controls-left">
            <button type="button" class="lp-icon-btn lp-play" aria-label="Play">${PI.play}</button>
            <button type="button" class="lp-icon-btn" data-skip="-10" aria-label="Back 10 seconds">${PI.back10}</button>
            <button type="button" class="lp-icon-btn" data-skip="10" aria-label="Forward 10 seconds">${PI.fwd10}</button>
            <div class="lp-volume">
              <button type="button" class="lp-icon-btn lp-mute" aria-label="Mute">${PI.volume}</button>
              <input type="range" class="lp-volume-range" min="0" max="1" step="0.05" aria-label="Volume" />
            </div>
            ${nextItem ? `<button type="button" class="lp-icon-btn lp-next" aria-label="Next episode" title="Next episode">${PI.next}</button>` : ''}
          </div>
          <div class="lp-controls-right">
            <button type="button" class="lp-icon-btn lp-full" aria-label="Full screen">${PI.full}</button>
          </div>
        </div>
      </div>
    </div>
  `, () => {
    if (activePlayer) activePlayer.destroy();
    if (releaseOffline) releaseOffline();
    refreshContinueRow();
  });

  const lp = root.querySelector('.lp');
  const video = lp.querySelector('.lp-video');
  const $ = (sel) => lp.querySelector(sel);
  const timers = new Set();
  const cleanups = [];
  const listen = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); cleanups.push(() => target.removeEventListener(type, fn, opts)); };
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
  const cancel = (t) => { clearTimeout(t); timers.delete(t); };

  // ---------- Progress, resume and analytics (shared with app.js) ----------
  let progress = null;
  if (w) progress = trackProgress(video, item, nextItem);
  const ids = w ? { title_id: w.titleId, episode_id: w.episodeId || undefined } : (item.id ? { title_id: item.id } : null);

  activePlayer = {
    destroy() {
      if (progress) progress.save();
      timers.forEach(clearTimeout);
      cleanups.forEach((fn) => fn());
      // Switching episodes keeps full screen (the holder stays); closing leaves it.
      if (document.fullscreenElement && !root.querySelector('.lp')) document.exitFullscreen().catch(() => {});
      document.documentElement.classList.remove('lp-open');
      video.pause();
      video.removeAttribute('src');
      video.load();
      activePlayer = null;
    },
  };
  document.documentElement.classList.add('lp-open');

  video.volume = prefs.volume;
  video.muted = prefs.muted;
  video.playbackRate = prefs.speed;
  video.src = src;
  if (ids) trackEvent('play_start', ids);
  const playPromise = video.play();
  if (playPromise) playPromise.catch(() => { /* autoplay blocked: the big Play button stays up */ });
  lp.focus({ preventScroll: true });

  // ---------- Play / pause and the centre button ----------
  const togglePlay = () => {
    if (lp.classList.contains('lp-has-error')) return;
    if (video.paused || video.ended) video.play().catch(() => {}); else video.pause();
  };
  const syncPlayState = () => {
    const paused = video.paused || video.ended;
    lp.classList.toggle('lp-paused', paused);
    const icon = video.ended && !nextItem ? PI.replay : paused ? PI.play : PI.pause;
    $('.lp-play').innerHTML = paused ? PI.play : PI.pause;
    $('.lp-play').setAttribute('aria-label', paused ? 'Play' : 'Pause');
    $('.lp-big-play').innerHTML = icon;
    $('.lp-big-play').setAttribute('aria-label', video.ended ? 'Play again' : 'Play');
    if (!paused) lp.classList.remove('lp-fresh');
    wake();
  };
  listen(video, 'play', syncPlayState);
  listen(video, 'pause', syncPlayState);
  listen(video, 'ended', syncPlayState);
  $('.lp-play').onclick = togglePlay;
  $('.lp-big-play').onclick = togglePlay;
  $('.lp-back').onclick = closeModal;

  // ---------- Loading, errors ----------
  const spinner = $('.lp-spinner');
  let spinnerTimer = null;
  listen(video, 'waiting', () => { cancel(spinnerTimer); spinnerTimer = later(() => { spinner.hidden = false; }, 250); });
  const hideSpinner = () => { cancel(spinnerTimer); spinner.hidden = true; };
  listen(video, 'playing', hideSpinner);
  listen(video, 'canplay', hideSpinner);
  listen(video, 'seeked', hideSpinner);
  listen(video, 'error', () => {
    hideSpinner();
    lp.classList.add('lp-has-error');
    $('.lp-error').hidden = false;
    if (ids) trackEvent('play_error', ids);
  });
  lp.querySelector('[data-error="retry"]').onclick = () => {
    lp.classList.remove('lp-has-error');
    $('.lp-error').hidden = true;
    const at = video.currentTime;
    video.load();
    video.addEventListener('loadedmetadata', () => { if (at) video.currentTime = at; video.play().catch(() => {}); }, { once: true });
  };
  lp.querySelector('[data-error="back"]').onclick = closeModal;

  // ---------- Time, seek bar ----------
  const bar = $('.lp-progress');
  const played = $('.lp-played'), buffered = $('.lp-buffered'), knob = $('.lp-knob'), hoverTime = $('.lp-hover-time');
  let scrubbing = false;
  const paintProgress = (time) => {
    const d = video.duration || 0;
    const pct = d ? Math.min(100, (time / d) * 100) : 0;
    played.style.width = `${pct}%`;
    knob.style.left = `${pct}%`;
    $('.lp-time').textContent = `${formatTime(time || 0)} / ${formatTime(d || 0)}`;
    bar.setAttribute('aria-valuemax', String(Math.round(d)));
    bar.setAttribute('aria-valuenow', String(Math.round(time)));
    bar.setAttribute('aria-valuetext', `${formatTime(time || 0)} of ${formatTime(d || 0)}`);
  };
  listen(video, 'timeupdate', () => { if (!scrubbing) paintProgress(video.currentTime); });
  listen(video, 'loadedmetadata', () => {
    paintProgress(video.currentTime);
    const h = video.videoHeight;
    $('[data-res]').textContent = h ? `${h >= 2160 ? '4K' : `${h}p`}` : 'Auto';
    applySubtitles();
    buildQualityMenu();
  });
  listen(video, 'progress', () => {
    const d = video.duration;
    if (!d || !video.buffered.length) return;
    let end = 0;
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= video.currentTime + 0.5) end = Math.max(end, video.buffered.end(i));
    }
    buffered.style.width = `${Math.min(100, (end / d) * 100)}%`;
  });
  const timeAt = (clientX) => {
    const r = bar.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return { f, t: f * (video.duration || 0) };
  };
  listen(bar, 'pointermove', (e) => {
    if (!video.duration) return;
    const { f, t } = timeAt(e.clientX);
    hoverTime.hidden = false;
    hoverTime.textContent = formatTime(t);
    hoverTime.style.left = `${f * 100}%`;
    if (scrubbing) paintProgress(t);
  });
  listen(bar, 'pointerleave', () => { if (!scrubbing) hoverTime.hidden = true; });
  listen(bar, 'pointerdown', (e) => {
    if (!video.duration) return;
    scrubbing = true;
    lp.classList.add('lp-scrubbing');
    bar.setPointerCapture(e.pointerId);
    paintProgress(timeAt(e.clientX).t);
  });
  const endScrub = (e) => {
    if (!scrubbing) return;
    scrubbing = false;
    lp.classList.remove('lp-scrubbing');
    hoverTime.hidden = true;
    video.currentTime = timeAt(e.clientX).t;
  };
  listen(bar, 'pointerup', endScrub);
  listen(bar, 'pointercancel', endScrub);
  const skip = (secs) => {
    if (!video.duration) return;
    video.currentTime = Math.min(video.duration, Math.max(0, video.currentTime + secs));
    paintProgress(video.currentTime);
    wake();
  };
  lp.querySelectorAll('[data-skip]').forEach((b) => { b.onclick = () => skip(Number(b.dataset.skip)); });

  // ---------- Volume ----------
  const range = $('.lp-volume-range');
  const syncVolume = () => {
    range.value = video.muted ? 0 : video.volume;
    range.style.setProperty('--fill', `${(video.muted ? 0 : video.volume) * 100}%`);
    $('.lp-mute').innerHTML = video.muted || video.volume === 0 ? PI.mute : PI.volume;
    $('.lp-mute').setAttribute('aria-label', video.muted ? 'Unmute' : 'Mute');
    savePlayerPrefs({ volume: video.volume, muted: video.muted });
  };
  listen(video, 'volumechange', syncVolume);
  range.oninput = () => { video.volume = Number(range.value); video.muted = video.volume === 0; };
  $('.lp-mute').onclick = () => { video.muted = !video.muted; if (!video.muted && video.volume === 0) video.volume = 0.5; };
  syncVolume();

  // ---------- Full screen ----------
  const toggleFullscreen = () => {
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
    if (root.requestFullscreen) {
      root.requestFullscreen().then(() => {
        // Phones: turn sideways for a full-width picture where allowed.
        if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
      }).catch(() => {});
    } else if (video.webkitEnterFullscreen) {
      video.webkitEnterFullscreen(); // iPhone: the system player
    }
  };
  $('.lp-full').onclick = toggleFullscreen;
  const syncFullscreen = () => {
    const on = !!document.fullscreenElement;
    $('.lp-full').innerHTML = on ? PI.exitFull : PI.full;
    $('.lp-full').setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
  };
  listen(document, 'fullscreenchange', syncFullscreen);
  syncFullscreen();

  // ---------- Menus: Quality (and speed), Audio & Subtitles ----------
  const menus = lp.querySelectorAll('[data-menu]');
  const closeMenus = () => {
    lp.querySelectorAll('.lp-menu').forEach((m) => { m.hidden = true; });
    menus.forEach((b) => b.setAttribute('aria-expanded', 'false'));
  };
  menus.forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const panel = lp.querySelector(`[data-menu-panel="${btn.dataset.menu}"]`);
      const open = panel.hidden;
      closeMenus();
      panel.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      wake();
    };
  });
  listen(lp, 'click', (e) => { if (!e.target.closest('.lp-menu-wrap')) closeMenus(); });
  const option = (label, on, attrs) => `<button type="button" class="lp-option ${on ? 'is-on' : ''}" ${attrs}><span class="lp-option-check">${on ? PI.check : ''}</span>${label}</button>`;

  function buildQualityMenu() {
    const h = video.videoHeight;
    lp.querySelector('[data-menu-panel="quality"]').innerHTML = `
      <div class="lp-menu-title">Quality</div>
      ${option(h ? `${h}p` : 'Original', true, 'disabled')}
      <div class="lp-menu-note">This video has one quality.</div>
      <div class="lp-menu-title">Playback speed</div>
      ${SPEEDS.map((s) => option(s === 1 ? 'Normal' : `${s}×`, video.playbackRate === s, `data-speed="${s}"`)).join('')}`;
    lp.querySelectorAll('[data-speed]').forEach((b) => {
      b.onclick = () => {
        video.playbackRate = Number(b.dataset.speed);
        savePlayerPrefs({ speed: video.playbackRate });
        buildQualityMenu();
      };
    });
  }

  // Subtitles: the viewer's last choice of language (or Off) carries over.
  function applySubtitles() {
    const tracks = [...video.textTracks];
    let pick = -1;
    const want = playerPrefs().subLang;
    if (want === 'off') pick = -1;
    else if (want) pick = subtitles.findIndex((s) => s.lang_code === want);
    if (want !== 'off' && pick < 0 && subtitles.length) pick = 0; // on by default when available
    tracks.forEach((t, i) => { t.mode = i === pick ? 'showing' : 'disabled'; });
    buildSubsMenu(pick);
  }
  function buildSubsMenu(current) {
    const size = playerPrefs().subSize;
    lp.querySelector('[data-menu-panel="subs"]').innerHTML = `
      <div class="lp-menu-title">Audio</div>
      ${option('Original', true, 'disabled')}
      <div class="lp-menu-title">Subtitles</div>
      ${option('Off', current < 0, 'data-sub="-1"')}
      ${subtitles.map((s, i) => option(esc(s.label || s.lang_code), current === i, `data-sub="${i}"`)).join('')}
      ${subtitles.length ? '' : '<div class="lp-menu-note">No subtitles for this video.</div>'}
      ${subtitles.length ? `<div class="lp-menu-title">Subtitle size</div>${SUB_SIZES.map(([k, l]) => option(l, size === k, `data-subsize="${k}"`)).join('')}` : ''}`;
    lp.querySelectorAll('[data-sub]').forEach((b) => {
      b.onclick = () => {
        const i = Number(b.dataset.sub);
        [...video.textTracks].forEach((t, j) => { t.mode = j === i ? 'showing' : 'disabled'; });
        savePlayerPrefs({ subLang: i < 0 ? 'off' : subtitles[i].lang_code });
        buildSubsMenu(i);
      };
    });
    lp.querySelectorAll('[data-subsize]').forEach((b) => {
      b.onclick = () => {
        SUB_SIZES.forEach(([k]) => lp.classList.remove(`lp-sub-${k}`));
        lp.classList.add(`lp-sub-${b.dataset.subsize}`);
        savePlayerPrefs({ subSize: b.dataset.subsize });
        buildSubsMenu(current);
      };
    });
  }
  buildQualityMenu();
  buildSubsMenu(-1);

  // Subtitles move up while the controls are showing, so they don't overlap.
  const placeCues = () => {
    const line = lp.classList.contains('lp-idle') ? 'auto' : 78; // % from the top
    [...video.textTracks].forEach((t) => {
      if (t.mode !== 'showing' || !t.cues) return;
      let moved = false;
      [...t.cues].forEach((c) => {
        if (c.line === line) return;
        c.snapToLines = line === 'auto';
        c.line = line;
        moved = true;
      });
      // Browsers only redraw a cue already on screen when the track is re-shown.
      if (moved && t.activeCues && t.activeCues.length) { t.mode = 'hidden'; t.mode = 'showing'; }
    });
  };
  [...video.textTracks].forEach((t) => listen(t, 'cuechange', placeCues));
  new MutationObserver(placeCues).observe(lp, { attributes: true, attributeFilter: ['class'] });

  // ---------- Controls hide while watching ----------
  let idleTimer = null;
  function wake() {
    lp.classList.remove('lp-idle');
    cancel(idleTimer);
    idleTimer = later(() => {
      const busy = video.paused || scrubbing || lp.querySelector('.lp-menu:not([hidden])') || (panel && !panel.hidden);
      if (!busy) lp.classList.add('lp-idle');
    }, 3000);
  }
  listen(lp, 'pointermove', (e) => { if (e.pointerType === 'mouse') wake(); });
  listen(lp, 'keydown', wake);

  // Clicks on the picture: play/pause with a mouse; on touch screens a tap
  // shows/hides the controls and a double tap on either side skips 10 s.
  let lastTap = 0, tapTimer = null;
  listen(lp, 'pointerup', (e) => {
    if (panel && !panel.hidden && !e.target.closest('.lp-panel')) { closePanel(); return; }
    const onPicture = e.target === video || e.target.classList.contains('lp-shade') || e.target.classList.contains('lp-poster');
    if (!onPicture) return;
    if (e.pointerType === 'mouse') { togglePlay(); return; }
    const now = Date.now();
    if (now - lastTap < 300) {
      cancel(tapTimer);
      const left = e.clientX < lp.clientWidth / 2;
      skip(left ? -10 : 10);
      const hint = $(left ? '.lp-tap-left' : '.lp-tap-right');
      hint.classList.remove('is-on'); void hint.offsetWidth; hint.classList.add('is-on');
      lastTap = 0;
      return;
    }
    lastTap = now;
    tapTimer = later(() => {
      if (lp.classList.contains('lp-idle')) wake(); else if (!video.paused) lp.classList.add('lp-idle');
    }, 280);
  });

  // ---------- Keyboard ----------
  listen(document, 'keydown', (e) => {
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'k') { e.preventDefault(); togglePlay(); }
    else if (k === 'arrowleft' || k === 'j') { e.preventDefault(); skip(-10); }
    else if (k === 'arrowright' || k === 'l') { e.preventDefault(); skip(10); }
    else if (k === 'arrowup') { e.preventDefault(); video.muted = false; video.volume = Math.min(1, video.volume + 0.1); }
    else if (k === 'arrowdown') { e.preventDefault(); video.volume = Math.max(0, video.volume - 0.1); }
    else if (k === 'm') video.muted = !video.muted;
    else if (k === 'f') toggleFullscreen();
    else if (k === 'c' && subtitles.length) {
      const showing = [...video.textTracks].findIndex((t) => t.mode === 'showing');
      const nextIdx = showing < 0 ? 0 : -1;
      [...video.textTracks].forEach((t, j) => { t.mode = j === nextIdx ? 'showing' : 'disabled'; });
      savePlayerPrefs({ subLang: nextIdx < 0 ? 'off' : subtitles[0].lang_code });
      buildSubsMenu(nextIdx);
    } else if (k === 'n' && nextItem) openPlayer(nextItem);
    else if (k === 'escape' && panel && !panel.hidden) { e.preventDefault(); closePanel(); }
  });

  // ---------- Next episode: button near the end, autoplay countdown ----------
  const pill = $('.lp-next-pill');
  if (nextItem) {
    $('.lp-next').onclick = () => openPlayer(nextItem);
    pill.querySelector('button').onclick = () => openPlayer(nextItem);
    listen(video, 'timeupdate', () => {
      const left = video.duration - video.currentTime;
      pill.hidden = !(video.duration && left <= 30 && left > 0.5 && video.currentTime > video.duration / 2);
    });
  }
  const upnext = $('.lp-upnext');
  let countdown = null;
  const stopCountdown = () => { if (countdown) { clearInterval(countdown); countdown = null; } };
  cleanups.push(stopCountdown);
  listen(video, 'ended', () => {
    pill.hidden = true;
    if (!nextItem) return;
    const nextEp = nextItem.watch.episodes[nextItem.watch.index];
    upnext.querySelector('.lp-upnext-title').textContent = `S${nextEp.season_number} E${nextEp.episode_number}${nextEp.name ? ` · ${nextEp.name}` : ''}`;
    upnext.hidden = false;
    if (!playerPrefs().autoplay) {
      upnext.querySelector('.lp-upnext-label').textContent = 'Up next';
      return;
    }
    let n = 5;
    upnext.querySelector('.lp-upnext-label').innerHTML = 'Next episode in <strong data-count>5</strong>';
    countdown = setInterval(() => {
      n -= 1;
      const c = upnext.querySelector('[data-count]');
      if (c) c.textContent = String(n);
      if (n <= 0) { stopCountdown(); openPlayer(nextItem); }
    }, 1000);
  });
  upnext.querySelector('[data-upnext="play"]').onclick = () => { stopCountdown(); openPlayer(nextItem); };
  upnext.querySelector('[data-upnext="cancel"]').onclick = () => { stopCountdown(); upnext.hidden = true; };
  listen(video, 'play', () => { stopCountdown(); upnext.hidden = true; });

  // ---------- Episodes panel ----------
  const panel = isEpisode ? $('.lp-panel') : null;
  const revealed = new Set(); // episodes shown despite spoiler mode
  let panelSeason = curEp ? curEp.season_number : null;
  let panelQuery = '';
  let thumbObserver = null;

  function openPanel() {
    panel.hidden = false;
    lp.classList.add('lp-panel-open');
    renderPanel();
    wake();
    const current = panel.querySelector('.lp-ep.is-current');
    if (current) current.scrollIntoView({ block: 'center' });
  }
  function closePanel() {
    panel.hidden = true;
    lp.classList.remove('lp-panel-open');
    if (thumbObserver) { thumbObserver.disconnect(); thumbObserver = null; }
    lp.focus({ preventScroll: true });
  }

  function renderPanel() {
    const all = w.episodes;
    const seasons = [...new Set(all.map((e) => e.season_number))].sort((a, b) => a - b);
    const hide = playerPrefs().hideSpoilers;
    const auto = playerPrefs().autoplay;
    const q = panelQuery.trim().toLowerCase();
    const list = all
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.season_number === panelSeason)
      .filter(({ e }) => !q || `${e.episode_number} ${e.name || ''}`.toLowerCase().includes(q))
      .sort((a, b) => a.e.episode_number - b.e.episode_number);
    const inSeason = all.filter((e) => e.season_number === panelSeason).length;
    const curIndex = w.index;
    const desc = w.show.description || '';

    const art = playerBackdrop(item);

    panel.innerHTML = `
      <div class="lp-panel-head">
        <div class="lp-panel-row">
          <label class="lp-season">
            <span class="lp-sr">Season</span>
            <select data-season>${seasons.map((s) => `<option value="${s}" ${s === panelSeason ? 'selected' : ''}>Season ${s}</option>`).join('')}</select>
          </label>
          <div class="lp-search">
            ${PI.search}
            <label class="lp-sr" for="lp-ep-search">Search episodes</label>
            <input id="lp-ep-search" type="search" placeholder="Search" value="${esc(panelQuery)}" data-ep-search autocomplete="off" />
            <span class="lp-search-divider"></span>
            <button type="button" class="lp-autoplay" role="switch" aria-checked="${auto}" title="Autoplay next episode" data-autoplay>${PI.next}<span class="lp-switch ${auto ? 'is-on' : ''}"><span></span></span><span class="lp-sr">Autoplay next episode</span></button>
          </div>
          <button type="button" class="lp-panel-close" aria-label="Close episodes">${PI.close}</button>
        </div>
        <div class="lp-panel-row">
          <div class="lp-panel-box"><span class="lp-panel-box-label">Episodes</span><span class="lp-panel-box-value">${list.length} of ${inSeason}</span></div>
          <button type="button" class="lp-spoiler ${hide ? 'is-on' : ''}" aria-pressed="${hide}" title="${hide ? 'Later episodes are hidden' : 'All episodes are shown'}" data-spoiler>${hide ? PI.eyeOff : PI.eye}<span>SPOILER</span></button>
        </div>
        <div class="lp-season-info">
          <div class="lp-season-title">Season ${panelSeason}</div>
          <div class="lp-season-count"><span></span>${inSeason} ${inSeason === 1 ? 'EPISODE' : 'EPISODES'}</div>
          ${desc ? `<div class="lp-season-desc">${esc(desc)}</div>` : ''}
        </div>
      </div>
      <div class="lp-ep-list">
        ${list.length ? list.map(({ e, i }) => {
          const isCurrent = i === curIndex;
          const locked = hide && i > curIndex && !revealed.has(e.id);
          const playable = !!e.video_url;
          const direct = playable && isDirectFile(e.video_url);
          const name = locked ? `Episode ${e.episode_number}` : `${e.episode_number}. ${esc(e.name || `Episode ${e.episode_number}`)}`;
          const label = locked ? `Reveal episode ${e.episode_number}` : playable ? `Play episode ${e.episode_number}` : `Episode ${e.episode_number}, video coming soon`;
          return `
          <div class="lp-ep ${isCurrent ? 'is-current' : ''} ${locked ? 'is-locked' : ''} ${playable ? '' : 'is-unavailable'}" data-ep-index="${i}" role="button" tabindex="0" aria-label="${label}">
            <div class="lp-ep-art" style="background-image:${art}">
              ${direct ? `<video muted playsinline preload="none" data-thumb-src="${esc(e.video_url)}"></video>` : ''}
            </div>
            <div class="lp-ep-fade"></div>
            ${isCurrent ? '<span class="lp-ep-badge">WATCHING</span>' : ''}
            ${locked ? `<span class="lp-ep-lock">${PI.lock}<span>Click to reveal</span></span>` : playable && !isCurrent ? `<span class="lp-ep-play">${PI.play}</span>` : ''}
            <div class="lp-ep-info">
              <div class="lp-ep-title">${name}</div>
              <div class="lp-ep-meta" data-ep-duration>${playable ? '' : 'Video coming soon'}</div>
              ${!locked && e.description ? `<div class="lp-ep-desc">${esc(e.description)}</div>` : ''}
            </div>
          </div>`;
        }).join('') : `<div class="lp-ep-empty">${q ? 'No episodes match your search.' : 'No episodes in this season yet.'}</div>`}
      </div>`;

    panel.querySelector('.lp-panel-close').onclick = closePanel;
    panel.querySelector('[data-season]').onchange = (e) => { panelSeason = Number(e.target.value); panelQuery = ''; renderPanel(); };
    const search = panel.querySelector('[data-ep-search]');
    search.oninput = () => {
      panelQuery = search.value;
      const pos = search.selectionStart;
      renderPanel();
      const again = panel.querySelector('[data-ep-search]');
      again.focus();
      again.setSelectionRange(pos, pos);
    };
    panel.querySelector('[data-autoplay]').onclick = () => { savePlayerPrefs({ autoplay: !playerPrefs().autoplay }); renderPanel(); };
    panel.querySelector('[data-spoiler]').onclick = () => { savePlayerPrefs({ hideSpoilers: !playerPrefs().hideSpoilers }); renderPanel(); };
    panel.querySelectorAll('.lp-ep').forEach((card) => {
      const i = Number(card.dataset.epIndex);
      const ep = w.episodes[i];
      const choose = () => {
        if (card.classList.contains('is-locked')) { revealed.add(ep.id); renderPanel(); return; }
        if (!ep.video_url) return;
        if (i === w.index) { closePanel(); if (video.paused) video.play().catch(() => {}); return; }
        openPlayer(episodePlayItem(w.show, w.episodes, i));
      };
      card.onclick = choose;
      card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); choose(); } };
    });
    loadThumbs();
  }

  // Episode pictures: a frame from each video, loaded as cards scroll into view.
  function loadThumbs() {
    if (thumbObserver) thumbObserver.disconnect();
    const vids = panel.querySelectorAll('video[data-thumb-src]');
    if (!vids.length) return;
    thumbObserver = new IntersectionObserver((entries, obs) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const v = en.target;
        obs.unobserve(v);
        const card = v.closest('.lp-ep');
        v.addEventListener('loadedmetadata', () => {
          v.currentTime = Math.min(v.duration * 0.1, 120) || 0;
          const meta = card.querySelector('[data-ep-duration]');
          if (meta && isFinite(v.duration)) meta.textContent = `${Math.max(1, Math.round(v.duration / 60))}m`;
        }, { once: true });
        v.addEventListener('seeked', () => v.classList.add('is-ready'), { once: true });
        v.addEventListener('error', () => v.remove(), { once: true });
        v.preload = 'metadata';
        v.src = v.dataset.thumbSrc;
      });
    }, { root: panel.querySelector('.lp-ep-list'), rootMargin: '200px' });
    vids.forEach((v) => thumbObserver.observe(v));
  }

  if (panel) {
    $('.lp-episodes-tab').onclick = openPanel;
    cleanups.push(() => { if (thumbObserver) thumbObserver.disconnect(); });
  }

  syncPlayState();
}

// YouTube / Vimeo links keep their own player inside the same full-screen
// frame, with our header and back button.
function openEmbedPlayer(item, embed) {
  const heading = playerHeading(item);
  const ids = item.watch ? { title_id: item.watch.titleId, episode_id: item.watch.episodeId || undefined } : (item.id ? { title_id: item.id } : null);
  const root = showModal(`
    <div class="lp lp-embed" tabindex="-1" role="region" aria-label="Video player">
      <iframe class="lp-iframe" src="${esc(embed.src)}" allow="autoplay; fullscreen; encrypted-media" allowfullscreen></iframe>
      <div class="lp-top lp-chrome">
        <div class="lp-top-left">
          <div class="lp-heading"><div class="lp-title">${esc(heading.title)}</div>${heading.sub ? `<div class="lp-sub">${esc(heading.sub)}</div>` : ''}</div>
          <button type="button" class="lp-icon-btn lp-back" aria-label="Back">${PI.arrowBack}</button>
        </div>
      </div>
    </div>`, () => document.documentElement.classList.remove('lp-open'));
  document.documentElement.classList.add('lp-open');
  root.querySelector('.lp-back').onclick = closeModal;
  if (ids) trackEvent('play_start', ids);
}
