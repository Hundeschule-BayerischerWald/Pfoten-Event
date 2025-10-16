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

// Listen for push notifications
self.addEventListener('push', event => {
  console.log('[Service Worker] Push Received.');
  let data = {};
  try {
    data = event.data.json();
  } catch (e) {
    data = {
      title: 'Wichtige Mitteilung',
      body: 'Es gibt Neuigkeiten zu deiner Buchung.',
    };
  }

  const title = data.title || 'Event-Update';
  const options = {
    body: data.body || 'Die Details für eines deiner Events haben sich geändert.',
    icon: 'https://hs-bw.com/wp-content/uploads/2025/10/Pfoten-Card-Icon.png',
    badge: 'https://hs-bw.com/wp-content/uploads/2025/10/Pfoten-Card-Icon.png',
    data: {
        url: data.url || '/'
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Handle notification click
self.addEventListener('notificationclick', event => {
  console.log('[Service Worker] Notification click Received.');

  event.notification.close();

  event.waitUntil(
    clients.openWindow(event.notification.data.url)
  );
});