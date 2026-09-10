/* Server transport is explicit: a failed API never switches to demo data. */
const ENGINE_SERVER = !window.ASTRA_DEMO;
if(ENGINE_SERVER){
 Object.assign(STR.ru,{wl4t:'Проекты хранятся на сервере',wl4b:'Файлы передаются на ваш сервер IDE Code. Доступ определяется аккаунтом и участием в проекте.',setWipeB:'Ваши проекты и файлы будут удалены с сервера',a1:'Файлы хранятся на сервере IDE Code. При импорте создаётся серверная копия. Настройки интерфейса остаются в браузере.',bannerSub:'Мобильная среда разработки: файлы на сервере, редактор и настоящий PowerShell.'});
 Object.assign(STR.en,{wl4t:'Projects live on your server',wl4b:'Files are uploaded to your IDE Code server. Accounts and project roles control access.',setWipeB:'Your projects and files will be deleted from the server',a1:'Files are stored on the IDE Code server. Import creates a server copy. UI preferences stay in this browser.',bannerSub:'Mobile development: server files, editor and real PowerShell.'});
}
/* Движок на устройстве ничего никуда не отправляет, и интерфейс не должен
   намекать на обратное: серверные формулировки заменяем на честные. */
const applyLocalWording = () => {
 Object.assign(STR.ru,{
  wlHiB:'IDE Code — среда разработки, которая целиком живёт на этом устройстве: проекты, файлы и терминал никуда не уходят. Чтобы продолжить, отметьте согласие ниже.',
  wl4t:'Код хранится на устройстве',
  wl4b:'Проекты, файлы и точки восстановления лежат в памяти этого устройства. Сервера нет, наружу ничего не передаётся.',
  setWipeB:'Проекты и файлы будут удалены с этого устройства',
  a1:'Код хранится в памяти этого устройства, в приватном каталоге приложения. Сервера нет, наружу ничего не уходит. При импорте файл копируется туда же.',
  bannerSub:'Мобильная среда разработки: проекты, редактор и терминал прямо на устройстве.',
  setSyncB:'перечитать файлы с устройства',
  setSignOutB:'завершить сессию на этом устройстве',
 });
 Object.assign(STR.en,{
  wlHiB:'IDE Code is a development environment that lives entirely on this device: projects, files and the terminal never leave it. Tick the box below to continue.',
  wl4t:'Your code stays on the device',
  wl4b:'Projects, files and restore points live in this device storage. There is no server and nothing is sent anywhere.',
  setWipeB:'Your projects and files will be deleted from this device',
  a1:'Code is stored in this device storage, inside the app private directory. There is no server and nothing leaves the device. Import copies the file there too.',
  bannerSub:'Mobile development: projects, editor and a terminal right on the device.',
  setSyncB:'reread files from the device',
  setSignOutB:'end the session on this device',
 });
};
const mergeServerProject = (server, local) => ({...server, files: server.files.map(f => {
 const draft=local?.files.find(x=>x.path===f.path);return draft?.unsaved ? draft : {...f,dirty:draft?.dirty,fresh:draft?.fresh};
}).concat((local?.files || []).filter(f=>f.unsaved&&!server.files.some(x=>x.path===f.path)))});
const API = {
 async request(path, options = {}) {
   const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 35000);
   try {
     const res = await fetch('/api/v1' + path, { ...options, signal: abort.signal, credentials: 'same-origin',
       headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'astracode', ...(options.headers || {}) },
       body: options.body === undefined ? undefined : JSON.stringify(options.body) });
     const data = res.status === 204 ? null : await res.json().catch(() => null);
     if (!res.ok) { const err = new Error(data?.error?.message || ('HTTP ' + res.status)); err.status = res.status; err.code = data?.error?.code;
       if(res.status!==401)window.dispatchEvent(new CustomEvent('astra:error',{detail:err.message}));throw err; }
     if (data && !Array.isArray(data)) data._etag = res.headers.get('ETag');
     return data;
   } finally { clearTimeout(timer); }
 },
 metadata(p) { return { name:p.name, desc:p.desc || '', theme:p.theme || '', tags:p.tags || [], tint:p.tint || '#8fb0ff' }; },
 async projects() { const list = await API.request('/projects'); return Promise.all(list.map(p => API.project(p.id))); },
 project(id) { return API.request('/projects/' + id); },
 create(p) { return API.request('/projects', { method:'POST', body:{...API.metadata(p), files:(p.files || []).map(f => ({path:f.path,code:f.code}))} }); },
 patch(p) { return API.request('/projects/' + p.id, {method:'PATCH',body:{...API.metadata(p), revision:p.revision}}); },
 remove(id) { return API.request('/projects/' + id, {method:'DELETE'}); },
 file(id,f) { return API.request('/projects/' + id + '/file?path=' + encodeURIComponent(f.path), {method:'PUT', body:{code:f.code}, headers:f.etag ? {'If-Match':f.etag} : {'If-None-Match':'*'}}); },
 async refresh() { window.dispatchEvent(new Event('astra:refresh')); }
};

/* Чат к релизу убран из навигации, но не из сборки: панель, ручки движка и
   раздел ключа в настройках на месте, скрыта только вкладка. Возвращается
   адресом «?chat=1» — пересобирать для этого ничего не нужно. */
const CHAT_UI = new URLSearchParams(location.search).get('chat') === '1';

function BackendGate() {
 const [state,setState] = useState(ENGINE_SERVER ? 'loading' : 'demo');
 const [config,setConfig] = useState(null), [user,setUser] = useState(null), [projects,setProjects] = useState([]);
 const [email,setEmail] = useState(() => {try{return localStorage.getItem('idecode.email') || '';}catch(e){return '';}});
 const [name,setName] = useState(() => {try{return localStorage.getItem('idecode.name') || '';}catch(e){return '';}});
 const [error,setError] = useState(''), [busy,setBusy] = useState(false), [leaving,setLeaving] = useState(false);
 const load = async () => {
   setError('');setState('loading');
   try { const cfg=await API.request('/config');setConfig(cfg);
     // Подписи терминала зависят от движка: на сервере PowerShell, на устройстве своя оболочка.
     window.ASTRA_SHELL=cfg.shellShort||cfg.shell||'Терминал';
     window.ASTRA_CAPS={chat:!!cfg.chat&&CHAT_UI,rootTerminal:!!cfg.rootTerminal};
     if(cfg.mode==='local')applyLocalWording();
     let who;
     try {who=await API.request('/auth/me');} catch(e) {if(e.status===401){setState('auth');return;}throw e;}
     const list=await API.projects();setUser(who);setProjects(list);setState('ready');
   } catch(e) {setError(e.message);setState('error');}
 };
 useEffect(() => {if(ENGINE_SERVER)load();},[]);
 /* Passwordless: the email identifies the account, the name is the label shown next to it. */
 const submit = async e => {e.preventDefault();if(busy)return;setBusy(true);setError('');
   try {await API.request('/auth/login',{method:'POST',body:{email:email.trim(),name:name.trim()}});
     try{localStorage.setItem('idecode.email',email.trim());localStorage.setItem('idecode.name',name.trim());}catch(err){}
     // Карточка уходит своей анимацией, и только на её месте проявляется интерфейс.
     setLeaving(true);await new Promise(r=>setTimeout(r,durationOf('--duration-fast',250)));
     await load();}
   catch(err){setLeaving(false);setError(err.message);}finally{setBusy(false);}
 };
 const logout = async () => {try{await API.request('/auth/logout',{method:'POST'});setUser(null);setProjects([]);setLeaving(false);setState('auth');}catch(e){window.dispatchEvent(new CustomEvent('astra:error',{detail:e.message}));}};
 if(state==='ready'||state==='demo')return <App key={user?.id || 'demo'} initialProjects={state==='demo'?SEED_PROJECTS:projects} user={user} entering={leaving} onLogout={logout}/>;
 return <div className={'engine-auth'+(leaving?' is-leaving':'')}><form onSubmit={submit}>
   <h1 className="h1">IDE Code{config&&config.mode==='local'?'':' · сервер'}</h1>
   <p className="meta">{config&&config.mode==='local'
     ? 'Проекты, файлы и терминал хранятся на этом устройстве. Наружу ничего не передаётся.'
     : 'Проекты сохраняются на сервере. Настоящий PowerShell доступен в браузере компьютера и Android.'}</p>
   {state==='auth' && <>
     <label htmlFor="engine-email">Почта</label><input className="field mono" id="engine-email" type="email" required autoComplete="username" inputMode="email" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)}/>
     <label htmlFor="engine-name">Имя</label><input className="field mono" id="engine-name" type="text" required maxLength={64} autoComplete="nickname" placeholder="Как вас называть" value={name} onChange={e=>setName(e.target.value)}/>
     <p className="meta">Пароль не нужен. Почта — это ваш аккаунт: первый вход создаёт его, следующие входы просто обновляют имя. {config&&config.mode==='local'?'Учётная запись хранится только на этом устройстве.':''}</p>
     <button className="cta" disabled={busy}>{busy?'Подключение…':'Войти'}</button>
   </>}
   {state==='loading'&&<p role="status">Подключение к серверу…</p>}
   {error&&<p className="engine-error" role="alert">{error}</p>}
   {state==='error'&&<button className="cta" type="button" onClick={load}>Повторить подключение</button>}
 </form></div>;
}

/* Стандартная палитра ANSI: без неё подсветка PSReadLine и вывод утилит
   приходят в цветах xterm по умолчанию и плохо читаются на тёмном фоне. */
const TERM_THEME = {
 background:'#0b0c0e', foreground:'#e6e7eb', cursor:'#e6e7eb', cursorAccent:'#0b0c0e',
 selectionBackground:'#33415580', selectionForeground:'#ffffff',
 black:'#3b4048', red:'#e06c75', green:'#98c379', yellow:'#e5c07b',
 blue:'#61afef', magenta:'#c678dd', cyan:'#56b6c2', white:'#cdd3df',
 brightBlack:'#5c6370', brightRed:'#ff7b86', brightGreen:'#b1e18b', brightYellow:'#ffd68a',
 brightBlue:'#7cc5ff', brightMagenta:'#dd9ff0', brightCyan:'#6fd7e3', brightWhite:'#ffffff',
};
const TERM_FONT_MIN = 10, TERM_FONT_MAX = 24;
const shellName = () => window.ASTRA_SHELL || 'Терминал';
const REMOTE_TITLE = /^[\w.-]+@[\w.-]+/;
const readTermFont = () => {
 try{const n=parseInt(localStorage.getItem('idecode.termFont'),10);
   if(n>=TERM_FONT_MIN&&n<=TERM_FONT_MAX)return n;}catch(e){}
 return 14;
};

/* Терминал занимает окно целиком: сессия поднимается сама, а сессии,
   служебные клавиши, размер шрифта и обновление файлов лежат в кнопке
   «Прочее», такой же, как дополнительные действия редактора. */
function ServerTerminal({project,onRefresh,visible=true}) {
 // Без проекта терминал открывается в корне рабочих папок: оттуда видно все
 // проекты, а cd заходит внутрь нужного.
 const scope = project ? '/projects/'+project.id : '';
 // Панели вкладок висят в разметке все сразу. Поднимать оболочку и xterm для
 // скрытой панели незачем: на телефоне это лишний процесс и лишняя память.
 const ready = visible;
 const host=useRef(null),inner=useRef(null),term=useRef(null),socket=useRef(null),fit=useRef(null),started=useRef(false);
 const [sessions,setSessions]=useState([]),[active,setActive]=useState(null),[status,setStatus]=useState('Запуск оболочки…'),[error,setError]=useState(''),[busy,setBusy]=useState(false),[menu,setMenu]=useState(false);
 // Где сейчас оболочка. Движок устройства считает это по самому процессу и
 // присылает строкой; серверная песочница такого не умеет, и там остаётся
 // заголовок окна — его ставит и наше приглашение, и удалённая оболочка после
 // ssh, так что видно и то и другое.
 const [where,setWhere]=useState({path:'',remote:''}),[title,setTitle]=useState('');
 const [font,setFont]=useState(readTermFont);
 const base=scope+'/terminals';
 const create=async()=>{
   setBusy(true);setError('');setMenu(false);
   try{const s=await API.request(base,{method:'POST',body:{cols:term.current?.cols||80,rows:term.current?.rows||24}});
     setSessions(list=>list.concat(s));setActive(s.id);return s;}
   catch(e){setError(e.message);setStatus('Сессия не запущена');}
   finally{setBusy(false);}
 };
 // Открыли вкладку — терминал уже работает; лезть в меню за первой сессией не нужно.
 useEffect(()=>{
   if(!ready)return;
   started.current=false;setStatus('Запуск оболочки…');
   let cancelled=false;
   (async()=>{
     try{const list=await API.request(base);if(cancelled)return;
       setSessions(list);
       if(list.length){setActive(list[0].id);return;}
       if(started.current)return;
       started.current=true;await create();
     }catch(e){if(!cancelled)setError(e.message);}
   })();
   return()=>{cancelled=true;};
 },[scope,ready]);
 /* Терминал и сокет живут одним эффектом: пока xterm не открыт, писать в него
    некуда, а раздельные эффекты роняли первый ответ сервера в пустоту. */
 useEffect(()=>{
   if(!active||!ready)return;
   if(!inner.current||!window.Terminal||!window.FitAddon){setError('Не удалось загрузить xterm.js');return;}
   const terminal=new window.Terminal({cursorBlink:true,fontSize:readTermFont(),
     fontFamily:'"JetBrains Mono","SF Mono",ui-monospace,Menlo,Consolas,monospace',
     lineHeight:1.2,scrollback:10000,scrollOnUserInput:true,theme:TERM_THEME,allowProposedApi:false});
   const addon=new window.FitAddon.FitAddon();terminal.loadAddon(addon);terminal.open(inner.current);
   term.current=terminal;fit.current=addon;terminal.focus();
   const resize=()=>{try{addon.fit();}catch(e){}};
   const observer=new ResizeObserver(resize);observer.observe(inner.current);observer.observe(host.current);
   let stopped=false,attempts=0,retry=null,ws=null,replaying=false,replayTimer=null;
   const input=terminal.onData(data=>{if(!replaying&&ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'input',data}));});
   const titled=terminal.onTitleChange(name=>setTitle((name||'').trim()));
   const resized=terminal.onResize(({cols,rows})=>{if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'resize',cols,rows}));});
   const connect=()=>{
     if(stopped)return;setStatus('Подключение…');setError('');terminal.reset();
     setWhere({path:'',remote:''});setTitle('');
     ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/api/v1'+base+'/'+active+'/ws');
     ws.binaryType='arraybuffer';socket.current=ws;
     ws.onopen=()=>{attempts=0;setStatus('подключён');resize();ws.send(JSON.stringify({type:'resize',cols:terminal.cols,rows:terminal.rows}));terminal.focus();
       // Первый двоичный кадр — переигранный буфер сессии; ответы на него наружу не идут.
       replaying=true;clearTimeout(replayTimer);replayTimer=setTimeout(()=>{replaying=false;},400);};
     ws.onmessage=e=>{if(e.data instanceof ArrayBuffer){
         const buffered=replaying;if(buffered)clearTimeout(replayTimer);
         terminal.write(new Uint8Array(e.data),buffered?()=>{replaying=false;}:undefined);}
       else{try{const msg=JSON.parse(e.data);
         if(msg.type==='exit'){stopped=true;setStatus('Оболочка закрыта — откройте новую сессию в «Прочее»');}
         else if(msg.type==='where')setWhere({path:msg.path||'',remote:msg.remote||''});}catch(err){}}};
     ws.onclose=()=>{if(stopped)return;setStatus('Соединение прервано');
       if(++attempts<=5)retry=setTimeout(connect,Math.min(1000*2**attempts,10000));
       else setError('Не удалось восстановить соединение. Откройте новую сессию.');};
     ws.onerror=()=>setStatus('Ошибка соединения');
   };
   resize();connect();
   return()=>{stopped=true;clearTimeout(retry);clearTimeout(replayTimer);ws?.close();socket.current=null;
     observer.disconnect();input.dispose();resized.dispose();titled.dispose();terminal.dispose();
     term.current=null;fit.current=null;};
 },[active,scope,ready]);
 /* Экранная клавиатура наезжает на страницу, а не сжимает её. Отдаём высоту
    клавиатуры макету, чтобы последняя строка и курсор оставались на виду. */
 useEffect(()=>{
   const vv=window.visualViewport;if(!vv)return;
   const root=document.documentElement;
   const sync=()=>{
     const inset=Math.max(0,Math.round(window.innerHeight-vv.height-vv.offsetTop));
     root.style.setProperty('--kb-inset',(inset>120?inset:0)+'px');
     if(inset>120)window.scrollTo(0,0);
     try{fit.current?.fit();term.current?.scrollToBottom();}catch(e){}
   };
   vv.addEventListener('resize',sync);vv.addEventListener('scroll',sync);sync();
   return()=>{vv.removeEventListener('resize',sync);vv.removeEventListener('scroll',sync);
     root.style.removeProperty('--kb-inset');};
 },[]);
 // Размер шрифта меняется на живом терминале: пересоздавать сессию незачем.
 useEffect(()=>{
   const t=term.current;if(!t)return;
   t.options.fontSize=font;
   try{localStorage.setItem('idecode.termFont',String(font));}catch(e){}
   try{fit.current?.fit();t.scrollToBottom();}catch(e){}
 },[font,active]);
 const focus=()=>{try{term.current?.focus();}catch(e){}};
 const send=data=>{if(socket.current?.readyState!==WebSocket.OPEN){setError('Терминал не подключён');return;}
   socket.current.send(JSON.stringify({type:'input',data}));setMenu(false);focus();};
 const close=async()=>{if(!active)return;setBusy(true);setMenu(false);
   try{await API.request(base+'/'+active,{method:'DELETE'});setActive(null);setStatus('Сессия завершена');
     setSessions(list=>list.filter(s=>s.id!==active));await onRefresh();}
   catch(e){setError(e.message);}finally{setBusy(false);}};
 const step=d=>setFont(n=>Math.min(TERM_FONT_MAX,Math.max(TERM_FONT_MIN,n+d)));
 // Пока сессия подключена, её состояние видно по самому терминалу.
 const note = error || (active && status === 'подключён' ? '' : status);
 // «user@host: ~» в заголовке ставит удалённая оболочка — этого хватает, чтобы
 // не путать её приглашение со своим, даже когда движок про ssh не знает.
 const remote = where.remote || (REMOTE_TITLE.test(title) ? title.split(/[\s:]/)[0] : '');
 // Движок знает путь точно; заголовок — запасной вариант там, где движок молчит,
 // и им же полноэкранные программы вроде vi подписывают себя сами.
 const place = remote ? 'ssh ' + remote : (where.path || title);
 return <div className="engine-terminal">
   <div className="engine-xterm" ref={host} onClick={focus}>
     <div className="engine-xterm-inner" ref={inner} style={{fontSize:font}}/>
   </div>
   <div className="engine-term-tools">
     {place && <span className={'engine-term-where'+(remote?' is-remote':'')} title={place}>
       <Ico n={remote?'terminal':'folder'} s={12}/><span>{place}</span></span>}
     {note && <span className={'engine-term-note'+(error?' is-error':'')} role={error?'alert':'status'}>{note}</span>}
     {menu && <div className="ed-extra-menu t-dropdown is-open" data-origin="top-right">
       {sessions.map((s,i)=><button key={s.id} onClick={()=>{setActive(s.id);setMenu(false);}}>
         <Ico n={s.id===active?'check':'terminal'} s={16}/>{shellName()} {i+1}</button>)}
       <button disabled={busy} onClick={create}><Ico n="plus" s={16}/>Новая сессия</button>
       <button disabled={!active||busy} onClick={close}><Ico n="x" s={16}/>Завершить сессию</button>
       <button onClick={async()=>{setMenu(false);await onRefresh();}}><Ico n="refresh" s={16}/>Обновить файлы</button>
       <div className="engine-term-font">
         <Ico n="code" s={16}/><span>Шрифт</span>
         <div className="stepper">
           <button onClick={()=>step(-1)} disabled={font<=TERM_FONT_MIN} aria-label="Меньше"><Ico n="minus" s={13}/></button>
           <span className="num">{font}px</span>
           <button onClick={()=>step(1)} disabled={font>=TERM_FONT_MAX} aria-label="Больше"><Ico n="plus" s={13}/></button>
         </div>
       </div>
       <div className="engine-term-keys">{[['Ctrl+C','\x03'],['Tab','\t'],['↑','\x1b[A'],['↓','\x1b[B'],['Esc','\x1b']].map(([label,data])=>
         <button key={label} onClick={()=>send(data)}>{label}</button>)}</div>
     </div>}
     <button className="ed-extra-btn is-icon" aria-expanded={menu} aria-label="Прочее" title="Прочее"
       onClick={()=>setMenu(!menu)}><Ico n="dots" s={18}/></button>
   </div>

 </div>;
}

/* Модель отдаёт проект отдельным блоком: function calling поддерживают не все
   модели платформы, а блок разбирается одинаково у любой. */
const MODE_LABEL = {
 ru: { chat: 'Обычный чат', build: 'Сборка' },
 en: { chat: 'Plain chat', build: 'Build' },
};
const MODE_HINT = {
 ru: { chat: 'вопросы, объяснения, правки по коду',
       build: 'собирает работающую страницу и сразу показывает её в просмотре' },
 en: { chat: 'questions, explanations, code edits',
       build: 'builds a working page and shows it in the preview right away' },
};
const PROJECT_BLOCK = /```idecode-project\s*([\s\S]*?)```/;
const FENCE = /```([a-zA-Z]*)\s*\n([\s\S]*?)```/g;
/* Маленькие модели служебный блок держат не всегда и отвечают обычным ```html.
   В режиме сборки это тоже проект: берём страницу из блока кода. */
const parsePage = (text, fallbackName) => {
 FENCE.lastIndex = 0;
 let found;
 while ((found = FENCE.exec(text || ''))) {
   const lang = (found[1] || '').toLowerCase(), code = found[2].trim();
   const looksLikePage = /<!doctype html|<html[\s>]/i.test(code);
   if (lang === 'html' || looksLikePage) {
     if (code.length < 20) continue;
     return { name: (fallbackName || 'Страница').slice(0, 160), desc: '',
       files: [{ path: 'index.html', code }], raw: '', guessed: true };
   }
 }
 return null;
};
/* Правка приложенного файла приходит отдельным блоком с путём в заголовке:
   это не новый проект, а замена файла на месте. */
const EDIT_BLOCK = /```idecode-file:([^\n`]+)\n([\s\S]*?)```/g;
const parseEdits = (text, attached) => {
 EDIT_BLOCK.lastIndex = 0;
 const out = [];
 let found;
 while ((found = EDIT_BLOCK.exec(text || ''))) {
   const path = found[1].trim();
   const source = attached.find(f => f.path === path);
   // Записываем только то, что пользователь сам приложил: иначе ответ модели
   // мог бы создать файл там, куда его не звали.
   if (!source) continue;
   out.push({ ...source, code: found[2].replace(/\n$/, ''), raw: found[0] });
 }
 return out;
};

/* Модели отвечают таблицами в разметке markdown. Показывать их палками и
   дефисами — значит терять смысл ответа, поэтому такие куски собираются в
   настоящую таблицу, а остальной текст остаётся текстом: полноценная разметка
   тут не нужна, а таблица без вёрстки нечитаема. */
const TABLE_ROW = /^\s*[|].*[|]\s*$/;
const TABLE_RULE = /^\s*[|][\s:|-]*[|]\s*$/;
const cells = (line) => line.trim().replace(/^[|]/, '').replace(/[|]\s*$/, '').split('|').map(c => c.trim());

/* Модели размечают ответ звёздочками и обратными кавычками. Оставить их как
   есть — значит показать разметку вместо текста: в таблице «**Go**» ещё и
   ломает колонку пополам. Разбираем жирный, наклонный и код; остальное
   остаётся словами, полноценный markdown тут ни к чему. */
const INLINE = /(\*\*[^\n]+?\*\*|`[^`\n]+`|\*[^*\n]+?\*)/g;
const inline = (text) => {
 const parts = String(text || '').split(INLINE);
 return parts.map((part, i) => {
   if (i % 2 === 0) return part;
   if (part.startsWith('**')) return <b key={i}>{part.slice(2, -2)}</b>;
   if (part.startsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>;
   return <i key={i}>{part.slice(1, -1)}</i>;
 });
};

const renderBody = (text) => {
 const lines = String(text || '').split('\n');
 const out = [];
 let plain = [];
 const flush = () => {
   if (plain.length) { out.push({ kind: 'text', text: plain.join('\n') }); plain = []; }
 };
 for (let i = 0; i < lines.length; i++) {
   // Таблица — это строка-заголовок, под ней строка-разделитель, дальше данные.
   if (TABLE_ROW.test(lines[i]) && TABLE_RULE.test(lines[i + 1] || '')) {
     const head = cells(lines[i]);
     const rows = [];
     let j = i + 2;
     for (; j < lines.length && TABLE_ROW.test(lines[j]); j++) rows.push(cells(lines[j]));
     flush();
     out.push({ kind: 'table', head, rows });
     i = j - 1;
     continue;
   }
   plain.push(lines[i]);
 }
 flush();
 return out.filter(part => part.kind !== 'text' || part.text.trim());
};

const parseProject = (text) => {
 const found = PROJECT_BLOCK.exec(text || '');
 if (!found) return null;
 try {
   const data = JSON.parse(found[1]);
   if (!data || typeof data.name !== 'string' || !Array.isArray(data.files) || !data.files.length) return null;
   const files = data.files
     .filter(f => f && typeof f.path === 'string' && typeof f.code === 'string')
     .filter(f => !f.path.startsWith('/') && !f.path.split('/').includes('..'))
     .slice(0, 20);
   if (!files.length) return null;
   return { name: data.name.slice(0, 160), desc: String(data.desc || '').slice(0, 2000), files, raw: found[0] };
 } catch (e) { return null; }
};

/* Страница из ответа показывается сразу: до создания проекта — прямо из текста
   в изолированном кадре, после — с диска, где работают и соседние файлы. */
/* Точку входа модель называет по-разному: index.html в корне, во вложенной
   папке или просто page.html. Берём самое подходящее, а не единственное имя. */
const page = (spec) => {
 if (!spec || !spec.files) return null;
 return spec.files.find(f => f.path === 'index.html')
   || spec.files.find(f => /(^|[/])index[.]html?$/i.test(f.path))
   || spec.files.find(f => /[.]html?$/i.test(f.path))
   || null;
};
/* В изолированном кадре соседние файлы недоступны, поэтому до создания проекта
   стили и скрипты вклеиваются в саму страницу — иначе просмотр показывал бы
   голую разметку и вводил в заблуждение. */
const inlinePage = (spec) => {
 const entry = page(spec);
 if (!entry) return '';
 const dir = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/') + 1) : '';
 const find = (name) => {
   const clean = String(name).replace(/^[.][/]/, '').split('?')[0];
   return spec.files.find(f => f.path === dir + clean) || spec.files.find(f => f.path === clean);
 };
 return entry.code
   .replace(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/gi, (whole, href) => {
     const file = find(href);
     return file && /[.]css$/i.test(href) ? '<style>' + file.code + '</style>' : whole;
   })
   .replace(/<script\b[^>]*src=["']([^"']+)["'][^>]*>\s*<[/]script>/gi, (whole, src) => {
     const file = find(src);
     return file ? '<script>' + file.code + '<' + '/script>' : whole;
   });
};

function Preview({ lang, name, entry, html, url, nonce, full, onFull }) {
 /* allow-popups — чтобы ссылка с target="_blank" открывалась, а не пропадала
    молча; allow-same-origin по-прежнему нет, поэтому к самой странице IDE Code
    код в кадре не подберётся. Ссылки внутри кадра ведут наружу как обычно. */
 const frame = <iframe key={String(nonce) + String(!!url)} title={name}
   sandbox="allow-scripts allow-forms allow-modals allow-popups"
   referrerPolicy="no-referrer"
   {...(url ? { src: url } : { srcDoc: html })} />;
 return <div className={'chat-preview' + (full ? ' is-full' : '')}>
   <div className="chat-preview-bar">
     <Ico n="play" s={14} />
     <span>{name} · {entry}</span>
     <button className="chip is-sm" onClick={() => onFull(!full)}
       aria-label={full ? (lang === 'ru' ? 'Свернуть' : 'Collapse') : (lang === 'ru' ? 'Развернуть' : 'Expand')}>
       <Ico n={full ? 'x' : 'panel'} s={13} />
     </button>
   </div>
   {frame}
   {!full && <button className="chat-preview-tap" onClick={() => onFull(true)}
     aria-label={lang === 'ru' ? 'Открыть на весь экран' : 'Open full screen'} />}
 </div>;
}

function ChatPane({ t, lang, projects, onCreated, onRefresh, toast }) {
 const [models, setModels] = useState([]), [model, setModel] = useState('');
 const [messages, setMessages] = useState([]), [draft, setDraft] = useState('');
 const [busy, setBusy] = useState(false), [note, setNote] = useState(''), [failed, setFailed] = useState(false);
 const [files, setFiles] = useState([]), [creating, setCreating] = useState('');
 // Режим меняет свод правил на стороне движка: в сборке модель делает
 // работающую страницу, которую тут же показывает просмотр.
 const [mode, setMode] = useState('chat'), [pick, setPick] = useState(null);
 const [preview, setPreview] = useState(null), [previewNonce, setPreviewNonce] = useState(0);
 const [full, setFull] = useState(false);
 const [query, setQuery] = useState(''), [fileQuery, setFileQuery] = useState('');
 const [copied, setCopied] = useState(-1);
 const [saving, setSaving] = useState('');
 const log = useRef(null), input = useRef(null), picker = useRef(null), abort = useRef(null);
 const reason = useRef(null);

 const loadModels = async (refresh) => {
   setNote(lang === 'ru' ? 'Проверяем доступные модели…' : 'Checking available models…'); setFailed(false);
   try {
     const data = await API.request('/chat/models' + (refresh ? '?refresh=1' : ''));
     const list = data.models || [];
     // По умолчанию берём ту, которую движок действительно спросил и получил
     // ответ: остальной каталог показан как есть, без обещаний.
     const ready = list.filter(m => m.ok && m.checked);
     const ok = list.filter(m => m.ok);
     setModels(list);
     setModel(current => (ok.some(m => m.id === current) ? current : ((ready[0] || ok[0] || {}).id || '')));
     if (!ok.length) {
       setFailed(true);
       const why = list.find(m => m.reason);
       setNote((lang === 'ru' ? 'Ни одна модель недоступна на этом ключе' : 'No model is available on this key') +
         (why ? ': ' + why.reason : ''));
     } else setNote('');
   } catch (e) { setFailed(true); setNote(e.message); }
 };
 useEffect(() => { loadModels(false); return () => abort.current && abort.current.abort(); }, []);
 useEffect(() => { const el = log.current; if (el) el.scrollTop = el.scrollHeight; }, [messages, busy]);

 // Пока модель пишет, показываем поток в окошке: оно едет за последними
 // строками с той же плавностью, а по окончании текст становится обычным
 // сообщением — окошко просто исчезает.
 const streaming = busy && messages.length > 0 && messages[messages.length - 1].role === 'assistant'
   ? messages[messages.length - 1].text : '';
 useEffect(() => {
   const el = reason.current;
   if (!el) return;
   const offset = Math.max(0, el.scrollHeight - el.parentNode.clientHeight);
   el.style.transition = 'transform var(--reason-step) var(--reason-ease)';
   el.style.transform = 'translateY(-' + offset + 'px)';
 }, [streaming]);

 /* Приложенный файл помнит, откуда он: без этого правку некуда возвращать. */
 const attachFile = (file) => {
   if (files.some(f => f.path === file.path && f.projectId === file.projectId)) return;
   setFiles(list => list.concat([{
     path: file.path, code: String(file.code || '').slice(0, 60000),
     projectId: file.projectId || '', projectName: file.projectName || '', etag: file.etag || '',
   }]));
 };

 /* Файл выбирается прямо в строке ввода: «/» открывает список проекта.
    Отдельная полоска с кнопками файлов занимала место под каждым вопросом,
    хотя нужна раз в пять сообщений. */
 const onDraft = (value, caret) => {
   setDraft(value);
   const before = value.slice(0, caret);
   const started = /(^|\s)\/([^\s\/]*)$/.exec(before);
   if (started) { setFileQuery(started[2]); setPick('file'); }
 };
 const pickFile = (file) => {
   // Убираем набранное «/имя» — вместо него встаёт плашка приложенного файла.
   setDraft(d => d.replace(/(^|\s)\/[^\s\/]*$/, '$1'));
   attachFile(file);
   setPick(null); setFileQuery('');
 };
 const importFile = (event) => {
   const file = event.target.files && event.target.files[0];
   event.target.value = '';
   if (!file) return;
   if (file.size > 200 * 1024) { toast(lang === 'ru' ? 'Файл больше 200 КБ' : 'File is over 200 KB'); return; }
   const reader = new FileReader();
   reader.onload = () => attachFile({ path: file.name, code: String(reader.result || '') });
   reader.readAsText(file);
 };

 /* Доступ к модели платформа меняет на ходу, а часть моделей тратит весь
    бюджет на рассуждения и молчит. Поэтому при осечке пробуем следующую. */
 const stream = async (useModel, history, onPiece) => {
   const controller = new AbortController(); abort.current = controller;
   const res = await fetch('/api/v1/chat/send', {
     method: 'POST', signal: controller.signal, credentials: 'same-origin',
     headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'astracode' },
     body: JSON.stringify({ model: useModel, mode, messages: history.map(m => ({ role: m.role, content: m.text })) }),
   });
   if (!res.ok) {
     const data = await res.json().catch(() => null);
     throw new Error((data && data.error && data.error.message) || ('HTTP ' + res.status));
   }
   const reader = res.body.getReader(), decoder = new TextDecoder();
   let buffer = '', answer = '';
   for (;;) {
     const { value, done } = await reader.read();
     if (done) break;
     buffer += decoder.decode(value, { stream: true });
     const lines = buffer.split('\n'); buffer = lines.pop();
     for (const line of lines) {
       const trimmed = line.trim();
       if (!trimmed.startsWith('data:')) continue;
       const payload = trimmed.slice(5).trim();
       if (payload === '[DONE]') continue;
       try {
         const chunk = JSON.parse(payload);
         const piece = chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content;
         if (piece) { answer += piece; onPiece(answer); }
       } catch (e) { /* платформа шлёт и служебные строки */ }
     }
   }
   return answer;
 };

 const send = async () => {
   const text = draft.trim();
   if ((!text && !files.length) || busy || !model) return;
   // Приложенные файлы уходят в тело вопроса: платформа принимает только текст.
   // Путь называем явно — им же модель подписывает блок с правкой.
   const context = files.map(f => 'Файл проекта, путь ' + f.path + ':\n```\n' + f.code + '\n```').join('\n\n');
   const outgoing = context ? context + '\n\n' + text : text;
   const attached = files;
   const history = messages.concat([{ role: 'user', text: outgoing, shown: text || '(' + files.map(f => f.path).join(', ') + ')' }]);
   setMessages(history.concat([{ role: 'assistant', text: '', attached }]));
   setDraft(''); setFiles([]); setBusy(true); setNote(''); setFailed(false);

   const paint = (answer) => setMessages(list => list.map((m, i) => (i === list.length - 1 ? { ...m, text: answer } : m)));
   const queue = [model].concat(usable.map(m => m.id).filter(id => id !== model)).slice(0, 3);
   let lastError = null;
   try {
     for (let attempt = 0; attempt < queue.length; attempt++) {
       const candidate = queue[attempt];
       if (attempt > 0) setNote((lang === 'ru' ? 'Пробуем ' : 'Trying ') + candidate + '…');
       try {
         const answer = await stream(candidate, history, paint);
         if (answer) {
           if (attempt > 0) { setModel(candidate); setNote((lang === 'ru' ? 'Ответила ' : 'Answered by ') + candidate); }
           else setNote('');
           return;
         }
         lastError = new Error(lang === 'ru' ? 'Модель вернула пустой ответ' : 'The model returned nothing');
       } catch (e) {
         if (e.name === 'AbortError') return;
         lastError = e;
       }
       paint('');
     }
     setFailed(true); setNote(lastError ? lastError.message : 'error');
     setMessages(list => list.filter((m, i) => !(i === list.length - 1 && m.role === 'assistant' && !m.text)));
   } finally { setBusy(false); abort.current = null; }
 };

 /* Правка возвращается в тот же файл проекта, откуда он был взят. */
 const saveEdits = async (edits) => {
   setSaving(edits.map(e => e.path).join(','));
   try {
     for (const edit of edits) {
       if (!edit.projectId) throw new Error(lang === 'ru' ? 'Файл не привязан к проекту' : 'File has no project');
       await API.file(edit.projectId, { path: edit.path, code: edit.code, etag: edit.etag });
     }
     // Файл на диске изменился — список проектов должен это увидеть.
     if (onRefresh) await onRefresh();
     toast(edits.length === 1
       ? (lang === 'ru' ? 'Файл сохранён' : 'File saved')
       : (lang === 'ru' ? 'Файлы сохранены' : 'Files saved'));
   } catch (e) { setFailed(true); setNote(e.message); } finally { setSaving(''); }
 };

 /* Копирование ответа. Наличие navigator.clipboard ещё ничего не обещает: он
    отказывает без фокуса на странице и в части WebView, поэтому отказ — повод
    попробовать старый путь через временное поле, а не сдаться с ошибкой. */
 const copyAnswer = async (text, index) => {
   const viaField = () => {
     const box = document.createElement('textarea');
     box.value = text;
     box.style.cssText = 'position:fixed;left:-9999px;top:0';
     document.body.appendChild(box);
     box.select();
     const done = document.execCommand('copy');
     box.remove();
     return done;
   };
   let done = false;
   if (navigator.clipboard && window.isSecureContext) {
     try { await navigator.clipboard.writeText(text); done = true; } catch (e) { done = false; }
   }
   if (!done) { try { done = viaField(); } catch (e) { done = false; } }
   if (!done) { toast(lang === 'ru' ? 'Не удалось скопировать' : 'Could not copy'); return; }
   setCopied(index);
   setTimeout(() => setCopied(c => (c === index ? -1 : c)), 1600);
 };

 const createProject = async (spec, index) => {
   setCreating(spec.name);
   try {
     const created = await API.create({ name: spec.name, desc: spec.desc, theme: '', tags: [], tint: '#8fb0ff', files: spec.files });
     await onCreated(created);
     toast(lang === 'ru' ? 'Проект создан' : 'Project created');
     // В сборке результат должен быть виден сразу, без похода по вкладкам.
     const entry = page(spec);
     if (entry) {
       // После создания просмотр берёт файлы с диска: там работают и соседние.
       setPreview({ url: (created.preview || '') + entry.path, name: created.name, spec: index });
       setPreviewNonce(n => n + 1);
     }
   } catch (e) { setFailed(true); setNote(e.message); } finally { setCreating(''); }
 };

 const usable = models.filter(m => m.ok);
 const needle = query.trim().toLowerCase();
 const found = needle ? models.filter(m => m.id.toLowerCase().includes(needle)) : models;
 // Имя для страницы, собранной из обычного блока кода, берём из просьбы.
 const lastAsk = messages.filter(m => m.role === 'user').slice(-1)[0];
 const pageName = lastAsk ? (lastAsk.shown || lastAsk.text).split(/[.:\n]/)[0].trim().slice(0, 40) : '';
 const allFiles = projects.reduce((all, p) => all.concat(
   (p.files || []).map(f => ({ ...f, projectId: p.id, projectName: p.name }))), []);
 const fileNeedle = fileQuery.trim().toLowerCase();
 const foundFiles = fileNeedle
   ? allFiles.filter(f => (f.path + ' ' + f.projectName).toLowerCase().includes(fileNeedle))
   : allFiles;

 return <div className="chat-pane">
   <div className="chat-log" ref={log}>
     {messages.length === 0 && <p className="chat-empty">{lang === 'ru'
       ? 'Опишите, что нужно сделать, — модель ответит и при необходимости соберёт проект с файлами. Всё, что она создаст, останется на этом устройстве.'
       : 'Describe what you need — the model answers and can assemble a project with files. Everything it creates stays on this device.'}</p>}
     {messages.map((m, i) => {
       // Пока не пришло ни слова, пузыря нет: пустая плашка выглядела как
       // сломанный ответ, а о работе и так говорит «Думает» под ней.
       if (m.role === 'assistant' && busy && i === messages.length - 1 && !m.text) return null;
       const edits = m.role === 'assistant' ? parseEdits(m.text, (messages[i - 1] || {}).attached || m.attached || []) : [];
       const spec = m.role === 'assistant' && !edits.length
         ? (parseProject(m.text) || (mode === 'build' ? parsePage(m.text, pageName) : null))
         : null;
       let body = spec ? m.text.replace(spec.raw, '').trim() : m.text;
       for (const edit of edits) body = body.replace(edit.raw, '').trim();
       return <div key={i} className={'chat-msg ' + (m.role === 'user' ? 'is-me' : 'is-ai')}>
         {m.role === 'assistant' && busy && i === messages.length - 1 && m.text
           ? <div className="chat-bubble"><div className="t-reason">
               <div className="t-reason-viewport">
                 <div className="t-reason-scroll" ref={reason}><div className="t-reason-text">{m.text}</div></div>
               </div>
             </div></div>
           : <div className="chat-bubble">{m.role === 'user'
               ? (m.shown || m.text)
               : (body ? renderBody(body).map((part, k) => (part.kind === 'table'
                   ? <div className="chat-table" key={k}>
                       <table>
                         <thead><tr>{part.head.map((c, n) => <th key={n}>{inline(c)}</th>)}</tr></thead>
                         <tbody>{part.rows.map((row, n) =>
                           <tr key={n}>{row.map((c, q) => <td key={q}>{inline(c)}</td>)}</tr>)}</tbody>
                       </table>
                     </div>
                   : <span className="chat-text" key={k}>{inline(part.text)}</span>)) : '…')}</div>}
         {m.role === 'assistant' && body && !(busy && i === messages.length - 1) &&
           <div className="chat-actions">
             <button className="chat-copy" onClick={() => copyAnswer(body, i)}
               aria-label={lang === 'ru' ? 'Скопировать ответ' : 'Copy the answer'}>
               <Ico n={copied === i ? 'check' : 'copy'} s={14} />
               <span>{copied === i ? (lang === 'ru' ? 'Скопировано' : 'Copied') : (lang === 'ru' ? 'Копировать' : 'Copy')}</span>
             </button>
           </div>}
         {edits.map(edit => <div key={edit.path} className="chat-project">
           <Ico n="pen" s={18} />
           <span className="set-main"><b>{edit.path}</b>
             <span className="meta">{edit.projectName} · {edit.code.split('\n').length} {lang === 'ru' ? 'строк' : 'lines'}</span></span>
           <button className="cta is-sm" disabled={!!saving} onClick={() => saveEdits([edit])}>
             {saving.includes(edit.path) ? '…' : (lang === 'ru' ? 'Сохранить' : 'Save')}
           </button>
         </div>)}
         {spec && spec.guessed && <span className="meta">{lang === 'ru' ? 'собрано из блока кода' : 'assembled from the code block'}</span>}
         {spec && page(spec) && <Preview lang={lang}
           name={spec.name} entry={page(spec).path} html={inlinePage(spec)}
           url={preview && preview.spec === i ? preview.url : ''}
           nonce={previewNonce} full={full === i} onFull={v => setFull(v ? i : false)} />}
         {spec && <div className="chat-project">
           <Ico n="cube" s={18} />
           <span className="set-main"><b>{spec.name}</b><span className="meta">{spec.files.length} {plural(spec.files.length, FILES_FORMS, lang)}</span></span>
           <button className="cta is-sm" disabled={!!creating} onClick={() => createProject(spec, i)}>
             {creating === spec.name ? '…' : (lang === 'ru' ? 'Создать' : 'Create')}
           </button>
         </div>}
       </div>;
     })}
     {busy && <div className="chat-working">
       <span className="chat-dots" aria-hidden="true">{Array.from({ length: 9 }, (_, i) =>
         <span key={i} style={{ animationDelay: ((i % 3) + Math.abs(Math.floor(i / 3) - 1)) * 90 + 'ms' }} />)}</span>
       <span className="chat-shimmer">{lang === 'ru' ? 'Думает' : 'Thinking'}</span>
     </div>}
   </div>

   <div className="chat-compose">
     {note && <p className={'chat-note' + (failed ? ' is-error' : '')} role={failed ? 'alert' : 'status'}>{note}</p>}
     {files.length > 0 && <div className="chat-files">
       {files.map(f => <span key={f.path} className="chat-file"><span>{f.path}</span>
         <button aria-label={lang === 'ru' ? 'Убрать' : 'Remove'} onClick={() => setFiles(list => list.filter(x => x.path !== f.path))}>
           <Ico n="x" s={12} /></button></span>)}
     </div>}
     <div className="chat-tools">
       <button className="chat-pick is-wide" aria-haspopup="dialog" onClick={() => setPick('model')} disabled={busy}>
         <span>{model || (lang === 'ru' ? 'нет доступных' : 'none available')}</span>
         <Ico n="chevDown" s={13} />
       </button>
       <button className="chat-pick" aria-haspopup="dialog" onClick={() => setPick('mode')} disabled={busy}>
         <Ico n={mode === 'build' ? 'cube' : 'code'} s={14} />
         <span>{mode === 'build' ? MODE_LABEL[lang].build : MODE_LABEL[lang].chat}</span>
       </button>
       <button className="chat-pick" onClick={() => picker.current && picker.current.click()} disabled={busy}>
         <Ico n="upload" s={14} />
       </button>
       <input ref={picker} type="file" accept="text/*,.md,.json,.py,.js,.ts,.go,.css,.html" style={{ display: 'none' }} onChange={importFile} />
     </div>
     <div className="chat-row">
       <textarea ref={input} className="chat-input" rows={1} value={draft} disabled={!model}
         placeholder={lang === 'ru' ? 'Что собрать? «/» — файл проекта' : 'What should we build? "/" picks a file'}
         onChange={e => onDraft(e.target.value, e.target.selectionStart)}
         onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
       {busy
         ? <button className="chat-send" onClick={() => abort.current && abort.current.abort()} aria-label={lang === 'ru' ? 'Остановить' : 'Stop'}><Ico n="stop" s={16} /></button>
         : <button className="chat-send" onClick={send} disabled={(!draft.trim() && !files.length) || !model} aria-label={lang === 'ru' ? 'Отправить' : 'Send'}><Ico n="chev" s={18} /></button>}
     </div>
   </div>

   <Popup open={pick === 'model'} onClose={() => { setPick(null); setQuery(''); }} title={lang === 'ru' ? 'Модель' : 'Model'}
     sub={models.length + (lang === 'ru' ? ' моделей на платформе' : ' models on the platform')}
     foot={<button className="cta is-quiet" style={{ width: '100%' }} disabled={busy}
       onClick={() => { setPick(null); loadModels(true); }}>{lang === 'ru' ? 'Проверить заново' : 'Probe again'}</button>}>
     {/* Каталог платформы — три сотни позиций, без поиска в нём не найтись. */}
     <input className="field chat-search" value={query} placeholder={lang === 'ru' ? 'Поиск модели' : 'Search models'}
       autoCapitalize="off" autoCorrect="off" spellCheck={false} onChange={e => setQuery(e.target.value)} />
     {found.length === 0 && <p className="meta">{lang === 'ru' ? 'Ничего не нашлось' : 'Nothing found'}</p>}
     {[['checked', lang === 'ru' ? 'Проверены сейчас' : 'Checked just now'],
       ['rest', lang === 'ru' ? 'Остальной каталог' : 'Rest of the catalogue']].map(([kind, title]) => {
       const part = found.filter(m => (kind === 'checked') === !!m.checked);
       if (!part.length) return null;
       return <React.Fragment key={kind}>
         <p className="meta" style={{ margin: '4px 2px 6px' }}>{title}{kind === 'rest' &&
           (lang === 'ru' ? ' — доступ выяснится на первом вопросе' : ' — access is checked on the first question')}</p>
         <div className="set-group" style={{ marginBottom: 10 }}>
           {part.slice(0, kind === 'rest' && !query ? 40 : 400).map(m => <button key={m.id}
             className={'chat-option' + (m.checked ? '' : ' is-plain')} disabled={!m.ok}
             onClick={() => { setModel(m.id); setPick(null); setQuery(''); }}>
             <Ico n={m.id === model ? 'check' : (m.ok ? 'cube' : 'x')} s={16} />
             <span className="set-main"><b>{m.id}</b>{!m.ok && <span className="meta">{m.reason}</span>}</span>
           </button>)}
         </div>
       </React.Fragment>;
     })}
   </Popup>

   <Popup open={pick === 'file'} onClose={() => { setPick(null); setFileQuery(''); }}
     title={lang === 'ru' ? 'Файл проекта' : 'Project file'}
     sub={lang === 'ru' ? 'Уйдёт с вопросом; правку можно сохранить обратно' : 'Sent with the question; the edit can be saved back'}>
     <input className="field chat-search" value={fileQuery} autoFocus
       placeholder={lang === 'ru' ? 'Поиск по проектам' : 'Search projects'}
       autoCapitalize="off" autoCorrect="off" spellCheck={false} onChange={e => setFileQuery(e.target.value)} />
     {foundFiles.length === 0 && <p className="meta">{lang === 'ru'
       ? 'Файлов пока нет — создайте проект.' : 'No files yet — create a project first.'}</p>}
     <div className="set-group">
       {foundFiles.slice(0, 200).map(f => <button key={f.projectId + '/' + f.path} className="chat-option is-plain"
         onClick={() => pickFile(f)}>
         <Ico n="file" s={16} />
         <span className="set-main"><b>{f.path}</b><span className="meta">{f.projectName}</span></span>
       </button>)}
     </div>
   </Popup>

   <Popup open={pick === 'mode'} onClose={() => setPick(null)} title={lang === 'ru' ? 'Режим' : 'Mode'}>
     <div className="set-group">
       {['chat', 'build'].map(id => <button key={id} className="chat-option"
         onClick={() => { setMode(id); setPick(null); }}>
         <Ico n={mode === id ? 'check' : (id === 'build' ? 'cube' : 'code')} s={16} />
         <span className="set-main"><b>{MODE_LABEL[lang][id]}</b><span className="meta">{MODE_HINT[lang][id]}</span></span>
       </button>)}
     </div>
   </Popup>
 </div>;
}
