/* Снимок и черновик остаются на устройстве. Сервер получает только проверенное меню. */
const MenuEditor = (() => {
  const savedMenu = 'pso:publishedMenu:v1', draftKey = 'pso:menuDraft:v1';
  const el = id => document.getElementById(id);
  function read(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }
  function valid(menu) {
    if (!menu || !/^\d{4}-\d{2}-\d{2}$/.test(menu.date) || !Array.isArray(menu.sections) || !menu.sections.length) return false;
    const ids = new Set();
    return menu.sections.every(s => s && typeof s.title === 'string' && Array.isArray(s.items) && s.items.length &&
      s.items.every(i => {
        if (!i || !/^[a-z]+\d+$/.test(i.id) || ids.has(i.id) || typeof i.name !== 'string' || !Number.isInteger(i.price) || i.price <= 0) return false;
        ids.add(i.id); return true;
      }));
  }
  function current(base) {
    const menu = read(savedMenu);
    // Встроенное меню может содержать проверенные правки на ту же дату.
    if (!valid(menu) || menu.date <= base.date) return base;
    return {...base, ...menu, sections:menu.sections.map(section => ({
      ...section, items:section.items.map(item => {
        const [name, ...details] = item.name.split(' | ');
        const desc = details.join(', ');
        return desc ? {...item, name, desc} : item;
      })
    }))};
  }
  function parse(date, text) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date) throw Error('Проверьте дату меню.');
    const sections = []; let section, count = 0;
    for (const [index, raw] of splitPricedRows(text).entries()) {
      const line = raw.trim();
      if (!line) continue;
      function problem(message) {
        const error = Error('Строка '+(index+1)+'. '+message);
        error.fragment = raw;
        return error;
      }
      if (line.includes('[?]')) throw problem('Сверьте отмеченную цену с фото и уберите знак [?].');
      if (line.startsWith('#')) {
        if (section && !section.items.length) throw Error('В разделе «'+section.title+'» нет блюд.');
        const title = line.slice(1).trim();
        if (!title || title.length>80) throw Error('Проверьте заголовок в строке '+(index+1)+'.');
        section={title,items:[]}; sections.push(section); continue;
      }
      const m = line.match(/^(.+?)\s+(\d{1,4})\s*(?:₽|руб\.?)?$/iu);
      if (!m || +m[2] < 1) throw problem('Укажите название и цену, например «Рассольник 140».');
      if (!section) {section={title:'Меню',items:[]};sections.push(section);}
      const name=cleanDish(m[1],section.title).replace(/\s*[-–—]\s*$/,'').trim();
      const withoutPortions = name.replace(/\d+\s*(?:грамм[а-я]*|гр|г|кг|мл|л|шт|%)\.?(?=[\s),/]|$)/giu,'');
      if (/(?:^|\s)\d{2,4}(?:\s*₽)?(?:\s|$)/u.test(withoutPortions)) {
        throw problem('В названии обнаружена ещё одна возможная цена. Проверьте, где заканчивается блюдо, или укажите единицу измерения.');
      }
      if (!name || name.length>200) throw Error('Проверьте название в строке '+(index+1)+'.');
      section.items.push({id:'m'+(++count),name,price:+m[2]});
    }
    if (!count || !section.items.length || count>200 || sections.length>30) throw Error('Проверьте разделы и количество блюд (до 200).');
    return {date,collectBy:'21:00',sections};
  }
  async function picture(file) {
    const url=URL.createObjectURL(file);
    try {
      const img=new Image(); img.src=url; await img.decode();
      const scale=Math.min(1,2000/Math.max(img.width,img.height)), canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
      return canvas.toDataURL('image/jpeg',0.8);
    } finally {URL.revokeObjectURL(url);}
  }
  // В одном результате OCR могут оказаться две печатные строки с ценами.
  function splitPricedRows(text) {
    return text.replace(/(\s\d{2,4}(?:\s*₽)?)[ \t]+(?=[А-ЯЁ][а-яё])/gu,'$1\n').split('\n');
  }
  function cleanDish(name, section) {
    let text=name.trim().replace(/([а-яё])-\s+([а-яё])/giu,'$1-$2')
      .replace(/\s+и\s+[—–]\s+со\s/giu,' и со ')
      .replace(/в белом На маринаде/giu,'в белом маринаде');
    if (/выпечка|блины/iu.test(section)) {
      text=text.replace(/^с(?=жюльеном|творогом|ветчиной)/iu,'с ');
      if (/^с\s/iu.test(text) && /\(\s*\d+\s*шт/iu.test(text)) text='Блины '+text;
    }
    return text;
  }
  function draftLines(raw) {
    const out=[];let pending=null, family='', started=false, section='';
    const flush=()=>{if(pending){out.push(cleanDish(pending.name,section)+' '+pending.price);pending=null;}};
    const rows=splitPricedRows(raw).filter(row=>row.trim());
    for(let n=0;n<rows.length;n++) {
      let rawLine=rows[n];
      // Цена иногда попадает на отдельную строку. Присоединяем её только
      // к названию с буквы, без уже распознанной цены или заголовка.
      if (/^[А-ЯЁа-яё]/u.test(rawLine.trim()) &&
          !/\d\s*(?:₽|руб\.?)?\s*$/iu.test(rawLine) &&
          !/^(?:супы|горячие блюда|салаты|премиум(?: блюдо)?|выпечка|напитки|завтрак|блины)\s*[:.]?$/iu.test(rawLine.trim()) &&
          /^(?:\[\?\]\s*)?\d{1,4}\s*(?:₽|руб\.?)?$/iu.test(rows[n+1]?.trim()||'')) {
        rawLine+=' '+rows[++n].trim();
      }
      const line=rawLine.trim().replace(/^[+=|›→—–-]+\s*/u,'').replace(/^Ф\s+(?=[А-ЯЁ])/u,'').replace(/\s+[=—|]\s+(?=\d+\s*$)/u,' ').replace(/^[|—›→\s-]+/u,'').replace(/\s+\|/g,'').trim();
      if(!line)continue;
      const header=line.match(/^(супы|горячие блюда|напитки|завтрак|салаты|премиум(?: блюдо)?|выпечка)(?:$|[\s~≈–-])/iu);
      if(header){flush();section=header[1];out.push('# '+section);family='';started=true;continue;}
      if(/^заказы принимаем|^до \d\d?:\d\d/iu.test(line)){flush();continue;}
      if(/^блины\s*[:.]?$/iu.test(line)){flush();family='Блины ';continue;}
      const normalized=line.replace(/^с(?=жюльеном|творогом|ветчиной)/iu,'с ');
      const item=normalized.match(/^(.+?)\s+(\d{1,4})\s*(?:₽|руб\.?)?$/iu);
      if(item){flush();started=true;if(!/^с\s/iu.test(item[1]))family='';pending={name:family+item[1],price:item[2]};}
      else if(pending){
        if (/^(?:Куриный шницель|Куриная печень|Говядина|Мясные ёжики|Стейк|Котлета|Пирожок|Трайфл)\s/u.test(line)) {
          flush();out.push(line); // У новой позиции отсутствует цена: нужна сверка.
        } else {
          const ingredient=/салаты|премиум/iu.test(section) && !pending.name.includes(' | ') && /^[А-ЯЁ]/u.test(line) && line.includes(',');
          pending.name+=(ingredient?' | ':' ')+line;
        }
      }
      else if(started)out.push(line);
    }
    flush();return out.length?out.join('\n'):raw.trim();
  }
  // Сопоставляем слова с исходной строкой, чтобы одинаковая цена у соседнего блюда
  // не получила отметку по ошибке. Номера строк TSV локальны для каждой колонки.
  function flagUncertainPrices(text, tsv) {
    const rows = new Map();
    for (const record of (tsv || '').split('\n')) {
      const fields = record.split('\t');
      if (fields[0] !== '5' || fields.length < 12) continue;
      const key = fields.slice(1,5).join('/');
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push({word:fields[11].trim(), confidence:Number(fields[10])});
    }
    const matches = new Map();
    const compact = line => line.replace(/\s+/gu,'');
    for (const words of rows.values()) {
      const key = compact(words.map(w => w.word).join(' '));
      const last = words.filter(w => !/^(?:₽|руб\.?)$/iu.test(w.word)).at(-1);
      if (!matches.has(key)) matches.set(key, []);
      matches.get(key).push(last && /^\d{1,4}(?:₽|руб\.?)?$/iu.test(last.word) && last.confidence < 70);
    }
    return text.split('\n').map(line => {
      if (!matches.get(compact(line))?.shift()) return line;
      return line.replace(/(^|\s+)(\d{1,4}\s*(?:₽|руб\.?)?\s*)$/iu,'$1[?] $2');
    }).join('\n');
  }
  let library;
  async function recognize(src, columns) {
    if (!window.Tesseract) {
      if (!library) library=new Promise((resolve,reject)=>{
        const script=document.createElement('script');script.src='ocr/tesseract.min.js';
        script.onload=resolve;script.onerror=()=>{library=null;reject(Error('ocr'))};document.head.appendChild(script);
      });
      await library;
    }
    const path=new URL('ocr/',document.baseURI).href;
    const worker=await Tesseract.createWorker('rus',1,{workerPath:path+'worker.min.js',corePath:path+'tesseract-core-lstm.wasm.js',langPath:path,workerBlobURL:false});
    try {
      const img=new Image();img.src=src;await img.decode();
      await worker.setParameters({tessedit_pageseg_mode:'6'});
      const parts=[];
      for(let col=0;col<columns;col++){
        const left=Math.floor(img.width*col/columns),right=Math.floor(img.width*(col+1)/columns);
        const canvas=document.createElement('canvas');canvas.width=right-left;canvas.height=img.height;
        canvas.getContext('2d').drawImage(img,-left,0);
        const {text, tsv} = (await worker.recognize(canvas, {}, {text:true, tsv:true})).data;
        parts.push(flagUncertainPrices(text, tsv));
      }
      return {raw:parts.join('\n'),lines:parts.map(draftLines).join('\n')};
    } finally {await worker.terminate();}
  }
  function start({post,organizer,key,menu,onNew,canAdopt}) {
    const editor=el('photo-editor'), date=el('menu-date'), lines=el('menu-lines'), photo=el('menu-photo'),
      form=el('photo-form'), submit=form.querySelector('[type=submit]'), cancel=el('cancel-publication'), preview=el('photo-preview');
    let draft=read(draftKey)||{}, sending=false, scanning=false, refreshing=false;
    function say(s){el('photo-status').textContent=s;}
    function persist(){try{localStorage.setItem(draftKey,JSON.stringify(draft));return true;}catch{say('Память телефона заполнена. Черновик мог не сохраниться.');return false;}}
    function fields(){
      date.value=draft.date||'';lines.value=draft.text||'';preview.hidden=!draft.image;
      if(draft.image)preview.src=draft.image;else preview.removeAttribute('src');
      for(const field of [date,lines,photo,el('menu-columns'),submit])field.disabled=!!draft.queued||scanning;
      cancel.hidden=!draft.queued;cancel.disabled=sending;
    }
    fields();
    if(draft.queued)say('Меню ожидает отправки. Откройте приложение при появлении связи.');
    const edit=()=>{draft.date=date.value;draft.text=lines.value;persist();};
    date.oninput=lines.oninput=edit;
    photo.onchange=async()=>{
      const file=photo.files[0];if(!file)return;
      scanning=true;fields();say('Читаю фотографию на телефоне…');
      try {
        const image=await picture(file);draft={image,date:'',text:''};if(!persist())return;fields();
        const result=await recognize(image,Number(el('menu-columns').value));
        const day=result.raw.match(/\b(\d{2})[./](\d{2})[./](20\d{2})\b/);
        draft.date=day?day[3]+'-'+day[2]+'-'+day[1]:'';
        draft.text=result.lines;
        if(persist())say(draft.text.includes('[?]')
          ? 'Знаком [?] отмечены неясные цены. Сверьте их с фото и уберите отметки.'
          : 'Черновик готов. Сверьте дату, блюда и цены с фото.');
      } catch {say('Не удалось прочитать фото. Можно вписать блюда и цены вручную или вставить текст с фотографии.');}
      finally{scanning=false;fields();photo.value='';}
    };
    function accept(m){
      if(!valid(m)||m.date<=menu.date||!canAdopt())return false;
      try{localStorage.setItem(savedMenu,JSON.stringify(m));}catch{return false;}
      onNew(m.date);return true;
    }
    async function receive(){
      if(refreshing||!navigator.onLine||document.hidden)return;refreshing=true;
      try {
        const r=await post({action:'menu-current'});
        if(r?.ok && Object.hasOwn(r,'menu')){
          el('menu-connection').textContent='Таблица готова к публикации меню.';
          accept(r.menu);
        } else if(r?.error==='action'){
          el('menu-connection').textContent='Чтобы коллеги получили новое меню, обновите версию Apps Script в таблице.';
        }
      } catch {
        el('menu-connection').textContent='Связь с таблицей пока не подтверждена. Черновик можно готовить на телефоне.';
      } finally { refreshing=false; }
    }
    async function send(){
      if(sending||!draft.queued||!organizer()||!navigator.onLine)return;
      sending=true;fields();say('Отправляю меню…');
      try {
        const r=await post({action:'menu-publish',key:key(),menu:draft.queued});
        if(!r?.ok){
          const messages={action:'Обновите скрипт таблицы, чтобы включить публикацию.',key:'Войдите снова с кодом организатора.',wait:'Повторите вход через несколько минут.',date:'Эта дата уже занята или прошла. Проверьте дату.',menu:'Проверьте разделы, названия и цены.'};
          if(messages[r?.error]){delete draft.queued;if(persist())say(messages[r.error]);}
          else say('Таблица пока не подтвердила публикацию. Повторю при следующем подключении.');
          return;
        }
        const published=draft.queued;draft={};localStorage.removeItem(draftKey);say('Меню опубликовано.');editor.open=false;accept(published);
      } catch {say('Нет подтверждения. Меню сохранено для повторной отправки.');}
      finally{sending=false;fields();}
    }
    form.onsubmit=event=>{
      event.preventDefault(); if(!organizer()||scanning||sending||draft.queued)return;
      try {
        const m=parse(date.value,lines.value);
        if(m.date<=menu.date)throw Error('Выберите дату позже действующего меню. На его блюда уже могут быть заказы.');
        draft.queued=m;if(!persist()){delete draft.queued;return;}
        fields();say('Меню сохранено для отправки. Откройте приложение со связью.');send();
      }catch(e){
        say(e.message);
        if(e.fragment){
          const offset=lines.value.indexOf(e.fragment);
          if(offset>=0){lines.focus();lines.setSelectionRange(offset,offset+e.fragment.length);}
        }
      }
    };
    cancel.onclick=()=>{if(sending)return;delete draft.queued;persist();fields();say('Черновик можно изменить.');};
    const sync=()=>{if(!document.hidden&&navigator.onLine){send();receive();}};
    editor.addEventListener('toggle',()=>{if(editor.open)sync();});
    addEventListener('online',sync);document.addEventListener('visibilitychange',sync);setInterval(sync,60000);sync();
  }
  return {current,start,parse};
})();
