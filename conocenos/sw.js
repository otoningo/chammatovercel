// Service worker mínimo: solo se encarga de mostrar las notificaciones push.
// No hace caché agresivo de la app a propósito (es un chat, siempre queremos
// la versión más fresca).

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch (err) {
    payload = { title: 'Nodo', body: event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'Nodo', {
      body: payload.body || '',
      icon: '/conocenos/icons/icon.svg',
      badge: '/conocenos/icons/icon.svg',
      tag: 'nodo-message',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      if (clients.length > 0) return clients[0].focus();
      return self.clients.openWindow('/');
    })
  );
});
