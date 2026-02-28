// ARIES Service Worker — PWA Support v2
const CACHE_NAME = 'aries-v8';
const STATIC_ASSETS = ['/', '/index.html', '/style.css', '/app.js', '/features.js', '/features-v2.js', '/manifest.json'];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) { return cache.addAll(STATIC_ASSETS); })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE_NAME; }).map(function(k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(event) {
  // Don't cache API calls
  if (event.request.url.includes('/api/')) return;
  event.respondWith(
    fetch(event.request).catch(function() {
      return caches.match(event.request);
    })
  );
});

// Push notification handler
self.addEventListener('push', function(event) {
  var data = { title: 'ARIES', body: 'Notification', icon: '/api/icon/192' };
  try { data = event.data.json(); } catch(e) { data.body = event.data ? event.data.text() : 'New notification'; }
  event.waitUntil(
    self.registration.showNotification(data.title || 'ARIES', {
      body: data.body || '',
      icon: data.icon || '/api/icon/192',
      badge: '/api/icon/192',
      vibrate: [200, 100, 200]
    })
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));
});
