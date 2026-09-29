// Installing the site as an app needs a service worker. This one deliberately caches nothing:
// every page and API answer comes fresh from the server.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
