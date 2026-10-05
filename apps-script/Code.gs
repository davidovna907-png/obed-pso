/**
 * «Обед ПСО» — общий заказ всех коллег в Google Таблице.
 *
 * Как подключить (один раз, удобнее с компьютера):
 * 1. Создать Google Таблицу → «Расширения» → «Apps Script».
 * 2. Стереть всё в редакторе, вставить этот код, нажать «Сохранить».
 * 3. «Начать развертывание» → «Новое развертывание» → тип «Веб-приложение»;
 *    «Запуск от имени»: я, «У кого есть доступ»: все → «Начать развертывание» → разрешить доступ.
 * 4. Скопировать «URL веб-приложения» — его вписывают в ORDERS_API в index.html.
 * 5. Открыть этот адрес в браузере: в таблице появится лист «Настройки» с кодом организатора.
 *
 * Кто что видит: коллега получает только заказы своих участников (по именам);
 * все заказы, общую сумму и архив — только тот, кто ввёл в приложении код организатора.
 *
 * Если этот код потом поменяется:
 * 1. Заменить весь текст в редакторе новым кодом и нажать «Сохранить».
 * 2. Вверху выбрать функцию «setup» → «Выполнить» → разрешить доступ (нужно, если скрипт просит новые разрешения).
 * 3. «Начать развертывание» → «Управление развертываниями» → ✎ → версия «Новая версия» → «Начать развертывание»
 *    (адрес останется прежним).
 */
const SHEET_NAME = 'Заказы';
const SETTINGS_NAME = 'Настройки';
const SUBS_NAME = 'Уведомления';
const HEAD = ['Дата меню', 'Участник', 'Заказ', 'Сумма, ₽', 'Обновлено', 'Данные для приложения'];
const SUBS_HEAD = ['Адрес телефона для уведомлений', 'Ключ p256dh', 'Ключ auth', 'Добавлен', 'Последнее уведомление', 'Ответ службы'];
/* адрес приложения: отсюда скрипт узнаёт, что вышло новое меню */
const APP_URL = 'https://davidovna907-png.github.io/obed-pso/';
const ARCHIVE_DAYS = 120;   /* сколько последних дней заказов отдавать в архив */
const MAX_SUBS = 300;       /* сколько телефонов можно подписать на уведомления */
const KEY_TRIES = 30;       /* неверных кодов организатора подряд — затем пауза 10 минут */

/* Адрес, открытый в браузере: проверка, что всё работает; заодно создаются листы и код организатора */
function doGet() {
  return locked_(() => {
    sheet_();
    code_();
    return ContentService.createTextOutput('Обед ПСО: всё работает. Код организатора — в таблице, на листе «Настройки».')
      .setMimeType(ContentService.MimeType.TEXT);
  });
}

/* Запустить один раз из редактора («Выполнить»), чтобы разрешить скрипту всё нужное: таблицу и отправку уведомлений */
function setup() {
  locked_(() => { sheet_(); subsSheet_(); code_(); vapid_(); });
  const menu = liveMenu_();
  Logger.log('Обед ПСО: всё готово. Меню на сайте: ' + (menu ? menu.date : 'не удалось прочитать'));
}

/*
 * Все запросы приложения — POST с JSON:
 *   {date, key?, names?, set?: [{name, items, sum, text}], clear?: true} — заказы на дату (как раньше);
 *   {action: 'archive', key} — архив заказов по датам (только организатору);
 *   {action: 'push-key'} — открытый ключ для подписки на уведомления;
 *   {action: 'subscribe', sub: {endpoint, keys: {p256dh, auth}}} — подписать телефон на уведомления;
 *   {action: 'unsubscribe' | 'push-test', endpoint} — отписать телефон / прислать ему проверочное уведомление;
 *   {action: 'notify'} — проверить, вышло ли новое меню, и разослать уведомления.
 */
function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'json' }); }
  if (!req || typeof req !== 'object') return json_({ ok: false, error: 'json' });
  const action = String(req.action || '');
  try {
    if (action === 'push-key') return json_({ ok: true, key: locked_(() => vapid_().pub) });
    if (action === 'subscribe') return json_(subscribe_(req.sub));
    if (action === 'unsubscribe') return json_(unsubscribe_(req.endpoint));
    if (action === 'push-test') return json_(pushTest_(req.endpoint));
    if (action === 'notify') return json_(notify_());
    if (action === 'archive') return json_(locked_(() => {
      const k = keyCheck_(req.key);
      if (k !== 'ok') return { ok: false, error: k };
      return { ok: true, admin: true, days: archive_(sheet_()) };
    }));
    if (action) return json_({ ok: false, error: 'action' });
  } catch (err) {
    return json_({ ok: false, error: 'server', message: String(err && err.message || err).slice(0, 200) });
  }

  const date = cleanDate_(req.date);
  if (!date) return json_({ ok: false, error: 'date' });
  const out = locked_(() => {
    code_();   /* лист «Настройки» с кодом появляется при первом же заказе */
    const admin = req.key != null && req.key !== '';
    if (admin) {
      const k = keyCheck_(req.key);
      if (k !== 'ok') return { ok: false, error: k };
    }
    if (req.clear === true && !admin) return { ok: false, error: 'key' };
    const sh = sheet_();
    if (req.clear === true) remove_(sh, rows_(sh).filter(r => r.date === date));
    const set = Array.isArray(req.set) ? req.set.slice(0, 200) : [];
    set.forEach(o => save_(sh, date, o));
    const all = read_(sh, date);
    if (admin) return { ok: true, admin: true, orders: all };
    /* коллеге — только заказы участников с его телефона */
    const want = Object.create(null), mine = Object.create(null);
    (Array.isArray(req.names) ? req.names.slice(0, 100) : []).concat(set.map(o => o && o.name))
      .forEach(n => { n = cleanName_(n); if (n) want[n.toLowerCase()] = true; });
    Object.keys(all).forEach(n => { if (want[n.toLowerCase()]) mine[n] = all[n]; });
    return { ok: true, admin: false, orders: mine };
  });
  /* телефон с новым меню — повод проверить, не пора ли разослать уведомления (ошибки здесь заказу не мешают) */
  try { maybeNotify_(date); } catch (err) {}
  return json_(out);
}

/* код организатора; после KEY_TRIES неверных попыток проверка закрыта на 10 минут — так код не подобрать перебором */
function keyCheck_(key) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('keyFails') || 0);
  if (fails >= KEY_TRIES) return 'wait';
  if (normCode_(key) === normCode_(code_())) return 'ok';
  cache.put('keyFails', String(fails + 1), 600);
  return 'key';
}

/* заказ одного участника: заменить его строку или удалить, если ничего не выбрано */
function save_(sh, date, o) {
  const name = cleanName_(o && o.name);
  if (!name || name === '__proto__') return;
  const src = (o && typeof o.items === 'object' && o.items) || {}, items = {};
  Object.keys(src).forEach(id => {
    const q = Math.min(20, Math.floor(Number(src[id])));
    if (/^[a-z]+\d+$/.test(id) && q > 0) items[id] = q;
  });
  const key = name.toLowerCase();
  const mine = rows_(sh).filter(r => r.date === date && r.name.toLowerCase() === key);
  if (!Object.keys(items).length) return remove_(sh, mine);
  const row = [txt_(date), txt_(name), txt_(String(o.text || '').slice(0, 1000)),
    Math.max(0, Number(o.sum) || 0), new Date(), txt_(JSON.stringify(items))];
  if (mine.length) {
    sh.getRange(mine[0].row, 1, 1, row.length).setValues([row]);
    remove_(sh, mine.slice(1));
  } else {
    sh.appendRow(row);
  }
}

/* все заказы на дату: {"Фамилия Имя": {"h3": 1}} */
function read_(sh, date) {
  const out = Object.create(null);
  rows_(sh).forEach(r => {
    if (r.date !== date || !r.name || r.name === '__proto__') return;
    try { out[r.name] = JSON.parse(r.data); } catch (err) {}
  });
  return out;
}

/* архив: последние ARCHIVE_DAYS дней, новые сверху; по каждому участнику — блюда текстом и сумма */
function archive_(sh) {
  const by = Object.create(null);
  rows_(sh).forEach(r => {
    if (!cleanDate_(r.date) || !r.name || r.name === '__proto__') return;
    (by[r.date] = by[r.date] || []).push({ name: r.name, text: r.text, sum: r.sum });
  });
  return Object.keys(by).sort().reverse().slice(0, ARCHIVE_DAYS).map(date => {
    const people = by[date].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    return { date: date, sum: people.reduce((s, p) => s + p.sum, 0), people: people };
  });
}

function rows_(sh) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const tz = Session.getScriptTimeZone();
  const s = v => String(v).replace(/^'/, '');
  return sh.getRange(2, 1, n, HEAD.length).getValues().map((v, i) => ({
    row: i + 2,
    date: v[0] instanceof Date ? Utilities.formatDate(v[0], tz, 'yyyy-MM-dd') : s(v[0]),
    name: s(v[1]),
    text: s(v[2]),
    sum: Math.max(0, Number(v[3]) || 0),
    data: s(v[5])
  }));
}

function remove_(sh, rows) {
  if (!rows.length) return;
  /* на листе должна остаться хотя бы одна незакреплённая строка, иначе удаление не сработает */
  if (sh.getMaxRows() - rows.length <= sh.getFrozenRows()) sh.insertRowsAfter(sh.getMaxRows(), rows.length);
  rows.map(r => r.row).sort((a, b) => b - a).forEach(r => sh.deleteRow(r));
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/* код организатора: создаётся один раз на листе «Настройки», его можно заменить на свой */
function code_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SETTINGS_NAME);
  if (!sh) {
    sh = ss.insertSheet(SETTINGS_NAME);
    sh.getRange(1, 1, 3, 2).setValues([
      ['Код организатора', txt_(String(Math.floor(100000 + Math.random() * 900000)))],
      ['', 'Введите этот код в приложении: вкладка «Мой заказ» → «Вход для организатора».'],
      ['', 'Код можно заменить на свой (лучше из цифр) — тогда войти нужно будет с новым кодом.']
    ]);
  }
  return String(sh.getRange(1, 2).getDisplayValue()).trim();
}

/* ---------- уведомления о новом меню (Web Push: RFC 8030, ключи VAPID — RFC 8292, шифрование — RFC 8291) ---------- */

const WD_ACC = ['воскресенье', 'понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу'];
const WD_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

function subsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SUBS_NAME);
  if (!sh) {
    sh = ss.insertSheet(SUBS_NAME);
    sh.getRange(1, 1, 1, SUBS_HEAD.length).setValues([SUBS_HEAD]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function subs_(sh) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const s = v => String(v).replace(/^'/, '');
  return sh.getRange(2, 1, n, 3).getValues().map((v, i) => ({ row: i + 2, endpoint: s(v[0]), p256dh: s(v[1]), auth: s(v[2]) }));
}

/* принимаем только адреса настоящих служб уведомлений (Apple, Google, Mozilla, Microsoft) */
function cleanEndpoint_(s) {
  s = String(s || '').trim();
  const ok = /^https:\/\/(web\.push\.apple\.com|fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)\/[A-Za-z0-9_\-.~:\/%+=?&]+$/;
  return s.length <= 1000 && ok.test(s) ? s : '';
}

/* подписка телефона: адрес + ключи шифрования (p256dh — точка на кривой P-256, auth — 16 байт) */
function cleanSub_(sub) {
  if (!sub || typeof sub !== 'object') return null;
  const endpoint = cleanEndpoint_(sub.endpoint), keys = sub.keys || {};
  const p256dh = String(keys.p256dh || ''), auth = String(keys.auth || '');
  if (!endpoint || !/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{20,30}$/.test(auth)) return null;
  try {
    if (unb64url_(auth).length !== 16 || !uaPoint_(p256dh)) return null;
  } catch (err) { return null; }
  return { endpoint: endpoint, p256dh: p256dh, auth: auth };
}

function subscribe_(sub) {
  const s = cleanSub_(sub);
  if (!s) return { ok: false, error: 'endpoint' };
  return locked_(() => {
    const sh = subsSheet_(), all = subs_(sh), old = all.find(r => r.endpoint === s.endpoint);
    if (old) sh.getRange(old.row, 2, 1, 2).setValues([[txt_(s.p256dh), txt_(s.auth)]]);
    else {
      if (all.length >= MAX_SUBS) return { ok: false, error: 'full' };
      sh.appendRow([txt_(s.endpoint), txt_(s.p256dh), txt_(s.auth), new Date(), '', '']);
    }
    return { ok: true };
  });
}

function unsubscribe_(endpoint) {
  const ep = cleanEndpoint_(endpoint);
  if (!ep) return { ok: true };
  return locked_(() => {
    const sh = subsSheet_();
    remove_(sh, subs_(sh).filter(r => r.endpoint === ep));
    return { ok: true };
  });
}

/* проверочное уведомление — только на уже подписанный телефон и не чаще раза в 20 секунд */
function pushTest_(endpoint) {
  const ep = cleanEndpoint_(endpoint);
  if (!ep) return { ok: false, error: 'endpoint' };
  const cache = CacheService.getScriptCache(), ck = 'test:' + b64url_(sha256_(ep)).slice(0, 40);
  if (cache.get(ck)) return { ok: false, error: 'wait' };
  cache.put(ck, '1', 20);
  const sub = locked_(() => subs_(subsSheet_()).find(r => r.endpoint === ep));
  if (!sub) return { ok: false, error: 'unknown' };
  const status = send_([sub], { title: 'Обед ПСО', body: 'Проверка: уведомления на этом телефоне работают ✓', tag: 'test' })[0];
  report_([{ endpoint: ep, status: status }]);
  return { ok: status >= 200 && status < 300, status: status };
}

/* приложение прислало дату меню новее последней рассылки — проверяем сайт (не чаще раза в 2 минуты) */
function maybeNotify_(clientDate) {
  const last = PropertiesService.getScriptProperties().getProperty('menuNotified') || '';
  if (!clientDate || clientDate <= last) return;
  const cache = CacheService.getScriptCache();
  if (cache.get('menuCheck')) return;
  cache.put('menuCheck', '1', 120);
  notify_();
}

/* разослать уведомления, если на сайте меню новее последней рассылки; дату с телефона на веру не берём */
function notify_() {
  const menu = liveMenu_();
  if (!menu) return { ok: false, error: 'menu' };
  const props = PropertiesService.getScriptProperties();
  const go = locked_(() => {
    const last = props.getProperty('menuNotified') || '';
    if (menu.date <= last || menu.date < daysFromToday_(-1)) return false;   /* уже разослано или меню старое */
    props.setProperty('menuNotified', menu.date);
    return true;
  });
  if (!go) return { ok: true, date: menu.date, sent: 0 };
  const list = locked_(() => subs_(subsSheet_()));
  const statuses = list.length ? send_(list, menuMessage_(menu)) : [];
  report_(list.map((s, i) => ({ endpoint: s.endpoint, status: statuses[i] })));
  return { ok: true, date: menu.date, sent: statuses.filter(s => s >= 200 && s < 300).length, total: list.length };
}

/* «На вторник 06.10 — отметьте блюда до 21:00, пн 05.10» */
function menuMessage_(menu) {
  const p = menu.date.split('-').map(Number), day = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  const prev = new Date(day.getTime() - 864e5), dd = d => ('0' + d.getUTCDate()).slice(-2) + '.' + ('0' + (d.getUTCMonth() + 1)).slice(-2);
  return {
    title: 'Обед ПСО: новое меню',
    body: 'Меню на ' + WD_ACC[day.getUTCDay()] + ' ' + dd(day) + '. Отметьте блюда до ' + menu.collectBy + ', ' + WD_SHORT[prev.getUTCDay()] + ' ' + dd(prev) + '.',
    tag: 'menu'
  };
}

/* меню, которое сейчас опубликовано на сайте приложения: {date, collectBy} */
function liveMenu_() {
  const r = UrlFetchApp.fetch(APP_URL + '?menu=' + Date.now(), { muteHttpExceptions: true, followRedirects: true });
  if (r.getResponseCode() !== 200) return null;
  const m = r.getContentText('UTF-8').match(/id="menu-data"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[1]), date = cleanDate_(j.date);
    const by = /^\d{1,2}:\d{2}$/.test(String(j.collectBy || '')) ? String(j.collectBy) : '21:00';
    return date ? { date: date, collectBy: by } : null;
  } catch (err) { return null; }
}

function daysFromToday_(n) {
  return Utilities.formatDate(new Date(Date.now() + n * 864e5), 'Asia/Yekaterinburg', 'yyyy-MM-dd');
}

/* отправка: каждому телефону — своё зашифрованное сообщение; ответ службы — код HTTP (201 — принято) */
function send_(subs, message) {
  const keys = locked_(() => vapid_()), auth = {}, out = [], text = JSON.stringify(message);
  const eph = newKeyPair_();
  const reqs = subs.map((s, i) => {
    const aud = s.endpoint.match(/^https:\/\/[^\/]+/)[0];
    if (!auth[aud]) auth[aud] = vapidHeader_(aud, keys);
    let body = null;
    try { body = encrypt_(s, text, eph, i); } catch (err) {}
    return body && {
      url: s.endpoint, method: 'post', contentType: 'application/octet-stream', payload: signed_(body),
      headers: { 'Content-Encoding': 'aes128gcm', TTL: '43200', Urgency: 'high', Authorization: auth[aud] },
      muteHttpExceptions: true, followRedirects: false
    };
  });
  const ready = reqs.filter(Boolean), codes = [];
  for (let i = 0; i < ready.length; i += 50) {
    UrlFetchApp.fetchAll(ready.slice(i, i + 50)).forEach(r => codes.push(r.getResponseCode()));
  }
  let k = 0;
  reqs.forEach(r => out.push(r ? codes[k++] : 0));
  return out;
}

/* записать результат рассылки; телефоны, которые отписались (404/410) или с испорченными ключами (0), убрать */
function report_(results) {
  if (!results.length) return;
  locked_(() => {
    const sh = subsSheet_(), rows = subs_(sh), gone = [], now = new Date();
    results.forEach(res => {
      const r = rows.find(x => x.endpoint === res.endpoint);
      if (!r) return;
      if (res.status === 404 || res.status === 410 || res.status === 0) gone.push(r);
      else sh.getRange(r.row, 5, 1, 2).setValues([[now, res.status]]);
    });
    remove_(sh, gone);
  });
}

/* ключи VAPID: создаются один раз и хранятся в свойствах скрипта */
function vapid_() {
  const props = PropertiesService.getScriptProperties();
  let d = props.getProperty('vapidD'), pub = props.getProperty('vapidPub');
  if (!d || !pub) {
    const kp = newKeyPair_();
    d = kp.d.toString(16);
    pub = b64url_(kp.pub);
    props.setProperties({ vapidD: d, vapidPub: pub });
  }
  return { d: BigInt('0x' + d), pub: pub };
}

/* новая пара ключей P-256; случайность — из Utilities.getUuid() (SecureRandom на стороне Google) */
function newKeyPair_() {
  const E = ec_();
  let seed = '';
  for (let i = 0; i < 8; i++) seed += Utilities.getUuid();
  const d = mod_(bytesToInt_(sha256_(seed + Date.now())), E.n - E.one) + E.one;
  const Q = mul_(d, [E.gx, E.gy]);
  return { d: d, pub: [4].concat(intToBytes_(Q[0]), intToBytes_(Q[1])) };
}

/* заголовок Authorization по RFC 8292: JWT ES256, подписанный ключом VAPID */
function vapidHeader_(aud, keys) {
  const head = b64urlStr_('{"typ":"JWT","alg":"ES256"}');
  const body = b64urlStr_(JSON.stringify({ aud: aud, exp: Math.floor(Date.now() / 1000) + 3600, sub: APP_URL }));
  const sig = ecdsaSign_(head + '.' + body, keys.d);
  return 'vapid t=' + head + '.' + body + '.' + b64url_(sig) + ', k=' + keys.pub;
}

/* шифрование сообщения для одного телефона (RFC 8291, aes128gcm): заголовок + шифротекст */
function encrypt_(sub, text, eph, i, fixedSalt) {
  const ua = unb64url_(sub.p256dh), auth = unb64url_(sub.auth), P = uaPoint_(sub.p256dh);
  if (!P || auth.length !== 16) throw new Error('ключи телефона');
  const S = mul_(eph.d, P), ecdh = intToBytes_(S[0]);
  const ikm = hmac_(hmac_(auth, ecdh), ascii_('WebPush: info').concat([0], ua, eph.pub, [1]));
  const salt = fixedSalt || sha256_(Utilities.getUuid() + Utilities.getUuid() + i + Date.now()).slice(0, 16);
  const prk = hmac_(salt, ikm);
  const cek = hmac_(prk, ascii_('Content-Encoding: aes128gcm').concat([0, 1])).slice(0, 16);
  const nonce = hmac_(prk, ascii_('Content-Encoding: nonce').concat([0, 1])).slice(0, 12);
  const ct = gcm_(cek, nonce, utf8_(text).concat([2]));
  return salt.concat([0, 0, 16, 0], [65], eph.pub, ct);   /* rs = 4096, keyid = открытый ключ отправителя */
}

/* открытый ключ телефона → точка [x, y] на кривой P-256 (или null) */
function uaPoint_(p256dh) {
  const E = ec_(), b = unb64url_(p256dh);
  if (b.length !== 65 || b[0] !== 4) return null;
  const x = bytesToInt_(b.slice(1, 33)), y = bytesToInt_(b.slice(33));
  if (x >= E.p || y >= E.p) return null;
  const lhs = y * y % E.p, rhs = mod_(x * x % E.p * x - E.three * x + E.b, E.p);
  return lhs === rhs ? [x, y] : null;
}

/* --- кривая P-256 и подпись ECDSA + SHA-256 (RFC 6979: число k выводится из ключа и сообщения) ---
 * Константы создаются при первом вызове через BigInt('0x…'): если BigInt вдруг недоступен,
 * сломаются только уведомления, а заказы будут работать. */
let EC_ = null;
function ec_() {
  if (EC_) return EC_;
  const B = s => BigInt(s);
  EC_ = {
    p: B('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff'),
    n: B('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551'),
    b: B('0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b'),
    gx: B('0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296'),
    gy: B('0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5'),
    zero: B(0), one: B(1), two: B(2), three: B(3), four: B(4), eight: B(8), b256: B(256),
    r128: B('0xe1') << B(120)
  };
  return EC_;
}

function mod_(a, m) { const r = a % m; return r < ec_().zero ? r + m : r; }

function inv_(a, m) {
  const E = ec_();
  let t = E.zero, nt = E.one, r = m, nr = mod_(a, m);
  while (nr !== E.zero) {
    const q = r / nr;
    const t2 = t - q * nt; t = nt; nt = t2;
    const r2 = r - q * nr; r = nr; nr = r2;
  }
  return mod_(t, m);
}

/* точки в координатах Якоби [X, Y, Z]; null — бесконечно удалённая точка; у P-256 a = −3 */
function jDouble_(P) {
  const E = ec_(), p = E.p;
  if (!P || P[1] === E.zero) return null;
  const X = P[0], Y = P[1], Z = P[2];
  const delta = Z * Z % p, gamma = Y * Y % p, beta = X * gamma % p;
  const alpha = E.three * mod_(X - delta, p) % p * ((X + delta) % p) % p;
  const X3 = mod_(alpha * alpha - E.eight * beta, p);
  const Z3 = mod_((Y + Z) * (Y + Z) - gamma - delta, p);
  const Y3 = mod_(alpha * mod_(E.four * beta - X3, p) - E.eight * (gamma * gamma % p), p);
  return [X3, Y3, Z3];
}

function jAdd_(P, Q) {
  if (!P) return Q;
  if (!Q) return P;
  const E = ec_(), p = E.p;
  const Z1Z1 = P[2] * P[2] % p, Z2Z2 = Q[2] * Q[2] % p;
  const U1 = P[0] * Z2Z2 % p, U2 = Q[0] * Z1Z1 % p;
  const S1 = P[1] * Q[2] % p * Z2Z2 % p, S2 = Q[1] * P[2] % p * Z1Z1 % p;
  const H = mod_(U2 - U1, p), r = mod_(S2 - S1, p);
  if (H === E.zero) return r === E.zero ? jDouble_(P) : null;
  const H2 = H * H % p, H3 = H * H2 % p, U1H2 = U1 * H2 % p;
  const X3 = mod_(r * r - H3 - E.two * U1H2, p);
  const Y3 = mod_(r * mod_(U1H2 - X3, p) - S1 * H3, p);
  const Z3 = H * P[2] % p * Q[2] % p;
  return [X3, Y3, Z3];
}

/* k·P для точки P = [x, y]; результат — [x, y] или null */
function mul_(k, P) {
  const E = ec_(), J = [P[0], P[1], E.one], bits = k.toString(2);
  let R = null;
  for (let i = 0; i < bits.length; i++) {
    R = jDouble_(R);
    if (bits[i] === '1') R = jAdd_(R, J);
  }
  if (!R) return null;
  const zi = inv_(R[2], E.p), zi2 = zi * zi % E.p;
  return [R[0] * zi2 % E.p, R[1] * zi2 % E.p * zi % E.p];
}

/* подпись сообщения (строка) — 64 байта r‖s, как требует JWT ES256 */
function ecdsaSign_(msg, d) {
  const E = ec_(), n = E.n;
  const e = bytesToInt_(sha256_(msg));
  const x = intToBytes_(d), h1 = intToBytes_(mod_(e, n));
  let V = [], K = [];
  for (let i = 0; i < 32; i++) { V.push(1); K.push(0); }
  K = hmac_(K, V.concat([0], x, h1)); V = hmac_(K, V);
  K = hmac_(K, V.concat([1], x, h1)); V = hmac_(K, V);
  for (let tries = 0; tries < 100; tries++) {
    V = hmac_(K, V);
    const k = bytesToInt_(V);
    if (k > E.zero && k < n) {
      const R = mul_(k, [E.gx, E.gy]);
      const r = R ? mod_(R[0], n) : E.zero;
      const s = r === E.zero ? E.zero : inv_(k, n) * mod_(e + r * d, n) % n;
      if (s !== E.zero) return intToBytes_(r).concat(intToBytes_(s));
    }
    K = hmac_(K, V.concat([0])); V = hmac_(K, V);
  }
  throw new Error('ECDSA: не удалось подписать');
}

/* --- AES-128-GCM (только шифрование): таблица S-box вычисляется, а не переписывается вручную --- */
let AES_ = null;
function aes_() {
  if (AES_) return AES_;
  const sbox = new Array(256), rotl = (x, s) => ((x << s) | (x >> (8 - s))) & 255;
  let p = 1, q = 1;
  do {
    p = (p ^ (p << 1) ^ (p & 0x80 ? 0x1b : 0)) & 255;
    q = (q ^ (q << 1)) & 255; q = (q ^ (q << 2)) & 255; q = (q ^ (q << 4)) & 255;
    if (q & 0x80) q ^= 0x09;
    sbox[p] = (q ^ rotl(q, 1) ^ rotl(q, 2) ^ rotl(q, 3) ^ rotl(q, 4) ^ 0x63) & 255;
  } while (p !== 1);
  sbox[0] = 0x63;
  AES_ = { sbox: sbox, xt: b => ((b << 1) ^ (b & 0x80 ? 0x1b : 0)) & 255 };
  return AES_;
}

function aesKeys_(key) {
  const S = aes_().sbox, w = key.slice(0, 16);
  let rcon = 1;
  for (let i = 16; i < 176; i += 4) {
    let t = w.slice(i - 4, i);
    if (i % 16 === 0) {
      t = [S[t[1]] ^ rcon, S[t[2]], S[t[3]], S[t[0]]];
      rcon = aes_().xt(rcon);
    }
    for (let j = 0; j < 4; j++) w.push(w[i - 16 + j] ^ t[j]);
  }
  return w;
}

function aesBlock_(w, inp) {
  const A = aes_(), S = A.sbox, xt = A.xt;
  let s = inp.map((b, i) => b ^ w[i]);
  for (let round = 1; round <= 10; round++) {
    const t = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) t[r + 4 * c] = S[s[r + 4 * ((c + r) % 4)]];
    if (round < 10) {
      for (let c = 0; c < 4; c++) {
        const a0 = t[4 * c], a1 = t[4 * c + 1], a2 = t[4 * c + 2], a3 = t[4 * c + 3];
        t[4 * c] = xt(a0) ^ xt(a1) ^ a1 ^ a2 ^ a3;
        t[4 * c + 1] = a0 ^ xt(a1) ^ xt(a2) ^ a2 ^ a3;
        t[4 * c + 2] = a0 ^ a1 ^ xt(a2) ^ xt(a3) ^ a3;
        t[4 * c + 3] = xt(a0) ^ a0 ^ a1 ^ a2 ^ xt(a3);
      }
    }
    s = t.map((b, i) => b ^ w[16 * round + i]);
  }
  return s;
}

/* GCM: шифротекст + метка (16 байт); nonce — 12 байт, дополнительных данных нет */
function gcm_(key, nonce, pt) {
  const E = ec_(), w = aesKeys_(key), zero16 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const H = bytesToInt_(aesBlock_(w, zero16)), J0 = nonce.concat([0, 0, 0, 1]);
  const ctr = J0.slice(), ct = [];
  for (let i = 0; i < pt.length; i += 16) {
    for (let j = 15; j >= 12; j--) { ctr[j] = (ctr[j] + 1) & 255; if (ctr[j]) break; }
    const ks = aesBlock_(w, ctr);
    pt.slice(i, i + 16).forEach((b, j) => ct.push(b ^ ks[j]));
  }
  const gmul = (X, Y) => {
    let Z = E.zero, V = Y;
    for (let i = 127; i >= 0; i--) {
      if ((X >> BigInt(i)) & E.one) Z ^= V;
      V = (V & E.one) ? (V >> E.one) ^ E.r128 : V >> E.one;
    }
    return Z;
  };
  let X = E.zero;
  for (let i = 0; i < ct.length; i += 16) {
    const blk = ct.slice(i, i + 16);
    while (blk.length < 16) blk.push(0);
    X = gmul(X ^ bytesToInt_(blk), H);
  }
  const bits = ct.length * 8, lenBlock = zero16.slice(0, 12).concat([(bits >>> 24) & 255, (bits >>> 16) & 255, (bits >>> 8) & 255, bits & 255]);
  X = gmul(X ^ bytesToInt_(lenBlock), H);
  const tag = intToBytes_(X, 16), ek = aesBlock_(w, J0);
  return ct.concat(tag.map((b, i) => b ^ ek[i]));
}

/* байты: внутри скрипта — числа 0…255; Google ждёт байты со знаком (−128…127) */
const signed_ = a => a.map(b => (b & 255) > 127 ? (b & 255) - 256 : (b & 255));
const unsigned_ = a => Array.prototype.map.call(a, b => b & 255);
const ascii_ = s => s.split('').map(c => c.charCodeAt(0) & 255);
function utf8_(s) { return unsigned_(Utilities.base64Decode(Utilities.base64Encode(s, Utilities.Charset.UTF_8))); }
function sha256_(s) { return unsigned_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); }
function hmac_(key, data) { return unsigned_(Utilities.computeHmacSha256Signature(signed_(data), signed_(key))); }
function b64url_(bytes) { return Utilities.base64EncodeWebSafe(signed_(bytes)).replace(/=+$/, ''); }
function b64urlStr_(s) { return Utilities.base64EncodeWebSafe(s, Utilities.Charset.UTF_8).replace(/=+$/, ''); }
function unb64url_(s) { s = String(s); return unsigned_(Utilities.base64DecodeWebSafe(s + '===='.slice(0, (4 - s.length % 4) % 4))); }
function bytesToInt_(a) {
  const E = ec_();
  let x = E.zero;
  for (let i = 0; i < a.length; i++) x = x * E.b256 + BigInt(a[i] & 255);
  return x;
}
/* число → 32 байта (или 16 при len = 16), старшие байты впереди */
function intToBytes_(x, len) {
  len = len || 32;
  const h = x.toString(16).padStart(len * 2, '0'), out = [];
  for (let i = 0; i < len * 2; i += 2) out.push(parseInt(h.substr(i, 2), 16));
  return out;
}

/* запросы выполняются по одному, чтобы одновременные заказы не затёрли друг друга */
function locked_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* храним как текст: таблица не должна превратить дату в число, а «=…» — в формулу */
const txt_ = s => "'" + s;
const cleanName_ = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 60);
/* код сравниваем без учёта регистра и пробелов; «012345» и 12345 (таблица съела ноль) — один и тот же код */
const normCode_ = s => { s = String(s == null ? '' : s).trim().toLowerCase(); return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, '') : s; };
const cleanDate_ = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? String(d) : '';
const json_ = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
