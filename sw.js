/* «Обед ПСО» — фоновая часть приложения: показывает уведомления о новом меню.
 * Ничего не кэширует и не перехватывает запросы — приложение всегда загружается с сайта как обычно. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

/* сообщение приходит зашифрованным от Google Таблицы организатора: {title, body, tag}; tag — menu, summary (сводка в 21:00) или test */
self.addEventListener('push', e => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch (err) {}
  const tag = m.tag === 'test' || m.tag === 'summary' ? m.tag : 'menu';
  const shown = self.registration.showNotification(m.title || 'Обед ПСО: новое меню', {
    body: m.body || 'Откройте приложение и отметьте блюда.',
    tag: tag,
    renotify: true,   /* новое уведомление с тем же тегом — снова со звуком (Android); Safari поле пропускает */
    icon: 'icons/icon-192.png',
    lang: 'ru',
    data: { url: './' }
  });
  /* значок-счётчик на иконке приложения (iPhone 16.4+, Android) — снимается, когда приложение открыли */
  const badge = tag === 'menu' && self.navigator && self.navigator.setAppBadge
    ? self.navigator.setAppBadge(1).catch(() => {}) : null;
  e.waitUntil(Promise.all([shown, badge]));
});

/* нажали на уведомление — открыть приложение (или переключиться на уже открытое) */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow('./');
  }));
});
