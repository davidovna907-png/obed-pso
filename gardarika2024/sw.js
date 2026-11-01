/* Газета «Гардарика 2024»: хранит газету на телефоне целиком — страницу, снимки, видео, звук видео и шрифты,
   чтобы она открывалась и читалась без интернета. Снимки сохраняет сама страница (saveOffline в index.html)
   в кэш MEDIA, отсюда они отдаются без сети. Имена кэшей — свои (g24-…), чтобы не мешать фильму «Гардарика 2026». */
const SHELL = "g24-shell-v1", MEDIA = "g24-media";
const FILES = ["./", "./index.html", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png",
  "./icons/qr.svg", "./icons/invite.jpg"];
const BASE = new URL("./", self.registration.scope).pathname;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("g24-shell-") && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

/* видео браузер просит кусками (Range): отдаём нужный кусок из сохранённого файла — без этого iPhone не играет видео без сети */
async function part(req, res){
  const buf = await res.arrayBuffer(), size = buf.byteLength;
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") || "");
  let start = 0, end = size - 1;
  if (m && m[1]) { start = +m[1]; if (m[2]) end = Math.min(+m[2], size - 1); }
  else if (m && m[2]) start = Math.max(0, size - +m[2]);
  return new Response(buf.slice(start, end + 1), {status: 206, statusText: "Partial Content", headers: {
    "Content-Type": res.headers.get("Content-Type") || "video/mp4", "Content-Range": `bytes ${start}-${end}/${size}`,
    "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes"}});
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const fonts = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (url.origin !== location.origin && !fonts) return;
  if (url.origin === location.origin && !url.pathname.startsWith(BASE)) return;

  /* снимки, видео, звук: сначала сохранённая копия (они не меняются: переделанный файл получает ?v=2) */
  if (url.origin === location.origin && url.pathname.startsWith(BASE + "photos/")) {
    e.respondWith(caches.open(MEDIA).then(c => c.match(req.url).then(hit => {
      if (hit) return req.headers.has("range") ? part(req, hit) : hit;
      return fetch(req).then(res => {
        if (res.ok && res.status === 200 && !req.headers.has("range")) c.put(req.url, res.clone());
        return res;
      });
    })));
    return;
  }
  /* шрифты: сохранённая копия (её кладёт и сама страница — saveFonts, кэш g24-fonts), в фоне — обновление */
  if (fonts) {
    e.respondWith(caches.match(req, {ignoreVary: true}).then(hit => {
      const net = fetch(req).then(res => { if (res && (res.ok || res.type === "opaque")) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)); } return res; })
        .catch(() => hit || Response.error());
      return hit || net;
    }));
    return;
  }
  /* страница и значки: сначала сеть (чтобы новые снимки появлялись сразу), без сети — сохранённая копия */
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
