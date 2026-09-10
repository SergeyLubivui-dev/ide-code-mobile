#!/usr/bin/env python3
"""Полная сборка Android-приложения с движком внутри.

    python tools/build-apk.py

Три шага: веб-интерфейс с заранее собранным JSX, кросс-компиляция движка под
обе архитектуры телефонов, затем Gradle. Движок кладётся как `libidecode.so`,
потому что исполнять файлы Android разрешает только из каталога нативных
библиотек.

Нужны Docker (для Go и Babel) и JDK 17. Android SDK берётся из
android/local.properties.
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ANDROID = ROOT / 'android'
JNI = ANDROID / 'app' / 'src' / 'main' / 'jniLibs'
BUILDER = 'astracode-backend-test:latest'
ABIS = {'arm64-v8a': ('arm64', ''), 'armeabi-v7a': ('arm', '7')}
JDK = Path(r'C:\Program Files\Eclipse Adoptium\jdk-17.0.17.10-hotspot')


def run(args: list[str], **kw) -> None:
    result = subprocess.run(args, **kw)
    if result.returncode != 0:
        sys.exit(f'{" ".join(args[:2])} failed with exit code {result.returncode}')


def engine() -> None:
    """Статические бинарники без cgo: NDK для сборки не нужен."""
    JNI.mkdir(parents=True, exist_ok=True)
    script = ['set -e']
    for abi, (arch, arm) in ABIS.items():
        env = f'GOOS=linux GOARCH={arch}' + (f' GOARM={arm}' if arm else '')
        script.append(f'{env} go build -trimpath -ldflags="-s -w" -o /out/{abi}/libidecode.so ./cmd/local')
    run(['docker', 'run', '--rm',
         '-v', f'{ROOT / "backend"}:/src', '-v', f'{JNI}:/out',
         '-w', '/src', '-e', 'CGO_ENABLED=0', BUILDER, 'sh', '-c', '\n'.join(script)])
    for abi in ABIS:
        size = (JNI / abi / 'libidecode.so').stat().st_size
        print(f'движок {abi:<13} — {size // 1024} КБ')


def apk() -> None:
    env = dict(os.environ)
    if JDK.exists():
        env['JAVA_HOME'] = str(JDK)
    gradle = ANDROID / ('gradlew.bat' if os.name == 'nt' else 'gradlew')
    run([str(gradle), 'assembleRelease', '--no-daemon'], cwd=ANDROID, env=env)
    built = ANDROID / 'app' / 'build' / 'outputs' / 'apk' / 'release' / 'app-release.apk'
    if not built.exists():
        sys.exit('Gradle не выдал подписанный APK: проверьте android/keystore.properties')
    target = ANDROID / 'IDE-Code-1.0-release.apk'
    shutil.copy2(built, target)
    print(f'\n{target.relative_to(ROOT)} — {target.stat().st_size // 1024 // 1024} МБ')


def main() -> None:
    run([sys.executable, str(ROOT / 'tools' / 'build-local.py')])
    engine()
    apk()


if __name__ == '__main__':
    main()
