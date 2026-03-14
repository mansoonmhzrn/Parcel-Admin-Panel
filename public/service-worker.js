const CACHE_NAME = 'parcel-tracker-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/admin.html',
  '/styles.css',
  '/app.js',
  '/admin.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap',
  'https://unpkg.com/html5-qrcode'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (event) => {
  // Simple cache-first strategy for assets, network-first for APIs would be better but keeping it simple
  if (event.request.url.includes('/api/')) {
    // API calls - network first
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
  } else {
    // Assets - cache first
    event.respondWith(
      caches.match(event.request).then((response) => response || fetch(event.request))
    );
  }
});
