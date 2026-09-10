/* =========================================================================
   Проекты
   ========================================================================= */
const initials = (name) => (name.replace(/[^\wа-яА-Я ]/g, ' ').trim().slice(0, 1) || '?').toUpperCase();
const TINTS = ['#8fb0ff', '#5fc6da', '#82c7a2', '#e3b473', '#d3a2f2', '#ff9b8a', '#a2a6f2', '#5aa9f0'];

/* выпадающий список на моторике dropdown */
function Dropdown({ trigger, items, value, onPick, align }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState('closed');
  const [mounted, setMounted] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (open) { setMounted(true); const r = requestAnimationFrame(() => setState('open')); return () => cancelAnimationFrame(r); }
    if (!mounted) return;
    setState('closing');
    const tm = setTimeout(() => { setMounted(false); setState('closed'); }, MOTION.dropdownClose());
    return () => clearTimeout(tm);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', fn);
    return () => document.removeEventListener('pointerdown', fn);
  }, [open]);
  return (
    <div className="dd" ref={ref}>
      {trigger(() => setOpen(!open), open)}
      {mounted && (
        <div className={'dd-menu t-dropdown ' + (state === 'open' ? 'is-open' : state === 'closing' ? 'is-closing' : '')}
          data-origin={align || 'top-right'} role="menu">
          {items.map((it) => (
            it.sep ? <div className="dd-sep" key={it.key} /> : (
              <button className={'dd-item' + (it.key === value ? ' is-on' : '')} key={it.key} role="menuitem"
                onClick={() => { onPick(it.key); setOpen(false); }}>
                {it.dot ? <i style={{ width: 8, height: 8, borderRadius: 4, background: it.dot }} /> : (it.icon ? <Ico n={it.icon} s={16} /> : null)}
                <span>{it.label}</span>
                {it.count != null ? <span className="num">{it.count}</span> : null}
              </button>
            )
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectRow({ p, t, lang, onOpen, onRename, onDelete }) {
  const [dx, setDx] = useState(0);
  const [drag, setDrag] = useState(false);
  const [gone, setGone] = useState(false);
  const start = useRef(null);
  const OPEN = -2 * pxOf('--proj-action-w', 96); // ровно две .proj-action
  const st = projectStats(p.files);

  const down = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
    start.current = { x: e.clientX, y: e.clientY, base: dx, moved: false, lock: null };
  };
  const move = (e) => {
    const s = start.current; if (!s) return;
    const ddx = e.clientX - s.x, ddy = e.clientY - s.y;
    if (!s.lock) {
      if (Math.abs(ddx) > 8 && Math.abs(ddx) > Math.abs(ddy)) { s.lock = 'x'; setDrag(true); }
      else if (Math.abs(ddy) > 10) { s.lock = 'y'; }
      else return;
    }
    if (s.lock !== 'x') return;
    s.moved = true;
    let next = s.base + ddx;
    if (next > 0) next = next * 0.25;
    if (next < OPEN) next = OPEN + (next - OPEN) * 0.25;
    setDx(next);
  };
  const up = () => {
    const s = start.current; start.current = null; setDrag(false);
    if (!s || !s.moved) return;
    setDx(dx < OPEN / 2 ? OPEN : 0);
  };
  const tap = () => { if (dx !== 0) { setDx(0); return; } onOpen(p); };

  return (
    <div className={'proj-wrap' + (dx < -4 ? ' is-open' : '')}>
      <div className="proj-actions" aria-hidden={dx === 0}>
        <button className="proj-action" onClick={() => { setDx(0); onRename(p); }} tabIndex={dx === 0 ? -1 : 0}>
          <Ico n="pen" s={19} />{t.projRename}
        </button>
        <button className="proj-action is-danger" onClick={() => onDelete(p)} tabIndex={dx === 0 ? -1 : 0}>
          <Ico n="trash" s={19} />{t.projDelete}
        </button>
      </div>
      <button className={'proj-card' + (drag ? ' is-dragging' : '') + (gone ? ' is-removing' : '')}
        style={{ transform: 'translateX(' + dx + 'px)' }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onClick={tap}>
        <span className="proj-main">
          <span className="proj-title">
            <span className="proj-mark" style={{ background: p.tint + '22', color: p.tint }}>{initials(p.name)}</span>
            <b>{p.name}</b>
            {p.demo && <span className="badge mute">{t.demo}</span>}
          </span>
          <span className="proj-desc">{p.desc}</span>
          <span className="proj-stats">
            <span className="fmt"><Ico n="file" s={12} /><span className="num">{st.count}</span></span>
            {st.formats.slice(0, 2).map((f) => (
              <span className="fmt" key={f.lang}>
                <i style={{ background: LANG_COLOR[f.lang] || 'var(--text-tertiary)' }} />
                {(LANGS[f.lang] || LANGS.txt).label} <span className="num">{f.n}</span>
              </span>
            ))}
            <span className="fmt"><span className="num">{st.lines}</span> {t.linesShort}</span>
          </span>
          <span className="proj-stats is-tight">
            <span className="tag">{p.theme}</span>
            {p.tags.slice(0, 2).map((tg) => <span className="tag" key={tg}>#{tg}</span>)}
            <span style={{ marginLeft: 'auto', flex: '0 0 auto' }} title={fmtDT(p.updatedAt, lang)}>{fmtAgo(p.updatedAt, lang)}</span>
          </span>
        </span>
      </button>
    </div>
  );
}

function ProjectsScreen({ t, lang, projects, setProjects, onOpen, toast, isWide, recentIds }) {
  const [ask, askNode] = useAsk();
  const [pop, setPop] = useState(null);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [theme, setTheme] = useState('');
  const [tags, setTags] = useState('');
  const [filter, setFilter] = useState('all');
  const [openRecent, setOpenRecent] = useState(true);
  const fileRef = useRef(null);
  const dirRef = useRef(null);

  const themes = useMemo(() => {
    const s = [];
    projects.forEach((p) => { if (p.theme && s.indexOf(p.theme) < 0) s.push(p.theme); });
    return s;
  }, [projects]);
  const tagList = useMemo(() => {
    const s = [];
    projects.forEach((p) => p.tags.forEach((x) => { if (s.indexOf(x) < 0) s.push(x); }));
    return s.slice(0, 12);
  }, [projects]);

  const match = (p, f) => {
    if (f === 'all') return true;
    if (f.indexOf('t:') === 0) return p.theme === f.slice(2);
    return p.tags.indexOf(f.slice(2)) >= 0;
  };
  const shown = projects.filter((p) => match(p, filter));
  const recent = recentIds.map((id) => projects.find((p) => p.id === id)).filter(Boolean).slice(0, 5);
  const filterLabel = filter === 'all' ? t.filterAll : filter.slice(2);

  const items = [{ key: 'all', label: t.filterAll, count: projects.length, icon: 'grid' }]
    .concat(themes.length ? [{ sep: true, key: 'sep1' }] : [])
    .concat(themes.map((th) => ({ key: 't:' + th, label: th, count: projects.filter((p) => p.theme === th).length, icon: 'folder' })))
    .concat(tagList.length ? [{ sep: true, key: 'sep2' }] : [])
    .concat(tagList.map((tg) => ({ key: 'g:' + tg, label: '#' + tg, count: projects.filter((p) => p.tags.indexOf(tg) >= 0).length })));

  const create = async () => {
    const nm = name.trim(); if (!nm) return;
    const p = {
      id: nid('p'), name: nm, desc: desc.trim() || (lang === 'ru' ? 'Новый проект' : 'New project'),
      theme: theme.trim() || (lang === 'ru' ? 'Прочее' : 'Other'),
      tags: tags.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean).slice(0, 5),
      tint: TINTS[projects.length % TINTS.length], demo: false,
      updatedAt: Date.now(), snaps: [],
      files: [mkFile('README.md', '# ' + nm + '\n\n' + (desc.trim() || '') + '\n')],
    };
    try {
      const created = ENGINE_SERVER ? await API.create(p) : p;
      setProjects(list => [created].concat(list));
    } catch(e) { toast(e.message); return; }
    setPop(null); setName(''); setDesc(''); setTags(''); setTheme('');
  };

  const readFiles = (fileList) => {
    const files = Array.from(fileList).filter((f) => f.size < 512 * 1024).slice(0, 60);
    if (!files.length) { toast(lang === 'ru' ? 'Нет подходящих файлов' : 'No readable files'); return; }
    const rel = files.map((f) => f.webkitRelativePath || f.name);
    const root = rel[0].indexOf('/') > 0 ? rel[0].split('/')[0] : '';
    Promise.all(files.map((f) => new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(mkFile((f.webkitRelativePath || f.name).replace(root + '/', ''), String(r.result || '')));
      r.onerror = () => res(null);
      r.readAsText(f);
    }))).then(async (list) => {
      const good = list.filter(Boolean);
      const imported = {
        id: nid('p'), name: root || (lang === 'ru' ? 'Импорт' : 'Imported'),
        desc: lang === 'ru' ? 'Импортировано из памяти устройства' : 'Imported from device storage',
        theme: lang === 'ru' ? 'Импорт' : 'Imported', tags: ['импорт'],
        tint: TINTS[(projects.length + 2) % TINTS.length], demo: false,
        updatedAt: Date.now(), snaps: [], files: good,
      };
      try { const created=ENGINE_SERVER ? await API.create(imported) : imported;setProjects(list=>[created].concat(list)); }
      catch(e){toast(e.message);return;}
      setPop(null);
      toast((lang === 'ru' ? 'Импортировано файлов: ' : 'Files imported: ') + good.length);
    });
  };

  return (
    <>
      <div className="page-top is-slim">
        <div className="row" style={{ gap: 9, minWidth: 0 }}>
          <h1 className="h1" style={{ fontSize: 20 }}>{t.projTitle}</h1>
          <span className="badge mute num">{shown.length}</span>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Dropdown value={filter} items={items} onPick={setFilter}
            trigger={(toggle, open) => (
              <button className={'chip' + (filter !== 'all' ? ' is-on' : '')} onClick={toggle} aria-expanded={open}>
                <Ico n="sliders" s={15} />{filterLabel}
                <span className="tree-chev" style={{ transform: open ? 'rotate(180deg)' : 'none' }}><Ico n="chevDown" s={13} /></span>
              </button>
            )} />
          <button className="icon-btn is-ghost" onClick={() => setPop('import')} aria-label={t.projImport}><Ico n="upload" s={18} /></button>
          <button className="icon-btn" style={{ background: 'var(--accent-primary)', color: 'var(--accent-ink)' }}
            onClick={() => setPop('new')} aria-label={t.projNew}><Ico n="plus" s={18} /></button>
        </div>
      </div>

      {projects.length === 0 ? (
        <Fade className="page-body">
          {/* Баннер остаётся и на пустой главной: без него экран выглядит
              сломанным, а не просто пустым. */}
          <AppBanner t={t} lang={lang} compact />
          <div className="proj-empty t-stagger is-shown">
            <span className="t-stagger-line t-stagger-line--1" style={{ color: 'var(--text-tertiary)' }}><Ico n="folder" s={34} /></span>
            <b className="t-stagger-line t-stagger-line--2">{t.projEmpty}</b>
            <span className="t-stagger-line t-stagger-line--3 meta" style={{ maxWidth: '32ch' }}>{t.projEmptyB}</span>
            <button className="cta is-sm t-stagger-line t-stagger-line--4" style={{ marginTop: 6 }} onClick={() => setPop('new')}>
              <Ico n="plus" s={16} />{t.projNew}
            </button>
          </div>
        </Fade>
      ) : (
        <div className="proj-screen">
          <div className="proj-fixed">
            <AppBanner t={t} lang={lang} compact />
            {recent.length > 0 && (
              <>
                <Rule label={t.recent} count={recent.length} open={openRecent} onToggle={() => setOpenRecent(!openRecent)} />
                <Fold open={openRecent}>
                  <div className="scroll-x is-bleed">
                    {recent.map((p) => {
                      const st = projectStats(p.files);
                      return (
                        <button className="recent-card" key={p.id} style={{ '--tint': p.tint }} onClick={() => onOpen(p)}>
                          <span className="recent-top">
                            <span className="recent-badge">{initials(p.name)}</span>
                            <b>{p.name}</b>
                          </span>
                          <span className="recent-meta num">{fmtDT(p.updatedAt, lang)}</span>
                          <span className="recent-meta num">{st.count} {plural(st.count, FILES_FORMS, lang)} · {st.lines} {t.linesShort}</span>
                        </button>
                      );
                    })}
                  </div>
                </Fold>
              </>
            )}
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="eyebrow">{t.allProjects}</span>
              <span className="meta num">{shown.length} / {projects.length}</span>
            </div>
          </div>

          <Fade className="proj-scroll">
            <div className="proj-board"><div className="proj-list">
              {shown.map((p) => (
                <ProjectRow key={p.id} p={p} t={t} lang={lang} onOpen={onOpen}
                  onRename={(pr) => { setName(pr.name); setPop({ rename: pr }); }}
                  onDelete={async (pr) => {
                    if(!await ask({title:t.projDelete,body:'«'+pr.name+'»',confirm:t.projDelete,danger:true}))return;
                    try{if(ENGINE_SERVER)await API.remove(pr.id);setProjects(list=>list.filter(x=>x.id!==pr.id));toast(t.projDeleted);}catch(e){toast(e.message);} }} />
              ))}
              {shown.length === 0 && <div className="meta" style={{ padding: '14px 8px' }}>{t.noMatch}</div>}
            </div></div>
          </Fade>
        </div>
      )}

      {askNode}
      <Popup open={pop === 'new'} onClose={() => setPop(null)} title={t.projNew}
        foot={<button className="cta" style={{ width: '100%' }} disabled={!name.trim()} onClick={create}>{t.projCreate}</button>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label className="meta" htmlFor="pn">{t.projName}</label>
          <input id="pn" className="field" value={name} autoFocus placeholder="my-app" onChange={(e) => setName(e.target.value)} />
          <label className="meta" htmlFor="pd">{t.projDesc}</label>
          <input id="pd" className="field" value={desc} placeholder={lang === 'ru' ? 'Для чего этот проект' : 'What it is for'} onChange={(e) => setDesc(e.target.value)} />
          <label className="meta">{t.projTheme}</label>
          <Fade axis="x" className="scroll-x">
            {(themes.length ? themes : ['Веб', 'Боты', 'Бэкенд']).concat(lang === 'ru' ? ['Прочее'] : ['Other']).map((th) => (
              <button key={th} className={'chip' + (theme === th ? ' is-on' : '')} onClick={() => setTheme(theme === th ? '' : th)}>{th}</button>
            ))}
          </Fade>
          <label className="meta" htmlFor="pt">{t.tagsLabel}</label>
          <input id="pt" className="field" value={tags} placeholder={t.tagsHint} onChange={(e) => setTags(e.target.value)} />
          {tags.trim() && (
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {tags.split(',').map((x) => x.trim()).filter(Boolean).map((x, i) => <span className="tag" key={i}>#{x.toLowerCase()}</span>)}
            </div>
          )}
        </div>
      </Popup>

      <Popup open={typeof pop === 'object' && pop !== null} onClose={() => setPop(null)} title={t.projRename}
        foot={<button className="cta" style={{ width: '100%' }} disabled={!name.trim()} onClick={async () => {
          const changed={...pop.rename,name:name.trim()};
          try{const result=ENGINE_SERVER ? await API.patch(changed) : changed;
            setProjects(list=>list.map(x=>x.id===changed.id?{...x,...API.metadata(result),revision:result.revision}:x));
          }catch(e){toast(e.message);return;}
          setPop(null);
        }}>{t.done}</button>}>
        <input className="field" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      </Popup>

      <Popup open={pop === 'import'} onClose={() => setPop(null)} title={t.projImport}>
        <p className="meta" style={{ marginTop: 0 }}>
          {lang === 'ru'
            ? 'Выберите папку проекта или отдельные файлы в проводнике устройства. Текстовые файлы до 512 КБ читаются целиком.'
            : 'Pick a project folder or single files in the device browser. Text files up to 512 KB are read in full.'}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button className="cta" onClick={() => dirRef.current && dirRef.current.click()}>
            <Ico n="folderOpen" s={18} />{lang === 'ru' ? 'Выбрать папку' : 'Choose folder'}
          </button>
          <button className="cta is-quiet" onClick={() => fileRef.current && fileRef.current.click()}>
            <Ico n="file" s={18} />{lang === 'ru' ? 'Выбрать файлы' : 'Choose files'}
          </button>
        </div>
        <input ref={dirRef} type="file" webkitdirectory="" directory="" multiple hidden
          onChange={(e) => { readFiles(e.target.files); e.target.value = ''; }} />
        <input ref={fileRef} type="file" multiple hidden
          onChange={(e) => { readFiles(e.target.files); e.target.value = ''; }} />
      </Popup>
    </>
  );
}

/* =========================================================================
   Дерево файлов
   ========================================================================= */
function buildTree(files, directories = []) {
  const root = { dirs: Object.create(null), files: [] };
  directories.forEach(p=>{let node=root;for(const part of p.split('/')){node.dirs[part]=node.dirs[part]||{dirs:Object.create(null),files:[]};node=node.dirs[part];}});
  files.forEach((f) => {
    const parts = f.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const d = parts[i];
      node.dirs[d] = node.dirs[d] || { dirs: Object.create(null), files: [] };
      node = node.dirs[d];
    }
    node.files.push(f);
  });
  return root;
}
function allDirKeys(files) {
  const keys = [];
  files.forEach((f) => {
    const parts = f.path.split('/'); let acc = '';
    for (let i = 0; i < parts.length - 1; i++) { acc += parts[i] + '/'; if (keys.indexOf(acc) < 0) keys.push(acc); }
  });
  return keys;
}

function TreeNode({ node, depth, openDirs, toggle, active, onPick, prefix }) {
  const dirNames = Object.keys(node.dirs).sort();
  const files = node.files.slice().sort((a, b) => a.path.localeCompare(b.path));
  return (
    <>
      {dirNames.map((d) => {
        const key = prefix + d + '/';
        const open = !!openDirs[key];
        return (
          <div key={key}>
            <button className="tree-row" onClick={() => toggle(key)} style={{ paddingLeft: 6 + depth * 12 }} aria-expanded={open}>
              <span className={'tree-chev' + (open ? ' is-open' : '')}><Ico n="chev" s={13} /></span>
              <span className="tree-ico" style={{ color: 'var(--text-secondary)' }}><Ico n={open ? 'folderOpen' : 'folder'} s={15} /></span>
              <span className="tree-name">{d}</span>
            </button>
            <div className={'tree-branch' + (open ? ' is-open' : '')}>
              <div>
                <TreeNode node={node.dirs[d]} depth={depth + 1} openDirs={openDirs} toggle={toggle} active={active} onPick={onPick} prefix={key} />
              </div>
            </div>
          </div>
        );
      })}
      {files.map((f) => {
        const l = langOf(f.path);
        return (
          <button key={f.id} className={'tree-row' + (active === f.path ? ' is-active' : '')}
            style={{ paddingLeft: 6 + depth * 12 + 18 }} onClick={() => onPick(f)}>
            <span className="tree-ico" style={{ color: LANG_COLOR[l] || 'var(--text-tertiary)' }}><Ico n="file" s={14} /></span>
            <span className="tree-name">{f.path.split('/').pop()}</span>
            {(f.unsaved || f.dirty) && <i style={{ width: 6, height: 6, borderRadius: 3, background: f.unsaved ? 'var(--state-warning)' : 'var(--state-ok)' }} />}
          </button>
        );
      })}
    </>
  );
}

/* =========================================================================
   Редактор кода со сворачиванием блоков
   ========================================================================= */
const SYM_SETS = {
  brackets: ['\t', '{', '}', '(', ')', '[', ']', '<', '>'],
  ops: ['=', '+', '-', '*', '/', '%', '!', '&', '|', '^', '~', '=>', '->', '=='],
  other: [';', ':', ',', '.', '_', '"', "'", '`', '\\', '#', '$', '@', '?'],
};

function CodeEditor({ file, code, onChange, settings, searchQ, jumpTo, folds, setFolds }) {
  const taRef = useRef(null);
  const preRef = useRef(null);
  const scrollRef = useRef(null);
  const lang = file ? (file.langOverride || langOf(file.path)) : 'txt';

  const rows = useMemo(() => {
    const toks = tokenize(code, lang);
    const out = [[]];
    toks.forEach((tk) => {
      const parts = String(tk[1]).split('\n');
      parts.forEach((part, i) => {
        if (i > 0) out.push([]);
        if (part) out[out.length - 1].push([tk[0], part]);
      });
    });
    return out;
  }, [code, lang]);

  const raw = useMemo(() => code.split('\n'), [code]);
  const indent = useMemo(() => raw.map((l) => (l.trim() === '' ? -1 : l.replace(/\t/g, '  ').match(/^ */)[0].length)), [raw]);
  const blocks = useMemo(() => {
    const map = {};
    for (let i = 0; i < raw.length; i++) {
      if (indent[i] < 0) continue;
      let j = i + 1;
      while (j < raw.length && indent[j] < 0) j++;
      if (j >= raw.length || indent[j] <= indent[i]) continue;
      let end = j;
      let k = j;
      while (k < raw.length && (indent[k] < 0 || indent[k] > indent[i])) { if (indent[k] >= 0) end = k; k++; }
      if (end > i) map[i] = end;
    }
    return map;
  }, [raw, indent]);

  const hidden = useMemo(() => {
    const set = {};
    Object.keys(folds || {}).forEach((k) => {
      if (!folds[k]) return;
      const i = +k, end = blocks[i];
      if (end == null) return;
      for (let x = i + 1; x <= end; x++) set[x] = true;
    });
    return set;
  }, [folds, blocks]);
  const anyFold = Object.keys(hidden).length > 0;

  useLayoutEffect(() => {
    const ta = taRef.current, pre = preRef.current;
    if (ta && pre && !anyFold) ta.style.height = pre.offsetHeight + 'px';
  }, [rows, settings.font, settings.wrap, anyFold]);

  useEffect(() => {
    if (jumpTo == null || !scrollRef.current) return;
    const row = scrollRef.current.querySelector('[data-row="' + jumpTo + '"]');
    if (row) scrollRef.current.scrollTo({ top: Math.max(0, row.offsetTop - 90), behavior: 'smooth' });
  }, [jumpTo]);

  const insert = (sym) => {
    const ta = taRef.current; if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    onChange(ta.value.slice(0, s) + sym + ta.value.slice(e));
    requestAnimationFrame(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = s + sym.length; });
  };
  const keyDown = (e) => {
    if (e.key === 'Tab') { e.preventDefault(); insert(' '.repeat(settings.tab)); return; }
    if (e.key === 'Enter') {
      const ta = e.target, s = ta.selectionStart;
      const lineStart = ta.value.lastIndexOf('\n', s - 1) + 1;
      const ind = (ta.value.slice(lineStart, s).match(/^[ \t]*/) || [''])[0];
      const extra = /[{[(:]\s*$/.test(ta.value.slice(lineStart, s)) ? ' '.repeat(settings.tab) : '';
      if (ind || extra) { e.preventDefault(); insert('\n' + ind + extra); }
    }
  };

  const digits = String(Math.max(rows.length, 1)).length;
  const styleVars = {
    '--gut': settings.nums ? 'calc(' + digits + 'ch + 34px)' : '16px',
    fontSize: settings.font + 'px', lineHeight: 1.55,
  };
  const q = (searchQ || '').toLowerCase();

  return (
    <div className="ed-scroll" ref={scrollRef}>
      <div className={'ed-doc' + (settings.wrap ? ' is-wrap' : '')} style={styleVars}>
        <pre className="ed-hl" ref={preRef}>
          {rows.map((row, i) => {
            if (hidden[i]) return null;
            const text = row.map((r) => r[1]).join('');
            const hit = q && text.toLowerCase().indexOf(q) >= 0;
            const foldable = blocks[i] != null;
            const isFolded = !!(folds && folds[i]);
            return (
              <div className={'ed-row' + (hit ? ' is-hit' : '')} key={i} data-row={i}>
                <em className="ed-n">
                  {foldable ? (
                    <span className={'ed-fold' + (isFolded ? '' : ' is-open')} role="button" tabIndex={0}
                      onClick={() => setFolds(Object.assign({}, folds, { [i]: !isFolded }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') setFolds(Object.assign({}, folds, { [i]: !isFolded })); }}>
                      <Ico n="chev" s={11} />
                    </span>
                  ) : <span className="ed-fold" style={{ visibility: 'hidden' }} />}
                  {settings.nums ? i + 1 : ''}
                </em>
                <span className="ed-t">
                  {row.length === 0 ? '​' : row.map((tk, j) => {
                    const cls = TOK_CLASS[tk[0]];
                    return cls ? <span key={j} className={cls}>{tk[1]}</span> : <span key={j}>{tk[1]}</span>;
                  })}
                  {isFolded && <span className="ed-more">⋯ {blocks[i] - i}</span>}
                </span>
              </div>
            );
          })}
        </pre>
        <textarea
          ref={taRef} className={'ed-input' + (anyFold ? ' is-hidden' : '')} value={code} spellCheck="false"
          autoCapitalize="off" autoCorrect="off" autoComplete="off"
          onChange={(e) => onChange(e.target.value)} onKeyDown={keyDown}
          style={{ left: 'var(--gut)' }} aria-label={file ? file.path : 'code'} />
      </div>
    </div>
  );
}

/* =========================================================================
   Просмотр Markdown: разбор блоков и строчной разметки
   ========================================================================= */
function mdInline(text) {
  const parts = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|~~[^~]+~~|\[[^\]]+\]\([^)]+\))/g;
  let last = 0, m, key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.charAt(0) === '`') parts.push(<code className="md-code" key={key++}>{tok.slice(1, -1)}</code>);
    else if (tok.indexOf('**') === 0 || tok.indexOf('__') === 0) parts.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    else if (tok.indexOf('~~') === 0) parts.push(<s key={key++}>{tok.slice(2, -2)}</s>);
    else if (tok.charAt(0) === '[') {
      const mm = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      let safe=false;try{safe=['http:','https:','mailto:'].includes(new URL(mm[2],location.protocol==='file:'?'https://localhost/':location.href).protocol);}catch(e){}
      parts.push(safe ? <a className="md-link" key={key++} href={mm[2]} target="_blank" rel="noreferrer noopener">{mm[1]}</a> : <span key={key++}>{mm[1]}</span>);
    } else parts.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function mdBlocks(src) {
  const lines = src.split('\n');
  const out = [];
  let para = [];
  let key = 0;
  let i = 0;
  const flush = () => {
    if (!para.length) return;
    out.push(<p className="md-p" key={'p' + key++}>{mdInline(para.join(' '))}</p>);
    para = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*```/.test(line)) {                                   /* блок кода */
      flush();
      const tag = line.trim().slice(3).trim().toLowerCase();
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) { body.push(lines[i]); i++; }
      i++;
      const id = LANGS[tag] ? tag : (EXT2LANG[tag] || 'txt');
      out.push(
        <pre className="md-pre" key={'c' + key++}>
          <code><Highlight code={body.join('\n')} lang={id} /></code>
        </pre>
      );
      continue;
    }

    if (/^\s{0,3}#{1,6}\s/.test(line)) {                          /* заголовок */
      flush();
      const m = line.match(/^\s*(#{1,6})\s+(.*)$/);
      const lvl = Math.min(m[1].length, 6);
      out.push(React.createElement('h' + lvl, { className: 'md-h md-h' + lvl, key: 'h' + key++ }, mdInline(m[2])));
      i++; continue;
    }

    if (/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {          /* линия */
      flush(); out.push(<hr className="md-hr" key={'r' + key++} />); i++; continue;
    }

    if (/^\s*>/.test(line)) {                                     /* цитата */
      flush();
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      out.push(<blockquote className="md-quote" key={'q' + key++}>{mdInline(buf.join(' '))}</blockquote>);
      continue;
    }

    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]*-[\s:|-]*$/.test(lines[i + 1])) {  /* таблица */
      flush();
      const cells = (row) => row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim() !== '') { rows.push(cells(lines[i])); i++; }
      out.push(
        <div className="md-table-wrap" key={'t' + key++}>
          <table className="md-table">
            <thead><tr>{head.map((c, n) => <th key={n}>{mdInline(c)}</th>)}</tr></thead>
            <tbody>{rows.map((r, n) => <tr key={n}>{r.map((c, k) => <td key={k}>{mdInline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
      continue;
    }

    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {                    /* список */
      flush();
      const ordered = /^\s*\d/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        const indent = lines[i].match(/^\s*/)[0].replace(/\t/g, '  ').length;
        const text = lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '');
        if (indent >= 2 && items.length) items[items.length - 1].kids.push(text);
        else items.push({ text: text, kids: [] });
        i++;
      }
      const body = items.map((it, n) => (
        <li className="md-li" key={n}>
          {mdInline(it.text)}
          {it.kids.length > 0 && (
            <ul className="md-ul">{it.kids.map((k, m2) => <li className="md-li" key={m2}>{mdInline(k)}</li>)}</ul>
          )}
        </li>
      ));
      out.push(ordered
        ? <ol className="md-ol" key={'l' + key++}>{body}</ol>
        : <ul className="md-ul" key={'l' + key++}>{body}</ul>);
      continue;
    }

    if (/^ {4,}\S/.test(line) && !para.length) {                  /* отступ = код */
      flush();
      const body = [];
      while (i < lines.length && (/^ {4,}/.test(lines[i]) || lines[i].trim() === '')) {
        if (lines[i].trim() === '' && !/^ {4,}/.test(lines[i + 1] || '')) break;
        body.push(lines[i].replace(/^ {4}/, '')); i++;
      }
      out.push(<pre className="md-pre" key={'c' + key++}><code>{body.join('\n')}</code></pre>);
      continue;
    }

    if (line.trim() === '') { flush(); i++; continue; }
    para.push(line.trim());
    i++;
  }
  flush();
  return out;
}

function MarkdownView({ code, font }) {
  const blocks = useMemo(() => mdBlocks(code), [code]);
  return (
    <div className="md-wrap">
      <article className="md-view" style={{ fontSize: Math.max(14, font + 1) + 'px' }}>{blocks}</article>
    </div>
  );
}
