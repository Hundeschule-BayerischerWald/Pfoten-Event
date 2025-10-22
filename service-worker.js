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
  self.skipWaiting(); // Activate worker immediately
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
  // We only handle GET requests for caching.
  if (event.request.method !== 'GET') {
    return;
  }
  
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Try to get the resource from the cache.
      const cachedResponse = await cache.match(event.request);
      if (cachedResponse) {
        // If we found a match in the cache, return it.
        return cachedResponse;
      }

      // If the resource was not in the cache, try the network.
      try {
        const fetchResponse = await fetch(event.request);
        // Save the resource in the cache and return it.
        // This is a simplified cache-then-network strategy.
        // For API calls, you might want a network-first strategy.
        if (fetchResponse.status === 200) {
            cache.put(event.request, fetchResponse.clone());
        }
        return fetchResponse;
      } catch (e) {
        // The network failed.
        console.error('Fetch failed:', e);
        // Here you could return a fallback page if you have one cached.
      }
    })
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
    }).then(() => self.clients.claim()) // Take control of all pages
  );
});

// Listen for push notifications
self.addEventListener('push', event => {
  let data = { title: 'Neue Events!', body: 'Es gibt neue Termine, die du buchen kannst.' };
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    console.error('Push event payload is not valid JSON:', e);
  }

  const title = data.title || 'Pfoten-Event';
  const options = {
    body: data.body,
    icon: 'https://hs-bw.com/wp-content/uploads/2025/10/Pfoten-Card-Icon.png',
    badge: 'https://hs-bw.com/wp-content/uploads/2025/10/Pfoten-Card-Icon.png', // For Android
    vibrate: [200, 100, 200]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Handle notification click
self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(
        clients.openWindow('/')
    );
});
