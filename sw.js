// Receives push messages and shows them. No caching: the site always loads fresh.
// iOS withdraws a subscription that receives pushes without showing anything,
// so every push ends in a notification, even when its content cannot be read.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data.json();
  } catch {
    // Keep the defaults below.
  }
  event.waitUntil(self.registration.showNotification(data.title || 'Rimbak', {
    body: data.body || '',
    icon: 'icons/icon-192.png',
    tag: data.tag,
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (open.length) return open[0].focus();
    return self.clients.openWindow(self.registration.scope);
  })());
});
