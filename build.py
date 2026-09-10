#!/usr/bin/env python3
"""Сборка IDE Code.

    python3 build.py

Собирает два файла:
  dist/ide-code.html — тело для Claude Artifacts (без doctype и head,
                       их добавляет хост при публикации);
  dist/index.html    — самостоятельная страница с doctype, charset и viewport,
                       её и раздаёт nginx в docker-compose.

Порядок склейки важен: оболочка со стилями, затем данные баннера обычным
скриптом (чтобы Babel не разбирал мегабайт base64), затем JSX-модули.
"""
from pathlib import Path

ROOT = Path(__file__).parent
SRC = ROOT / 'src'
DIST = ROOT / 'dist'

SHELL = SRC / '01-shell.html'
BANNER = SRC / '02-banner.js'
MODULES = ['03-core.jsx', '04-data.jsx', '04-server.jsx', '05-projects.jsx', '06-workspace.jsx']

HEAD = (
    '<!doctype html>\n'
    '<html lang="ru" data-theme="dark">\n'
    '<head>\n'
    '<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
    '<meta name="color-scheme" content="dark light">\n'
    '<meta name="theme-color" content="#0b0c0e">\n'
    '<meta name="description" content="IDE Code — мобильная среда разработки: проекты, редактор с подсветкой, терминал и точки восстановления.">\n'
)


def main() -> None:
    shell = SHELL.read_text(encoding='utf-8')
    cut = shell.index('<script type="text/babel"')
    head, babel_tag = shell[:cut], shell[cut:]

    parts = [SRC.joinpath(name).read_text(encoding='utf-8') for name in MODULES]
    page = (
        head
        + '<script>\n' + BANNER.read_text(encoding='utf-8') + '</script>\n'
        + babel_tag
        + '\n'.join(parts)
        + '\n</script>\n'
    )

    DIST.mkdir(exist_ok=True)
    artifact = page.replace("window.ASTRA_DEMO = location.protocol === 'file:' || new URLSearchParams(location.search).get('mode') === 'demo';", "window.ASTRA_DEMO = true;", 1).replace("const standalone = location.protocol === 'file:';", "const standalone = true;", 1)
    (DIST / 'ide-code.html').write_text(artifact, encoding='utf-8')

    # Самостоятельная страница: стили уезжают в head, разметка и скрипты — в body.
    split = page.index('<div id="root"></div>')
    standalone = HEAD + page[:split] + '</head>\n<body>\n' + page[split:] + '</body>\n</html>\n'
    (DIST / 'index.html').write_text(standalone, encoding='utf-8')
    (ROOT / 'app').mkdir(exist_ok=True)
    (ROOT / 'app' / 'index.html').write_text(standalone, encoding='utf-8')

    kb = lambda s: round(len(s.encode('utf-8')) / 1024)
    print('dist/ide-code.html —', kb(page), 'КБ (артефакт)')
    print('dist/index.html    —', kb(standalone), 'КБ (自 standalone для nginx)'.replace('自 ', ''))


if __name__ == '__main__':
    main()
