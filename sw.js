/* Кэш содержит только общедоступные файлы этого приложения. */
const scope = self.registration.scope;
const prefix = 'pso:' + new URL(scope).pathname + ':shell:';
const cacheName = prefix + 'photo-v3';
const app = new URL('./', scope).href;
const assets = ['menu-editor.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/apple-touch-icon.png',
  'icons/icon-192.png', 'icons/icon-512.png', 'ocr/tesseract.min.js', 'ocr/worker.min.js',
  'ocr/tesseract-core-lstm.wasm.js', 'ocr/rus.traineddata.gz'];
const files = new Set(assets.map(path => new URL(path, scope).href));
async function installOffline() {
  const cache = await caches.open(cacheName);
  const response = await fetch(new Request(app, {cache:'reload'}));
  if (!response.ok || !(await response.clone().text()).includes('id="order-app"')) throw Error('app');
  await cache.addAll(assets.map(path => new Request(new URL(path, scope), {cache:'reload'})));
  await cache.put(app, response);
  await self.skipWaiting();
}
self.addEventListener('install', e => e.waitUntil(installOffline()));
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith(prefix) && name !== cacheName) await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('message', e => {
  if(e.data==='offline-status' && e.ports[0]) e.ports[0].postMessage('offline-ready');
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  url.search = ''; url.hash = '';
  if (url.href === app || url.href === new URL('index.html', app).href) {
    e.respondWith((async () => {
      const cache = await caches.open(cacheName);
      try {
        const response = await fetch(e.request);
        if (!response.ok || !(await response.clone().text()).includes('id="order-app"')) throw Error('app');
        await cache.put(app, response.clone());
        return response;
      } catch (error) { const saved = await cache.match(app); if (saved) return saved; throw error; }
    })());
  } else if (files.has(url.href)) {
    e.respondWith(caches.open(cacheName).then(async cache => (await cache.match(url.href)) || fetch(e.request)));
  }
});

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
