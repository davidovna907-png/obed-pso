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
    return valid(menu) && menu.date >= base.date ? Object.assign({},base,menu) : base;
  }
  function parse(date, text) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date) throw Error('Проверьте дату меню.');
    const sections = []; let section, count = 0;
    for (const [index, raw] of text.split('\n').entries()) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#')) {
        if (section && !section.items.length) throw Error('В разделе «'+section.title+'» нет блюд.');
        const title = line.slice(1).trim();
        if (!title || title.length>80) throw Error('Проверьте заголовок в строке '+(index+1)+'.');
        section={title,items:[]}; sections.push(section); continue;
      }
      const m = line.match(/^(.+?)\s+(\d{1,4})\s*(?:₽|руб\.?)?$/iu);
      if (!m || +m[2] < 1) throw Error('Строка '+(index+1)+'. Укажите название и цену, например «Рассольник 140».');
      if (!section) {section={title:'Меню',items:[]};sections.push(section);}
      const name=m[1].replace(/\s*[-–—]\s*$/,'').trim();
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
  function draftLines(raw) {
    const out=[];let pending=null, family='', started=false;
    const flush=()=>{if(pending){out.push(pending.name+' '+pending.price);pending=null;}};
    for(const rawLine of raw.split('\n')) {
      const line=rawLine.trim().replace(/^[|—›→\s-]+/u,'').replace(/\s+\|/g,'').trim();
      if(!line)continue;
      const header=line.match(/^(супы|горячие блюда|напитки|завтрак|салаты|премиум(?: блюдо)?|выпечка)(?:$|[\s~≈–-])/iu);
      if(header){flush();out.push('# '+header[1]);family='';started=true;continue;}
      if(/^заказы принимаем|^до \d\d?:\d\d/iu.test(line)){flush();continue;}
      if(/^блины[:.]?$/iu.test(line)){flush();family='Блины ';continue;}
      const item=line.match(/^(.+?)\s+(\d{1,4})\s*(?:₽|руб\.?)?$/iu);
      if(item){flush();started=true;if(!/^с\s/iu.test(item[1]))family='';pending={name:family+item[1],price:item[2]};}
      else if(pending)pending.name+=' '+line;
      else if(started)out.push(line);
    }
    flush();return out.length?out.join('\n'):raw.trim();
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
        parts.push((await worker.recognize(canvas)).data.text);
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
        if(persist())say('Сверьте дату, названия и цены с фото. Исправьте ошибки и удалите лишние строки перед публикацией.');
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
      }catch(e){say(e.message);}
    };
    cancel.onclick=()=>{if(sending)return;delete draft.queued;persist();fields();say('Черновик можно изменить.');};
    const sync=()=>{if(!document.hidden&&navigator.onLine){send();receive();}};
    editor.addEventListener('toggle',()=>{if(editor.open)sync();});
    addEventListener('online',sync);document.addEventListener('visibilitychange',sync);setInterval(sync,60000);sync();
  }
  return {current,start,parse};
})();
