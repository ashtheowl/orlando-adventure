/* Keeps the app's own files on the tablet so it opens with no internet.
   Never touches saved entries: those live in storage, not in this cache.
   Bump CACHE_VERSION on every deploy, and APP_VERSION in app.js with it,
   otherwise a fix will not reach the tablet. */
const CACHE_VERSION = 'orlando-v1';

const SHELL = [
  './',
  './index.html',
  './app.js',
  './storage.js',
  './styles.css',
  './fonts.css',
  './content.json',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      // cache: 'reload' skips the browser's own cache, so a new version
      // never gets filled with old files
      return cache.addAll(SHELL.map(function (url) { return new Request(url, { cache: 'reload' }); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.filter(function (name) { return name !== CACHE_VERSION; })
        .map(function (name) { return caches.delete(name); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(request).catch(function (err) {
        if (request.mode === 'navigate') return caches.match('./index.html');
        throw err;
      });
    })
  );
});
