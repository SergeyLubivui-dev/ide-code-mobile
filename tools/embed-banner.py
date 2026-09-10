#!/usr/bin/env python3
"""Складывает ролики и постер из assets/ в src/02-banner.js как data-URI."""
import base64
from pathlib import Path

ROOT = Path(__file__).parent.parent
A = ROOT / 'assets'


def b64(name: str) -> str:
    return base64.b64encode((A / name).read_bytes()).decode()


out = ROOT / 'src' / '02-banner.js'
out.write_text(
    '/* Баннер: ide-code-banner.webm / .mp4 — вперёд и обратно одним циклом, без звука */\n'
    'const BANNER_WEBM = "data:video/webm;base64,' + b64('ide-code-banner.webm') + '";\n'
    'const BANNER_SRC = "data:video/mp4;base64,' + b64('ide-code-banner.mp4') + '";\n'
    'const BANNER_POSTER = "data:image/jpeg;base64,' + b64('ide-code-banner-poster.jpg') + '";\n',
    encoding='utf-8',
)
print('обновлён', out)
