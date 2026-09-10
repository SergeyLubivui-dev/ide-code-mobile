#!/usr/bin/env python3
"""Сборка веб-части для локального движка на устройстве.

    python tools/build-local.py

От серверной сборки отличается двумя вещами. JSX транспилируется заранее:
на телефоне Babel разбирал бы полтора мегабайта исходника при каждом запуске,
а это самая заметная задержка на старте. Вместе с ним уходит и сам babel.js —
три мегабайта, которые больше незачем везти в APK.

Результат кладётся в backend/internal/local/web и попадает в бинарник
через go:embed, поэтому на устройстве не нужен ни nginx, ни распаковка ассетов.
"""
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist' / 'index.html'
WEB = ROOT / 'backend' / 'internal' / 'local' / 'web'
VENDOR_FILES = ['react.js', 'react-dom.js', 'xterm.js', 'xterm.css', 'xterm-fit.js']
BABEL_IMAGE = 'astracode-frontend-test:latest'
UI_IMAGE = 'astracode-ide-code:latest'
OPEN_TAG = '<script type="text/babel" data-presets="react">'


def run(args: list[str], **kw) -> subprocess.CompletedProcess:
    result = subprocess.run(args, capture_output=True, text=True, encoding='utf-8', errors='replace', **kw)
    if result.returncode != 0:
        sys.exit(f'{" ".join(args[:3])} failed:\n{result.stdout}\n{result.stderr}')
    return result


def transpile(jsx: str) -> str:
    """Гоняем @babel/standalone из уже собранного образа фронтенда."""
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / 'bundle.jsx'
        source.write_text(jsx, encoding='utf-8')
        script = (
            "const fs=require('fs'),b=require('@babel/standalone');"
            "const out=b.transform(fs.readFileSync('/work/bundle.jsx','utf8'),"
            "{presets:[['react',{runtime:'classic'}]],compact:false,comments:false});"
            "fs.writeFileSync('/work/bundle.js',out.code);"
        )
        run(['docker', 'run', '--rm', '-v', f'{tmp}:/work', '-w', '/vendor',
             BABEL_IMAGE, 'node', '-e', script])
        return (Path(tmp) / 'bundle.js').read_text(encoding='utf-8')


def vendor() -> None:
    """Забираем react/xterm из образа интерфейса — те же файлы, что у сервера."""
    target = WEB / 'vendor'
    target.mkdir(parents=True, exist_ok=True)
    for stale in target.iterdir():
        stale.unlink()
    container = run(['docker', 'create', UI_IMAGE]).stdout.strip()
    try:
        for name in VENDOR_FILES:
            run(['docker', 'cp', f'{container}:/usr/share/nginx/html/vendor/{name}', str(target / name)])
    finally:
        subprocess.run(['docker', 'rm', '-f', container], capture_output=True)


def main() -> None:
    run([sys.executable, str(ROOT / 'build.py')], cwd=ROOT)
    html = DIST.read_text(encoding='utf-8')

    start = html.index(OPEN_TAG)
    body_start = start + len(OPEN_TAG)
    body_end = html.rindex('</script>')
    if body_end <= body_start:
        sys.exit('не нашёл границы JSX-блока в dist/index.html')
    jsx = html[body_start:body_end]

    code = transpile(jsx)
    # Babel больше не нужен ни как файл, ни как шаг на устройстве.
    head = html[:start].replace("'/vendor/babel.js',", '')
    if '/vendor/babel.js' in head:
        sys.exit('ссылка на babel.js осталась в разметке')
    page = head + '<script>\n' + code + '\n</script>' + html[body_end + len('</script>'):]

    WEB.mkdir(parents=True, exist_ok=True)
    (WEB / 'index.html').write_text(page, encoding='utf-8')
    vendor()

    total = sum(f.stat().st_size for f in WEB.rglob('*') if f.is_file())
    print(f'web/index.html   — {len(page.encode("utf-8")) // 1024} КБ (JSX уже собран)')
    print(f'web/vendor       — {len(VENDOR_FILES)} файлов, babel.js не нужен')
    print(f'итого для embed  — {total // 1024} КБ')


if __name__ == '__main__':
    main()
