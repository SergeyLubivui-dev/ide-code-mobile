/* =========================================================================
   IDE Code — мобильная среда разработки. Мок-данные, один файл.
   ========================================================================= */
const { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } = React;

/* ---------- моторика: JS читает те же токены, что и CSS ---------- */
const durCache = {};
function durationOf(token, fallback) {
  if (durCache[token] != null) return durCache[token];
  let v = fallback;
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
    if (raw.endsWith('ms')) v = parseFloat(raw);
    else if (raw.endsWith('s')) v = parseFloat(raw) * 1000;
  } catch (e) {}
  durCache[token] = v;
  return v;
}
/* Размеры тоже живут в CSS: JS читает тот же токен, а не копию числа. */
function pxOf(token, fallback) {
  if (durCache[token] != null) return durCache[token];
  let v = fallback;
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
    if (raw.endsWith('px')) v = parseFloat(raw);
  } catch (e) {}
  durCache[token] = v;
  return v;
}

const MOTION = {
  panelOpen: () => durationOf('--panel-open-dur', 400),
  panelClose: () => durationOf('--panel-close-dur', 350),
  quick: () => durationOf('--duration-quick', 150),
  fast: () => durationOf('--duration-fast', 250),
  slow: () => durationOf('--duration-slow', 400),
  verySlow: () => durationOf('--duration-very-slow', 500),
  dropdownClose: () => durationOf('--dropdown-close-dur', 150),
  dropdownOpen: () => durationOf('--dropdown-open-dur', 250),
};

/* ---------- словарь ---------- */
const STR = {
  ru: {
    appName: 'IDE Code', appSub: 'редактор кода',
    tabProjects: 'Главная', tabCode: 'Проект', tabChat: 'Чат', tabSettings: 'Настройки',
    wlSkip: 'Пропустить', wlNext: 'Далее', wlStart: 'Начать работу',
    wlHiT: 'Добро пожаловать',
    wlHiB: 'IDE Code — среда разработки, которая целиком живёт на этом устройстве: проекты, файлы и терминал никуда не уходят. Чтобы продолжить, отметьте согласие ниже.',
    wlThanks: 'Спасибо, что выбрали IDE Code',
    wl1t: 'Полноценная IDE в кармане',
    wl1b: 'Дерево файлов, вкладки, подсветка двадцати языков и панель символов над клавиатурой — всё то, чем вы пользуетесь на большом экране.',
    wl2t: 'Проекты, а не разрозненные файлы',
    wl2b: 'Создавайте проекты, импортируйте папки из памяти телефона и возвращайтесь к работе там, где остановились.',
    wl3t: 'Терминал и история изменений',
    wl3b: 'Запускайте задачи, смотрите вывод, собирайте коммит из изменённых файлов — не переключаясь на компьютер.',
    wl4t: 'Всё остаётся на устройстве',
    wl4b: 'Код, проекты и настройки хранятся локально. Мы не отправляем ваши файлы на серверы и не передаём их третьим лицам.',
    wlAgree1: 'Я принимаю ', wlAgreeLink: 'условия использования и политику конфиденциальности',
    wlAgree2: ' и подтверждаю, что данные не передаются третьим лицам.',
    wlNeedAgree: 'Отметьте согласие, чтобы продолжить',
    legalTitle: 'Конфиденциальность',
    projTitle: 'Проекты', projSub: 'проектов', projFiles: 'файлов',
    projNew: 'Новый проект', projImport: 'Импорт из памяти',
    projEmpty: 'Пока пусто', projEmptyB: 'Создайте проект или импортируйте папку с телефона.',
    projName: 'Название проекта', projDesc: 'Короткое описание',
    projCreate: 'Создать', projRename: 'Переименовать', projDelete: 'Удалить',
    projDeleted: 'Проект удалён', projOpened: 'Проект открыт',
    demo: 'демо', updated: 'изменён',
    codeNoProject: 'Проект не выбран',
    codeNoProjectB: 'Откройте проект на вкладке «Проекты» — файлы и редактор появятся здесь.',
    codeGo: 'К проектам',
    files: 'Файлы', newFile: 'Новый файл', importFile: 'Импорт файла',
    fileName: 'Путь и имя файла', fileHint: 'Например: src/utils/format.ts',
    search: 'Поиск по файлу', terminal: 'Терминал', git: 'История изменений',
    save: 'Сохранить', saved: 'Сохранено', run: 'Запустить', stop: 'Остановить',
    wrap: 'Перенос строк', lines: 'строк', col: 'кол',
    commitMsg: 'Что изменилось', commit: 'Закоммитить', staged: 'В коммите',
    changes: 'Изменения', history: 'История', noChanges: 'Изменений нет',
    committed: 'Коммит создан',
    setTitle: 'Настройки', setAppear: 'Внешний вид', setTheme: 'Тёмная тема',
    setChat: 'Чат с моделью', setChatKey: 'Ключ платформы', setChatNoKey: 'не задан',
    setChatSave: 'Сохранить',
    setChatB: 'Ключ хранится на этом устройстве рядом с движком и в интерфейс не передаётся. Запросы к платформе идут через движок. В списке — весь каталог платформы; признака «бесплатно» она не отдаёт, поэтому движок пробует несколько моделей и помечает те, что ответили.',
    setProfile: 'Профиль', setNoName: 'Без имени', setSync: 'Обновить проекты', setSyncB: 'перечитать файлы с сервера',
    setSyncing: 'Синхронизация…', setSample: 'Пример проекта', setSampleB: 'создать демонстрационный проект',
    setSignOut: 'Выйти', setSignOutB: 'завершить сессию на этом устройстве', setToServer: 'К серверу',
    setToServerB: 'выйти из демо с мок-данными', setSampleDone: 'Пример проекта создан',
    setDemo: 'ДЕМО · мок-данные', setDemoB: 'команды имитируются, правки живут до перезагрузки',
    setThemeB: 'Круговое переключение из точки нажатия',
    setLang: 'Язык интерфейса', setEditor: 'Редактор', setFont: 'Размер шрифта',
    setTab: 'Ширина отступа', setWrapB: 'Длинные строки переносятся',
    setNums: 'Номера строк', setKeys: 'Панель символов',
    setKeysB: 'Ряд скобок и операторов над клавиатурой',
    setData: 'Данные', setAbout: 'О приложении', setFaq: 'Как это устроено',
    setReset: 'Показать приветствие снова', setWipe: 'Стереть все проекты',
    setWipeB: 'Проекты и файлы будут удалены с устройства',
    wipeAck: 'Понимаю, что это необратимо', wipeGo: 'Стереть',
    wipeDone: 'Данные стёрты', cancel: 'Отмена', close: 'Закрыть', done: 'Готово',
    q1: 'Где хранится код?',
    a1: 'В памяти устройства, в песочнице приложения. Проект — это папка с файлами; при импорте копия кладётся рядом с остальными проектами. Ничего не уходит в сеть.',
    q2: 'Какие языки подсвечиваются?',
    a2: 'JavaScript, TypeScript, JSX, Python, Go, Rust, Java, Kotlin, Swift, C, C++, C#, PHP, Ruby, SQL, Shell, YAML, JSON, HTML, CSS и Markdown. Язык определяется по расширению файла и меняется вручную в статусной строке.',
    q3: 'Чем отличается планшет?',
    a3: 'На планшете навигация уезжает влево и превращается в рельс: его можно сузить до иконок — дерево файлов и редактор получают всю ширину. На телефоне те же экраны живут под нижней капсулой.',
    q4: 'Что умеет терминал?',
    a4: 'В демо-режиме это песочница с набором команд: ls, cd, cat, run, git status, help. Реальные процессы появятся, когда приложение получит доступ к рантайму.',
    tabTerminal: 'Терминал', tabHistory: 'История', tabSearch: 'Поиск', tabPrefs: 'Редактор',
    tools: 'Инструменты', collapse: 'Свернуть', expand: 'Развернуть',
    collapseAll: 'Свернуть всё', expandAll: 'Развернуть всё', hidePanel: 'Скрыть панель',
    recent: 'Последние', allProjects: 'Все проекты', filterAll: 'Все', filters: 'Фильтры',
    projTheme: 'Тематика', tagsLabel: 'Теги', tagsHint: 'через запятую: rust, cli, офлайн',
    linesShort: 'строк', noMatch: 'Ничего не найдено',
    connect: 'Подключиться', disconnect: 'Отключиться', host: 'Хост', user: 'Пользователь', port: 'Порт',
    connecting: 'подключение…', connected: 'Соединение установлено', localShell: 'Локальная оболочка',
    remoteShell: 'Сервер по SSH', session: 'Сессия', newSession: 'Новая сессия',
    snapshots: 'Точки восстановления', saveSnap: 'Сохранить точку', snapMsg: 'Что изменилось',
    restore: 'Откатить к этой точке', restored: 'Файлы восстановлены', inSnap: 'Файлы в точке',
    searchAll: 'Что ищем', matches: 'совпадений', openAt: 'Открыть строку',
    scopeFile: 'Файл', scopeProject: 'Проект', scopeAll: 'Все проекты',
    searchHint: 'Введите текст: поиск идёт по открытому файлу, проекту или всем проектам сразу.',
    viewCode: 'Код', viewRead: 'Просмотр',
    extra: 'Прочее', symBrackets: 'Скобки', symOps: 'Операторы', symOther: 'Знаки', hideRow: 'Скрыть ряд',
    foldHint: 'Клик по стрелке в поле номеров сворачивает блок',
    aboutV: 'Версия 0.9.0 · демо-сборка',
    openSource: 'Открытый код', sourceCode: 'исходный код',
    bannerSub: 'Мобильная среда разработки: проекты, редактор с подсветкой, терминал и точки восстановления — всё на устройстве.',
    aboutB: 'Интерфейс собран на токенах моторики: длительности, кривые и дистанции живут в CSS, а таймеры JS читают те же переменные.',
    lineNums: 'Номера', symbols: 'Символы',
  },
  en: {
    appName: 'IDE Code', appSub: 'code editor',
    tabProjects: 'Home', tabCode: 'Project', tabChat: 'Chat', tabSettings: 'Settings',
    wlSkip: 'Skip', wlNext: 'Next', wlStart: 'Start working',
    wlHiT: 'Welcome',
    wlHiB: 'IDE Code is a development environment that lives entirely on this device: projects, files and the terminal never leave it. Tick the box below to continue.',
    wlThanks: 'Thank you for choosing IDE Code',
    wl1t: 'A real IDE in your pocket',
    wl1b: 'File tree, tabs, syntax highlighting for twenty languages and a symbol row above the keyboard — everything you use on a big screen.',
    wl2t: 'Projects, not loose files',
    wl2b: 'Create projects, import folders from device storage and pick up exactly where you stopped.',
    wl3t: 'Terminal and change history',
    wl3b: 'Run tasks, read the output, assemble a commit from changed files — without switching to a computer.',
    wl4t: 'Everything stays on the device',
    wl4b: 'Code, projects and settings are stored locally. We never upload your files and never share them with third parties.',
    wlAgree1: 'I accept the ', wlAgreeLink: 'terms of use and privacy policy',
    wlAgree2: ' and confirm that data is not shared with third parties.',
    wlNeedAgree: 'Tick the box to continue',
    legalTitle: 'Privacy',
    projTitle: 'Projects', projSub: 'projects', projFiles: 'files',
    projNew: 'New project', projImport: 'Import from storage',
    projEmpty: 'Nothing here yet', projEmptyB: 'Create a project or import a folder from the device.',
    projName: 'Project name', projDesc: 'Short description',
    projCreate: 'Create', projRename: 'Rename', projDelete: 'Delete',
    projDeleted: 'Project deleted', projOpened: 'Project opened',
    demo: 'demo', updated: 'edited',
    codeNoProject: 'No project selected',
    codeNoProjectB: 'Open a project on the Projects tab — files and the editor will appear here.',
    codeGo: 'Go to projects',
    files: 'Files', newFile: 'New file', importFile: 'Import file',
    fileName: 'File path and name', fileHint: 'For example: src/utils/format.ts',
    search: 'Find in file', terminal: 'Terminal', git: 'Change history',
    save: 'Save', saved: 'Saved', run: 'Run', stop: 'Stop',
    wrap: 'Wrap lines', lines: 'lines', col: 'col',
    commitMsg: 'What changed', commit: 'Commit', staged: 'In commit',
    changes: 'Changes', history: 'History', noChanges: 'No changes',
    committed: 'Commit created',
    setTitle: 'Settings', setAppear: 'Appearance', setTheme: 'Dark theme',
    setChat: 'Model chat', setChatKey: 'Platform key', setChatNoKey: 'not set',
    setChatSave: 'Save',
    setChatB: 'The key is stored on this device next to the engine and never reaches the interface. Requests go through the engine. The list holds the whole platform catalogue; the platform exposes no free-tier flag, so the engine probes a few models and marks the ones that answered.',
    setProfile: 'Profile', setNoName: 'No name', setSync: 'Refresh projects', setSyncB: 'reread files from the server',
    setSyncing: 'Syncing…', setSample: 'Sample project', setSampleB: 'create a demonstration project',
    setSignOut: 'Sign out', setSignOutB: 'end the session on this device', setToServer: 'Go to the server',
    setToServerB: 'leave the mock-data demo', setSampleDone: 'Sample project created',
    setDemo: 'DEMO · mock data', setDemoB: 'commands are simulated, edits last until reload',
    setThemeB: 'Circular swap from the point you touch',
    setLang: 'Interface language', setEditor: 'Editor', setFont: 'Font size',
    setTab: 'Indent width', setWrapB: 'Long lines wrap',
    setNums: 'Line numbers', setKeys: 'Symbol row',
    setKeysB: 'Brackets and operators above the keyboard',
    setData: 'Data', setAbout: 'About', setFaq: 'How it works',
    setReset: 'Show onboarding again', setWipe: 'Erase all projects',
    setWipeB: 'Projects and files will be deleted from the device',
    wipeAck: 'I understand this cannot be undone', wipeGo: 'Erase',
    wipeDone: 'Data erased', cancel: 'Cancel', close: 'Close', done: 'Done',
    q1: 'Where is the code stored?',
    a1: 'In device storage, inside the app sandbox. A project is a folder of files; an import copies it next to your other projects. Nothing leaves the device.',
    q2: 'Which languages are highlighted?',
    a2: 'JavaScript, TypeScript, JSX, Python, Go, Rust, Java, Kotlin, Swift, C, C++, C#, PHP, Ruby, SQL, Shell, YAML, JSON, HTML, CSS and Markdown. The language comes from the file extension and can be changed in the status bar.',
    q3: 'What changes on a tablet?',
    a3: 'On a tablet the navigation moves left and becomes a rail that collapses to icons, giving the tree and editor the full width. On a phone the same screens live under the bottom capsule.',
    q4: 'What can the terminal do?',
    a4: 'In demo mode it is a sandbox with a set of commands: ls, cd, cat, run, git status, help. Real processes arrive once the app gets runtime access.',
    tabTerminal: 'Terminal', tabHistory: 'History', tabSearch: 'Search', tabPrefs: 'Editor',
    tools: 'Tools', collapse: 'Collapse', expand: 'Expand',
    collapseAll: 'Collapse all', expandAll: 'Expand all', hidePanel: 'Hide panel',
    recent: 'Recent', allProjects: 'All projects', filterAll: 'All', filters: 'Filters',
    projTheme: 'Category', tagsLabel: 'Tags', tagsHint: 'comma separated: rust, cli, offline',
    linesShort: 'lines', noMatch: 'Nothing found',
    connect: 'Connect', disconnect: 'Disconnect', host: 'Host', user: 'User', port: 'Port',
    connecting: 'connecting…', connected: 'Connection established', localShell: 'Local shell',
    remoteShell: 'Server over SSH', session: 'Session', newSession: 'New session',
    snapshots: 'Restore points', saveSnap: 'Save restore point', snapMsg: 'What changed',
    restore: 'Roll back to this point', restored: 'Files restored', inSnap: 'Files in this point',
    searchAll: 'What to find', matches: 'matches', openAt: 'Open line',
    scopeFile: 'File', scopeProject: 'Project', scopeAll: 'All projects',
    searchHint: 'Type a query: the search runs over the open file, the project, or every project at once.',
    viewCode: 'Code', viewRead: 'Preview',
    extra: 'More', symBrackets: 'Brackets', symOps: 'Operators', symOther: 'Punctuation', hideRow: 'Hide row',
    foldHint: 'Tap the caret in the gutter to fold a block',
    aboutV: 'Version 0.9.0 · demo build',
    openSource: 'Open source', sourceCode: 'source code',
    bannerSub: 'A mobile development environment: projects, a highlighting editor, a terminal and restore points — all on the device.',
    aboutB: 'The interface runs on motion tokens: durations, curves and distances live in CSS, and JS timers read the same variables.',
    lineNums: 'Numbers', symbols: 'Symbols',
  },
};

/* =========================================================================
   Прокрутка с растворяющимися краями
   ========================================================================= */
/* Маска включается только с той стороны, где ещё есть что листать:
   у неподвижного списка края остаются чёткими. */
function useFade(axis) {
  const ref = useRef(null);
  const sync = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const y = axis === 'y';
    const pos = y ? el.scrollTop : el.scrollLeft;
    const size = y ? el.clientHeight : el.clientWidth;
    const full = y ? el.scrollHeight : el.scrollWidth;
    el.style.setProperty('--fa', pos > 2 ? 'var(--fade-edge)' : '0px');
    el.style.setProperty('--fb', pos + size < full - 2 ? 'var(--fade-edge)' : '0px');
  }, [axis]);
  useEffect(sync);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener('scroll', sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', sync); ro.disconnect(); };
  }, [sync]);
  return ref;
}

function Fade({ axis = 'y', className = '', children, ...rest }) {
  const ref = useFade(axis);
  return <div ref={ref} className={'fade fade-' + axis + (className ? ' ' + className : '')} {...rest}>{children}</div>;
}

/* =========================================================================
   Иконки — Reicon, вес Filled (reicon.dev, MIT). Сетка 24×24,
   единственная заливка currentColor: цвет и размер задаёт вызов.
   ========================================================================= */
function Ico({ n, s = 20, cls }) {
  const p = { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true, className: cls };
  const F = { fill: 'currentColor' };
  switch (n) {
    case 'folder': return <svg {...p}><path fillRule="evenodd" clipRule="evenodd" d="M2.07 5.26C2 5.63 2 6.07 2 6.95V14C2 17.77 2 19.66 3.17 20.83C4.34 22 6.23 22 10 22H14C17.77 22 19.66 22 20.83 20.83C22 19.66 22 17.77 22 14V11.8C22 9.17 22 7.85 21.23 6.99C21.16 6.92 21.08 6.84 21.01 6.77C20.15 6 18.83 6 16.2 6H15.83C14.67 6 14.1 6 13.56 5.85C13.27 5.76 12.98 5.64 12.71 5.5C12.22 5.22 11.82 4.82 11 4L10.45 3.45C10.18 3.18 10.04 3.04 9.9 2.92C9.28 2.41 8.52 2.09 7.72 2.02C7.53 2 7.34 2 6.95 2C6.07 2 5.63 2 5.26 2.07C3.64 2.37 2.37 3.64 2.07 5.26ZM12.25 10C12.25 9.59 12.59 9.25 13 9.25H18C18.41 9.25 18.75 9.59 18.75 10C18.75 10.41 18.41 10.75 18 10.75H13C12.59 10.75 12.25 10.41 12.25 10Z" {...F} /></svg>;
    case 'folderOpen': return <svg {...p}><path d="M16.07 9.95C17.4 9.95 18.53 9.95 19.44 10.05C19.59 10.07 19.74 10.09 19.89 10.12C20.43 10.21 20.94 10.35 21.42 10.61V9.76C21.42 8.85 21.42 8.09 21.34 7.49C21.25 6.86 21.05 6.29 20.58 5.83C20.51 5.76 20.43 5.69 20.34 5.62C19.83 5.21 19.22 5.04 18.52 4.97C17.85 4.89 17.01 4.89 15.98 4.89L15.62 4.89C14.64 4.89 14.29 4.89 13.97 4.81C13.78 4.76 13.6 4.69 13.43 4.61C13.15 4.47 12.9 4.26 12.21 3.64L11.73 3.22C11.53 3.04 11.4 2.92 11.25 2.82C10.63 2.36 9.87 2.08 9.07 2.02C8.89 2 8.7 2 8.41 2L8.3 2C7.66 2 7.23 2 6.87 2.06C5.26 2.33 3.96 3.45 3.65 4.94C3.58 5.27 3.58 5.66 3.58 6.22L3.58 10.61C4.06 10.35 4.57 10.21 5.11 10.12C5.26 10.09 5.41 10.07 5.56 10.05C6.47 9.95 7.6 9.95 8.93 9.95H16.07Z" {...F} /><path fillRule="evenodd" clipRule="evenodd" d="M3.36 12.78C2.75 13.72 3 15.03 3.5 17.65C3.87 19.53 4.05 20.47 4.68 21.1C4.84 21.26 5.02 21.41 5.22 21.53C5.98 22 7 22 9.02 22H15.98C18 22 19.02 22 19.78 21.53C19.98 21.41 20.16 21.26 20.32 21.1C20.95 20.47 21.13 19.53 21.5 17.65C22 15.03 22.25 13.72 21.64 12.78C21.49 12.54 21.29 12.32 21.07 12.13C20.2 11.4 18.79 11.4 15.98 11.4H9.02C6.21 11.4 4.8 11.4 3.93 12.13C3.71 12.32 3.51 12.54 3.36 12.78ZM9.7 17.18C9.7 16.78 10.04 16.46 10.46 16.46H14.54C14.96 16.46 15.3 16.78 15.3 17.18C15.3 17.58 14.96 17.9 14.54 17.9H10.46C10.04 17.9 9.7 17.58 9.7 17.18Z" {...F} /></svg>;
    case 'file': return <svg {...p}><path fillRule="evenodd" clipRule="evenodd" d="M14 22H10C6.23 22 4.34 22 3.17 20.83C2 19.66 2 17.77 2 14V10C2 6.23 2 4.34 3.17 3.17C4.34 2 6.24 2 10.03 2C10.64 2 11.12 2 11.53 2.02C11.52 2.1 11.51 2.18 11.51 2.26L11.5 5.09C11.5 6.19 11.5 7.16 11.6 7.94C11.72 8.79 11.98 9.64 12.67 10.33C13.36 11.02 14.21 11.28 15.06 11.4C15.84 11.5 16.81 11.5 17.91 11.5L18 11.5H21.96C22 12.03 22 12.69 22 13.56V14C22 17.77 22 19.66 20.83 20.83C19.66 22 17.77 22 14 22Z" {...F} /><path d="M19.35 7.62L15.39 4.05C14.27 3.04 13.7 2.53 13.01 2.27L13 5C13 7.36 13 8.54 13.73 9.27C14.46 10 15.64 10 18 10H21.58C21.22 9.3 20.57 8.71 19.35 7.62Z" {...F} /></svg>;
    case 'code': return <svg {...p}><path d="M14.18 4.28C14.58 4.38 14.82 4.79 14.71 5.19L10.74 20.02C10.63 20.42 10.22 20.66 9.82 20.55C9.42 20.45 9.18 20.04 9.29 19.64L13.26 4.81C13.37 4.41 13.78 4.17 14.18 4.28Z" {...F} /><path d="M16.44 7.33C16.72 7.02 17.19 6.99 17.5 7.27L19.24 8.84C19.98 9.5 20.59 10.05 21.01 10.55C21.45 11.07 21.76 11.63 21.76 12.33C21.76 13.02 21.45 13.59 21.01 14.11C20.59 14.61 19.98 15.16 19.24 15.82L17.5 17.39C17.19 17.66 16.72 17.64 16.44 17.33C16.17 17.02 16.19 16.55 16.5 16.27L18.19 14.75C18.98 14.04 19.51 13.56 19.86 13.15C20.19 12.75 20.26 12.53 20.26 12.33C20.26 12.13 20.19 11.9 19.86 11.51C19.51 11.1 18.98 10.62 18.19 9.91L16.5 8.39C16.19 8.11 16.17 7.64 16.44 7.33Z" {...F} /><path d="M7.5 8.39C7.81 8.11 7.83 7.64 7.56 7.33C7.28 7.02 6.81 6.99 6.5 7.27L4.76 8.84C4.02 9.5 3.41 10.05 2.99 10.55C2.55 11.07 2.24 11.63 2.24 12.33C2.24 13.02 2.55 13.59 2.99 14.11C3.41 14.61 4.02 15.16 4.76 15.82L6.5 17.39C6.81 17.66 7.28 17.64 7.56 17.33C7.83 17.02 7.81 16.55 7.5 16.27L5.81 14.75C5.02 14.04 4.49 13.56 4.14 13.15C3.81 12.75 3.74 12.53 3.74 12.33C3.74 12.13 3.81 11.9 4.14 11.51C4.49 11.1 5.02 10.62 5.81 9.91L7.5 8.39Z" {...F} /></svg>;
    case 'terminal': return <svg {...p}><path d="M7.47 10.47C7.76 10.18 8.24 10.18 8.53 10.47L11.53 13.47C11.82 13.76 11.82 14.24 11.53 14.53L8.53 17.53C8.24 17.82 7.76 17.82 7.47 17.53C7.18 17.24 7.18 16.76 7.47 16.47L9.94 14L7.47 11.53C7.18 11.24 7.18 10.76 7.47 10.47Z" {...F} /> <path d="M12 16.25C11.59 16.25 11.25 16.59 11.25 17C11.25 17.41 11.59 17.75 12 17.75H17C17.41 17.75 17.75 17.41 17.75 17C17.75 16.59 17.41 16.25 17 16.25H12Z" {...F} /> <path fillRule="evenodd" clipRule="evenodd" d="M4.03 2.29C4.52 2.25 5.13 2.25 5.87 2.25H18.13C18.87 2.25 19.48 2.25 19.97 2.29C20.47 2.33 20.92 2.42 21.34 2.63C22 2.97 22.53 3.5 22.87 4.16C23.08 4.58 23.17 5.03 23.21 5.53C23.25 6.02 23.25 6.63 23.25 7.37V16.63C23.25 17.37 23.25 17.98 23.21 18.47C23.17 18.97 23.08 19.42 22.87 19.84C22.53 20.5 22 21.03 21.34 21.37C20.92 21.58 20.47 21.67 19.97 21.71C19.48 21.75 18.87 21.75 18.13 21.75H5.87C5.13 21.75 4.52 21.75 4.03 21.71C3.53 21.67 3.08 21.58 2.66 21.37C2 21.03 1.47 20.5 1.13 19.84C0.92 19.42 0.83 18.97 0.79 18.47C0.75 17.98 0.75 17.37 0.75 16.63V7.37C0.75 6.63 0.75 6.02 0.79 5.53C0.83 5.03 0.92 4.58 1.13 4.16C1.47 3.5 2 2.97 2.66 2.63C3.08 2.42 3.53 2.33 4.03 2.29ZM2.25 8.75V16.6C2.25 17.38 2.25 17.92 2.28 18.35C2.32 18.76 2.38 18.99 2.47 19.16C2.66 19.53 2.97 19.84 3.34 20.03C3.51 20.12 3.74 20.18 4.15 20.21C4.58 20.25 5.12 20.25 5.9 20.25H18.1C18.88 20.25 19.42 20.25 19.85 20.21C20.26 20.18 20.49 20.12 20.66 20.03C21.03 19.84 21.34 19.53 21.53 19.16C21.62 18.99 21.68 18.76 21.71 18.35C21.75 17.92 21.75 17.38 21.75 16.6V8.75H2.25Z" {...F} /></svg>;
    case 'git': return <svg {...p}><path d="M5.25 8.5C7.04 8.5 8.5 7.04 8.5 5.25C8.5 3.46 7.04 2 5.25 2C3.46 2 2 3.46 2 5.25C2 7.04 3.46 8.5 5.25 8.5Z" {...F} /><path d="M5 22C6.66 22 8 20.66 8 19C8 17.34 6.66 16 5 16C3.34 16 2 17.34 2 19C2 20.66 3.34 22 5 22Z" {...F} /><path d="M19 22C20.66 22 22 20.66 22 19C22 17.34 20.66 16 19 16C17.34 16 16 17.34 16 19C16 20.66 17.34 22 19 22Z" {...F} /><path d="M19.17 15.98C18.2 13.2 15.58 11.33 12.63 11.33C12.62 11.33 12.61 11.33 12.6 11.33L9.07 11.34C7.55 11.36 6.19 10.33 5.78 8.85V7.01C5.78 6.59 5.44 6.25 5.01 6.25C4.58 6.25 4.25 6.59 4.25 7.01V18.23C4.25 18.65 4.59 18.99 5.01 18.99C5.43 18.99 5.78 18.65 5.78 18.23V11.61C6.66 12.39 7.81 12.87 9.06 12.87C9.07 12.87 9.07 12.87 9.08 12.87L12.61 12.86C12.62 12.86 12.62 12.86 12.63 12.86C14.92 12.86 16.97 14.31 17.72 16.48C17.84 16.8 18.13 17 18.45 17C18.53 17 18.62 16.99 18.7 16.96C19.1 16.82 19.31 16.38 19.17 15.98Z" {...F} /></svg>;
    case 'sliders': return <svg {...p}><path d="M5 2.75C2.93 2.75 1.25 4.43 1.25 6.5C1.25 8.57 2.93 10.25 5 10.25C7.07 10.25 8.75 8.57 8.75 6.5C8.75 4.43 7.07 2.75 5 2.75Z" {...F} /> <path d="M13 7.25C12.59 7.25 12.25 6.91 12.25 6.5C12.25 6.09 12.59 5.75 13 5.75H22C22.41 5.75 22.75 6.09 22.75 6.5C22.75 6.91 22.41 7.25 22 7.25H13Z" {...F} /> <path d="M11 18.25C11.41 18.25 11.75 17.91 11.75 17.5C11.75 17.09 11.41 16.75 11 16.75H2C1.59 16.75 1.25 17.09 1.25 17.5C1.25 17.91 1.59 18.25 2 18.25H11Z" {...F} /> <path d="M19 13.75C16.93 13.75 15.25 15.43 15.25 17.5C15.25 19.57 16.93 21.25 19 21.25C21.07 21.25 22.75 19.57 22.75 17.5C22.75 15.43 21.07 13.75 19 13.75Z" {...F} /></svg>;
    case 'plus': return <svg {...p}><path d="M11 20C11 20.55 11.45 21 12 21C12.55 21 13 20.55 13 20V13H20C20.55 13 21 12.55 21 12C21 11.45 20.55 11 20 11H13V4C13 3.45 12.55 3 12 3C11.45 3 11 3.45 11 4V11H4C3.45 11 3 11.45 3 12C3 12.55 3.45 13 4 13H11V20Z" {...F} /></svg>;
    case 'minus': return <svg {...p}><path d="M21 12C21 12.55 20.55 13 20 13H4C3.45 13 3 12.55 3 12C3 11.45 3.45 11 4 11H20C20.55 11 21 11.45 21 12Z" {...F} /></svg>;
    case 'upload': return <svg {...p}><path fillRule="evenodd" clipRule="evenodd" d="M12 15.75C12.41 15.75 12.75 15.41 12.75 15V4.03L14.43 5.99C14.7 6.3 15.17 6.34 15.49 6.07C15.8 5.8 15.84 5.33 15.57 5.01L12.57 1.51C12.43 1.35 12.22 1.25 12 1.25C11.78 1.25 11.57 1.35 11.43 1.51L8.43 5.01C8.16 5.33 8.2 5.8 8.51 6.07C8.83 6.34 9.3 6.3 9.57 5.99L11.25 4.03L11.25 15C11.25 15.41 11.59 15.75 12 15.75Z" {...F} /><path d="M16 9C15.3 9 14.95 9 14.69 9.17C14.59 9.24 14.49 9.34 14.42 9.44C14.25 9.7 14.25 10.05 14.25 10.75L14.25 15C14.25 16.24 13.24 17.25 12 17.25C10.76 17.25 9.75 16.24 9.75 15L9.75 10.75C9.75 10.05 9.75 9.7 9.58 9.44C9.51 9.34 9.41 9.24 9.31 9.17C9.05 9 8.7 9 8 9C5.17 9 3.76 9 2.88 9.88C2 10.76 2 12.17 2 15V16C2 18.83 2 20.24 2.88 21.12C3.76 22 5.17 22 8 22H16C18.83 22 20.24 22 21.12 21.12C22 20.24 22 18.83 22 16V15C22 12.17 22 10.76 21.12 9.88C20.24 9 18.83 9 16 9Z" {...F} /></svg>;
    case 'download': return <svg {...p}><path fillRule="evenodd" clipRule="evenodd" d="M12 1.25C11.59 1.25 11.25 1.59 11.25 2V12.97L9.57 11.01C9.3 10.7 8.83 10.66 8.51 10.93C8.2 11.2 8.16 11.67 8.43 11.99L11.43 15.49C11.57 15.65 11.78 15.75 12 15.75C12.22 15.75 12.43 15.65 12.57 15.49L15.57 11.99C15.84 11.67 15.8 11.2 15.49 10.93C15.17 10.66 14.7 10.7 14.43 11.01L12.75 12.97L12.75 2C12.75 1.59 12.41 1.25 12 1.25Z" {...F} /><path d="M14.25 9V9.38C14.98 9.12 15.83 9.25 16.46 9.79C17.41 10.6 17.52 12.02 16.71 12.96L13.71 16.46C13.28 16.96 12.66 17.25 12 17.25C11.34 17.25 10.72 16.96 10.29 16.46L7.29 12.96C6.48 12.02 6.59 10.6 7.54 9.79C8.17 9.25 9.02 9.12 9.75 9.38V9H8C5.17 9 3.76 9 2.88 9.88C2 10.76 2 12.17 2 15V16C2 18.83 2 20.24 2.88 21.12C3.76 22 5.17 22 8 22H16C18.83 22 20.24 22 21.12 21.12C22 20.24 22 18.83 22 16V15C22 12.17 22 10.76 21.12 9.88C20.24 9 18.83 9 16 9H14.25Z" {...F} /></svg>;
    case 'search': return <svg {...p}><path d="M11.01 20.02C15.99 20.02 20.02 15.99 20.02 11.01C20.02 6.03 15.99 2 11.01 2C6.03 2 2 6.03 2 11.01C2 15.99 6.03 20.02 11.01 20.02Z" {...F} /><path d="M21.99 18.95C21.66 18.34 20.96 18 20.02 18C19.31 18 18.7 18.29 18.34 18.79C17.98 19.29 17.9 19.96 18.12 20.63C18.55 21.93 19.3 22.22 19.71 22.27C19.77 22.28 19.83 22.28 19.9 22.28C20.34 22.28 21.02 22.09 21.68 21.1C22.21 20.33 22.31 19.56 21.99 18.95Z" {...F} /></svg>;
    case 'chev': return <svg {...p}><path d="M 17.71 11.29 L 9.37 2.96 c -0.39 -0.39 -1.02 -0.39 -1.41 0 s -0.39 1.02 0 1.41 l 7.63 7.63 -7.63 7.63 c -0.39 0.39 -0.39 1.02 0 1.41 0.19 0.19 0.45 0.29 0.71 0.29 s 0.51 -0.1 0.71 -0.29 l 8.33 -8.33 c 0.39 -0.39 0.39 -1.02 0 -1.41 Z" {...F}></path></svg>;
    case 'chevDown': return <svg {...p}><path d="M 12 18 c -0.26 0 -0.51 -0.1 -0.71 -0.29 L 2.96 9.37 c -0.39 -0.39 -0.39 -1.02 0 -1.41 s 1.02 -0.39 1.41 0 l 7.63 7.63 7.63 -7.63 c 0.39 -0.39 1.02 -0.39 1.41 0 s 0.39 1.02 0 1.41 l -8.33 8.33 c -0.19 0.19 -0.45 0.29 -0.71 0.29 Z" {...F}></path></svg>;
    case 'check': return <svg {...p}><path d="M21.71 5.29C22.1 5.68 22.1 6.32 21.71 6.71L9.71 18.71C9.32 19.1 8.68 19.1 8.29 18.71L2.29 12.71C1.9 12.32 1.9 11.68 2.29 11.29C2.68 10.9 3.32 10.9 3.71 11.29L9 16.59L20.29 5.29C20.68 4.9 21.32 4.9 21.71 5.29Z" {...F} /></svg>;
    case 'x': return <svg {...p}><path d="M 5.33 19.67 c -0.26 0 -0.51 -0.1 -0.71 -0.29 -0.39 -0.39 -0.39 -1.02 0 -1.41 L 17.96 4.63 c 0.39 -0.39 1.02 -0.39 1.41 0 s 0.39 1.02 0 1.41 L 6.04 19.37 c -0.19 0.19 -0.45 0.29 -0.71 0.29 Z" {...F}></path><path d="M 18.67 19.67 c -0.26 0 -0.51 -0.1 -0.71 -0.29 L 4.63 6.04 c -0.39 -0.39 -0.39 -1.02 0 -1.41 s 1.02 -0.39 1.41 0 L 19.37 17.96 c 0.39 0.39 0.39 1.02 0 1.41 -0.19 0.19 -0.45 0.29 -0.71 0.29 Z" {...F}></path></svg>;
    case 'trash': return <svg {...p}><path d="M2.75 6.17C2.75 5.71 3.1 5.33 3.52 5.33L6.19 5.33C6.72 5.32 7.18 4.95 7.36 4.42C7.37 4.4 7.37 4.39 7.39 4.32L7.51 3.95C7.58 3.72 7.64 3.52 7.72 3.35C8.06 2.64 8.69 2.16 9.41 2.03C9.59 2 9.79 2 10.01 2H13.49C13.71 2 13.91 2 14.09 2.03C14.81 2.16 15.44 2.64 15.78 3.35C15.86 3.52 15.92 3.72 15.99 3.95L16.11 4.32C16.13 4.39 16.13 4.4 16.14 4.42C16.32 4.95 16.88 5.32 17.41 5.33H19.98C20.4 5.33 20.75 5.71 20.75 6.17C20.75 6.63 20.4 7 19.98 7H3.52C3.1 7 2.75 6.63 2.75 6.17Z" {...F} /><path d="M11.61 22H12.39C15.1 22 16.45 22 17.34 21.14C18.22 20.27 18.31 18.86 18.49 16.03L18.75 11.95C18.84 10.41 18.89 9.64 18.45 9.15C18.01 8.67 17.26 8.67 15.77 8.67H8.23C6.74 8.67 5.99 8.67 5.55 9.15C5.11 9.64 5.16 10.41 5.26 11.95L5.51 16.03C5.7 18.86 5.79 20.27 6.67 21.14C7.55 22 8.9 22 11.61 22Z" {...F} /></svg>;
    case 'play': return <svg {...p}><path d="M21.41 9.35C23.53 10.51 23.53 13.49 21.41 14.65L8.6 21.61C6.53 22.74 4 21.28 4 18.97L4 5.03C4 2.72 6.53 1.26 8.6 2.39L21.41 9.35Z" {...F} /></svg>;
    case 'stop': return <svg {...p}><path d="M2 12C2 7.29 2 4.93 3.46 3.46C4.93 2 7.29 2 12 2C16.71 2 19.07 2 20.54 3.46C22 4.93 22 7.29 22 12C22 16.71 22 19.07 20.54 20.54C19.07 22 16.71 22 12 22C7.29 22 4.93 22 3.46 20.54C2 19.07 2 16.71 2 12Z" {...F} /></svg>;
    case 'sun': return <svg {...p}><path d="M18 12C18 15.31 15.31 18 12 18C8.69 18 6 15.31 6 12C6 8.69 8.69 6 12 6C15.31 6 18 8.69 18 12Z" {...F} /><path fillRule="evenodd" clipRule="evenodd" d="M12 1.25C12.41 1.25 12.75 1.59 12.75 2V3C12.75 3.41 12.41 3.75 12 3.75C11.59 3.75 11.25 3.41 11.25 3V2C11.25 1.59 11.59 1.25 12 1.25ZM4.4 4.4C4.69 4.11 5.17 4.11 5.46 4.4L5.85 4.79C6.14 5.08 6.14 5.56 5.85 5.85C5.56 6.14 5.08 6.14 4.79 5.85L4.4 5.46C4.11 5.17 4.11 4.69 4.4 4.4ZM19.6 4.4C19.89 4.69 19.89 5.17 19.6 5.46L19.21 5.85C18.92 6.15 18.44 6.15 18.15 5.85C17.85 5.56 17.85 5.08 18.15 4.79L18.54 4.4C18.83 4.11 19.31 4.11 19.6 4.4ZM1.25 12C1.25 11.59 1.59 11.25 2 11.25H3C3.41 11.25 3.75 11.59 3.75 12C3.75 12.41 3.41 12.75 3 12.75H2C1.59 12.75 1.25 12.41 1.25 12ZM20.25 12C20.25 11.59 20.59 11.25 21 11.25H22C22.41 11.25 22.75 11.59 22.75 12C22.75 12.41 22.41 12.75 22 12.75H21C20.59 12.75 20.25 12.41 20.25 12ZM18.15 18.15C18.44 17.85 18.92 17.85 19.21 18.15L19.6 18.54C19.89 18.83 19.89 19.31 19.6 19.6C19.31 19.89 18.83 19.89 18.54 19.6L18.15 19.21C17.85 18.92 17.85 18.44 18.15 18.15ZM5.85 18.15C6.14 18.44 6.14 18.92 5.85 19.21L5.46 19.6C5.17 19.89 4.69 19.89 4.4 19.6C4.11 19.31 4.11 18.83 4.4 18.54L4.79 18.15C5.08 17.86 5.56 17.86 5.85 18.15ZM12 20.25C12.41 20.25 12.75 20.59 12.75 21V22C12.75 22.41 12.41 22.75 12 22.75C11.59 22.75 11.25 22.41 11.25 22V21C11.25 20.59 11.59 20.25 12 20.25Z" {...F} /></svg>;
    case 'moon': return <svg {...p}><path d="M12 22C17.52 22 22 17.52 22 12C22 11.54 21.31 11.46 21.07 11.86C19.93 13.74 17.86 15 15.5 15C11.91 15 9 12.09 9 8.5C9 6.14 10.26 4.07 12.14 2.93C12.54 2.69 12.46 2 12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22Z" {...F} /></svg>;
    case 'panel': return <svg {...p}><path d="M22 11V13C22 16.77 22 18.66 20.83 19.83C19.85 20.8 18.39 20.97 15.75 20.99V3.01C18.39 3.03 19.85 3.2 20.83 4.17C22 5.34 22 7.23 22 11Z" {...F} /><path fillRule="evenodd" clipRule="evenodd" d="M10 3H14H14.25L14.25 21H14H10C6.23 21 4.34 21 3.17 19.83C2 18.66 2 16.77 2 13V11C2 7.23 2 5.34 3.17 4.17C4.34 3 6.23 3 10 3ZM4.75 10C4.75 9.59 5.09 9.25 5.5 9.25H11.5C11.91 9.25 12.25 9.59 12.25 10C12.25 10.41 11.91 10.75 11.5 10.75H5.5C5.09 10.75 4.75 10.41 4.75 10ZM5.75 14C5.75 13.59 6.09 13.25 6.5 13.25H10.5C10.91 13.25 11.25 13.59 11.25 14C11.25 14.41 10.91 14.75 10.5 14.75H6.5C6.09 14.75 5.75 14.41 5.75 14Z" {...F} /></svg>;
    case 'back': return <svg {...p}><path d="M20 11.25C20.41 11.25 20.75 11.59 20.75 12C20.75 12.41 20.41 12.75 20 12.75H10.75L10.75 18C10.75 18.3 10.57 18.58 10.29 18.69C10.01 18.81 9.68 18.74 9.47 18.53L3.47 12.53C3.33 12.39 3.25 12.2 3.25 12C3.25 11.8 3.33 11.61 3.47 11.47L9.47 5.47C9.68 5.26 10.01 5.19 10.29 5.31C10.57 5.42 10.75 5.7 10.75 6L10.75 11.25H20Z" {...F} /></svg>;
    case 'copy': return <svg {...p}><path d="M15.24 2H11.35C9.58 2 8.18 2 7.09 2.15C5.97 2.3 5.05 2.62 4.34 3.34C3.62 4.06 3.3 4.98 3.15 6.11C3 7.21 3 8.61 3 10.38V16.22C3 17.73 3.92 19.02 5.23 19.56C5.16 18.65 5.16 17.37 5.16 16.31L5.16 11.4L5.16 11.3C5.16 10.02 5.16 8.92 5.28 8.03C5.41 7.08 5.69 6.18 6.43 5.44C7.16 4.7 8.06 4.41 9.01 4.29C9.89 4.17 10.99 4.17 12.27 4.17L12.36 4.17H15.24L15.33 4.17C16.61 4.17 17.71 4.17 18.59 4.29C18.06 2.95 16.76 2 15.24 2Z" {...F} /><path d="M6.6 11.4C6.6 8.67 6.6 7.31 7.44 6.46C8.29 5.61 9.64 5.61 12.36 5.61H15.24C17.96 5.61 19.31 5.61 20.16 6.46C21 7.31 21 8.67 21 11.4V16.22C21 18.94 21 20.31 20.16 21.15C19.31 22 17.96 22 15.24 22H12.36C9.64 22 8.29 22 7.44 21.15C6.6 20.31 6.6 18.94 6.6 16.22V11.4Z" {...F} /></svg>;
    case 'pen': return <svg {...p}><path d="M21 22H3C2.59 22 2.25 21.66 2.25 21.25C2.25 20.84 2.59 20.5 3 20.5H21C21.41 20.5 21.75 20.84 21.75 21.25C21.75 21.66 21.41 22 21 22Z" {...F} /><path d="M19.02 3.48C17.08 1.54 15.18 1.49 13.19 3.48L11.98 4.69C11.88 4.79 11.84 4.95 11.88 5.09C12.64 7.74 14.76 9.86 17.41 10.62C17.45 10.63 17.49 10.64 17.53 10.64C17.64 10.64 17.74 10.6 17.82 10.52L19.02 9.31C20.01 8.33 20.49 7.38 20.49 6.42C20.5 5.43 20.02 4.47 19.02 3.48Z" {...F} /><path d="M15.61 11.53C15.32 11.39 15.04 11.25 14.77 11.09C14.55 10.96 14.34 10.82 14.13 10.67C13.96 10.56 13.76 10.4 13.57 10.24C13.55 10.23 13.48 10.17 13.4 10.09C13.07 9.81 12.7 9.45 12.37 9.05C12.34 9.03 12.29 8.96 12.22 8.87C12.12 8.75 11.95 8.55 11.8 8.32C11.68 8.17 11.54 7.95 11.41 7.73C11.25 7.46 11.11 7.19 10.97 6.91C10.95 6.87 10.93 6.82 10.91 6.78C10.76 6.44 10.33 6.34 10.07 6.6L4.34 12.33C4.21 12.46 4.09 12.71 4.06 12.88L3.52 16.71C3.42 17.39 3.61 18.03 4.03 18.46C4.39 18.81 4.89 19 5.43 19C5.55 19 5.67 18.99 5.79 18.97L9.63 18.43C9.81 18.4 10.06 18.28 10.18 18.15L15.9 12.43C16.16 12.17 16.06 11.72 15.73 11.58C15.69 11.56 15.65 11.55 15.61 11.53Z" {...F} /></svg>;
    case 'dots': return <svg {...p}><path d="M7 12C7 13.1 6.1 14 5 14C3.9 14 3 13.1 3 12C3 10.9 3.9 10 5 10C6.1 10 7 10.9 7 12Z" {...F} /><path d="M14 12C14 13.1 13.1 14 12 14C10.9 14 10 13.1 10 12C10 10.9 10.9 10 12 10C13.1 10 14 10.9 14 12Z" {...F} /><path d="M21 12C21 13.1 20.1 14 19 14C17.9 14 17 13.1 17 12C17 10.9 17.9 10 19 10C20.1 10 21 10.9 21 12Z" {...F} /></svg>;
    case 'grid': return <svg {...p}><path d="M7.63 1.25H4.37C3.98 1.25 3.63 1.25 3.35 1.27C3.06 1.3 2.76 1.35 2.48 1.5C2.06 1.71 1.71 2.06 1.5 2.48C1.35 2.76 1.3 3.06 1.27 3.35C1.25 3.63 1.25 3.98 1.25 4.37V7.63C1.25 8.02 1.25 8.37 1.27 8.65C1.3 8.94 1.35 9.24 1.5 9.52C1.71 9.94 2.06 10.29 2.48 10.5C2.76 10.65 3.06 10.7 3.35 10.73C3.63 10.75 3.98 10.75 4.37 10.75H7.63C8.02 10.75 8.37 10.75 8.65 10.73C8.94 10.7 9.24 10.65 9.52 10.5C9.94 10.29 10.29 9.94 10.5 9.52C10.65 9.24 10.7 8.94 10.73 8.65C10.75 8.37 10.75 8.02 10.75 7.63V4.37C10.75 3.98 10.75 3.63 10.73 3.35C10.7 3.06 10.65 2.76 10.5 2.48C10.29 2.06 9.94 1.71 9.52 1.5C9.24 1.35 8.94 1.3 8.65 1.27C8.37 1.25 8.02 1.25 7.63 1.25Z" {...F} /> <path d="M19.63 1.25H16.37C15.98 1.25 15.63 1.25 15.35 1.27C15.06 1.3 14.76 1.35 14.48 1.5C14.06 1.71 13.71 2.06 13.5 2.48C13.35 2.76 13.3 3.06 13.27 3.35C13.25 3.63 13.25 3.98 13.25 4.37V7.63C13.25 8.02 13.25 8.37 13.27 8.65C13.3 8.94 13.35 9.24 13.5 9.52C13.71 9.94 14.06 10.29 14.48 10.5C14.76 10.65 15.06 10.7 15.35 10.73C15.63 10.75 15.98 10.75 16.37 10.75H19.63C20.02 10.75 20.37 10.75 20.65 10.73C20.94 10.7 21.24 10.65 21.52 10.5C21.94 10.29 22.29 9.94 22.5 9.52C22.65 9.24 22.7 8.94 22.73 8.65C22.75 8.37 22.75 8.02 22.75 7.63V4.37C22.75 3.98 22.75 3.63 22.73 3.35C22.7 3.06 22.65 2.76 22.5 2.48C22.29 2.06 21.94 1.71 21.52 1.5C21.24 1.35 20.94 1.3 20.65 1.27C20.37 1.25 20.02 1.25 19.63 1.25Z" {...F} /> <path d="M19.63 13.25H16.37C15.98 13.25 15.63 13.25 15.35 13.27C15.06 13.3 14.76 13.35 14.48 13.5C14.06 13.71 13.71 14.06 13.5 14.48C13.35 14.76 13.3 15.06 13.27 15.35C13.25 15.63 13.25 15.98 13.25 16.37V19.63C13.25 20.02 13.25 20.37 13.27 20.65C13.3 20.94 13.35 21.24 13.5 21.52C13.71 21.94 14.06 22.29 14.48 22.5C14.76 22.65 15.06 22.7 15.35 22.73C15.63 22.75 15.98 22.75 16.37 22.75H19.63C20.02 22.75 20.37 22.75 20.65 22.73C20.94 22.7 21.24 22.65 21.52 22.5C21.94 22.29 22.29 21.94 22.5 21.52C22.65 21.24 22.7 20.94 22.73 20.65C22.75 20.37 22.75 20.02 22.75 19.63V16.37C22.75 15.98 22.75 15.63 22.73 15.35C22.7 15.06 22.65 14.76 22.5 14.48C22.29 14.06 21.94 13.71 21.52 13.5C21.24 13.35 20.94 13.3 20.65 13.27C20.37 13.25 20.02 13.25 19.63 13.25Z" {...F} /> <path d="M7.63 13.25H4.37C3.98 13.25 3.63 13.25 3.35 13.27C3.06 13.3 2.76 13.35 2.48 13.5C2.06 13.71 1.71 14.06 1.5 14.48C1.35 14.76 1.3 15.06 1.27 15.35C1.25 15.63 1.25 15.98 1.25 16.37V19.63C1.25 20.02 1.25 20.37 1.27 20.65C1.3 20.94 1.35 21.24 1.5 21.52C1.71 21.94 2.06 22.29 2.48 22.5C2.76 22.65 3.06 22.7 3.35 22.73C3.63 22.75 3.98 22.75 4.37 22.75H7.63C8.02 22.75 8.37 22.75 8.65 22.73C8.94 22.7 9.24 22.65 9.52 22.5C9.94 22.29 10.29 21.94 10.5 21.52C10.65 21.24 10.7 20.94 10.73 20.65C10.75 20.37 10.75 20.02 10.75 19.63V16.37C10.75 15.98 10.75 15.63 10.73 15.35C10.7 15.06 10.65 14.76 10.5 14.48C10.29 14.06 9.94 13.71 9.52 13.5C9.24 13.35 8.94 13.3 8.65 13.27C8.37 13.25 8.02 13.25 7.63 13.25Z" {...F} /></svg>;
    case 'shield': return <svg {...p}><path d="M11.25 2.07C10.64 2.19 9.93 2.43 8.84 2.8L8.26 3C5.26 4.03 3.76 4.54 3.38 5.08C3.01 5.61 3 7.15 3 10.21L11.25 7.46V2.07Z" {...F} /><path d="M11.25 9.04L3 11.79V11.99C3 17.63 7.24 20.37 9.9 21.53C10.41 21.75 10.74 21.89 11.25 21.96V9.04Z" {...F} /><path d="M12.75 21.96V9.04L21 11.79V11.99C21 17.63 16.76 20.37 14.1 21.53C13.59 21.75 13.26 21.89 12.75 21.96Z" {...F} /><path d="M12.75 7.46V2.07C13.36 2.19 14.07 2.43 15.16 2.8L15.74 3C18.74 4.03 20.25 4.54 20.62 5.08C20.99 5.61 21 7.15 21 10.21L12.75 7.46Z" {...F} /></svg>;
    case 'save': return <svg {...p}><path fillRule="evenodd" clipRule="evenodd" d="M20.54 20.54C22 19.07 22 16.71 22 12C22 11.66 22 11.49 21.98 11.31C21.91 10.5 21.59 9.71 21.06 9.09C20.95 8.96 20.83 8.83 20.58 8.59L15.41 3.42C15.17 3.17 15.04 3.05 14.91 2.94C14.29 2.41 13.5 2.09 12.69 2.02C12.51 2 12.34 2 12 2C7.29 2 4.93 2 3.46 3.46C2 4.93 2 7.29 2 12C2 16.71 2 19.07 3.46 20.54C4.15 21.22 5.03 21.58 6.25 21.78L6.25 20.95C6.25 20.05 6.25 19.3 6.33 18.71C6.41 18.08 6.6 17.51 7.06 17.06C7.51 16.6 8.08 16.41 8.71 16.33C9.3 16.25 10.05 16.25 10.95 16.25H13.05C13.95 16.25 14.7 16.25 15.29 16.33C15.92 16.41 16.49 16.6 16.94 17.06C17.4 17.51 17.59 18.08 17.67 18.71C17.75 19.3 17.75 20.05 17.75 20.95L17.75 21.78C18.97 21.58 19.85 21.22 20.54 20.54ZM6.25 8C6.25 7.59 6.59 7.25 7 7.25H13C13.41 7.25 13.75 7.59 13.75 8C13.75 8.41 13.41 8.75 13 8.75H7C6.59 8.75 6.25 8.41 6.25 8Z" {...F} /><path d="M16.18 18.91C16.25 19.39 16.25 20.04 16.25 21V21.93C15.09 22 13.7 22 12 22C10.3 22 8.91 22 7.75 21.93V21C7.75 20.04 7.75 19.39 7.82 18.91C7.88 18.44 7.99 18.25 8.12 18.12C8.25 17.99 8.44 17.88 8.91 17.82C9.39 17.75 10.04 17.75 11 17.75H13C13.96 17.75 14.61 17.75 15.09 17.82C15.56 17.88 15.75 17.99 15.88 18.12C16.01 18.25 16.12 18.44 16.18 18.91Z" {...F} /></svg>;
    case 'wrapTxt': return <svg {...p}><path d="M12 5.25H3C2.59 5.25 2.25 4.91 2.25 4.5C2.25 4.09 2.59 3.75 3 3.75H12C12.41 3.75 12.75 4.09 12.75 4.5C12.75 4.91 12.41 5.25 12 5.25Z" {...F} /><path d="M12 10.25H3C2.59 10.25 2.25 9.91 2.25 9.5C2.25 9.09 2.59 8.75 3 8.75H12C12.41 8.75 12.75 9.09 12.75 9.5C12.75 9.91 12.41 10.25 12 10.25Z" {...F} /><path d="M21 15.25H3C2.59 15.25 2.25 14.91 2.25 14.5C2.25 14.09 2.59 13.75 3 13.75H21C21.41 13.75 21.75 14.09 21.75 14.5C21.75 14.91 21.41 15.25 21 15.25Z" {...F} /><path d="M21 20.25H3C2.59 20.25 2.25 19.91 2.25 19.5C2.25 19.09 2.59 18.75 3 18.75H21C21.41 18.75 21.75 19.09 21.75 19.5C21.75 19.91 21.41 20.25 21 20.25Z" {...F} /></svg>;
    case 'refresh': return <svg {...p}><path d="M12.08 2.25C7.29 2.25 3.34 5.91 2.96 10.58H2C1.7 10.58 1.42 10.77 1.31 11.05C1.19 11.33 1.26 11.65 1.47 11.87L3.15 13.53C3.44 13.82 3.92 13.82 4.21 13.53L5.89 11.87C6.1 11.65 6.17 11.33 6.05 11.05C5.94 10.77 5.66 10.58 5.36 10.58H4.47C4.85 6.75 8.1 3.75 12.08 3.75C14.85 3.75 17.27 5.21 18.62 7.39C18.83 7.75 19.29 7.86 19.65 7.64C20 7.42 20.11 6.96 19.89 6.61C18.29 3.99 15.39 2.25 12.08 2.25Z" {...F} /><path d="M20.84 10.47C20.55 10.18 20.08 10.18 19.79 10.47L18.1 12.13C17.88 12.35 17.82 12.67 17.93 12.95C18.05 13.23 18.32 13.42 18.63 13.42H19.53C19.15 17.25 15.88 20.25 11.88 20.25C9.1 20.25 6.67 18.79 5.32 16.61C5.1 16.25 4.64 16.14 4.29 16.36C3.93 16.58 3.82 17.04 4.04 17.39C5.65 20.01 8.56 21.75 11.88 21.75C16.69 21.75 20.65 18.09 21.03 13.42H22C22.3 13.42 22.58 13.23 22.69 12.95C22.81 12.67 22.74 12.35 22.53 12.13L20.84 10.47Z" {...F} /></svg>;
    case 'info': return <svg {...p}><path fillRule="evenodd" clipRule="evenodd" d="M22 12C22 17.52 17.52 22 12 22C6.48 22 2 17.52 2 12C2 6.48 6.48 2 12 2C17.52 2 22 6.48 22 12ZM12 17.75C12.41 17.75 12.75 17.41 12.75 17V11C12.75 10.59 12.41 10.25 12 10.25C11.59 10.25 11.25 10.59 11.25 11V17C11.25 17.41 11.59 17.75 12 17.75ZM12 7C12.55 7 13 7.45 13 8C13 8.55 12.55 9 12 9C11.45 9 11 8.55 11 8C11 7.45 11.45 7 12 7Z" {...F} /></svg>;
    case 'warn': return <svg {...p}><path d="M21.76 15.92L15.36 4.4C14.5 2.85 13.31 2 12 2C10.69 2 9.5 2.85 8.64 4.4L2.24 15.92C1.43 17.39 1.34 18.8 1.99 19.91C2.64 21.02 3.92 21.63 5.6 21.63H18.4C20.08 21.63 21.36 21.02 22.01 19.91C22.66 18.8 22.57 17.38 21.76 15.92ZM11.25 9C11.25 8.59 11.59 8.25 12 8.25C12.41 8.25 12.75 8.59 12.75 9V14C12.75 14.41 12.41 14.75 12 14.75C11.59 14.75 11.25 14.41 11.25 14V9ZM12.71 17.71C12.66 17.75 12.61 17.79 12.56 17.83C12.5 17.87 12.44 17.9 12.38 17.92C12.32 17.95 12.26 17.97 12.19 17.98C12.13 17.99 12.06 18 12 18C11.94 18 11.87 17.99 11.8 17.98C11.74 17.97 11.68 17.95 11.62 17.92C11.56 17.9 11.5 17.87 11.44 17.83C11.39 17.79 11.34 17.75 11.29 17.71C11.11 17.52 11 17.26 11 17C11 16.74 11.11 16.48 11.29 16.29C11.34 16.25 11.39 16.21 11.44 16.17C11.5 16.13 11.56 16.1 11.62 16.08C11.68 16.05 11.74 16.03 11.8 16.02C11.93 15.99 12.07 15.99 12.19 16.02C12.26 16.03 12.32 16.05 12.38 16.08C12.44 16.1 12.5 16.13 12.56 16.17C12.61 16.21 12.66 16.25 12.71 16.29C12.89 16.48 13 16.74 13 17C13 17.26 12.89 17.52 12.71 17.71Z" {...F} /></svg>;
    case 'cube': return <svg {...p}><path d="M17.58 4.43L15.58 3.38C13.82 2.46 12.94 2 12 2C11.06 2 10.18 2.46 8.42 3.38L8.1 3.55L17.02 8.65L21.04 6.64C20.39 5.91 19.35 5.36 17.58 4.43Z" {...F} /><path d="M21.75 7.96L17.75 9.96V13C17.75 13.41 17.41 13.75 17 13.75C16.59 13.75 16.25 13.41 16.25 13V10.71L12.75 12.46V21.9C13.47 21.73 14.28 21.3 15.58 20.62L17.58 19.57C19.73 18.44 20.81 17.87 21.4 16.86C22 15.85 22 14.58 22 12.06V11.94C22 10.05 22 8.87 21.75 7.96Z" {...F} /><path d="M11.25 21.9V12.46L2.25 7.96C2 8.87 2 10.05 2 11.94V12.06C2 14.58 2 15.85 2.6 16.86C3.19 17.87 4.27 18.44 6.42 19.57L8.42 20.62C9.72 21.3 10.53 21.73 11.25 21.9Z" {...F} /><path d="M2.96 6.64L12 11.16L15.41 9.46L6.52 4.38L6.42 4.43C4.65 5.36 3.61 5.91 2.96 6.64Z" {...F} /></svg>;
    case 'lang': return <svg {...p}><path d="M8 2C8.55 2 9 2.45 9 3V4H11.98C11.99 4 12.01 4 12.02 4H14C14.55 4 15 4.45 15 5C15 5.55 14.55 6 14 6H12.79C12.27 8.03 11.5 9.75 10.29 11.3C10.04 11.61 9.78 11.92 9.49 12.21C10.33 12.86 11.31 13.49 12.48 14.12C12.96 14.39 13.14 14.99 12.88 15.48C12.61 15.96 12.01 16.14 11.52 15.88C10.16 15.14 9 14.38 8 13.58C7 14.38 5.84 15.14 4.48 15.88C3.99 16.14 3.39 15.96 3.12 15.48C2.86 14.99 3.04 14.39 3.52 14.12C4.69 13.48 5.67 12.86 6.51 12.21C5.71 11.37 5.06 10.47 4.52 9.47C4.26 8.98 4.45 8.38 4.93 8.12C5.42 7.86 6.03 8.04 6.29 8.53C6.74 9.37 7.29 10.15 8 10.88C8.26 10.62 8.49 10.34 8.71 10.06C9.62 8.9 10.26 7.6 10.72 6H2C1.45 6 1 5.55 1 5C1 4.45 1.45 4 2 4H7V3C7 2.45 7.45 2 8 2Z" {...F} /> <path fillRule="evenodd" clipRule="evenodd" d="M17.5 10C17.89 10 18.25 10.23 18.41 10.59L21.55 17.57L21.56 17.59L21.57 17.6L21.57 17.61L22.91 20.59C23.14 21.09 22.91 21.69 22.41 21.91C21.91 22.14 21.31 21.91 21.09 21.41L20 19H15L13.91 21.41C13.69 21.91 13.09 22.14 12.59 21.91C12.09 21.69 11.86 21.09 12.09 20.59L13.43 17.61C13.43 17.6 13.44 17.58 13.45 17.57L16.59 10.59C16.75 10.23 17.11 10 17.5 10ZM15.9 17H19.1L17.5 13.44L15.9 17Z" {...F} /></svg>;
    default: return <svg {...p} />;
  }
}

/* =========================================================================
   Подсветка синтаксиса
   ========================================================================= */
const W = (s) => new Set(s.split(' '));
const JS_KW = 'const let var function return if else for while do switch case break continue new class extends super this typeof instanceof in of async await try catch finally throw import export from default delete void yield static get set null undefined true false';
const TS_TY = 'string number boolean any unknown never void object symbol bigint Array Promise Record Partial Readonly Map Set interface type enum implements declare namespace public private protected readonly abstract';
const LANGS = {
  js: { label: 'JavaScript', kw: W(JS_KW), ty: W('console window document Math JSON Object Array String Number Boolean Promise Map Set Date RegExp React useState useEffect'), line: '//', block: ['/*', '*/'], str: '"\'`' },
  ts: { label: 'TypeScript', kw: W(JS_KW + ' ' + 'as satisfies keyof infer'), ty: W(TS_TY), line: '//', block: ['/*', '*/'], str: '"\'`' },
  tsx: { label: 'TSX', kw: W(JS_KW + ' as keyof'), ty: W(TS_TY + ' React JSX'), line: '//', block: ['/*', '*/'], str: '"\'`', jsx: true },
  py: { label: 'Python', kw: W('def class return if elif else for while in is not and or import from as pass break continue with try except finally raise lambda global nonlocal yield assert del async await True False None self match case'), ty: W('int str float bool list dict set tuple bytes print len range open enumerate zip map filter super Exception ValueError TypeError'), line: '#', str: '"\'' },
  go: { label: 'Go', kw: W('package import func return if else for range switch case default break continue go defer chan select var const type struct interface map make new nil true false fallthrough goto'), ty: W('string int int64 int32 float64 byte rune bool error any uint uint8 context http fmt time sync'), line: '//', block: ['/*', '*/'], str: '"`' },
  rs: { label: 'Rust', kw: W('fn let mut const static struct enum impl trait for while loop if else match return use pub mod crate self super as ref move where unsafe async await dyn type in break continue true false'), ty: W('String str Vec Option Some None Result Ok Err u8 u16 u32 u64 i8 i32 i64 f32 f64 bool usize isize HashMap Box Arc Rc'), line: '//', block: ['/*', '*/'], str: '"' },
  java: { label: 'Java', kw: W('public private protected class interface extends implements static final void return if else for while do switch case break continue new this super try catch finally throw throws import package abstract synchronized enum instanceof null true false var record'), ty: W('String int long double float boolean byte char List Map Set ArrayList HashMap Optional Integer Object Exception System'), line: '//', block: ['/*', '*/'], str: '"\'' },
  kt: { label: 'Kotlin', kw: W('fun val var class object interface data sealed override return if else when for while do break continue import package private public internal suspend companion init constructor is as in out null true false by lateinit'), ty: W('String Int Long Double Float Boolean List Map Set MutableList Any Unit Nothing Array'), line: '//', block: ['/*', '*/'], str: '"' },
  swift: { label: 'Swift', kw: W('func let var class struct enum protocol extension import return if else guard for while repeat switch case default break continue in is as try catch throws throw init deinit self super static private public internal open lazy weak nil true false async await some'), ty: W('String Int Double Float Bool Array Dictionary Set Optional Any View Text Color State Binding'), line: '//', block: ['/*', '*/'], str: '"' },
  c: { label: 'C', kw: W('int char float double void long short unsigned signed const static struct union enum typedef sizeof return if else for while do switch case break continue goto extern inline register volatile'), ty: W('size_t uint8_t uint32_t int32_t FILE NULL bool printf malloc free memcpy'), line: '//', block: ['/*', '*/'], str: '"\'' },
  cpp: { label: 'C++', kw: W('int char float double void bool auto const constexpr static struct class public private protected virtual override final template typename namespace using return if else for while do switch case break continue new delete try catch throw nullptr true false enum inline friend operator this'), ty: W('std string vector map set unique_ptr shared_ptr size_t ostream istream cout cin'), line: '//', block: ['/*', '*/'], str: '"\'' },
  cs: { label: 'C#', kw: W('using namespace class struct interface public private protected internal static readonly const void return if else for foreach while do switch case break continue new this base try catch finally throw async await var record sealed override virtual abstract get set null true false in is as'), ty: W('string int long double float bool object List Dictionary Task IEnumerable Console String Guid DateTime'), line: '//', block: ['/*', '*/'], str: '"\'' },
  php: { label: 'PHP', kw: W('function class extends implements interface public private protected static return if else elseif foreach for while do switch case break continue new echo print require include use namespace try catch finally throw null true false array global const abstract final'), ty: W('string int float bool array object mixed void self parent this'), line: '//', line2: '#', block: ['/*', '*/'], str: '"\'' },
  rb: { label: 'Ruby', kw: W('def end class module if elsif else unless while until for in do return yield begin rescue ensure raise require require_relative attr_accessor attr_reader self nil true false and or not then case when lambda proc'), ty: W('String Integer Float Array Hash Symbol puts print new each map select'), line: '#', str: '"\'' },
  sql: { label: 'SQL', kw: W('select from where group by order having limit offset insert into values update set delete create table alter drop index view join left right inner outer full on as and or not null distinct union all case when then else end with returning primary key foreign references default constraint unique'), ty: W('int integer bigint text varchar boolean timestamp timestamptz date numeric jsonb uuid serial count sum avg min max coalesce now'), line: '--', block: ['/*', '*/'], str: '"\'', upper: true },
  sh: { label: 'Shell', kw: W('if then else elif fi for while do done case esac function return export local source echo cd set unset trap exit'), ty: W('npm node git docker python pip curl mkdir rm cp mv ls cat grep sed awk chmod'), line: '#', str: '"\'' },
  yaml: { label: 'YAML', kw: W('true false null yes no on off'), ty: W(''), line: '#', str: '"\'', yamlKeys: true },
  json: { label: 'JSON', kw: W('true false null'), ty: W(''), str: '"', jsonKeys: true },
  dart: { label: 'Dart', kw: W('class extends implements with abstract final const var late void return if else for while do switch case break continue new this super try catch finally throw import export library async await yield null true false factory get set required'), ty: W('String int double bool List Map Set Future Stream Widget BuildContext Column Row Text Container'), line: '//', block: ['/*', '*/'], str: '"\'' },
  html: { label: 'HTML', mode: 'markup' },
  xml: { label: 'XML', mode: 'markup' },
  css: { label: 'CSS', mode: 'css' },
  md: { label: 'Markdown', mode: 'md' },
  txt: { label: 'Text', kw: W(''), ty: W(''), str: '' },
};
const EXT2LANG = {
  js: 'js', mjs: 'js', cjs: 'js', jsx: 'tsx', ts: 'ts', tsx: 'tsx', py: 'py', go: 'go', rs: 'rs',
  java: 'java', kt: 'kt', kts: 'kt', swift: 'swift', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp',
  cs: 'cs', php: 'php', rb: 'rb', sql: 'sql', sh: 'sh', bash: 'sh', zsh: 'sh', yml: 'yaml', yaml: 'yaml',
  json: 'json', html: 'html', htm: 'html', xml: 'xml', svg: 'xml', css: 'css', scss: 'css', less: 'css',
  md: 'md', markdown: 'md', dart: 'dart', txt: 'txt', lock: 'txt', env: 'sh', toml: 'yaml', ini: 'yaml',
};
function langOf(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (name.toLowerCase() === 'dockerfile') return 'sh';
  if (name.toLowerCase() === 'makefile') return 'sh';
  return EXT2LANG[ext] || 'txt';
}
const LANG_COLOR = {
  js: '#e3b473', ts: '#5fc6da', tsx: '#5fc6da', py: '#8fb0ff', go: '#5fc6da', rs: '#ff9b8a',
  java: '#f05f5f', kt: '#d3a2f2', swift: '#ff9b8a', c: '#9aa1a9', cpp: '#8fb0ff', cs: '#8fd3a2',
  php: '#a2a6f2', rb: '#f05f5f', sql: '#e3b473', sh: '#82c7a2', yaml: '#9aa1a9', json: '#e3b473',
  html: '#ff9b8a', xml: '#ff9b8a', css: '#a2a6f2', md: '#9aa1a9', dart: '#5fc6da', txt: '#7d838b',
};

/* --- разметка --- */
function markupTokens(code) {
  const out = []; let i = 0; const n = code.length;
  while (i < n) {
    if (code.startsWith('<!--', i)) { let j = code.indexOf('-->', i); j = j < 0 ? n : j + 3; out.push(['com', code.slice(i, j)]); i = j; continue; }
    if (code[i] === '<') {
      let j = i + 1; if (code[j] === '/' || code[j] === '!') j++;
      while (j < n && /[\w:.-]/.test(code[j])) j++;
      out.push(['tag', code.slice(i, j)]); i = j;
      while (i < n && code[i] !== '>') {
        const c = code[i];
        if (c === '"' || c === "'") { let k = code.indexOf(c, i + 1); k = k < 0 ? n : k + 1; out.push(['str', code.slice(i, k)]); i = k; continue; }
        if (/[\w:@.-]/.test(c)) { let k = i; while (k < n && /[\w:@.-]/.test(code[k])) k++; out.push(['attr', code.slice(i, k)]); i = k; continue; }
        if (c === '/') { out.push(['tag', '/']); i++; continue; }
        out.push(['op', c]); i++;
      }
      if (i < n) { out.push(['tag', '>']); i++; }
      continue;
    }
    let j = code.indexOf('<', i); j = j < 0 ? n : j;
    out.push(['var', code.slice(i, j)]); i = j;
  }
  return out;
}
/* --- css --- */
function cssTokens(code) {
  const out = []; let i = 0; const n = code.length; let inBlock = false;
  while (i < n) {
    if (code.startsWith('/*', i)) { let j = code.indexOf('*/', i); j = j < 0 ? n : j + 2; out.push(['com', code.slice(i, j)]); i = j; continue; }
    const c = code[i];
    if (c === '"' || c === "'") { let k = code.indexOf(c, i + 1); k = k < 0 ? n : k + 1; out.push(['str', code.slice(i, k)]); i = k; continue; }
    if (c === '{') { inBlock = true; out.push(['punct', c]); i++; continue; }
    if (c === '}') { inBlock = false; out.push(['punct', c]); i++; continue; }
    if (c === '@') { let k = i + 1; while (k < n && /[\w-]/.test(code[k])) k++; out.push(['kw', code.slice(i, k)]); i = k; continue; }
    if (/[\w#.:%-]/.test(c)) {
      let k = i; while (k < n && /[\w#.%-]/.test(code[k])) k++;
      if (k === i) { out.push(['op', c]); i++; continue; }
      const word = code.slice(i, k);
      let rest = k; while (rest < n && code[rest] === ' ') rest++;
      let kind;
      if (/^[\d.]/.test(word)) kind = 'num';
      else if (inBlock && code[rest] === ':') kind = 'attr';
      else if (!inBlock) kind = 'tag';
      else kind = 'var';
      out.push([kind, word]); i = k; continue;
    }
    if (/\s/.test(c)) { let k = i; while (k < n && /\s/.test(code[k])) k++; out.push(['ws', code.slice(i, k)]); i = k; continue; }
    out.push(['op', c]); i++;
  }
  return out;
}
/* --- markdown --- */
function mdTokens(code) {
  const out = []; const lines = code.split('\n'); let fence = false;
  lines.forEach((line, idx) => {
    const nl = idx < lines.length - 1 ? '\n' : '';
    if (line.trim().startsWith('```')) { fence = !fence; out.push(['str', line + nl]); return; }
    if (fence) { out.push(['type', line + nl]); return; }
    if (/^\s{0,3}#{1,6}\s/.test(line)) { out.push(['head', line + nl]); return; }
    if (/^\s*([-*+]|\d+\.)\s/.test(line)) {
      const m = line.match(/^(\s*([-*+]|\d+\.)\s)(.*)$/);
      out.push(['kw', m[1]]); out.push(['var', m[3] + nl]); return;
    }
    if (/^\s*>/.test(line)) { out.push(['com', line + nl]); return; }
    const parts = line.split(/(`[^`]*`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g);
    parts.forEach((pt) => {
      if (!pt) return;
      if (pt.startsWith('`')) out.push(['str', pt]);
      else if (pt.startsWith('**')) out.push(['type', pt]);
      else if (pt.startsWith('[')) out.push(['fn', pt]);
      else out.push(['var', pt]);
    });
    out.push(['var', nl]);
  });
  return out;
}
/* --- общий сканер --- */
function tokenize(code, id) {
  const L = LANGS[id] || LANGS.txt;
  if (L.mode === 'markup') return markupTokens(code);
  if (L.mode === 'css') return cssTokens(code);
  if (L.mode === 'md') return mdTokens(code);
  const out = []; let i = 0; const n = code.length;
  const kw = L.kw || new Set(), ty = L.ty || new Set();
  const str = L.str || '';
  while (i < n) {
    const c = code[i];
    if (L.line && code.startsWith(L.line, i)) { let j = code.indexOf('\n', i); j = j < 0 ? n : j; out.push(['com', code.slice(i, j)]); i = j; continue; }
    if (L.line2 && code.startsWith(L.line2, i)) { let j = code.indexOf('\n', i); j = j < 0 ? n : j; out.push(['com', code.slice(i, j)]); i = j; continue; }
    if (L.block && code.startsWith(L.block[0], i)) { let j = code.indexOf(L.block[1], i + L.block[0].length); j = j < 0 ? n : j + L.block[1].length; out.push(['com', code.slice(i, j)]); i = j; continue; }
    if (str.indexOf(c) >= 0) {
      const triple = (c === '"' || c === "'") && code.substr(i, 3) === c + c + c;
      if (triple) { let j = code.indexOf(c + c + c, i + 3); j = j < 0 ? n : j + 3; out.push(['str', code.slice(i, j)]); i = j; continue; }
      let j = i + 1;
      while (j < n) {
        if (code[j] === '\\') { j += 2; continue; }
        if (code[j] === c) { j++; break; }
        if (code[j] === '\n' && c !== '`') break;
        j++;
      }
      out.push(['str', code.slice(i, j)]); i = j; continue;
    }
    if (/[0-9]/.test(c) && !/[\w$]/.test(code[i - 1] || ' ')) {
      let j = i; while (j < n && /[0-9a-fA-FxXob_.]/.test(code[j])) j++;
      out.push(['num', code.slice(i, j)]); i = j; continue;
    }
    if (/[A-Za-z_$@#]/.test(c)) {
      let j = i; if (c === '@' || c === '#' || c === '$') j++;
      while (j < n && /[\w$]/.test(code[j])) j++;
      const w = code.slice(i, j);
      const cmp = L.upper ? w.toLowerCase() : w;
      let k = 'var';
      if (kw.has(cmp)) k = 'kw';
      else if (ty.has(cmp)) k = 'type';
      else if (c === '@' || c === '#') k = 'kw';
      else if (code[j] === '(') k = 'fn';
      else if (/^[A-Z]/.test(w)) k = 'type';
      if ((L.jsonKeys || L.yamlKeys) && code[j] === ':') k = 'attr';
      out.push([k, w]); i = j; continue;
    }
    if (/\s/.test(c)) { let j = i; while (j < n && /\s/.test(code[j])) j++; out.push(['ws', code.slice(i, j)]); i = j; continue; }
    if ('{}[]()'.indexOf(c) >= 0) { out.push(['punct', c]); i++; continue; }
    out.push(['op', c]); i++;
  }
  return out;
}
const TOK_CLASS = { kw: 'tok-kw', str: 'tok-str', num: 'tok-num', com: 'tok-com', fn: 'tok-fn', type: 'tok-type', punct: 'tok-punct', op: 'tok-op', tag: 'tok-tag', attr: 'tok-attr', var: 'tok-var', head: 'tok-head', ws: null };

function Highlight({ code, lang }) {
  const toks = useMemo(() => tokenize(code, lang), [code, lang]);
  return toks.map((t, i) => {
    const cls = TOK_CLASS[t[0]];
    return cls ? <span key={i} className={cls}>{t[1]}</span> : t[1];
  });
}
