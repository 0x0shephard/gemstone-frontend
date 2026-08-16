/**
 * Service worker, for Web Push only.
 *
 * Deliberately does not cache anything. The app ships content-hashed chunks
 * behind atomic deploys, and a worker that serves stale assets is a very
 * effective way to reintroduce the "failed to fetch dynamically imported module"
 * class of bug that `lazyRoute` exists to recover from.
 */

self.addEventListener('install', () => {
  // Take over immediately rather than waiting for every tab to close, so
  // granting permission and receiving the first push are the same visit.
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
  } catch {
    // A push we cannot parse is still worth surfacing; silence looks identical
    // to a broken subscription from the reader's side.
    payload = { title: 'Digital Carat', body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'Digital Carat', {
      body: payload.body ?? '',
      // The 180px touch icon, because it exists. A notification naming an
      // icon the site does not serve renders with the browser's own default,
      // which is a silent way to look unbranded.
      icon: '/apple-touch-icon.png',
      badge: '/apple-touch-icon.png',
      // Replaces an earlier notice about the same offer rather than stacking a
      // second one beside it.
      tag: payload.tag,
      renotify: Boolean(payload.tag),
      data: { url: payload.url ?? '/profile' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url ?? '/profile', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Reuse a tab that is already open on this site rather than piling up a
      // new one for every notification acted on.
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          return client.navigate(target).then(() => client.focus());
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
