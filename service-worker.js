// A simple, offline-first service worker
const CACHE_NAME = 'pfoten-event-cache-v1';
// This list includes the core files needed for the app to function.
const urlsToCache = [
  '/',
  '/index.html',
  '/index.css',
  '/manifest.json',
  'https://hs-bw.com/wp-content/uploads/2025/10/Pfoten-Card-Icon.png'
];

// On install, cache the core assets.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // console.log('Opened cache, caching core assets.');
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
            // console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// --- PUSH NOTIFICATION HANDLERS ---

self.addEventListener('push', function(event) {
  if (event.data) {
    const data = event.data.json();
    const title = data.title || 'Pfoten-Event News';
    const options = {
      body: data.body || 'Neue Events verfügbar!',
      icon: 'https://hs-bw.com/wp-content/uploads/2025/10/Pfoten-Card-Icon.png',
      badge: 'https://hs-bw.com/wp-content/uploads/2025/10/Pfoten-Card-Icon.png',
      vibrate: [100, 50, 100],
      data: {
        url: data.url || '/'
      }
    };

    event.waitUntil(self.registration.showNotification(title, options));
  }
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(windowClients => {
      // Check if there is already a window/tab open with the target URL
      for (var i = 0; i < windowClients.length; i++) {
        var client = windowClients[i];
        if (client.url === event.notification.data.url && 'focus' in client) {
          return client.focus();
        }
      }
      // If not, open a new window
      if (clients.openWindow) {
        return clients.openWindow(event.notification.data.url);
      }
    })
  );
});