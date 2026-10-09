// Bump this on any deploy that changes cached files, so old caches get
// cleared out and everyone picks up the new version automatically.
const CACHE_VERSION = 'lumatostreaming-v15';

const STATIC_ASSETS = [
  '/styles.css',
  '/app.js',
  '/admin.css',
  '/admin.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(STATIC_ASSETS).catch(() => {
      // Don't fail install if one asset is briefly unreachable — the app
      // still works, it just won't be precached until the next successful fetch.
    }))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache API calls — titles, watchlists, and auth state must always
  // be live, not served stale from a previous visit.
  if (url.pathname.startsWith('/api/')) return;

  // HTML pages: network-first, so a deploy is reflected immediately for
  // anyone online; falls back to cache only if the network request fails.
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
    );
    return;
  }

  // Our own CSS/JS/icons: network-first, same as HTML, so a deploy takes
  // effect on the very first load instead of one load later. Falls back to
  // the cache when offline.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Other origins: only posters, fonts and stylesheets are cached. Videos
  // (streams and offline downloads) go straight to the network — caching
  // them would store a second copy of every movie.
  if (!['image', 'font', 'style'].includes(request.destination)) return;

  // Cache-first for speed, refreshing the cache in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        return res;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
