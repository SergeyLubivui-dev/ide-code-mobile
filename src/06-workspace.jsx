/* =========================================================================
   Терминал: сессии-вкладки, консольная палитра, ввод внутри полотна
   ========================================================================= */
function mkTerm(n) {
  return {
    id: nid('t'), n: n, shell: 'ps', proj: '', cwd: '', conn: null, hist: [], hp: -1,
    lines: [
      { k: 'sys', v: 'IDE Code PowerShell 7.4.5 · сессия ' + n },
      { k: 'out', v: 'Оболочка открыта в C:\\IDECode. dir — проекты, cd <проект> — войти, help — команды.' },
    ],
  };
}

const projSlug = (p) => p.name.toLowerCase().replace(/\s+/g, '-');

function TerminalPane({ t, lang, projects, sessions, setSessions, active, setActive }) {
  const [cmd, setCmd] = useState('');
  const [busy, setBusy] = useState(false);
  const [hints, setHints] = useState(false);
  const boxRef = useRef(null);
  const inRef = useRef(null);
  const s = sessions.find((x) => x.id === active) || sessions[0];

  useEffect(() => { if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight; }, [sessions, busy, active]);
  useEffect(() => { setCmd(''); }, [active]);

  if (!s) return <div className="term-pane" />;

  const patch = (fields) => setSessions((list) => list.map((x) => (x.id === s.id ? Object.assign({}, x, fields) : x)));
  const push = (k, v) => setSessions((list) => list.map((x) => (x.id === s.id ? Object.assign({}, x, { lines: x.lines.concat({ k: k, v: v }) }) : x)));
  const pushMany = (arr) => setSessions((list) => list.map((x) => (x.id === s.id ? Object.assign({}, x, { lines: x.lines.concat(arr) }) : x)));

  /* Корень оболочки — C:\IDECode со всеми проектами: s.proj говорит, в какой
     из них уже вошли, s.cwd — путь внутри него. Пусто и то и другое — корень. */
  const cur = projects.find((x) => projSlug(x) === s.proj) || null;
  const files = cur ? cur.files : [];
  const here = (sep) => [s.proj].concat(s.cwd ? s.cwd.split('/') : []).filter(Boolean).join(sep);

  const prompt = () => {
    const unix = here('/');
    if (s.conn) return s.conn.user + '@' + s.conn.host + ':~' + (unix ? '/' + unix : '') + '$ ';
    if (s.shell === 'bash') return 'dev@device:~/IDECode' + (unix ? '/' + unix : '') + '$ ';
    const win = here('\\');
    return 'PS C:\\IDECode' + (win ? '\\' + win : '') + '> ';
  };

  const needProject = (name) => push('err', name + ': ' + (lang === 'ru'
    ? 'здесь нет проекта — сначала cd <проект>'
    : 'no project here — cd <project> first'));

  const listNames = (dir) => {
    const prefix = dir ? dir + '/' : '';
    const dirs = {}; const out = [];
    files.forEach((f) => {
      if (prefix && f.path.indexOf(prefix) !== 0) return;
      const rest = f.path.slice(prefix.length);
      const cut = rest.indexOf('/');
      if (cut > 0) dirs[rest.slice(0, cut)] = true;
      else out.push({ name: rest, file: f });
    });
    return { dirs: Object.keys(dirs).sort(), files: out.sort((a, b) => a.name.localeCompare(b.name)) };
  };

  const stamp = (at) => new Date(at || Date.now())
    .toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

  const rootTable = () => {
    const rows = [{ k: 'out', v: '    Каталог: C:\\IDECode' }, { k: 'out', v: '' },
      { k: 'cmd', v: 'Mode      LastWriteTime      Length Name' },
      { k: 'out', v: '----      -------------      ------ ----' }];
    projects.forEach((x) => rows.push({ k: 'out', v: 'd----  ' + stamp(x.updatedAt) + '            ' + projSlug(x) }));
    if (!projects.length) rows.push({ k: 'out', v: lang === 'ru' ? '(проектов ещё нет)' : '(no projects yet)' });
    return rows;
  };

  const dirTable = (dir) => {
    const l = listNames(dir);
    const when = new Date((cur && cur.updatedAt) || Date.now())
      .toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    const rows = [];
    rows.push({ k: 'out', v: '    Каталог: C:\\IDECode\\' + here('\\') });
    rows.push({ k: 'out', v: '' });
    rows.push({ k: 'cmd', v: 'Mode      LastWriteTime      Length Name' });
    rows.push({ k: 'out', v: '----      -------------      ------ ----' });
    l.dirs.forEach((d) => rows.push({ k: 'out', v: 'd----  ' + when + '            ' + d }));
    l.files.forEach((f) => rows.push({ k: 'out', v: '-a---  ' + when + ' ' + String(f.file.code.length).padStart(10, ' ') + ' ' + f.name }));
    return rows;
  };

  const connect = (user, host, port) => {
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      patch({ conn: { user: user, host: host, port: port || '22' }, shell: 'ssh' });
      pushMany([
        { k: 'sys', v: 'ключ ed25519 SHA256:9f2c…a71b принят' },
        { k: 'ok', v: (lang === 'ru' ? 'Соединение установлено · ' : 'Connected · ') + user + '@' + host },
        { k: 'out', v: 'Linux ' + host.split('.')[0] + ' 6.8.0-41-generic x86_64 · последний вход: сегодня, 09:12' },
      ]);
    }, 1200);
  };

  const run = (raw) => {
    const input = raw.trim();
    if (!input) { push('cmd', prompt()); return; }
    push('cmd', prompt() + input);
    patch({ hist: [input].concat(s.hist).slice(0, 50), hp: -1 });
    setCmd('');
    const parts = input.split(/\s+/);
    const name = parts[0].toLowerCase();
    const args = parts.slice(1);

    if (name === 'clear' || name === 'cls') { patch({ lines: [] }); return; }
    if (name === 'help' || name === 'get-help') {
      pushMany([
        { k: 'out', v: 'dir | ls            ' + (lang === 'ru' ? 'список файлов' : 'list files') },
        { k: 'out', v: 'cd <проект|папка>   ' + (lang === 'ru' ? 'войти в проект или папку' : 'enter a project or folder') },
        { k: 'out', v: 'cd ..               ' + (lang === 'ru' ? 'на уровень выше, из проекта — в корень' : 'up one level, out of the project to the root') },
        { k: 'out', v: 'cat | type <файл>   ' + (lang === 'ru' ? 'вывести файл' : 'print a file') },
        { k: 'out', v: 'grep <текст>        ' + (lang === 'ru' ? 'поиск по проекту' : 'search the project') },
        { k: 'out', v: 'run | python <файл> ' + (lang === 'ru' ? 'запустить' : 'run') },
        { k: 'out', v: 'git status | log    ' + (lang === 'ru' ? 'состояние и точки' : 'state and points') },
        { k: 'out', v: 'ssh user@host       ' + (lang === 'ru' ? 'подключиться к серверу' : 'connect to a server') },
        { k: 'out', v: 'listen <порт>       ' + (lang === 'ru' ? 'ждать обратную оболочку' : 'wait for a reverse shell') },
        { k: 'out', v: 'exit · whoami · pwd · date · history · clear' },
      ]);
      return;
    }
    if (name === 'pwd' || name === 'get-location') {
      const win = here('\\'), unix = here('/');
      push('out', s.shell === 'ps' && !s.conn
        ? 'C:\\IDECode' + (win ? '\\' + win : '')
        : '/home/dev/IDECode' + (unix ? '/' + unix : ''));
      return;
    }
    if (name === 'whoami') { push('out', s.conn ? s.conn.user + '@' + s.conn.host : 'device\\dev'); return; }
    if (name === 'date' || name === 'get-date') { push('out', new Date().toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-GB')); return; }
    if (name === 'history') { push('out', s.hist.slice(0, 15).reverse().map((h, i) => ('  ' + (i + 1) + '  ' + h)).join('\n') || '—'); return; }
    if (name === 'ls' || name === 'dir' || name === 'get-childitem' || name === 'gci') {
      if (!cur) {
        if (s.shell === 'ps' && !s.conn) { pushMany(rootTable()); return; }
        push('out', projects.map((x) => projSlug(x) + '/').join('\n') || (lang === 'ru' ? 'пусто' : 'empty'));
        return;
      }
      if (s.shell === 'ps' && !s.conn) { pushMany(dirTable(s.cwd)); return; }
      const l = listNames(s.cwd);
      push('out', l.dirs.map((d) => d + '/').concat(l.files.map((f) => f.name)).join('\n') || (lang === 'ru' ? 'пусто' : 'empty'));
      return;
    }
    if (name === 'cd' || name === 'set-location') {
      const target = (args[0] || '').replace(/[\\/]$/, '');
      if (!target || target === '~' || target === '\\' || target === '/') { patch({ proj: '', cwd: '' }); return; }
      if (target === '..') {
        if (s.cwd) patch({ cwd: s.cwd.split('/').slice(0, -1).join('/') });
        else patch({ proj: '' });
        return;
      }
      if (!cur) {
        const hit = projects.find((x) => projSlug(x) === target.toLowerCase());
        if (!hit) { push('err', 'cd: ' + target + ': ' + (lang === 'ru' ? 'нет такого проекта' : 'no such project')); return; }
        patch({ proj: projSlug(hit), cwd: '' });
        return;
      }
      const next = (s.cwd ? s.cwd + '/' : '') + target;
      if (!files.some((f) => f.path.indexOf(next + '/') === 0)) { push('err', 'cd: ' + target + ': ' + (lang === 'ru' ? 'нет такой папки' : 'no such directory')); return; }
      patch({ cwd: next });
      return;
    }
    if (name === 'cat' || name === 'type' || name === 'get-content') {
      if (!cur) { needProject(name); return; }
      const p = (s.cwd ? s.cwd + '/' : '') + (args[0] || '');
      const f = files.find((x) => x.path === p || x.path === args[0] || x.path.endsWith('/' + args[0]));
      if (!f) { push('err', name + ': ' + (args[0] || '') + ': ' + (lang === 'ru' ? 'файл не найден' : 'file not found')); return; }
      push('out', f.code.split('\n').slice(0, 80).join('\n'));
      return;
    }
    if (name === 'grep' || name === 'select-string' || name === 'findstr') {
      if (!cur) { needProject(name); return; }
      const needle = args.join(' ').toLowerCase();
      if (!needle) { push('err', name + ': ' + (lang === 'ru' ? 'нужен текст' : 'text required')); return; }
      const hits = [];
      files.forEach((f) => f.code.split('\n').forEach((l, i) => {
        if (l.toLowerCase().indexOf(needle) >= 0) hits.push(f.path + ':' + (i + 1) + ':' + l.trim().slice(0, 70));
      }));
      push(hits.length ? 'out' : 'err', hits.slice(0, 15).join('\n') || (lang === 'ru' ? 'совпадений нет' : 'no matches'));
      return;
    }
    if (name === 'run' || name === 'python' || name === 'python3' || name === 'node' || name === 'go') {
      if (!cur) { needProject(name); return; }
      setBusy(true);
      setTimeout(() => {
        setBusy(false);
        pushMany([
          { k: 'out', v: '12:04:11  INFO  Astra запущен, дежурных: 4' },
          { k: 'out', v: '12:04:11  INFO  poll interval 2.0s' },
          { k: 'ok', v: (lang === 'ru' ? 'процесс работает · Ctrl+C для остановки' : 'process running · Ctrl+C to stop') },
        ]);
      }, 900);
      return;
    }
    if (name === 'git') {
      if (!cur) { needProject(name); return; }
      const sub = (args[0] || '').toLowerCase();
      if (sub === 'status') {
        const dirty = files.filter((f) => f.dirty || f.fresh);
        push('out', 'On branch main');
        if (!dirty.length) push('ok', 'nothing to commit, working tree clean');
        else dirty.forEach((f) => push('warn', '        ' + (f.fresh ? 'new file:   ' : 'modified:   ') + f.path));
        return;
      }
      if (sub === 'log') {
        (cur.snaps || []).slice(0, 8).forEach((sn) => {
          push('out', sn.hash + '  ' + fmtDT(sn.at, lang) + '  ' + sn.msg);
        });
        return;
      }
      push('out', 'git: ' + sub + ' — ' + (lang === 'ru' ? 'в демо доступны status и log' : 'demo supports status and log'));
      return;
    }
    if (name === 'ssh') {
      const m = (args[0] || '').match(/^([\w.-]+)@([\w.-]+)$/);
      const port = (args.indexOf('-p') >= 0 ? args[args.indexOf('-p') + 1] : '22');
      if (!m) { push('err', 'ssh: ' + (lang === 'ru' ? 'формат — ssh user@host [-p порт]' : 'usage — ssh user@host [-p port]')); return; }
      connect(m[1], m[2], port);
      return;
    }
    if (name === 'listen' || name === 'nc') {
      const port = args.find((a) => /^\d+$/.test(a)) || '4444';
      setBusy(true);
      push('sys', (lang === 'ru' ? 'слушаю обратное подключение на порту ' : 'listening for a reverse shell on port ') + port + '…');
      setTimeout(() => {
        setBusy(false);
        patch({ conn: { user: 'root', host: '10.0.0.14', port: port }, shell: 'ssh' });
        pushMany([
          { k: 'ok', v: (lang === 'ru' ? 'подключение с 10.0.0.14 · оболочка получена' : 'connection from 10.0.0.14 · shell received') },
          { k: 'out', v: 'bash: no job control in this shell' },
        ]);
      }, 1500);
      return;
    }
    if (name === 'exit' || name === 'logout') {
      if (s.conn) { patch({ conn: null, shell: 'ps' }); push('sys', lang === 'ru' ? 'соединение закрыто' : 'connection closed'); }
      else push('out', lang === 'ru' ? 'нет активного соединения' : 'no active connection');
      return;
    }
    if (name === 'ping' || name === 'curl' || name === 'wget' || name === 'invoke-webrequest') {
      push('err', name + ': ' + (lang === 'ru' ? 'сеть в демо-режиме отключена' : 'network is off in demo mode'));
      return;
    }
    if (s.shell === 'ps' && !s.conn) {
      pushMany([
        { k: 'err', v: parts[0] + ' : ' + (lang === 'ru' ? 'имя "' + parts[0] + '" не распознано как имя командлета, функции или программы.' : 'the term "' + parts[0] + '" is not recognized as a cmdlet, function or program.') },
        { k: 'err', v: 'строка:1 знак:1' },
        { k: 'err', v: '+ ' + input },
        { k: 'err', v: '+ ' + Array(Math.min(input.length, 40) + 1).join('~') },
      ]);
      return;
    }
    push('err', name + ': ' + (lang === 'ru' ? 'команда не найдена' : 'command not found'));
  };

  const onKey = (e) => {
    if (e.key === 'Enter') { run(cmd); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); const n = Math.min(s.hp + 1, s.hist.length - 1); if (n >= 0) { patch({ hp: n }); setCmd(s.hist[n]); } return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); const n = s.hp - 1; patch({ hp: n }); setCmd(n >= 0 ? s.hist[n] : ''); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      const parts = cmd.split(/\s+/); const last = parts[parts.length - 1] || '';
      const l = cur ? listNames(s.cwd) : { dirs: projects.map(projSlug), files: [] };
      const cand = l.dirs.map((d) => d + '/').concat(l.files.map((f) => f.name)).find((f) => last && f.indexOf(last) === 0);
      if (cand) { parts[parts.length - 1] = cand; setCmd(parts.join(' ')); }
    }
  };

  const addSession = () => {
    const n = sessions.reduce((m, x) => Math.max(m, x.n), 0) + 1;
    const fresh = mkTerm(n);
    setSessions(sessions.concat(fresh));
    setActive(fresh.id);
  };
  const closeSession = (id) => {
    const next = sessions.filter((x) => x.id !== id);
    const list = next.length ? next : [mkTerm(1)];
    setSessions(list);
    if (id === active) setActive(list[list.length - 1].id);
  };

  return (
    <div className="term-pane" data-shell={s.conn ? 'ssh' : s.shell}>
      <div className="term-tabs">
        {sessions.map((x) => (
          <div key={x.id} className={'term-tab' + (x.id === s.id ? ' is-active' : '')} role="button" tabIndex={0}
            onClick={() => setActive(x.id)} onKeyDown={(e) => { if (e.key === 'Enter') setActive(x.id); }}>
            <Ico n="terminal" s={13} />
            {t.tabTerminal} {x.n}
            {x.conn && <i className="term-dot is-live" />}
            <span className="ed-tab-x" onClick={(e) => { e.stopPropagation(); closeSession(x.id); }}><Ico n="x" s={12} /></span>
          </div>
        ))}
        <button className="ed-tabs-add" onClick={addSession} aria-label={t.newSession}><Ico n="plus" s={15} /></button>
      </div>

      <div className="term-body" ref={boxRef}
        onClick={() => { if (!window.getSelection || String(window.getSelection()) === '') { if (inRef.current) inRef.current.focus(); } }}>
        {s.lines.map((l, i) => <div className={'term-line ' + l.k} key={i}>{l.v}</div>)}
        {busy && <div className="term-line t-shimmer">{t.connecting}</div>}
        <div className="term-inline">
          <span className="term-ps">{prompt()}</span>
          <input ref={inRef} value={cmd} onChange={(e) => setCmd(e.target.value)} onKeyDown={onKey}
            spellCheck="false" autoCapitalize="off" autoCorrect="off" autoComplete="off" aria-label={t.tabTerminal} />
        </div>
      </div>

      <div className="term-extra">
        {hints && (
          <div className="ed-extra-menu is-hints t-dropdown is-open" data-origin="bottom-right">
            {[
              ['help', lang === 'ru' ? 'список команд' : 'list of commands'],
              ['dir', lang === 'ru' ? 'что лежит в текущей папке' : 'what is in the current folder'],
              ['cd astra-bot', lang === 'ru' ? 'войти в проект' : 'enter a project'],
              ['cat main.py', lang === 'ru' ? 'вывести файл' : 'print a file'],
              ['grep async', lang === 'ru' ? 'поиск по проекту' : 'search the project'],
              ['run main.py', lang === 'ru' ? 'запустить' : 'run'],
              ['git status', lang === 'ru' ? 'что изменилось' : 'what changed'],
              ['ssh deploy@astra.dev', lang === 'ru' ? 'подключиться к серверу' : 'connect to a server'],
              ['listen 4444', lang === 'ru' ? 'ждать обратную оболочку' : 'wait for a reverse shell'],
              ['exit', lang === 'ru' ? 'закрыть соединение' : 'close the connection'],
              ['clear', lang === 'ru' ? 'очистить экран' : 'clear the screen'],
            ].map((h) => (
              <button key={h[0]} onClick={() => { setHints(false); run(h[0]); }}>
                <span className="hint-cmd">{h[0]}</span>
                <span className="hint-txt">{h[1]}</span>
              </button>
            ))}
          </div>
        )}
        <button className="ed-extra-btn" onClick={() => setHints(!hints)}>
          <Ico n="dots" s={16} />{t.extra}
        </button>
      </div>
    </div>
  );
}

/* =========================================================================
   История: инфографика, точная дата, откат
   ========================================================================= */
function HistoryPane({ t, lang, project, updateProject, toast }) {
  const [sel, setSel] = useState(null);
  const [msg, setMsg] = useState('');
  const [staged, setStaged] = useState({});
  const [openChanges, setOpenChanges] = useState(true);
  const [openSnaps, setOpenSnaps] = useState(true);
  const [done, setDone] = useState(false);
  const files = project.files;
  const changes = files.filter((f) => f.dirty || f.fresh);
  const snaps = project.snaps || [];

  useEffect(() => {
    const st = {}; changes.forEach((f) => { st[f.id] = staged[f.id] !== false; });
    setStaged(st);
  }, [changes.length]);

  const inSnap = changes.filter((f) => staged[f.id]);
  const save = async () => {
    if (!inSnap.length || !msg.trim()) return;
    if(ENGINE_SERVER){
      try{
        for(const f of inSnap.filter(f=>f.unsaved)){
          const saved=await API.file(project.id,f);
          updateProject(p=>({...p,files:p.files.map(x=>x.path===f.path?{...x,etag:saved.etag,unsaved:x.code!==f.code}:x)}));
        }
        const snap=await API.request('/projects/'+project.id+'/snapshots',{method:'POST',body:{message:msg.trim(),paths:inSnap.map(f=>f.path)}});
        updateProject(p=>({...p,snaps:[snap].concat(p.snaps||[]),files:p.files.map(f=>inSnap.some(x=>x.path===f.path)?{...f,dirty:false,fresh:false}:f)}));
        setMsg('');setDone(true);setTimeout(()=>setDone(false),1800);
      }catch(e){toast(e.message);}return;
    }
    const snap = {
      id: nid('s'), hash: shortHash(), msg: msg.trim(),
      who: lang === 'ru' ? 'вы' : 'you', whoEn: 'you', at: Date.now(),
      files: inSnap.map((f) => ({ path: f.path, code: f.code })),
    };
    updateProject((p) => Object.assign({}, p, {
      snaps: [snap].concat(p.snaps || []),
      files: p.files.map((f) => (inSnap.some((x) => x.id === f.id) ? Object.assign({}, f, { dirty: false, fresh: false }) : f)),
    }));
    setMsg(''); setDone(true); setTimeout(() => setDone(false), 1800);
  };

  const rollback = async (snap, onlyPath) => {
    if(ENGINE_SERVER){
      if(project.files.some(f=>f.unsaved)){toast(lang==='ru'?'Сначала сохраните несохранённые правки':'Save your drafts first');return;}
      try{
        const current=await API.project(project.id);
        await API.request('/projects/'+project.id+'/snapshots/'+snap.id+'/restore',{method:'POST',headers:{'If-Match':current._etag},body:{path:onlyPath||''}});
        const updated=await API.project(project.id);updateProject(()=>updated);toast(t.restored);
      }catch(e){toast(e.message);}return;
    }
    updateProject((p) => {
      let list = p.files.slice();
      snap.files.forEach((sf) => {
        if (onlyPath && sf.path !== onlyPath) return;
        const idx = list.findIndex((f) => f.path === sf.path);
        if (idx >= 0) list[idx] = Object.assign({}, list[idx], { code: sf.code, dirty: true, unsaved: false });
        else list = list.concat(Object.assign({}, mkFile(sf.path, sf.code), { fresh: true }));
      });
      return Object.assign({}, p, { files: list });
    });
    toast(t.restored + (onlyPath ? ' · ' + onlyPath : ''));
  };

  const graph = snaps.slice(0, 12).slice().reverse().map((sn) => ({
    sn: sn, lines: sn.files.reduce((a, f) => a + (f.lines ?? (f.code||'').split('\n').length), 0),
  }));
  const peak = graph.reduce((m, g) => Math.max(m, g.lines), 1);

  return (
    <Fade className="pane">
      {done && (
        <div className="row" style={{ gap: 12, padding: '2px 0 12px' }}>
          <SuccessCheck size={40} tone="var(--state-ok)" /><b>{t.committed}</b>
        </div>
      )}

      {graph.length > 0 && (
        <>
          <div className="hist-legend" style={{ justifyContent: 'space-between' }}>
            <span>{t.snapshots} · <span className="num">{snaps.length}</span></span>
            <span className="num">{lang === 'ru' ? 'последняя: ' : 'latest: '}{fmtDT(snaps[0].at, lang)}</span>
          </div>
          <div className="hist-graph">
            {graph.map((g) => (
              <button className={'hist-col' + (sel === g.sn.id ? ' is-on' : '')} key={g.sn.id}
                onClick={() => setSel(sel === g.sn.id ? null : g.sn.id)}
                title={g.sn.msg + ' · ' + fmtDT(g.sn.at, lang) + ' · ' + g.lines + ' ' + t.linesShort}>
                <span className="hist-bar" style={{ height: Math.max(6, Math.round((g.lines / peak) * 46)) + 'px' }} />
                <span className="hist-tick">{new Date(g.sn.at).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB', { day: '2-digit', month: '2-digit' })}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <Rule label={t.changes} count={changes.length} open={openChanges} onToggle={() => setOpenChanges(!openChanges)} />
      <Fold open={openChanges}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 12 }}>
          {changes.length === 0 && <div className="meta">{t.noChanges}</div>}
          {changes.map((f) => (
            <div key={f.id} className="g-row">
              <CheckBox on={!!staged[f.id]} onChange={(v) => setStaged(Object.assign({}, staged, { [f.id]: v }))} label={f.path} />
              <span className="g-mark" style={f.fresh
                ? { background: 'var(--state-ok-dim)', color: 'var(--state-ok)' }
                : { background: 'var(--state-warning-dim)', color: 'var(--state-warning)' }}>{f.fresh ? 'A' : 'M'}</span>
              <span className="mono" style={{ fontSize: 13, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.path}</span>
              <span className="meta num">{f.code.split('\n').length}</span>
            </div>
          ))}
          {changes.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
              <textarea className="field" rows={2} placeholder={t.snapMsg} value={msg} onChange={(e) => setMsg(e.target.value)} />
              <button className="cta" disabled={!inSnap.length || !msg.trim()} onClick={save}>
                <Ico n="save" s={17} />{t.saveSnap} · <span className="num">{inSnap.length}</span>
              </button>
            </div>
          )}
        </div>
      </Fold>

      <Rule label={t.snapshots} count={snaps.length} open={openSnaps} onToggle={() => setOpenSnaps(!openSnaps)} />
      <Fold open={openSnaps}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {snaps.length === 0 && <div className="meta">{lang === 'ru' ? 'Точек пока нет' : 'No restore points yet'}</div>}
          {snaps.map((sn, i) => (
            <div key={sn.id}>
              <button className={'snap' + (sel === sn.id ? ' is-on' : '')} onClick={() => setSel(sel === sn.id ? null : sn.id)}>
                <span className="snap-rail"><span className="snap-dot" />{i < snaps.length - 1 && <span className="snap-line" />}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <b>{sn.msg}</b>
                  <span className="meta mono num" style={{ fontSize: 12, display: 'block' }}>{fmtDT(sn.at, lang)}</span>
                  <span className="meta mono" style={{ fontSize: 12 }}>
                    {sn.hash} · {lang === 'ru' ? sn.who : (sn.whoEn || sn.who)} · {sn.files.length} {plural(sn.files.length, FILES_FORMS, lang)} · {fmtAgo(sn.at, lang)}
                  </span>
                </span>
                <span className="tree-chev" style={{ transform: sel === sn.id ? 'rotate(90deg)' : 'none' }}><Ico n="chev" s={14} /></span>
              </button>
              <Fold open={sel === sn.id}>
                <div style={{ padding: '8px 0 10px 24px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div className="eyebrow">{t.inSnap}</div>
                  {sn.files.map((sf) => (
                    <div className="g-row" key={sf.path}>
                      <span className="tree-ico" style={{ color: LANG_COLOR[langOf(sf.path)] || 'var(--text-tertiary)' }}><Ico n="file" s={14} /></span>
                      <span className="mono" style={{ fontSize: 13, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sf.path}</span>
                      <span className="meta num">{sf.lines ?? (sf.code||'').split('\n').length}</span>
                      <button className="chip is-sm" onClick={() => rollback(sn, sf.path)}><Ico n="refresh" s={13} />{lang === 'ru' ? 'файл' : 'file'}</button>
                    </div>
                  ))}
                  <button className="cta is-sm is-quiet" style={{ alignSelf: 'flex-start' }} onClick={() => rollback(sn)}>
                    <Ico n="refresh" s={15} />{t.restore}
                  </button>
                </div>
              </Fold>
            </div>
          ))}
        </div>
      </Fold>
    </Fade>
  );
}

/* =========================================================================
   Поиск: по файлу, по проекту, по всем проектам
   ========================================================================= */
function SearchPane({ t, lang, project, projects, state, setState, onOpenAt, onOpenGlobal, activeFile }) {
  const q = state.q, scope = state.scope, cs = state.cs;
  const set = (fields) => setState(Object.assign({}, state, fields));

  const results = useMemo(() => {
    if (!q) return [];
    const needle = cs ? q : q.toLowerCase();
    const scan = (files, proj) => {
      const out = [];
      files.forEach((f) => {
        const hits = [];
        f.code.split('\n').forEach((line, i) => {
          const hay = cs ? line : line.toLowerCase();
          if (hay.indexOf(needle) >= 0) hits.push({ i: i, line: line.trim().slice(0, 140) });
        });
        if (hits.length) out.push({ file: f, hits: hits, proj: proj });
      });
      return out;
    };
    if (scope === 'file') return activeFile ? scan([activeFile], project) : [];
    if (scope === 'all') {
      let out = [];
      projects.forEach((p) => { out = out.concat(scan(p.files, p)); });
      return out;
    }
    return scan(project.files, project);
  }, [q, cs, scope, project, projects, activeFile]);
  const total = results.reduce((a, r) => a + r.hits.length, 0);

  const mark = (line) => {
    const idx = (cs ? line : line.toLowerCase()).indexOf(cs ? q : q.toLowerCase());
    if (idx < 0) return line;
    return <>{line.slice(0, idx)}<mark>{line.slice(idx, idx + q.length)}</mark>{line.slice(idx + q.length)}</>;
  };

  return (
    <Fade className="pane">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="row" style={{ gap: 8 }}>
          <span style={{ color: 'var(--text-secondary)', display: 'grid', placeItems: 'center' }}><Ico n="search" s={20} /></span>
          <input className="field" autoFocus value={q} placeholder={t.searchAll} onChange={(e) => set({ q: e.target.value })} />
          <button className={'icon-btn' + (cs ? '' : ' is-ghost')} onClick={() => set({ cs: !cs })}
            aria-label="Aa" title="Aa" style={{ fontSize: 14, fontWeight: 700 }}>Aa</button>
        </div>
        <div className="row" style={{ gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div className="seg">
            {[['file', t.scopeFile], ['project', t.scopeProject], ['all', t.scopeAll]].map((sc) => (
              <button key={sc[0]} className={scope === sc[0] ? 'is-on' : ''} onClick={() => set({ scope: sc[0] })}>{sc[1]}</button>
            ))}
          </div>
          <span className="meta"><span className="num">{total}</span> {t.matches}</span>
        </div>
      </div>

      <div style={{ height: 12 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {!q && <div className="meta" style={{ padding: '8px 2px' }}>{t.searchHint}</div>}
        {q && results.length === 0 && <div className="meta" style={{ padding: '8px 2px' }}>{t.noMatch}</div>}
        {results.map((r) => (
          <div key={(r.proj ? r.proj.id : '') + r.file.id}>
            <div className="res-file">
              <span className="tree-ico" style={{ color: LANG_COLOR[langOf(r.file.path)] || 'var(--text-tertiary)' }}><Ico n="file" s={17} /></span>
              <span className="mono" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {scope === 'all' && r.proj && r.proj.id !== project.id ? <span style={{ color: r.proj.tint }}>{r.proj.name} / </span> : null}
                {r.file.path}
              </span>
              <span className="badge mute num">{r.hits.length}</span>
            </div>
            {r.hits.slice(0, 8).map((h) => (
              <button className="res-hit" key={h.i}
                onClick={() => (r.proj && r.proj.id !== project.id ? onOpenGlobal(r.proj, r.file, h.i, q) : onOpenAt(r.file, h.i, q))}>
                <em className="num">{h.i + 1}</em>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mark(h.line)}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </Fade>
  );
}

/* =========================================================================
   Расширенные настройки редактора
   ========================================================================= */
function PrefsPane({ t, lang, settings, setSettings, project, onGoSettings }) {
  const [openA, setOpenA] = useState(true);
  const [openB, setOpenB] = useState(true);
  const st = projectStats(project.files);
  return (
    <Fade className="pane">
      <Rule label={t.setEditor} open={openA} onToggle={() => setOpenA(!openA)} />
      <Fold open={openA}>
        <div className="set-group" style={{ paddingBottom: 12 }}>
          <div className="set-row">
            <Ico n="code" s={18} />
            <span className="set-main"><b>{t.setFont}</b><span className="meta">{t.foldHint}</span></span>
            <div className="stepper">
              <button onClick={() => setSettings(Object.assign({}, settings, { font: Math.max(12, settings.font - 1) }))} aria-label="-"><Ico n="minus" s={13} /></button>
              <span className="num">{settings.font}px</span>
              <button onClick={() => setSettings(Object.assign({}, settings, { font: Math.min(22, settings.font + 1) }))} aria-label="+"><Ico n="plus" s={13} /></button>
            </div>
          </div>
          <div className="set-row">
            <Ico n="wrapTxt" s={18} />
            <span className="set-main"><b>{t.setTab}</b></span>
            <div className="seg">{[2, 4, 8].map((n) => (
              <button key={n} className={settings.tab === n ? 'is-on' : ''} onClick={() => setSettings(Object.assign({}, settings, { tab: n }))}>{n}</button>
            ))}</div>
          </div>
          <div className="set-row">
            <Ico n="file" s={18} />
            <span className="set-main"><b>{t.wrap}</b><span className="meta">{t.setWrapB}</span></span>
            <Toggle on={settings.wrap} onChange={(v) => setSettings(Object.assign({}, settings, { wrap: v }))} label={t.wrap} />
          </div>
          <div className="set-row">
            <Ico n="sliders" s={18} />
            <span className="set-main"><b>{t.setNums}</b></span>
            <Toggle on={settings.nums} onChange={(v) => setSettings(Object.assign({}, settings, { nums: v }))} label={t.setNums} />
          </div>
        </div>
      </Fold>

      <Rule label={t.projTitle} open={openB} onToggle={() => setOpenB(!openB)} />
      <Fold open={openB}>
        <div className="set-group">
          <div className="set-row"><span className="set-main"><b>{project.name}</b><span className="meta">{project.desc}</span></span></div>
          <div className="set-row"><span className="set-main">
            <b>{st.count} {plural(st.count, FILES_FORMS, lang)} · {st.lines} {t.linesShort}</b>
            <span className="meta">{st.formats.map((f) => (LANGS[f.lang] || LANGS.txt).label + ' ' + f.n).join(' · ')}</span>
          </span></div>
          <div className="set-row"><span className="set-main">
            <b className="num">{fmtDT(project.updatedAt, lang)}</b><span className="meta">{t.updated}</span>
          </span></div>
          <button className="set-row" onClick={onGoSettings}>
            <Ico n="sliders" s={18} /><span className="set-main"><b>{t.setTitle}</b><span className="meta">{t.setAppear}, {t.setLang}, {t.setData}</span></span>
            <Ico n="chev" s={15} />
          </button>
        </div>
      </Fold>
    </Fade>
  );
}

/* =========================================================================
   Рабочая область
   ========================================================================= */
function CodeScreen({ t, lang, project, projects, updateProject, onRefresh, isWide, toast, goProjects, goSettings,
  settings, setSettings, toolSignal, onActiveKind, openInProject, pendingOpen }) {
  const [ask, askNode] = useAsk();
  const [tabs, setTabs] = useState([]);
  const [active, setActive] = useState(null);
  const [openDirs, setOpenDirs] = useState({});
  const [treeOn, setTreeOn] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [pop, setPop] = useState(null);
  const [newName, setNewName] = useState('');
  const [q, setQ] = useState('');
  const [jump, setJump] = useState(null);
  const [hitIdx, setHitIdx] = useState(0);
  const [findOn, setFindOn] = useState(false);
  const [folds, setFolds] = useState({});
  const [symSet, setSymSet] = useState(null);
  const [mdMode, setMdMode] = useState({});
  const [extraOpen, setExtraOpen] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [arrows, setArrows] = useState({ l: false, r: false });
  const [terms, setTerms] = useState([mkTerm(1)]);
  const [termActive, setTermActive] = useState(null);
  const [search, setSearch] = useState({ q: '', scope: 'project', cs: false });
  const importRef = useRef(null);
  const tabsRef = useRef(null);
  const dragRef = useRef(null);

  const files = project ? project.files : [];

  useEffect(() => {
    if (!project) { setTabs([]); setActive(null); return; }
    const first = project.files.find((f) => /readme/i.test(f.path)) || project.files[0];
    setTabs(first ? [{ key: 'f:' + first.path, kind: 'file', path: first.path }] : []);
    setActive(first ? 'f:' + first.path : null);
    const dirs = {};
    allDirKeys(project.files).forEach((k) => { dirs[k] = k.split('/').length <= 2; });
    setOpenDirs(dirs);
    setFolds({});
  }, [project && project.id]);

  const openTool = useCallback((kind) => {
    if (kind === 'file') {
      setTabs((list) => {
        const f = list.filter((x) => x.kind === 'file');
        if (f.length) setActive(f[f.length - 1].key);
        return list;
      });
      setDrawer(false);
      return;
    }
    setTabs((list) => (list.some((x) => x.key === kind) ? list : list.concat({ key: kind, kind: kind })));
    setActive(kind);
    setDrawer(false);
  }, []);

  useEffect(() => { if (toolSignal && toolSignal.kind) openTool(toolSignal.kind); }, [toolSignal && toolSignal.n]);

  const openFile = (f, line, query) => {
    const key = 'f:' + f.path;
    setTabs((list) => (list.some((x) => x.key === key) ? list : list.concat({ key: key, kind: 'file', path: f.path })));
    setActive(key);
    setDrawer(false);
    if (line != null) { setQ(query || ''); setFindOn(!!query); setTimeout(() => setJump(line), 80); }
  };

  useEffect(() => {
    if (!pendingOpen || !pendingOpen.path || !project) return;
    const f = project.files.find((x) => x.path === pendingOpen.path);
    if (f) openFile(f, pendingOpen.line, pendingOpen.q);
  }, [pendingOpen && pendingOpen.n]);

  const closeTab = (key) => {
    setTabs((list) => {
      const next = list.filter((x) => x.key !== key);
      if (key === active) setActive(next.length ? next[next.length - 1].key : null);
      return next;
    });
  };

  const activeTab = tabs.find((x) => x.key === active) || null;
  const file = activeTab && activeTab.kind === 'file' ? files.find((f) => f.path === activeTab.path) || null : null;
  const fileLang = file ? (file.langOverride || langOf(file.path)) : 'txt';
  const tree = useMemo(() => buildTree(files, project?.directories || []), [files,project?.directories]);

  useEffect(() => { if (onActiveKind) onActiveKind(activeTab ? activeTab.kind : null); }, [activeTab && activeTab.kind]);
  useEffect(() => {
    if (activeTab && activeTab.kind === 'term' && !termActive && terms[0]) setTermActive(terms[0].id);
  }, [activeTab && activeTab.kind]);

  const syncArrows = useCallback(() => {
    const el = tabsRef.current; if (!el) return;
    setArrows({ l: el.scrollLeft > 4, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);
  useLayoutEffect(() => {
    syncArrows();
    window.addEventListener('resize', syncArrows);
    return () => window.removeEventListener('resize', syncArrows);
  }, [tabs.length, syncArrows, isWide]);

  const scrollTabs = (dir) => { const el = tabsRef.current; if (el) el.scrollBy({ left: dir * 170, behavior: 'smooth' }); };
  const tabDown = (e) => {
    const el = tabsRef.current; if (!el) return;
    dragRef.current = { x: e.clientX, left: el.scrollLeft, moved: false };
  };
  const tabMove = (e) => {
    const d = dragRef.current, el = tabsRef.current; if (!d || !el) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 6) return;
    d.moved = true;
    el.classList.add('is-grabbing');
    el.scrollLeft = d.left - dx;
  };
  const tabUp = () => {
    const el = tabsRef.current;
    if (el) el.classList.remove('is-grabbing');
    setTimeout(() => { dragRef.current = null; }, 0);
    syncArrows();
  };
  const clickTab = (key) => { if (dragRef.current && dragRef.current.moved) return; setActive(key); };

  /* активная вкладка сама подъезжает в видимую часть полосы */
  useEffect(() => {
    const wrap = tabsRef.current;
    if (!wrap || !active) return;
    const el = Array.from(wrap.querySelectorAll('[data-tabkey]')).find(el => el.dataset.tabkey === active);
    if (!el) return;
    const left = el.offsetLeft;
    const right = left + el.offsetWidth;
    if (left < wrap.scrollLeft + 10) wrap.scrollTo({ left: Math.max(0, left - 18), behavior: 'smooth' });
    else if (right > wrap.scrollLeft + wrap.clientWidth - 10) wrap.scrollTo({ left: right - wrap.clientWidth + 18, behavior: 'smooth' });
    const tm = setTimeout(syncArrows, 320);
    return () => clearTimeout(tm);
  }, [active, tabs.length]);

  const editCode = (val) => {
    if (!file) return;
    updateProject((p) => Object.assign({}, p, {
      updatedAt: Date.now(),
      files: p.files.map((f) => (f.id === file.id ? Object.assign({}, f, { code: val, dirty: true, unsaved: true }) : f)),
    }));
  };
  const save = async () => {
    if (!file) return;
    try{
      const saved=ENGINE_SERVER ? await API.file(project.id,file) : file;
      updateProject(p=>({...p,files:p.files.map(f=>f.id===file.id?{...f,etag:saved.etag,unsaved:f.code!==file.code}:f)}));
    }catch(e){toast(e.message);return;}
    setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1400);
  };
  const addFile = async (path) => {
    if (!path.trim()) return;
    let f = Object.assign({}, mkFile(path.trim(), ''), { fresh: true, unsaved: true });
    if(files.some(x=>x.path===f.path)){toast(lang==='ru'?'Файл уже существует':'File already exists');return;}
    if(ENGINE_SERVER){try{f={...await API.file(project.id,f),fresh:true,unsaved:false};}catch(e){toast(e.message);return;}}
    updateProject((p) => Object.assign({}, p, { files: p.files.concat(f) }));
    setTabs((list) => list.concat({ key: 'f:' + f.path, kind: 'file', path: f.path }));
    setActive('f:' + f.path);
    setPop(null); setNewName('');
  };
  const importFiles = (list) => {
    const arr = Array.from(list).filter((f) => f.size < 512 * 1024).slice(0, 20);
    if (!arr.length) { toast(lang === 'ru' ? 'Нет подходящих файлов' : 'No readable files'); return; }
    Promise.all(arr.map((f) => new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(Object.assign({}, mkFile(f.webkitRelativePath || f.name, String(r.result || '')), { fresh: true }));
      r.onerror = () => res(null);
      r.readAsText(f);
    }))).then(async (list2) => {
      let good = list2.filter(Boolean);
      if(ENGINE_SERVER){const saved=[];try{for(const f of good)saved.push({...await API.file(project.id,f),fresh:true});}
        catch(e){toast(e.message);if(saved.length)updateProject(p=>({...p,files:p.files.concat(saved)}));return;}good=saved;}
      updateProject((p) => Object.assign({}, p, { files: p.files.concat(good) }));
      if (good[0]) openFile(good[0]);
      toast((lang === 'ru' ? 'Импортировано: ' : 'Imported: ') + good.length);
    });
  };

  const hits = useMemo(() => {
    if (!q || !file) return [];
    const out = [];
    file.code.split('\n').forEach((l, i) => { if (l.toLowerCase().indexOf(q.toLowerCase()) >= 0) out.push(i); });
    return out;
  }, [q, file && file.code]);
  const step = (d) => {
    if (!hits.length) return;
    const n = (hitIdx + d + hits.length) % hits.length;
    setHitIdx(n); setJump(hits[n]);
  };

  if (!project) {
    return (
      <Fade className="page-body">
        <div className="proj-empty t-stagger is-shown">
          <span className="t-stagger-line t-stagger-line--1" style={{ color: 'var(--text-tertiary)' }}><Ico n="code" s={34} /></span>
          <b className="t-stagger-line t-stagger-line--2">{t.codeNoProject}</b>
          <span className="t-stagger-line t-stagger-line--3 meta" style={{ maxWidth: '34ch' }}>{t.codeNoProjectB}</span>
          <button className="cta is-sm t-stagger-line t-stagger-line--4" style={{ marginTop: 6 }} onClick={goProjects}>
            <Ico n="grid" s={16} />{t.codeGo}
          </button>
        </div>
      </Fade>
    );
  }

  const TAB_META = {
    term: { icon: 'terminal', label: t.tabTerminal },
    git: { icon: 'git', label: t.tabHistory },
    search: { icon: 'search', label: t.tabSearch },
    prefs: { icon: 'sliders', label: t.tabPrefs },
  };
  const anyFold = Object.keys(folds).some((k) => folds[k]);
  const isMd = !!file && fileLang === 'md';
  const mdPreview = isMd && (mdMode[file.id] || 'view') === 'view';
  const lastFileTab = tabs.filter((x) => x.kind === 'file').slice(-1)[0];
  const searchFile = file || (lastFileTab ? files.find((f) => f.path === lastFileTab.path) : null);

  const treeInner = (
    <>
      <div className="tree-head">
        <span style={{ minWidth: 0 }}>
          <span className="eyebrow" style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{project.name}</span>
          <span className="meta num" style={{ fontSize: 12 }}>{files.length} {plural(files.length, FILES_FORMS, lang)}</span>
        </span>
        <div className="row" style={{ gap: 2 }}>
          <button className="icon-btn is-ghost" style={{ width: 28, height: 28 }} onClick={() => setPop('new')} aria-label={t.newFile}><Ico n="plus" s={16} /></button>
          <button className="icon-btn is-ghost" style={{ width: 28, height: 28 }} onClick={() => importRef.current && importRef.current.click()} aria-label={t.importFile}><Ico n="upload" s={15} /></button>
        </div>
      </div>
      <Fade className="tree-scroll">
        <TreeNode node={tree} depth={0} prefix="" openDirs={openDirs}
          toggle={(k) => setOpenDirs(Object.assign({}, openDirs, { [k]: !openDirs[k] }))}
          active={file ? file.path : null} onPick={openFile} />
      </Fade>
      <div className="tree-foot">
        <button onClick={() => (isWide ? setTreeOn(false) : setDrawer(false))} aria-label={t.hidePanel}>
          <Ico n="panel" s={16} />{t.hidePanel}
        </button>
      </div>
    </>
  );

  return (
    <>
      <div className="work">
        {isWide ? (
          <aside className={'tree-col t-resize' + (treeOn ? '' : ' is-hidden')} aria-hidden={!treeOn}>{treeInner}</aside>
        ) : (
          <>
            <div className={'tree-scrim' + (drawer ? ' is-open' : '')} onClick={() => setDrawer(false)} />
            <aside className={'tree-col is-drawer' + (drawer ? ' is-open' : '')} aria-hidden={!drawer}>{treeInner}</aside>
          </>
        )}

        <div className="editor">
          <div className="ed-topbar">
            <button className="icon-btn is-ghost" style={{ width: 32, height: 32 }} aria-label={t.files}
              onClick={() => (isWide ? setTreeOn(!treeOn) : setDrawer(true))}><Ico n="panel" s={18} /></button>
            <button className={'ed-arrow' + (arrows.l ? ' is-on' : '')} onClick={() => scrollTabs(-1)} aria-label="prev tabs"
              style={{ transform: 'rotate(180deg)' }}><Ico n="chev" s={15} /></button>
            <div className="ed-tabs" ref={tabsRef} onScroll={syncArrows}
              style={{ '--fade-l': arrows.l ? '20px' : '0px', '--fade-r': arrows.r ? '20px' : '0px' }}
              onPointerDown={tabDown} onPointerMove={tabMove} onPointerUp={tabUp} onPointerLeave={tabUp}>
              {tabs.length === 0 && <span className="meta" style={{ padding: '9px 6px', whiteSpace: 'nowrap' }}>{lang === 'ru' ? 'Нет вкладок' : 'No tabs'}</span>}
              {tabs.map((tb) => {
                const isFile = tb.kind === 'file';
                const f = isFile ? files.find((x) => x.path === tb.path) : null;
                if (isFile && !f) return null;
                const meta = isFile ? null : TAB_META[tb.kind];
                return (
                  <div key={tb.key} data-tabkey={tb.key} className={'ed-tab' + (tb.key === active ? ' is-active' : '')} role="button" tabIndex={0}
                    onClick={() => clickTab(tb.key)} onKeyDown={(e) => { if (e.key === 'Enter') setActive(tb.key); }}>
                    <span style={{ color: isFile ? LANG_COLOR[langOf(tb.path)] : 'var(--text-secondary)', display: 'grid', placeItems: 'center' }}>
                      <Ico n={isFile ? 'file' : meta.icon} s={14} />
                    </span>
                    <span className="ed-tab-lbl">{isFile ? tb.path.split('/').pop() : meta.label}</span>
                    {isFile && f.unsaved && <i />}
                    <span className="ed-tab-x" onClick={(e) => { e.stopPropagation(); closeTab(tb.key); }}><Ico n="x" s={12} /></span>
                  </div>
                );
              })}
            </div>
            <button className={'ed-arrow' + (arrows.r ? ' is-on' : '')} onClick={() => scrollTabs(1)} aria-label="next tabs"><Ico n="chev" s={15} /></button>
            <div className="ed-actions">
              <button className="icon-btn is-ghost" onClick={() => (file ? setFindOn(!findOn) : openTool('search'))} aria-label={t.search}><Ico n="search" s={17} /></button>
              <button className="icon-btn is-ghost" onClick={() => setPop('menu')} aria-label={t.extra}><Ico n="dots" s={17} /></button>
            </div>
          </div>

          {findOn && file && (
            <div className="find-bar">
              <Ico n="search" s={17} />
              <input className="field" style={{ height: 34, flex: 1, borderRadius: 10 }} autoFocus value={q}
                placeholder={t.search} onChange={(e) => { setQ(e.target.value); setHitIdx(0); }}
                onKeyDown={(e) => { if (e.key === 'Enter') step(1); }} />
              <span className="num meta" style={{ minWidth: 48, textAlign: 'center' }}>{hits.length ? (hitIdx + 1) + '/' + hits.length : '0'}</span>
              <button className="icon-btn is-ghost" style={{ width: 30, height: 30, transform: 'rotate(180deg)' }} onClick={() => step(-1)} aria-label="prev"><Ico n="chevDown" s={15} /></button>
              <button className="icon-btn is-ghost" style={{ width: 30, height: 30 }} onClick={() => step(1)} aria-label="next"><Ico n="chevDown" s={15} /></button>
              <button className="icon-btn is-ghost" style={{ width: 30, height: 30 }} onClick={() => { setFindOn(false); setQ(''); }} aria-label={t.close}><Ico n="x" s={15} /></button>
            </div>
          )}

          {activeTab && activeTab.kind === 'file' && file && (mdPreview
            ? <MarkdownView code={file.code} font={settings.font} />
            : <CodeEditor file={file} code={file.code} onChange={editCode} settings={settings}
                searchQ={findOn ? q : ''} jumpTo={jump} folds={folds} setFolds={setFolds} />
          )}
          {activeTab && activeTab.kind === 'term' && (ENGINE_SERVER ? <ServerTerminal key={project.id} project={project} onRefresh={onRefresh}/> :
            <TerminalPane t={t} lang={lang} projects={projects} sessions={terms} setSessions={setTerms}
              active={termActive || (terms[0] && terms[0].id)} setActive={setTermActive} />
          )}
          {activeTab && activeTab.kind === 'git' && <HistoryPane t={t} lang={lang} project={project} updateProject={updateProject} toast={toast} />}
          {activeTab && activeTab.kind === 'search' && (
            <SearchPane t={t} lang={lang} project={project} projects={projects} state={search} setState={setSearch}
              activeFile={searchFile}
              onOpenAt={(f, line, query) => openFile(f, line, query)}
              onOpenGlobal={(p, f, line, query) => openInProject(p, f, line, query)} />
          )}
          {activeTab && activeTab.kind === 'prefs' && (
            <PrefsPane t={t} lang={lang} settings={settings} setSettings={setSettings} project={project} onGoSettings={goSettings} />
          )}
          {!activeTab && (
            <div className="ed-scroll" style={{ display: 'grid', placeItems: 'center' }}>
              <button className="cta is-quiet is-sm" onClick={() => (isWide ? setTreeOn(true) : setDrawer(true))}>
                <Ico n="folderOpen" s={16} />{t.files}
              </button>
            </div>
          )}

          {activeTab && activeTab.kind === 'file' && (
            <>
              <div className="ed-extra" style={{ '--ed-bottom': symSet ? '80px' : '32px' }}>
                {isMd && (
                  <div className="ed-view-seg">
                    <button className={mdPreview ? '' : 'is-on'}
                      onClick={() => setMdMode(Object.assign({}, mdMode, { [file.id]: 'code' }))}>
                      <Ico n="code" s={15} />{t.viewCode}
                    </button>
                    <button className={mdPreview ? 'is-on' : ''}
                      onClick={() => setMdMode(Object.assign({}, mdMode, { [file.id]: 'view' }))}>
                      <Ico n="file" s={15} />{t.viewRead}
                    </button>
                  </div>
                )}
                {extraOpen && (
                  <div className="ed-extra-menu t-dropdown is-open" data-origin="bottom-right">
                    {[['brackets', t.symBrackets], ['ops', t.symOps], ['other', t.symOther]].map((sx) => (
                      <button key={sx[0]} onClick={() => { setSymSet(sx[0]); setExtraOpen(false); }}>
                        <Ico n="code" s={16} />{sx[1]}
                      </button>
                    ))}
                    <button onClick={() => { setSymSet(null); setExtraOpen(false); }}><Ico n="x" s={16} />{t.hideRow}</button>
                  </div>
                )}
                <div className="ed-extra-row">
                  <button className={'ed-extra-btn ed-save' + (file && file.unsaved ? ' is-shown' : '')}
                    onClick={save} tabIndex={file && file.unsaved ? 0 : -1} aria-hidden={!(file && file.unsaved)}>
                    <span className="t-icon-swap">
                      <span className={savedFlash ? 'is-off' : 'is-on'}><Ico n="save" s={16} /></span>
                      <span className={savedFlash ? 'is-on' : 'is-off'}><Ico n="check" s={16} /></span>
                    </span>
                    {t.save}
                  </button>
                  <button className="ed-extra-btn" onClick={() => setExtraOpen(!extraOpen)}>
                    <Ico n="dots" s={16} />{t.extra}
                  </button>
                </div>
              </div>

              {symSet && !mdPreview && (
                <div className="ed-bar">
                  {SYM_SETS[symSet].map((sx, i) => (
                    <button key={i} className="ed-key" onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        const ta = document.querySelector('.ed-input');
                        if (!ta) return;
                        const st = ta.selectionStart, en = ta.selectionEnd;
                        const ins = sx === '\t' ? ' '.repeat(settings.tab) : sx;
                        editCode(ta.value.slice(0, st) + ins + ta.value.slice(en));
                        requestAnimationFrame(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = st + ins.length; });
                      }}>{sx === '\t' ? '⇥' : sx}</button>
                  ))}
                  <button className="ed-key" style={{ marginLeft: 'auto' }} onClick={() => setSymSet(null)} aria-label={t.hideRow}><Ico n="x" s={14} /></button>
                </div>
              )}
            </>
          )}

          {activeTab && activeTab.kind === 'file' && file && (
            <div className="ed-status">
              <button onClick={() => setPop('lang')}>{(LANGS[fileLang] || LANGS.txt).label}</button>
              <span>·</span>
              <span className="num">{file.code.split('\n').length}</span><span>{t.linesShort}</span>
              {anyFold && (
                <button onClick={() => setFolds({})} style={{ color: 'var(--state-warning)' }}>
                  {lang === 'ru' ? 'развернуть всё' : 'unfold all'}
                </button>
              )}
              <span className="sp" />
              {file.unsaved && <span style={{ color: 'var(--state-warning)' }}>●</span>}
              <button onClick={() => setSettings(Object.assign({}, settings, { wrap: !settings.wrap }))}
                style={{ color: settings.wrap ? 'var(--text-primary)' : 'var(--text-tertiary)' }} aria-label={t.wrap}>
                <Ico n="wrapTxt" s={15} />
              </button>
              <span className="num">{settings.font}px</span>
            </div>
          )}
        </div>
      </div>

      <input ref={importRef} type="file" multiple hidden onChange={(e) => { importFiles(e.target.files); e.target.value = ''; }} />

      {askNode}
      <Popup open={pop === 'menu'} onClose={() => setPop(null)} title={project.name} sub={project.desc} origin="top-right">
        <div className="set-group">
          {[
            ['plus', t.newFile, '', () => setPop('new')],
            ...(ENGINE_SERVER ? [
              ['folder',lang==='ru'?'Создать папку':'Create folder','',async()=>{
                const path=await ask({title:lang==='ru'?'Создать папку':'Create folder',input:true,
                  placeholder:lang==='ru'?'например src/utils':'for example src/utils',confirm:lang==='ru'?'Создать':'Create'});
                if(!path)return;
                try{await API.request('/projects/'+project.id+'/directories',{method:'POST',body:{path}});setPop(null);await onRefresh();}catch(e){toast(e.message);}
              }],
              ['refresh',lang==='ru'?'Обновить с сервера':'Refresh from server','',async()=>{setPop(null);await onRefresh();}],
              ['pen',lang==='ru'?'Переименовать файл':'Rename file',file?.path||'',async()=>{
                if(!file)return;if(file.unsaved){toast(lang==='ru'?'Сначала сохраните файл':'Save the file first');return;}
                const to=await ask({title:lang==='ru'?'Переименовать файл':'Rename file',input:true,value:file.path,
                  confirm:lang==='ru'?'Переименовать':'Rename'});
                if(!to||to===file.path)return;
                try{const moved=await API.request('/projects/'+project.id+'/rename',{method:'POST',body:{from:file.path,to},headers:{'If-Match':file.etag}});
                  updateProject(p=>({...p,files:p.files.map(f=>f.path===file.path?moved:f)}));closeTab('f:'+file.path);openFile(moved);setPop(null);
                }catch(e){toast(e.message);}
              }],
              ['trash',lang==='ru'?'Удалить файл':'Delete file',file?.path||'',async()=>{
                if(!file)return;
                if(!await ask({title:lang==='ru'?'Удалить файл':'Delete file',body:file.path,
                  confirm:lang==='ru'?'Удалить':'Delete',danger:true}))return;
                try{await API.request('/projects/'+project.id+'/file?path='+encodeURIComponent(file.path),{method:'DELETE',headers:{'If-Match':file.etag}});
                  updateProject(p=>({...p,files:p.files.filter(f=>f.path!==file.path)}));closeTab('f:'+file.path);setPop(null);
                }catch(e){toast(e.message);}
              }]
            ] : []),
            ['upload', t.importFile, lang === 'ru' ? 'из памяти устройства' : 'from device storage', () => { setPop(null); importRef.current && importRef.current.click(); }],
            ['search', t.tabSearch, t.searchAll, () => { setPop(null); openTool('search'); }],
            ['terminal', t.tabTerminal, ENGINE_SERVER ? 'PowerShell 7 · Linux' : 'PowerShell · bash · ssh', () => { setPop(null); openTool('term'); }],
            ['git', t.tabHistory, t.snapshots, () => { setPop(null); openTool('git'); }],
            ['sliders', t.tabPrefs, t.setEditor, () => { setPop(null); openTool('prefs'); }],
            ['copy', lang === 'ru' ? 'Скопировать файл' : 'Copy file', file ? file.path : '', () => {
              if (file) { try { navigator.clipboard.writeText(file.code); toast(lang === 'ru' ? 'Код скопирован' : 'Code copied'); } catch (e) {} }
              setPop(null);
            }],
            ['grid', t.codeGo, '', () => { setPop(null); goProjects(); }],
          ].map((r) => (
            <button className="set-row" key={r[1]} onClick={r[3]}>
              <Ico n={r[0]} s={18} />
              <span className="set-main"><b>{r[1]}</b>{r[2] ? <span className="meta">{r[2]}</span> : null}</span>
              <Ico n="chev" s={15} />
            </button>
          ))}
        </div>
      </Popup>

      <Popup open={pop === 'new'} onClose={() => setPop(null)} title={t.newFile} sub={t.fileHint}
        foot={<button className="cta" style={{ width: '100%' }} disabled={!newName.trim()} onClick={() => addFile(newName)}>{t.projCreate}</button>}>
        <input className="field mono" autoFocus value={newName} placeholder={t.fileHint}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) addFile(newName); }} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {['src/index.ts', 'src/App.tsx', 'main.py', 'styles.css', 'Dockerfile', 'notes.md'].map((sx) => (
            <button key={sx} className="chip is-sm mono" onClick={() => setNewName(sx)}>{sx}</button>
          ))}
        </div>
        {newName.trim() && (
          <p className="meta" style={{ marginBottom: 0 }}>
            {lang === 'ru' ? 'Язык: ' : 'Language: '}
            <b style={{ color: 'var(--text-primary)' }}>{(LANGS[langOf(newName)] || LANGS.txt).label}</b>
          </p>
        )}
      </Popup>

      <Popup open={pop === 'lang'} onClose={() => setPop(null)} title={lang === 'ru' ? 'Язык файла' : 'File language'}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {Object.keys(LANGS).map((k) => (
            <button key={k} className={'chip' + (k === fileLang ? ' is-on' : '')}
              onClick={() => {
                if (file) updateProject((p) => Object.assign({}, p, { files: p.files.map((f) => (f.id === file.id ? Object.assign({}, f, { langOverride: k }) : f)) }));
                setPop(null);
              }}>
              <i style={{ width: 8, height: 8, borderRadius: 4, background: LANG_COLOR[k] || 'var(--text-tertiary)' }} />
              {LANGS[k].label}
            </button>
          ))}
        </div>
      </Popup>
    </>
  );
}

/* =========================================================================
   Баннер приложения: видео идёт вперёд, затем быстро отматывается назад
   ========================================================================= */
function AppBanner({ t, lang, compact }) {
  const ref = useRef(null);
  /* Ролик уже смонтирован как маятник: прямой проход и ускоренный обратный
     склеены в один файл, поэтому браузеру остаётся только зациклить его. */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { el.pause(); return; }
    const play = () => { const pr = el.play(); if (pr && pr.catch) pr.catch(() => {}); };
    if (el.readyState >= 2) play();
    else el.addEventListener('loadeddata', play, { once: true });
    return () => el.removeEventListener('loadeddata', play);
  }, []);

  return (
    <div className={'banner' + (compact ? ' is-compact' : '')}>
      <video ref={ref} className="banner-video" poster={BANNER_POSTER}
        muted playsInline autoPlay loop preload="auto" aria-hidden="true">
        <source src={BANNER_WEBM} type="video/webm" />
        <source src={BANNER_SRC} type="video/mp4" />
      </video>
      <div className="banner-wash" />
      <div className="banner-body">
        <b className="banner-title">{t.appName}</b>
        <p className="banner-sub">{t.bannerSub}</p>
        <a className="banner-link" href={REPO_URL} target="_blank" rel="noopener noreferrer">
          <Ico n="git" s={16} />GitHub · {t.sourceCode}<Ico n="chev" s={14} />
        </a>
      </div>
    </div>
  );
}

/* =========================================================================
   Настройки
   ========================================================================= */
function Bouncy({ items }) {
  const [open, setOpen] = useState(null);
  return (
    <div className="bouncy">
      {items.map((it, i) => {
        const isOpen = open === it.id;
        const cls = ['bouncy-item'];
        if (isOpen) cls.push('is-open');
        else {
          const prevOpen = i > 0 && open === items[i - 1].id;
          const nextOpen = i < items.length - 1 && open === items[i + 1].id;
          if (i === 0 || prevOpen) cls.push('is-start');
          if (i === items.length - 1 || nextOpen) cls.push('is-end');
        }
        return (
          <div key={it.id} className={cls.join(' ')}>
            <button className="bouncy-head" onClick={() => setOpen(isOpen ? null : it.id)} aria-expanded={isOpen}>
              <span style={{ color: 'var(--text-secondary)', display: 'grid', placeItems: 'center' }}><Ico n={it.icon} s={17} /></span>
              <b>{it.q}</b>
              <span className="bouncy-chev"><Ico n="chevDown" s={16} /></span>
            </button>
            <div className="bouncy-panel"><div><p className="bouncy-desc">{it.a}</p></div></div>
          </div>
        );
      })}
    </div>
  );
}

function SettingsScreen({ t, lang, setLang, theme, swapTheme, settings, setSettings, isWide, onLegal, onReset, onWipe, projects,
                         user, refreshing, onSync, onSample, onLogout }) {
  const caps = window.ASTRA_CAPS || {};
  const [pop, setPop] = useState(null);
  const [secChat, setSecChat] = useState(true);
  const [chatKey, setChatKey] = useState('');
  const [chatProxy, setChatProxy] = useState('');
  const [chatInfo, setChatInfo] = useState(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatNote, setChatNote] = useState('');
  useEffect(() => {
    if (!caps.chat) return;
    API.request('/chat/config').then((cfg) => { setChatInfo(cfg); setChatProxy(cfg.proxy || ''); })
      .catch((e) => setChatNote(e.message));
  }, [caps.chat]);
  const saveChatKey = async () => {
    setChatBusy(true); setChatNote('');
    try {
      // Поля, которых нет в запросе, движок оставляет как были: пустое поле
      // ключа значит «не трогать», а не «стереть сохранённый».
      const body = { proxy: chatProxy.trim() };
      if (chatKey.trim()) body.key = chatKey.trim();
      setChatInfo(await API.request('/chat/config', { method: 'PUT', body }));
      setChatKey('');
      setChatNote(lang === 'ru' ? 'Сохранено' : 'Saved');
    } catch (e) { setChatNote(e.message); } finally { setChatBusy(false); }
  };
  const [ack, setAck] = useState(false);
  const [wiped, setWiped] = useState(false);
  const [secP, setSecP] = useState(true);
  const [secA, setSecA] = useState(true);
  const [secB, setSecB] = useState(true);
  const [secC, setSecC] = useState(true);
  const [secD, setSecD] = useState(true);
  const totals = projects.reduce((a, p) => {
    const st = projectStats(p.files);
    return { files: a.files + st.count, lines: a.lines + st.lines, bytes: a.bytes + p.files.reduce((s, f) => s + f.code.length, 0) };
  }, { files: 0, lines: 0, bytes: 0 });

  return (
    <>
      <Fade className="page-body" style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 'calc(var(--safe-top) + 10px)' }}>
        <AppBanner t={t} lang={lang} />
        <div style={{ height: 6 }} />

        <Rule label={t.setProfile} open={secP} onToggle={() => setSecP(!secP)} />
        <Fold open={secP}>
          <div className="set-group" style={{ paddingBottom: 12 }}>
            {ENGINE_SERVER ? <>
              <div className="set-account">
                <span className="set-avatar">{((user && (user.name || user.email)) || '?').trim().charAt(0).toUpperCase()}</span>
                <span className="set-main"><b>{(user && user.name) || t.setNoName}</b><span className="meta">{(user && user.email) || ''}</span></span>
              </div>
              <button className="set-row" disabled={refreshing} onClick={onSync}>
                <Ico n="refresh" s={18} /><span className="set-main"><b>{refreshing ? t.setSyncing : t.setSync}</b><span className="meta">{t.setSyncB}</span></span><Ico n="chev" s={15} />
              </button>
              <button className="set-row" onClick={onSample}>
                <Ico n="cube" s={18} /><span className="set-main"><b>{t.setSample}</b><span className="meta">{t.setSampleB}</span></span><Ico n="chev" s={15} />
              </button>
              <button className="set-row" onClick={onLogout} style={{ color: 'var(--state-danger)' }}>
                <Ico n="back" s={18} /><span className="set-main"><b>{t.setSignOut}</b><span className="meta">{t.setSignOutB}</span></span><Ico n="chev" s={15} />
              </button>
            </> : <>
              <div className="set-account">
                <span className="set-avatar"><Ico n="cube" s={19} /></span>
                <span className="set-main"><b>{t.setDemo}</b><span className="meta">{t.setDemoB}</span></span>
              </div>
              <a className="set-row" href="/">
                <Ico n="back" s={18} /><span className="set-main"><b>{t.setToServer}</b><span className="meta">{t.setToServerB}</span></span><Ico n="chev" s={15} />
              </a>
            </>}
          </div>
        </Fold>

        <Rule label={t.setAppear} open={secA} onToggle={() => setSecA(!secA)} />
        <Fold open={secA}>
          <div className="set-group" style={{ paddingBottom: 12 }}>
            <div className="set-row">
              <span className="t-icon-swap" style={{ color: 'var(--text-secondary)' }}>
                <span className={theme === 'dark' ? 'is-on' : 'is-off'}><Ico n="moon" s={18} /></span>
                <span className={theme === 'dark' ? 'is-off' : 'is-on'}><Ico n="sun" s={18} /></span>
              </span>
              <span className="set-main"><b>{t.setTheme}</b><span className="meta">{t.setThemeB}</span></span>
              <button className={'toggle' + (theme === 'dark' ? ' is-on' : '')} role="switch" aria-checked={theme === 'dark'}
                aria-label={t.setTheme} onClick={(e) => swapTheme(e)}><i /></button>
            </div>
            <div className="set-row">
              <Ico n="lang" s={18} />
              <span className="set-main"><b>{t.setLang}</b></span>
              <div className="seg">
                <button className={lang === 'ru' ? 'is-on' : ''} onClick={() => setLang('ru')}>Рус</button>
                <button className={lang === 'en' ? 'is-on' : ''} onClick={() => setLang('en')}>Eng</button>
              </div>
            </div>
          </div>
        </Fold>

        {caps.chat && <>
          <Rule label={t.setChat} open={secChat} onToggle={() => setSecChat(!secChat)} />
          <Fold open={secChat}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 12 }}>
              <div className="set-group">
                <div className="set-row">
                  <Ico n="shield" s={18} />
                  <span className="set-main"><b>{t.setChatKey}</b>
                    <span className="meta">{chatInfo && chatInfo.hasKey ? chatInfo.keyHint : t.setChatNoKey}</span></span>
                </div>
              </div>
              <input className="field mono" type="password" value={chatKey} placeholder="xpl_…"
                autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                onChange={(e) => setChatKey(e.target.value)} />
              {/* Прокси: на телефоне системная настройка приложению не
                  наследуется, и в такой сети чат иначе просто не достучится. */}
              <div className="set-group">
                <div className="set-row">
                  <Ico n="git" s={18} />
                  <span className="set-main"><b>{lang === 'ru' ? 'Прокси' : 'Proxy'}</b>
                    <span className="meta">{lang === 'ru'
                      ? 'Нужен, если интернет идёт через посредника. С VPN поле оставьте пустым.'
                      : 'Only needed when the internet goes through a proxy. Leave empty on a VPN.'}</span></span>
                </div>
              </div>
              <input className="field mono" value={chatProxy} placeholder="http://127.0.0.1:8080"
                autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                onChange={(e) => setChatProxy(e.target.value)} />
              <div className="row" style={{ gap: 8 }}>
                <button className="cta is-sm" disabled={chatBusy} onClick={saveChatKey}>{t.setChatSave}</button>
                {chatNote && <span className="meta" style={{ minWidth: 0 }}>{chatNote}</span>}
              </div>
              <p className="meta" style={{ margin: '0 2px' }}>{t.setChatB}</p>
            </div>
          </Fold>
        </>}

        <Rule label={t.setEditor} open={secB} onToggle={() => setSecB(!secB)} />
        <Fold open={secB}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 12 }}>
            <div className="set-group">
              <div className="set-row">
                <Ico n="code" s={18} />
                <span className="set-main"><b>{t.setFont}</b></span>
                <div className="stepper">
                  <button onClick={() => setSettings(Object.assign({}, settings, { font: Math.max(12, settings.font - 1) }))} aria-label="-"><Ico n="minus" s={13} /></button>
                  <span className="num">{settings.font}px</span>
                  <button onClick={() => setSettings(Object.assign({}, settings, { font: Math.min(22, settings.font + 1) }))} aria-label="+"><Ico n="plus" s={13} /></button>
                </div>
              </div>
              <div className="set-row">
                <Ico n="wrapTxt" s={18} />
                <span className="set-main"><b>{t.setTab}</b></span>
                <div className="seg">{[2, 4, 8].map((n) => (
                  <button key={n} className={settings.tab === n ? 'is-on' : ''} onClick={() => setSettings(Object.assign({}, settings, { tab: n }))}>{n}</button>
                ))}</div>
              </div>
              <div className="set-row">
                <Ico n="file" s={18} />
                <span className="set-main"><b>{t.wrap}</b><span className="meta">{t.setWrapB}</span></span>
                <Toggle on={settings.wrap} onChange={(v) => setSettings(Object.assign({}, settings, { wrap: v }))} label={t.wrap} />
              </div>
              <div className="set-row">
                <Ico n="sliders" s={18} />
                <span className="set-main"><b>{t.setNums}</b><span className="meta">{t.foldHint}</span></span>
                <Toggle on={settings.nums} onChange={(v) => setSettings(Object.assign({}, settings, { nums: v }))} label={t.setNums} />
              </div>
            </div>
            <div style={{ borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
              <div style={{ background: 'var(--code-bg)', padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: settings.font, lineHeight: 1.55 }}>
                <Highlight lang="ts" code={'export const MOTION = {\n  panelOpen: () => durationOf("--panel-open-dur", 400),\n  fast: () => 250, // предпросмотр\n};'} />
              </div>
            </div>
          </div>
        </Fold>

        <Rule label={t.setFaq} open={secC} onToggle={() => setSecC(!secC)} />
        <Fold open={secC}>
          <div style={{ paddingBottom: 12 }}>
            <Bouncy items={[
              { id: 'q1', q: t.q1, a: t.a1, icon: 'shield' },
              { id: 'q2', q: t.q2, a: t.a2, icon: 'code' },
              { id: 'q3', q: t.q3, a: t.a3, icon: 'panel' },
              { id: 'q4', q: t.q4, a: t.a4, icon: 'terminal' },
            ]} />
          </div>
        </Fold>

        <Rule label={t.setData} open={secD} onToggle={() => setSecD(!secD)} />
        <Fold open={secD}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 12 }}>
            <div className="set-group">
              <button className="set-row" onClick={onLegal}>
                <Ico n="shield" s={18} /><span className="set-main"><b>{t.legalTitle}</b><span className="meta">{lang === 'ru' ? 'что и где хранится' : 'what is stored and where'}</span></span><Ico n="chev" s={15} />
              </button>
              <button className="set-row" onClick={() => setPop('about')}>
                <Ico n="info" s={18} /><span className="set-main"><b>{t.setAbout}</b><span className="meta">{t.aboutV}</span></span><Ico n="chev" s={15} />
              </button>
              <button className="set-row" onClick={onReset}>
                <Ico n="refresh" s={18} /><span className="set-main"><b>{t.setReset}</b></span><Ico n="chev" s={15} />
              </button>
              <button className="set-row" onClick={() => { setPop('wipe'); setAck(false); setWiped(false); }} style={{ color: 'var(--state-danger)' }}>
                <Ico n="trash" s={18} /><span className="set-main"><b>{t.setWipe}</b><span className="meta">{t.setWipeB}</span></span><Ico n="chev" s={15} />
              </button>
            </div>
            <p className="meta" style={{ margin: '0 2px' }}>
              <span className="num">{projects.length}</span> {t.projSub} · <span className="num">{totals.files}</span> {plural(totals.files, FILES_FORMS, lang)} ·{' '}
              <span className="num">{totals.lines}</span> {t.linesShort} · <span className="num">{Math.round(totals.bytes / 1024)}</span> КБ
            </p>
          </div>
        </Fold>
      </Fade>

      <Popup open={pop === 'about'} onClose={() => setPop(null)} title={t.setAbout} sub={t.aboutV}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
          <span style={{ width: 46, height: 46, borderRadius: 14, display: 'grid', placeItems: 'center', background: 'var(--accent-primary)', color: 'var(--accent-ink)' }}>
            <Ico n="code" s={24} />
          </span>
          <span><b style={{ display: 'block', fontSize: 16 }}>{t.appName}</b><span className="meta">{t.appSub}</span></span>
        </div>
        <p className="meta" style={{ lineHeight: 1.5 }}>{t.aboutB}</p>
        <div className="set-group" style={{ marginTop: 8 }}>
          {[['GitHub · ' + t.openSource, REPO_SHORT],
            ['Inter · JetBrains Mono', lang === 'ru' ? 'шрифты интерфейса и кода' : 'interface and code type'],
            [Object.keys(LANGS).length + (lang === 'ru' ? ' языков' : ' languages'), lang === 'ru' ? 'подсветка по расширению файла' : 'highlighting by file extension'],
            ['100%', lang === 'ru' ? 'обработки на устройстве' : 'processed on device']].map((r) => (
            <div className="set-row" key={r[0]}><span className="set-main"><b>{r[0]}</b><span className="meta">{r[1]}</span></span></div>
          ))}
        </div>
      </Popup>

      <Popup open={pop === 'wipe'} onClose={() => setPop(null)} title={t.setWipe}
        foot={!wiped ? (
          <button className="cta is-danger" style={{ width: '100%' }} disabled={!ack} onClick={async () => { if(await onWipe())setWiped(true); }}>{t.wipeGo}</button>
        ) : null}>
        {wiped ? (
          <div className="row" style={{ gap: 12, padding: '8px 0 16px' }}><SuccessCheck size={44} /><b>{t.wipeDone}</b></div>
        ) : (
          <>
            <p className="meta" style={{ marginTop: 0 }}>{t.setWipeB}.</p>
            <div className="wl-agree" style={{ background: 'var(--bg-elevated)' }}>
              <CheckBox on={ack} onChange={setAck} danger label={t.wipeAck} />
              <p>{t.wipeAck}</p>
            </div>
          </>
        )}
      </Popup>
    </>
  );
}

/* =========================================================================
   Политика
   ========================================================================= */
function LegalPopup({ open, onClose, t, lang }) {
  const ru = [
    ['Что хранится', 'Проекты, файлы и настройки редактора лежат в памяти устройства, в песочнице приложения. Импортированная папка копируется туда же — оригинал остаётся на месте.'],
    ['Что не уходит наружу', 'Содержимое файлов, имена проектов и точки восстановления не отправляются на серверы и не передаются третьим лицам.'],
    ['Соединения', 'Терминал подключается только к тем адресам, которые вы вводите сами. Ключи и пароли хранятся локально и не синхронизируются.'],
    ['Разрешения', 'Доступ к файлам запрашивается в момент импорта и только к выбранной вами папке. Отозвать его можно в системных настройках.'],
    ['Удаление', 'Кнопка «Стереть все проекты» удаляет данные приложения с устройства без возможности восстановления.'],
  ];
  const en = [
    ['What is stored', 'Projects, files and editor settings live in device storage, inside the app sandbox. An imported folder is copied there — the original stays where it is.'],
    ['What never leaves', 'File contents, project names and restore points are never uploaded and never shared with third parties.'],
    ['Connections', 'The terminal only connects to addresses you type yourself. Keys and passwords stay local and are never synced.'],
    ['Permissions', 'File access is requested at import time and only for the folder you pick. You can revoke it in system settings.'],
    ['Deletion', 'The "Erase all projects" button removes app data from the device permanently.'],
  ];
  const rows = ENGINE_SERVER ? (lang==='ru' ? [
    ['Хранение','Файлы, имена проектов и снимки хранятся на сервере IDE Code. Импорт загружает копию выбранных файлов на сервер.'],
    ['Доступ','Аккаунт и роль в проекте определяют доступ к файлам и терминалу. Владелец сервера управляет инфраструктурой и резервными копиями.'],
    ['Терминал','Команды выполняются в серверном контейнере PowerShell. Рабочая папка доступна участникам этого проекта; сеть контейнера отключена.'],
    ['Браузер','Настройки интерфейса остаются локально. Сессия входа хранится в HttpOnly cookie. Несохранённые правки находятся в памяти вкладки.'],
    ['Удаление','Удаление проекта удаляет его файлы, снимки и записи доступа на сервере. Резервные копии регулируются владельцем сервера.']
  ] : [
    ['Storage','Files, project names and snapshots are stored on the IDE Code server. Import uploads a copy of selected files.'],
    ['Access','Your account and project role control access. The server operator manages infrastructure and backups.'],
    ['Terminal','PowerShell runs in a server container with this project mounted and networking disabled.'],
    ['Browser','UI preferences stay local. Authentication uses an HttpOnly cookie; unsaved drafts stay in tab memory.'],
    ['Deletion','Deleting a project removes server files, snapshots and access records. Backup retention is controlled by the server operator.']
  ]) : (lang === 'ru' ? ru : en);
  return (
    <Popup open={open} onClose={onClose} title={t.legalTitle}
      sub={ENGINE_SERVER ? (lang==='ru'?'Серверный режим IDE Code':'IDE Code server mode') : (lang === 'ru' ? 'Демо: данные в памяти вкладки' : 'Demo: data in tab memory')}>
      {rows.map((r, i) => (
        <div key={r[0]} style={{ padding: '10px 0', borderTop: i ? '1px solid var(--stroke)' : 'none' }}>
          <b style={{ fontSize: 14.5 }}>{r[0]}</b>
          <p className="meta" style={{ margin: '3px 0 0', lineHeight: 1.5 }}>{r[1]}</p>
        </div>
      ))}
      <p className="meta" style={{ marginTop: 12, color: 'var(--text-tertiary)' }}>
        {ENGINE_SERVER ? (lang==='ru'?'Описание фактического хранения в этой сборке.':'Storage behavior in this build.') : (lang==='ru'?'Демонстрационный режим.':'Demonstration mode.')}
      </p>
    </Popup>
  );
}

/* =========================================================================
   Приложение
   ========================================================================= */
// Репозиторий проекта: адрес живёт в одном месте, потому что стоит и на баннере,
// и в карточке «О программе».
const REPO_URL = 'https://github.com/SergeyLubivui-dev/ide-code-mobile';
const REPO_SHORT = REPO_URL.replace('https://', '');

const LS = {
  get(k, d) { try { const v = localStorage.getItem('idecode.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('idecode.' + k, JSON.stringify(v)); } catch (e) {} },
};

function App({initialProjects=SEED_PROJECTS,user,entering,onLogout}) {
  const [ask, askNode] = useAsk();
  const isWide = useMedia('(min-width: 768px)');
  const [lang, setLang] = useState(() => LS.get('lang', 'ru'));
  const t = STR[lang] || STR.ru;
  const [theme, setTheme] = useState(() => LS.get('theme', 'dark'));
  const [settings, setSettings] = useState(() => Object.assign({ font: 14, tab: 2, wrap: false, nums: true }, LS.get('settings', {})));
  const [projects, setProjects] = useState(initialProjects);
  const [serverError,setServerError] = useState('');
  const [refreshing,setRefreshing] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [recent, setRecent] = useState(initialProjects.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5).map((p) => p.id));
  const [tab, setTab] = useState('projects');
  const [welcome, setWelcome] = useState(() => !LS.get('seen', false));
  const [legal, setLegal] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);
  const [railNarrow, setRailNarrow] = useState(false);
  const [toolSignal, setToolSignal] = useState({ kind: null, n: 0 });
  const [pendingOpen, setPendingOpen] = useState({ n: 0 });
  const [codeKind, setCodeKind] = useState(null);
  const navRefs = useRef([]);
  const [pill, setPill] = useState({ x: 0, w: 0, first: true });

  // Терминал и чат живут сами по себе, если движок это умеет: в них можно
  // попасть, не открывая проект.
  const caps = window.ASTRA_CAPS || {};
  const RAIL_TABS = [
    { id: 'projects', label: t.tabProjects, icon: 'grid' },
    { id: 'code', label: t.tabCode, icon: 'code' },
    ...(caps.rootTerminal ? [{ id: 'term', label: t.tabTerminal, icon: 'terminal' }] : []),
    ...(caps.chat ? [{ id: 'chat', label: t.tabChat, icon: 'cube' }] : []),
    { id: 'settings', label: t.tabSettings, icon: 'sliders' },
  ];
  const TOOLS = [
    ...(caps.rootTerminal ? [] : [{ kind: 'term', label: t.tabTerminal, icon: 'terminal' }]),
    { kind: 'git', label: t.tabHistory, icon: 'git' },
    { kind: 'search', label: t.tabSearch, icon: 'search' },
    { kind: 'prefs', label: t.tabPrefs, icon: 'sliders' },
  ];
  // Когда терминал самостоятельный, в нижней навигации это обычная вкладка,
  // а не инструмент внутри проекта.
  const NAV = [
    { id: 'projects', label: t.tabProjects, icon: 'grid' },
    { id: 'code', label: t.tabCode, icon: 'code' },
    caps.rootTerminal
      ? { id: 'term', label: t.tabTerminal, icon: 'terminal' }
      : { id: 'terminal', label: t.tabTerminal, icon: 'terminal' },
    ...(caps.chat ? [{ id: 'chat', label: t.tabChat, icon: 'cube' }] : []),
    { id: 'settings', label: t.tabSettings, icon: 'sliders' },
  ];
  const navSel = tab === 'code' ? (codeKind === 'term' && !caps.rootTerminal ? 'terminal' : 'code') : tab;
  const navIdx = NAV.findIndex((x) => x.id === navSel);
  const railIdx = RAIL_TABS.findIndex((x) => x.id === tab);

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); LS.set('theme', theme); }, [theme]);
  useEffect(() => { LS.set('lang', lang); }, [lang]);
  useEffect(() => { LS.set('settings', settings); }, [settings]);

  const measure = useCallback(() => {
    const el = navRefs.current[navIdx];
    if (!el) return;
    setPill((p) => ({ x: el.offsetLeft, w: el.offsetWidth, first: p.first }));
  }, [navIdx]);
  useLayoutEffect(() => {
    measure();
    const t0 = setTimeout(measure, 90);
    const t2 = setTimeout(measure, 330);
    const t1 = setTimeout(() => setPill((p) => Object.assign({}, p, { first: false })), 60);
    window.addEventListener('resize', measure);
    return () => { clearTimeout(t0); clearTimeout(t1); clearTimeout(t2); window.removeEventListener('resize', measure); };
  }, [measure, isWide]);

  const toast = (m) => { setToastMsg(m); clearTimeout(toast._t); toast._t = setTimeout(() => setToastMsg(null), 2100); };

  const swapTheme = (e) => {
    const next = theme === 'dark' ? 'light' : 'dark';
    const root = document.documentElement;
    root.style.setProperty('--vt-x', (e && e.clientX ? e.clientX : window.innerWidth / 2) + 'px');
    root.style.setProperty('--vt-y', (e && e.clientY ? e.clientY : window.innerHeight / 2) + 'px');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || reduce) { setTheme(next); return; }
    document.startViewTransition(() => { ReactDOM.flushSync(() => setTheme(next)); });
  };

  const project = projects.find((p) => p.id === activeId) || null;
  const updateProject = (fn) => setProjects((list) => list.map((p) => (p.id === activeId ? fn(p) : p)));
  const refreshProject = async () => {
    if(!ENGINE_SERVER)return;setRefreshing(true);
    try{const fresh=await API.projects();setProjects(list=>fresh.map(p=>mergeServerProject(p,list.find(x=>x.id===p.id))));setServerError('');}
    catch(e){setServerError(e.message);}finally{setRefreshing(false);}
  };
  useEffect(()=>{
    const refresh=()=>refreshProject(),error=e=>setServerError(e.detail);
    const before=e=>{if(projects.some(p=>p.files.some(f=>f.unsaved))){e.preventDefault();e.returnValue='';}};
    window.addEventListener('astra:refresh',refresh);window.addEventListener('astra:error',error);window.addEventListener('beforeunload',before);
    return()=>{window.removeEventListener('astra:refresh',refresh);window.removeEventListener('astra:error',error);window.removeEventListener('beforeunload',before);};
  },[projects]);
  const markRecent = (id) => setRecent((r) => [id].concat(r.filter((x) => x !== id)).slice(0, 5));
  const openProject = (p) => { setActiveId(p.id); setTab('code'); markRecent(p.id); };
  const openTool = (kind) => {
    if (!project) { setTab('projects'); return; }
    setTab('code');
    setToolSignal((s) => ({ kind: kind, n: s.n + 1 }));
  };
  const openInProject = (p, file, line, q) => {
    setActiveId(p.id); markRecent(p.id);
    setPendingOpen((s) => ({ path: file.path, line: line, q: q, n: s.n + 1 }));
  };

  const addSample = async () => {
    try{const p=await API.create({...SEED_PROJECTS[0],name:'Пример · Astra Bot'});setProjects(list=>[p].concat(list));toast(t.setSampleDone);}
    catch(e){setServerError(e.message);}
  };
  const signOut = async () => {
    if(projects.some(p=>p.files.some(f=>f.unsaved))){
      const ok=await ask({title:lang==='ru'?'Есть несохранённые правки':'Unsaved changes',
        body:lang==='ru'?'Они пропадут, если выйти сейчас.':'They will be lost if you sign out now.',
        confirm:t.setSignOut,danger:true});
      if(!ok)return;
    }
    onLogout();
  };

  return (
    <div className={'app' + (entering ? ' is-entering' : '')}>
      {serverError && (
        <div className="engine-alert" role="alert">
          <span>{serverError}</span>
          <button className="chip is-sm" onClick={()=>setServerError('')} aria-label={t.close}>×</button>
        </div>
      )}
      <div className="shell">
        {isWide && (
          <nav className={'rail t-resize' + (railNarrow ? ' is-narrow' : '')} aria-label={t.appName}>
            <div className="rail-top">
              <span className="rail-mark"><Ico n="code" s={17} /></span>
              <span className="rail-title"><b>{t.appName}</b><span>{t.appSub}</span></span>
            </div>
            <div className="rail-menu">
              <span className={'rail-pill' + (pill.first ? ' no-anim' : '')} style={{ transform: 'translateY(' + railIdx * 48 + 'px)' }} />
              {RAIL_TABS.map((x) => (
                <button key={x.id} className={'rail-item' + (x.id === tab ? ' is-active' : '')} onClick={() => setTab(x.id)} title={x.label}>
                  <span><Ico n={x.icon} s={19} /></span><span className="rail-label">{x.label}</span>
                </button>
              ))}
            </div>
            {/* Инструменты работают внутри проекта, поэтому и появляются вместе с ним. */}
            {project && (
              <div className="rail-tools">
                <div className="rail-sec">
                  <span className="rail-sec-txt eyebrow" style={{ fontSize: 10.5 }}>{t.tools}</span>
                  <span className="rail-sec-line" />
                </div>
                <div className="rail-menu">
                  {TOOLS.map((x) => (
                    <button key={x.kind} className={'rail-item' + (tab === 'code' && codeKind === x.kind ? ' is-active' : '')}
                      onClick={() => openTool(x.kind)} title={x.label}>
                      <span><Ico n={x.icon} s={18} /></span><span className="rail-label">{x.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="rail-spacer" />
            <button className="rail-foot" onClick={() => setRailNarrow(!railNarrow)} title={railNarrow ? t.expand : t.collapse}>
              <span style={{ transform: railNarrow ? 'rotate(180deg)' : 'none' }}><Ico n="panel" s={18} /></span>
              <span className="rail-foot-txt">{t.collapse}</span>
            </button>
          </nav>
        )}

        <div className="panes">
          {RAIL_TABS.map((x, i) => (
            <section key={x.id} className={'tab-pane' + (x.id === tab ? ' is-active' : '')}
              data-side={i < railIdx ? 'left' : 'right'} aria-hidden={x.id !== tab}>
              {x.id === 'projects' && (
                <ProjectsScreen t={t} lang={lang} projects={projects} setProjects={setProjects}
                  onOpen={openProject} toast={toast} isWide={isWide} recentIds={recent} />
              )}
              {x.id === 'code' && (
                <CodeScreen t={t} lang={lang} project={project} projects={projects} updateProject={updateProject} onRefresh={refreshProject} isWide={isWide}
                  toast={toast} goProjects={() => setTab('projects')} goSettings={() => setTab('settings')}
                  settings={settings} setSettings={setSettings} toolSignal={toolSignal}
                  onActiveKind={setCodeKind} openInProject={openInProject} pendingOpen={pendingOpen} />
              )}
              {x.id === 'term' && (
                // Самостоятельный терминал не смотрит на открытый проект: он
                // стартует в корне и заходит внутрь через cd.
                <ServerTerminal project={caps.rootTerminal ? null : project}
                  visible={tab === 'term'} onRefresh={refreshProject} />
              )}
              {x.id === 'chat' && (
                <ChatPane t={t} lang={lang} projects={projects} toast={toast} onRefresh={refreshProject}
                  onCreated={async (created) => {
                    setProjects(list => [created].concat(list.filter(p => p.id !== created.id)));
                    setActiveId(created.id); markRecent(created.id);
                  }} />
              )}
              {x.id === 'settings' && (
                <SettingsScreen t={t} lang={lang} setLang={setLang} theme={theme} swapTheme={swapTheme}
                  settings={settings} setSettings={setSettings} isWide={isWide} projects={projects}
                  user={user} refreshing={refreshing} onSync={refreshProject} onSample={addSample} onLogout={signOut}
                  onLegal={() => setLegal(true)}
                  onReset={() => { LS.set('seen', false); setWelcome(true); }}
                  onWipe={async () => {
                    try{if(ENGINE_SERVER){for(const p of projects.filter(p=>p.role==='owner')){await API.remove(p.id);setProjects(list=>list.filter(x=>x.id!==p.id));}}
                      else setProjects([]);setActiveId(null);setRecent([]);
                      // Стирать данные и оставаться внутри бессмысленно: возвращаем на вход.
                      if(ENGINE_SERVER)setTimeout(onLogout,1400);
                      return true;
                    }catch(e){setServerError(e.message);return false;}
                  }} />
              )}
            </section>
          ))}
        </div>
      </div>

      {!isWide && (
        <nav className="bottom-nav" aria-label={t.appName}>
          <span className={'nav-pill' + (pill.first ? ' no-anim' : '')} style={{ transform: 'translateX(' + pill.x + 'px)', width: pill.w }} />
          {NAV.map((x, i) => (
            <button key={x.id} ref={(el) => { navRefs.current[i] = el; }} aria-label={x.label}
              className={'nav-item' + (x.id === navSel ? ' is-active' : '')}
              onClick={() => {
                if (x.id === 'terminal') openTool('term');
                else if (x.id === 'code') { setTab('code'); setToolSignal((s) => ({ kind: 'file', n: s.n + 1 })); }
                else setTab(x.id);
              }}>
              <span className="nav-ico"><Ico n={x.icon} s={21} /></span>
              <span className="nav-label">{x.label}</span>
            </button>
          ))}
        </nav>
      )}

      {askNode}
      <div className={'toast' + (toastMsg ? ' is-on' : '')} role="status">
        <Ico n="check" s={15} />{toastMsg}
      </div>

      <LegalPopup open={legal} onClose={() => setLegal(false)} t={t} lang={lang} />

      {welcome && (
        <Welcome t={t} onLegal={() => setLegal(true)} onDone={() => { setWelcome(false); LS.set('seen', true); }} />
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<BackendGate />);
