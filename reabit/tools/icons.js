// Значки приложения «Памятки РЕАБИТ»: node reabit/tools/icons.js (нужен Playwright).
// Рисунок: на сине-бирюзовом фоне — стопка памяток, на верхней — сердце с линией пульса, под ней «РЕАБИТ».
// icon-maskable-512.png — тот же значок, уменьшенный в «безопасную зону» (Android обрезает значок кругом).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const APP = path.resolve(__dirname, '..');
const font = f => 'data:font/woff2;base64,' + fs.readFileSync(path.join(APP, 'fonts', f)).toString('base64');

const html = scale => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:U;src:url(${font('unbounded-cyr.woff2')}) format('woff2');unicode-range:U+0400-045F;font-weight:200 900}
@font-face{font-family:U;src:url(${font('unbounded-lat.woff2')}) format('woff2');unicode-range:U+0000-00FF;font-weight:200 900}
html,body{margin:0;width:100%;height:100%;overflow:hidden}
svg{display:block;width:100vw;height:100vh}
</style></head><body>
<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2475BC"/><stop offset=".5" stop-color="#1F5F99"/><stop offset="1" stop-color="#1F8A7E"/>
    </linearGradient>
    <radialGradient id="hl" cx=".25" cy=".15" r=".7">
      <stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="heart" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2BA595"/><stop offset="1" stop-color="#1B7D71"/>
    </linearGradient>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#06223A" flood-opacity=".35"/></filter>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <rect width="1024" height="1024" fill="url(#hl)"/>
  <g transform="translate(512 512) scale(${scale}) translate(-512 -512)">
    <!-- нижняя памятка -->
    <rect x="300" y="150" width="400" height="500" rx="40" fill="#fff" fill-opacity=".38" transform="rotate(-9 500 400)"/>
    <!-- верхняя памятка с загнутым уголком -->
    <g filter="url(#sh)">
      <path d="M352 168 H612 L712 268 V642 Q712 682 672 682 H352 Q312 682 312 642 V208 Q312 168 352 168 Z" fill="#fff"/>
      <path d="M612 168 V238 Q612 268 642 268 H712 Z" fill="#CFE0EE"/>
    </g>
    <!-- сердце и пульс -->
    <path d="M512 520 C430 462 384 420 384 364 C384 324 414 296 452 296 C478 296 499 310 512 332 C525 310 546 296 572 296 C610 296 640 324 640 364 C640 420 594 462 512 520 Z" fill="url(#heart)"/>
    <polyline points="372,404 452,404 478,352 510,452 538,380 556,404 652,404" fill="none" stroke="#fff" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="370" y="566" width="284" height="20" rx="10" fill="#C7D7E6"/>
    <rect x="370" y="612" width="210" height="20" rx="10" fill="#C7D7E6"/>
    <!-- надпись -->
    <text x="512" y="862" text-anchor="middle" font-family="U" font-weight="700" font-size="128" letter-spacing="2" fill="#fff">РЕАБИТ</text>
  </g>
</svg></body></html>`;

(async () => {
  const b = await chromium.launch();
  for (const [name, size, scale] of [['apple-touch-icon.png', 180, 1], ['icon-192.png', 192, 1], ['icon-512.png', 512, 1], ['icon-maskable-512.png', 512, 0.74]]) {
    const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await p.setContent(html(scale), { waitUntil: 'load' });
    await p.evaluate(() => document.fonts.ready);
    await p.evaluate(() => document.fonts.load('700 128px U', 'РЕАБИТ'));
    await p.screenshot({ path: path.join(APP, 'icons', name) });
    await p.close();
    console.log('icons/' + name);
  }
  await b.close();
})();
