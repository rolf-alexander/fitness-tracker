// Service worker: saves a copy of the app on your phone so it opens instantly and works offline.
// IMPORTANT: when you change any file, bump VERSION (and APP_VERSION in js/settings-store.js)
// so phones download the new version. Add any new file to ASSETS.
const VERSION = '1.0.1';
const CACHE = `fitness-${VERSION}`;
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/app.js',
  'js/db.js',
  'js/ui.js',
  'js/chart.js',
  'js/timer.js',
  'js/backup.js',
  'js/settings-store.js',
  'js/views/workouts.js',
  'js/views/nutrition.js',
  'js/views/bodyweight.js',
  'js/views/load.js',
  'js/views/habits.js',
  'js/views/mealprep.js',
  'js/views/settings.js',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(a => new Request(a, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

// The app shows an "Update now" banner; tapping it sends this message.
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

// Cache first: serve the saved copy, fall back to the network for anything not saved.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (req.mode === 'navigate') {
      return (await cache.match('index.html')) || fetch(req);
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch {
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
