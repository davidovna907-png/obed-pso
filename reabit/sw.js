/* Приложение «Памятки РЕАБИТ»: хранит в телефоне оболочку приложения (страницу, просмотр PDF, шрифты, значки),
   чтобы оно открывалось без интернета. Сами памятки (files/*.bin) и каталог (data.bin) зашифрованы;
   их сохраняет и достаёт из памяти сама страница (кэши reabit-files и reabit-data), здесь они не трогаются.
   При изменении списка FILES поднимать версию SHELL. */
const SHELL = "reabit-shell-v1";
const FILES = ["./", "./index.html", "./manifest.webmanifest", "./key.json",
  "./vendor/pdf.min.js", "./vendor/pdf.worker.min.js",
  "./fonts/golos-cyr.woff2", "./fonts/golos-lat.woff2", "./fonts/unbounded-cyr.woff2", "./fonts/unbounded-lat.woff2",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png", "./icons/apple-touch-icon.png"];
const BASE = new URL("./", self.registration.scope).pathname;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("reabit-shell-") && k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || !url.pathname.startsWith(BASE)) return;
  const rest = url.pathname.slice(BASE.length);
  if (rest.startsWith("files/") || rest === "data.bin" || rest.startsWith("tools/")) return;   /* памятки и каталог — забота страницы */

  /* просмотр PDF, шрифты, значки не меняются (новая версия — новая SHELL): сначала сохранённая копия */
  if (rest.startsWith("vendor/") || rest.startsWith("fonts/") || rest.startsWith("icons/")) {
    e.respondWith(caches.match(req, {ignoreSearch: true}).then(hit => hit || fetch(req).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  /* страница, manifest, key.json: сначала сеть (чтобы обновления приходили сразу), без сети — сохранённая копия */
  let net = req;
  if (req.mode === "navigate" || /(\/|\.html)$/.test(url.pathname)) {
    try { net = new Request(req, {cache: "no-cache"}); } catch (err) {}
  }
  e.respondWith(
    fetch(net).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, {ignoreSearch: true}).then(r => r || (req.mode === "navigate" ? caches.match("./index.html") : undefined)))
  );
});
