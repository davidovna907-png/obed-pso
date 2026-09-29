/**
 * «Обед ПСО» — общий заказ всех коллег в Google Таблице.
 *
 * Как подключить (один раз, удобнее с компьютера):
 * 1. Создать Google Таблицу → «Расширения» → «Apps Script».
 * 2. Стереть всё в редакторе, вставить этот код, нажать «Сохранить».
 * 3. «Начать развертывание» → «Новое развертывание» → тип «Веб-приложение»;
 *    «Запуск от имени»: я, «У кого есть доступ»: все → «Начать развертывание» → разрешить доступ.
 * 4. Скопировать «URL веб-приложения» — его вписывают в ORDERS_API в index.html.
 *
 * Если этот код потом поменяется: «Начать развертывание» → «Управление развертываниями» → ✎ →
 * версия «Новая версия» → «Начать развертывание» (адрес останется прежним).
 */
const SHEET_NAME = 'Заказы';
const HEAD = ['Дата меню', 'Участник', 'Заказ', 'Сумма, ₽', 'Обновлено', 'Данные для приложения'];

/* GET ?date=2026-09-30 → все заказы на эту дату: {ok, orders: {"Фамилия Имя": {"h3": 1}}} */
function doGet(e) {
  const date = cleanDate_(e && e.parameter && e.parameter.date);
  if (!date) return json_({ ok: false, error: 'date' });
  return locked_(() => json_({ ok: true, orders: read_(sheet_(), date) }));
}

/* POST {date, set: [{name, items, sum, text}], clear?: true} → сохраняет и возвращает все заказы на дату */
function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'json' }); }
  const date = cleanDate_(req && req.date);
  if (!date) return json_({ ok: false, error: 'date' });
  return locked_(() => {
    const sh = sheet_();
    if (req.clear === true) remove_(sh, rows_(sh).filter(r => r.date === date));
    (Array.isArray(req.set) ? req.set.slice(0, 200) : []).forEach(o => save_(sh, date, o));
    return json_({ ok: true, orders: read_(sh, date) });
  });
}

/* one participant's order: replace their row, or delete it when nothing is selected */
function save_(sh, date, o) {
  const name = String((o && o.name) || '').replace(/\s+/g, ' ').trim().slice(0, 60);
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

function read_(sh, date) {
  const out = {};
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
  /* a sheet must keep at least one unfrozen row, or deleteRow fails */
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

function locked_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* stored as text: the sheet must not turn a date into a number or «=…» into a formula */
const txt_ = s => "'" + s;
const cleanDate_ = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? String(d) : '';
const json_ = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
