package local

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Приглашение показывает путь от папки проектов: «~», «~/проект»,
// «~/проект/src». Ушли наружу — виден обычный абсолютный путь, чтобы
// приглашение не врало. Строку раскрывает сама оболочка, запуска команд на
// каждое приглашение нет.
//
// На телефоне это важнее, чем кажется: каталог данных приложения — это
// /data/user/0/ru.sergeylubivui.idecode/files, и полный путь занимает пол-экрана
// именем пакета.
// Тильда экранирована не для красоты: без обратной косой оболочка
// подставит на её место домашний каталог, и вместо «~/проект» получится
// «/data/.../home/проект» — ровно та длинная строка, от которой уходим.
const promptShort = `${PWD/#$IDE_WS/\~} $ `

// Замену префикса умеют mksh (оболочка Android) и bash, а dash с busybox — нет:
// у них строка осталась бы на экране как есть. Для них путь считается от
// каталога данных и начинается с «IDECode».
const promptPlain = `${PWD#$IDE_ROOT/} $ `

// Спрашиваем у самой оболочки, а не гадаем по имени: под «sh» на разных
// системах лежат разные оболочки.
func prefixReplaceOK(shell string) bool {
	cmd := exec.Command(shell, "-c", `p=/a/b; printf %s "${p/#\/a/\~}"`)
	out, e := cmd.Output()
	return e == nil && string(out) == "~/b"
}

// Файл настроек интерактивной оболочки. Лежит в домашней папке рядом с
// проектами и переписывается при каждом запуске сессии.
const rcName = ".idecoderc"

// Своего rc-файла раньше не было: PS1 уезжал в окружение, и на телефоне его
// молча перебивало. Причина — в mksh, оболочке Android: она разворачивает
// «${ENV:-/system/etc/mkshrc}», и пустой ENV для неё значит не «профиля нет», а
// «взять системный». Системный mkshrc ставит своё приглашение с именем хоста и
// полным путём — то самое, которое занимало полстроки на экране телефона.
// Непустой ENV перекрывает системный профиль и заодно даёт место цвету и
// псевдонимам.
func shellRC(prompt string) string {
	return strings.Join([]string{
		"# IDE Code: настройки интерактивной оболочки.",
		"# Файл переписывает движок при запуске сессии — правки не сохранятся.",
		"",
		"PS1='" + prompt + "'",
		"export PS1",
		"",
		"# Цвет включаем там, где утилита о нём знает: у toybox, busybox и GNU",
		"# ключ один и тот же, а на остальных проверка просто не пройдёт.",
		`if ls --color=auto / >/dev/null 2>&1; then alias ls='ls --color=auto'; fi`,
		`if echo c | grep --color=auto c >/dev/null 2>&1; then alias grep='grep --color=auto'; fi`,
		`alias ll='ls -l'`,
		`alias la='ls -la'`,
		"",
		"# less без -R съедает цвет всего, что через него проходит.",
		`if command -v less >/dev/null 2>&1; then PAGER='less -R'; LESS=-R; export PAGER LESS; fi`,
		"",
		"# Ключи хостов ssh лежат в домашней папке: без неё первое подключение",
		"# ругается, что известные хосты некуда записать.",
		`[ -d "$HOME/.ssh" ] || mkdir -p "$HOME/.ssh" 2>/dev/null`,
		"",
	}, "\n")
}

// Домашняя папка оболочки создаётся здесь же: раньше HOME указывал на каталог,
// которого не существовало, и ssh спотыкался об него на первом подключении.
func writeShellRC(home, prompt string) (string, error) {
	if e := os.MkdirAll(home, 0o700); e != nil {
		return "", e
	}
	if e := os.MkdirAll(filepath.Join(home, ".ssh"), 0o700); e != nil {
		return "", e
	}
	path := filepath.Join(home, rcName)
	if e := os.WriteFile(path, []byte(shellRC(prompt)), 0o600); e != nil {
		return "", e
	}
	return path, nil
}
