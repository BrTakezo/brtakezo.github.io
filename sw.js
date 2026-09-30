/**
 * Service Worker — offline support, cache-first for static assets,
 * network-first for manifest/config.
 */

const CACHE_NAME    = 'app-cache-v1';
const NETWORK_FIRST = ['/manifest.json', '/config.json'];

const PRECACHE = [
  '/',
  '/index.html',
  '/js/app.js',
  '/js/update-system.js',
  '/style.css',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const { url } = event.request;
  const path    = new URL(url).pathname;

  // Network-first para manifesto e config
  if (NETWORK_FIRST.some(p => path.endsWith(p))) {
    event.respondWith(
      fetch(event.request)
        .then(resp => {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          return resp;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first para tudo mais
  event.respondWith(
    caches.match(event.request).then(cached =>
      cached ?? fetch(event.request).then(resp => {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        return resp;
      })
    )
  );
});
