/* ProcureFlow public app shell. No business records, APIs, or private documents are cached. */
const CACHE_NAME = 'procureflow-public-v2';
// Registration scope is / on localhost, /Procurement-System/ on GitHub Pages.
const BASE = new URL(self.registration.scope);
const publicURL = path => new URL(path, BASE).href;
const SHELL = ['','index.html','manifest.webmanifest','pwa-192.png','pwa-512.png']
  .map(publicURL);
const PUBLIC_ASSET = /^(?:assets\/[^?#]+|pwa-(?:192|512)\.png|manifest\.webmanifest|procureflow-(?:mark|favicon)\.png)$/;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME)
    .then(cache => cache.addAll(SHELL))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys
      .filter(key => key.startsWith('procureflow-public-') && key !== CACHE_NAME)
      .map(key => caches.delete(key)))),
    self.clients.claim(),
  ]));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== BASE.origin ||
      !url.pathname.startsWith(BASE.pathname)) return;
  const relative = url.pathname.slice(BASE.pathname.length);
  if (request.mode === 'navigate') {
    // Never cache personalized responses. This application serves only a public HTML shell.
    event.respondWith(fetch(request).then(response => {
      if (response.ok && response.type === 'basic' &&
          response.headers.get('content-type')?.includes('text/html')) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(publicURL('index.html'), copy)));
      }
      return response;
    }).catch(async () => await caches.match(publicURL('index.html')) || Response.error()));
    return;
  }
  // Only fixed public build assets can be stored. The Worker API is a separate origin.
  if (!PUBLIC_ASSET.test(relative)) return;
  if (relative === 'manifest.webmanifest') {
    event.respondWith(fetch(request).catch(() => caches.match(request)));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok && response.type === 'basic') {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(request, copy)));
    }
    return response;
  })));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.tab || 'notifications';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(async clients => {
      const existing = clients.find(client => {
        const url = new URL(client.url);
        return url.origin === BASE.origin && url.pathname.startsWith(BASE.pathname);
      });
      if (existing) {
        await existing.focus();
        existing.postMessage({ type: 'PROCUREFLOW_OPEN_MODULE', tab: target });
      } else {
        await self.clients.openWindow(publicURL('?from=notification'));
      }
    }));
});
// No push handler: notifications only arrive while the application is running.
