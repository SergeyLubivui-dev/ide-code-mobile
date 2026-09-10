package local

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Где сейчас оболочка и не ушла ли она наружу. Приглашение специально короткое,
// и без этой строки в интерфейсе непонятно, идёт работа в проекте или уже на
// удалённой машине после ssh: удалённое приглашение рисует чужая оболочка, и
// подписать его самим нечем.
//
// Спрашиваем /proc, а не саму оболочку: приглашение уходит в общий поток
// вывода, и вытаскивать путь оттуда значило бы разбирать чужой текст. Свои
// процессы видны даже там, где Android закрывает чужие (hidepid).
type terminalWhere struct {
	Path   string `json:"path"`
	Remote string `json:"remote,omitempty"`
}

func (t *Terminal) pid() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.cmd == nil || t.cmd.Process == nil {
		return 0
	}
	return t.cmd.Process.Pid
}

func procPath(pid int, rest ...string) string {
	return filepath.Join(append([]string{"/proc", strconv.Itoa(pid)}, rest...)...)
}

func procChildren(pid int) []int {
	b, e := os.ReadFile(procPath(pid, "task", strconv.Itoa(pid), "children"))
	if e != nil {
		return nil
	}
	out := []int{}
	for _, f := range strings.Fields(string(b)) {
		if n, err := strconv.Atoi(f); err == nil {
			out = append(out, n)
		}
	}
	return out
}

func procArgs(pid int) []string {
	b, e := os.ReadFile(procPath(pid, "cmdline"))
	if e != nil || len(b) == 0 {
		return nil
	}
	return strings.Split(strings.TrimRight(string(b), "\x00"), "\x00")
}

// Ключи ssh, после которых идёт отдельным словом значение, а не адрес.
const sshValueFlags = "bcDEeFIiJLlmOopQRSWw"

// Адрес — первое слово, которое не ключ и не значение ключа. Разбор простой
// намеренно: строка идёт в подпись «ssh …», а не в команду.
func sshTarget(args []string) string {
	skip := false
	for _, a := range args[1:] {
		switch {
		case skip:
			skip = false
		case a == "--":
			continue
		case strings.HasPrefix(a, "-"):
			// Отдельным словом значение идёт только у одиночного ключа: у «-p22»
			// и «-oPort=22» оно уже внутри, пропускать следующее слово не нужно.
			if len(a) == 2 && strings.Contains(sshValueFlags, a[1:]) {
				skip = true
			}
		default:
			return strings.TrimPrefix(a, "ssh://")
		}
	}
	return ""
}

// Обходим только своё поддерево и неглубоко: ssh почти всегда прямой потомок
// оболочки, а полный обход /proc на телефоне того не стоит.
func remoteHost(pid int) string {
	queue, seen := []int{pid}, 0
	for len(queue) > 0 && seen < 24 {
		next := []int{}
		for _, p := range queue {
			for _, child := range procChildren(p) {
				seen++
				args := procArgs(child)
				if len(args) > 0 && filepath.Base(args[0]) == "ssh" {
					if target := sshTarget(args); target != "" {
						return target
					}
				}
				next = append(next, child)
			}
		}
		queue = next
	}
	return ""
}

// Путь в том же виде, в каком его печатает приглашение: «~», «~/проект»,
// «~/проект/src», а снаружи — обычный абсолютный путь.
func (m *terminals) label(dir string) string {
	ws := filepath.Join(m.s.cfg.Root, WorkspaceDir)
	switch {
	case dir == ws:
		return "~"
	case strings.HasPrefix(dir, ws+string(filepath.Separator)):
		return "~/" + filepath.ToSlash(dir[len(ws)+1:])
	default:
		return dir
	}
}

func (m *terminals) where(t *Terminal) terminalWhere {
	pid := t.pid()
	if pid == 0 {
		return terminalWhere{}
	}
	out := terminalWhere{Remote: remoteHost(pid)}
	if dir, e := os.Readlink(procPath(pid, "cwd")); e == nil {
		out.Path = m.label(dir)
	}
	return out
}
