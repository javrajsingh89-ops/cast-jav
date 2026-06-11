// Service Worker per Cast Jav
const CACHE_NAME = 'cast-jav-v1';
const urlsToCache = [
  '/',
  '/tv.html',
  '/style.css',
  '/client.js',
  '/tv-client.js',
  '/manifest.json'
];

// Installa il service worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

// Gestisci le richieste
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});

// Aggiorna il service worker
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
