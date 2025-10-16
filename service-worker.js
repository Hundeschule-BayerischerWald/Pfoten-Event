// A simple, offline-first service worker
const CACHE_NAME = 'pfoten-event-cache-v1';
// This list includes the core files needed for the app to function.
const urlsToCache = [
  '/',
  '/index.html',
  '/index.css',
  '/manifest.json',
  '/logo.png',
  '/logo-192.png',
  '/logo-512.png',
  'https://hs-bw.com/wp-content/uploads/2025/10/Pfoten-Card-Icon.png'
];

// On install, cache the core assets.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache, caching core assets.');
        // addAll will fail if any of the files are not available.
        // Using an individual add and catching errors for non-critical assets might be more robust.
        return Promise.all(
            urlsToCache.map(url => {
                return cache.add(url).catch(reason => {
                    console.log(`Failed to cache ${url}: ${reason}`);
                });
            })
        );
      })
  );
});

// On fetch, serve from cache if possible, falling back to the network.
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Cache hit - return response
        if (response) {
          return response;
        }

        // Not in cache, go to network.
        return fetch(event.request);
      }
    )
  );
});

// On activation, clean up old caches.
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
