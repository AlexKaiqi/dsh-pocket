// dsh-pocket Service Worker（经 webServer 同源提供：/pocket-sw.js）
// 职责：接收推送 → 显示通知；点击通知 → 聚焦/打开 DSH 页面。
// 图标用内联 data URI（不依赖 dsh 静态资源，避免 404 导致通知无图标）。
const ICON = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
  '<rect width="64" height="64" rx="14" fill="#4f6ef7"/>' +
  '<rect x="16" y="12" width="32" height="40" rx="5" fill="#fff"/>' +
  '<rect x="22" y="18" width="20" height="26" rx="2" fill="#4f6ef7"/>' +
  '<circle cx="32" cy="49" r="2.2" fill="#fff"/>' +
  '</svg>');

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
