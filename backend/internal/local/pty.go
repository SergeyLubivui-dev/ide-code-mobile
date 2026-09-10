package local

import (
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

// Терминал устройства: настоящий PTY на собственной оболочке. Контейнеров на
// телефоне нет, поэтому изоляция здесь — только права самого приложения:
// оболочка видит ровно то, что видит процесс приложения.
type Terminal struct {
	ID      string    `json:"id"`
	Project string    `json:"projectId"`
	Created time.Time `json:"createdAt"`

	mu        sync.Mutex
	master    *os.File
	cmd       *exec.Cmd
	replay    []byte
	sub       chan []byte
	done      chan struct{}
	closeOnce sync.Once
}

type terminals struct {
	s     *Server
	mu    sync.Mutex
	items map[string]*Terminal

	probeOnce sync.Once
	short     bool
}

func newTerminals(s *Server) *terminals {
	return &terminals{s: s, items: map[string]*Terminal{}}
}

// Оболочку спрашиваем один раз на всё время работы: она не меняется.
func (m *terminals) shortPrompt() bool {
	m.probeOnce.Do(func() { m.short = prefixReplaceOK(m.s.cfg.Shell) })
	return m.short
}

func (m *terminals) list(project string) []*Terminal {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []*Terminal{}
	for _, t := range m.items {
		if t.Project == project {
			out = append(out, t)
		}
	}
	return out
}

func (m *terminals) get(project, id string) *Terminal {
	m.mu.Lock()
	defer m.mu.Unlock()
	t := m.items[id]
	if t == nil || t.Project != project {
		return nil
	}
	return t
}

func (m *terminals) count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.items)
}

func (m *terminals) stop(id string) {
	m.mu.Lock()
	t := m.items[id]
	delete(m.items, id)
	m.mu.Unlock()
	if t != nil {
		t.close()
	}
}

func (m *terminals) closeProject(project string) {
	m.mu.Lock()
	ids := []string{}
	for id, t := range m.items {
		if t.Project == project {
			ids = append(ids, id)
		}
	}
	m.mu.Unlock()
	for _, id := range ids {
		m.stop(id)
	}
}

func (m *terminals) closeAll() {
	m.mu.Lock()
	ids := make([]string, 0, len(m.items))
	for id := range m.items {
		ids = append(ids, id)
	}
	m.mu.Unlock()
	for _, id := range ids {
		m.stop(id)
	}
}

func (t *Terminal) close() {
	t.closeOnce.Do(func() {
		close(t.done)
		if t.cmd != nil && t.cmd.Process != nil {
			// Оболочка живёт в своей сессии: сигнал всей группе, чтобы не осталось
			// осиротевших дочерних процессов.
			_ = syscall.Kill(-t.cmd.Process.Pid, syscall.SIGKILL)
		}
		if t.master != nil {
			_ = t.master.Close()
		}
	})
}

// На Android у процесса приложения PATH бывает пустым, и тогда в оболочке
// не находится даже ls. Свой список надёжнее наследуемого.
const androidPath = "/system/bin:/system/xbin:/product/bin:/apex/com.android.runtime/bin:/vendor/bin:/usr/bin:/bin"

// bash в интерактивном режиме на $ENV не смотрит вовсе: свой файл ему нужно
// назвать явно. Остальные оболочки семейства sh читают $ENV сами.
func interactiveArgs(shell, rc string) []string {
	if rc != "" && filepath.Base(shell) == "bash" {
		return []string{"--rcfile", rc, "-i"}
	}
	return []string{"-i"}
}

func (m *terminals) create(project, dir string, cols, rows int) (*Terminal, error) {
	if m.count() >= MaxTerminals {
		return nil, problem(429, "terminal_limit", "Too many open terminals")
	}
	workspaces := filepath.Join(m.s.cfg.Root, WorkspaceDir)
	// Пустая папка — терминал не привязан к проекту и открывается в корне:
	// оттуда видно все проекты, а cd заходит внутрь нужного.
	cwd := workspaces
	if dir != "" {
		cwd = filepath.Join(workspaces, dir)
	}
	prompt := promptPlain
	if m.shortPrompt() {
		prompt = promptShort
	}
	// Свой rc-файл, а не только PS1 в окружении: системный профиль оболочки
	// иначе перебивает приглашение своим, длинным. Не записался — оставляем
	// ENV на /dev/null, это тоже отменяет системный профиль.
	home := filepath.Join(m.s.cfg.Root, "home")
	rc, rcErr := writeShellRC(home, prompt)
	env := "ENV=/dev/null"
	if rcErr == nil {
		env = "ENV=" + rc
	}
	// На Android каталога /tmp нет вовсе, а ssh, git и распаковщики пишут туда
	// временные файлы. Свой каталог рядом с проектами уходит вместе с приложением.
	tmp := filepath.Join(m.s.cfg.Root, "tmp")
	_ = os.MkdirAll(tmp, 0o700)
	master, slave, e := openPTY()
	if e != nil {
		return nil, problem(503, "pty_unavailable", "Device shell is unavailable: "+e.Error())
	}
	cmd := exec.Command(m.s.cfg.Shell, interactiveArgs(m.s.cfg.Shell, rc)...)
	cmd.Dir = cwd
	path := os.Getenv("PATH")
	if path == "" {
		path = androidPath
	}
	cmd.Env = append(os.Environ(),
		"TERM=xterm-256color",
		"PATH="+path,
		"HOME="+home,
		"IDE_ROOT="+m.s.cfg.Root,
		"IDE_WS="+workspaces,
		"TMPDIR="+tmp,
		env,
		"PS1="+prompt,
	)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = slave, slave, slave
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true, Setctty: true, Ctty: 0}
	if e = cmd.Start(); e != nil {
		slave.Close()
		master.Close()
		return nil, problem(503, "shell_unavailable", "Cannot start the device shell: "+e.Error())
	}
	slave.Close()
	setSize(master, cols, rows)

	t := &Terminal{ID: newID(), Project: project, Created: time.Now(),
		master: master, cmd: cmd, done: make(chan struct{})}
	m.mu.Lock()
	m.items[t.ID] = t
	m.mu.Unlock()
	go t.pump()
	go func() {
		_ = cmd.Wait()
		m.stop(t.ID)
	}()
	return t, nil
}

func (t *Terminal) pump() {
	buf := make([]byte, 8192)
	for {
		n, e := t.master.Read(buf)
		if n > 0 {
			b := append([]byte(nil), buf[:n]...)
			t.mu.Lock()
			t.replay = append(t.replay, b...)
			if len(t.replay) > 1<<20 {
				t.replay = append([]byte(nil), t.replay[len(t.replay)-(1<<20):]...)
			}
			if t.sub != nil {
				select {
				case t.sub <- b:
				default:
					close(t.sub)
					t.sub = nil
				}
			}
			t.mu.Unlock()
		}
		if e != nil {
			t.close()
			return
		}
	}
}

func (t *Terminal) write(b []byte) error {
	t.mu.Lock()
	master := t.master
	t.mu.Unlock()
	if master == nil {
		return os.ErrClosed
	}
	_, e := master.Write(b)
	return e
}

func (t *Terminal) resize(cols, rows int) {
	t.mu.Lock()
	master := t.master
	t.mu.Unlock()
	if master != nil {
		setSize(master, cols, rows)
	}
}

func (t *Terminal) subscribe() (chan []byte, []byte) {
	ch := make(chan []byte, 64)
	t.mu.Lock()
	if t.sub != nil {
		close(t.sub)
	}
	t.sub = ch
	replay := append([]byte(nil), t.replay...)
	t.mu.Unlock()
	return ch, replay
}

func (t *Terminal) unsubscribe(ch chan []byte) {
	t.mu.Lock()
	if t.sub == ch {
		t.sub = nil
	}
	t.mu.Unlock()
}

// openPTY повторяет то, что делает posix_openpt: без cgo, только ioctl.
func openPTY() (*os.File, *os.File, error) {
	master, e := os.OpenFile("/dev/ptmx", os.O_RDWR|syscall.O_NOCTTY, 0)
	if e != nil {
		return nil, nil, e
	}
	var unlock int
	if e = ioctl(master.Fd(), syscall.TIOCSPTLCK, uintptr(unsafe.Pointer(&unlock))); e != nil {
		master.Close()
		return nil, nil, e
	}
	var n uint32
	if e = ioctl(master.Fd(), _TIOCGPTN, uintptr(unsafe.Pointer(&n))); e != nil {
		master.Close()
		return nil, nil, e
	}
	slave, e := os.OpenFile("/dev/pts/"+itoa(int(n)), os.O_RDWR|syscall.O_NOCTTY, 0)
	if e != nil {
		master.Close()
		return nil, nil, e
	}
	return master, slave, nil
}

const _TIOCGPTN = 0x80045430

func ioctl(fd, request, arg uintptr) error {
	if _, _, errno := syscall.Syscall(syscall.SYS_IOCTL, fd, request, arg); errno != 0 {
		return errno
	}
	return nil
}

type winsize struct{ rows, cols, x, y uint16 }

func setSize(f *os.File, cols, rows int) {
	if cols < 2 || rows < 2 || cols > 500 || rows > 200 {
		return
	}
	ws := winsize{rows: uint16(rows), cols: uint16(cols)}
	_ = ioctl(f.Fd(), syscall.TIOCSWINSZ, uintptr(unsafe.Pointer(&ws)))
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [12]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}
