// Guardian alerts by FCM web push (backend/app/notifier.py -> src/lib/push.ts). Imported into the generated service
// worker (vite.config.ts, workbox.importScripts), so the PWA keeps a single worker and no Firebase code runs here.
// The payload carries one summary sentence and the risk level - never a transcript.
self.addEventListener('push', (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch (e) {}
  const note = message.notification || {};
  event.waitUntil(
    self.registration.showNotification(note.title || 'Sagi Shield', {
      body: note.body || '',
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag: 'sagi-alert', // a newer alert replaces the older one instead of stacking
      renotify: true,
      requireInteraction: true, // stays until the guardian acts on it
      data: message.data || {},
    })
  );
});

// Opening the alert lands on the guardian dashboard: an open window is focused and told to switch, otherwise the
// app opens with #guardian (read once by src/api/client.ts).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({type: 'window', includeUncontrolled: true}).then((windows) => {
      for (const client of windows) {
        if ('focus' in client) {
          client.postMessage('sagi:open-guardian');
          return client.focus();
        }
      }
      return self.clients.openWindow('/#guardian');
    })
  );
});
