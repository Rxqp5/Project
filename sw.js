// Offline support: always try the network first (so the raid rotation stays current) and fall
// back to the last cached copy when offline.
const CACHE = 'raid-guide-v5';
const SHELL = ['./', 'index.html', 'src/styles.css', 'src/app.js', 'src/calc.js', 'src/schedule.js', 'src/collection.js', 'src/mine.js', 'src/scan.js', 'src/advice.js', 'src/pokemon-pages.js', 'data/game.json', 'icon.svg', 'manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.open(CACHE).then((cache) => fetch(e.request)
    .then((res) => {
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    })
    .catch(() => cache.match(e.request).then((cached) => cached || Response.error()))));
});
