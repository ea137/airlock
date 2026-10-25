// The service worker only shows push notifications: it caches nothing and
// doesn't see any other request.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = {};
  }
  const text = (value, otherwise) => (typeof value === 'string' && value ? value : otherwise);
  // Only a place inside Airlock.
  const url = text(message.url, '#/').startsWith('#/') ? message.url : '#/';
  event.waitUntil(
    self.registration.showNotification(text(message.title, 'Airlock'), {
      body: text(message.body, ''),
      tag: text(message.tag, undefined),
      icon: new URL('icon-512.png', self.registration.scope).href,
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? '#/', self.registration.scope).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows[0];
      if (open) {
        await open.focus();
        if ('navigate' in open) await open.navigate(url).catch(() => undefined);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
