// dsh-pocket Service Worker（经 webServer 同源提供：/pocket-sw.js）
// 职责：接收推送 → 显示通知；点击通知 → 聚焦/打开 DSH 页面。
const ICON = '/favicon.svg';

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch { /* 非 JSON 载荷忽略 */ }
  event.waitUntil(
    self.registration.showNotification(data.title || 'DSH Pocket', {
      body: data.body || '',
      icon: ICON,
      badge: ICON,
      tag: data.tag || 'dsh-pocket',
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
