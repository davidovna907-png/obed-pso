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
 * все заказы и общую сумму — только тот, кто ввёл в приложении код организатора.
 *
 * Если этот код потом поменяется: «Начать развертывание» → «Управление развертываниями» → ✎ →
 * версия «Новая версия» → «Начать развертывание» (адрес останется прежним).
 */
const SHEET_NAME = 'Заказы';
const SETTINGS_NAME = 'Настройки';
const HEAD = ['Дата меню', 'Участник', 'Заказ', 'Сумма, ₽', 'Обновлено', 'Данные для приложения'];

/* Адрес, открытый в браузере: проверка, что всё работает; заодно создаются листы и код организатора */
function doGet() {
  return locked_(() => {
    sheet_();
    code_();
    return ContentService.createTextOutput('Обед ПСО: всё работает. Код организатора — в таблице, на листе «Настройки».')
      .setMimeType(ContentService.MimeType.TEXT);
  });
}

/* Все запросы приложения: POST {date, key?, names?, set?: [{name, items, sum, text}], clear?: true} */
function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'json' }); }
  const date = cleanDate_(req && req.date);
  if (!date) return json_({ ok: false, error: 'date' });
  return locked_(() => {
    const code = code_();   /* лист «Настройки» с кодом появляется при первом же заказе */
    const admin = req.key != null && req.key !== '';
    if (admin && String(req.key).trim() !== code) return json_({ ok: false, error: 'key' });
    if (req.clear === true && !admin) return json_({ ok: false, error: 'key' });
    const sh = sheet_();
    if (req.clear === true) remove_(sh, rows_(sh).filter(r => r.date === date));
    const set = Array.isArray(req.set) ? req.set.slice(0, 200) : [];
    set.forEach(o => save_(sh, date, o));
    const all = read_(sh, date);
    if (admin) return json_({ ok: true, admin: true, orders: all });
    /* коллеге — только заказы участников с его телефона */
    const want = Object.create(null), mine = Object.create(null);
    (Array.isArray(req.names) ? req.names.slice(0, 100) : []).concat(set.map(o => o && o.name))
      .forEach(n => { n = cleanName_(n); if (n) want[n.toLowerCase()] = true; });
    Object.keys(all).forEach(n => { if (want[n.toLowerCase()]) mine[n] = all[n]; });
    return json_({ ok: true, admin: false, orders: mine });
  });
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

function rows_(sh) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const tz = Session.getScriptTimeZone();
  const s = v => String(v).replace(/^'/, '');
  return sh.getRange(2, 1, n, HEAD.length).getValues().map((v, i) => ({
    row: i + 2,
    date: v[0] instanceof Date ? Utilities.formatDate(v[0], tz, 'yyyy-MM-dd') : s(v[0]),
    name: s(v[1]),
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
      ['', 'Код можно заменить на свой — тогда войти нужно будет с новым кодом.']
    ]);
  }
  return String(sh.getRange(1, 2).getDisplayValue()).trim();
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
const cleanDate_ = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? String(d) : '';
const json_ = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
