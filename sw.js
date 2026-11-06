// BMG offline worker: serves the app from cache (works with no signal), refreshes it in the background.
const CACHE = 'bmg-app-v3';
const KEEP = ['bmg-data']; // user data cache — never delete
const ASSETS = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE && !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.url.includes('__bmg-data__')) return;
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      const key = req.mode === 'navigate' ? 'index.html' : req;
      const cached = await c.match(key, { ignoreSearch: true });
      const network = fetch(req)
        .then((r) => { if (r && r.ok) c.put(key, r.clone()); return r; })
        .catch(() => cached);
      return cached || network;
    })
  );
});
