const CACHE_NAME = 'sfk-kindtrack-desktop-extra-075in-side-panels-v30';
const APP_SHELL = [
  './',
  './index.html',
  './handbook.html',
  './style.css',
  './script.js',
  './firebase-config.js',
  './firebase-auth-optional.js',
  './firebase-adapter.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './attendance-header.png',
  './sf2-template.xlsx'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // Do not pin handbook PDFs in the app shell cache. The official copy may be replaced anytime.
  if (requestUrl.pathname.toLowerCase().endsWith('.pdf')) {
    return;
  }

  // Always use the network for API requests and form posts.
  if (
    requestUrl.hostname.includes('script.google.com') ||
    requestUrl.hostname.includes('firestore.googleapis.com') ||
    requestUrl.hostname.includes('firebase') ||
    event.request.method !== 'GET'
  ) {
    return;
  }

  // Network-first for HTML so updates appear after refresh; cache fallback if offline.
  if (event.request.mode === 'navigate' || requestUrl.pathname.endsWith('/index.html')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  // Cache-first for CSS/JS/icons, then update from network when available.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
