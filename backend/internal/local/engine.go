// Package local — движок для устройства пользователя: то же API, что у сервера,
// но без PostgreSQL, Docker и участников проектов. Данные лежат в одном JSON-файле
// рядом с рабочими папками, терминал запускает оболочку самого устройства.
package local

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
)

// WorkspaceDir — имя папки с проектами. Оно попадает в приглашение терминала,
// поэтому читается человеком, а не машиной.
const WorkspaceDir = "IDECode"

const (
	MaxFileBytes    = 512 << 10
	MaxProjectBytes = 8 << 20
	MaxEntries      = 512
	MaxSnapshots    = 20
	MaxTerminals    = 4
)

type Config struct {
	Root    string // каталог данных приложения
	Listen  string // адрес, всегда локальная петля
	Shell   string // оболочка устройства
	APIKey  string // ключ платформы моделей по умолчанию
	APIBase string // база API платформы
}

func EnvConfig() Config {
	env := func(k, d string) string {
		if v := os.Getenv(k); v != "" {
			return v
		}
		return d
	}
	return Config{
		Root:   env("IDECODE_ROOT", "."),
		Listen: env("LISTEN_ADDR", "127.0.0.1:5738"),
		Shell:  env("IDECODE_SHELL", defaultShell()),
		// Ключ приходит извне: в исходниках его держать незачем, а поле
		// в настройках всё равно перекрывает значение по умолчанию.
		APIKey:  os.Getenv("IDECODE_API_KEY"),
		APIBase: env("IDECODE_API_BASE", defaultChatBase),
	}
}

// На Android нет /bin/sh, зато всегда есть /system/bin/sh.
func defaultShell() string {
	for _, candidate := range []string{"/system/bin/sh", "/bin/sh", "/bin/bash"} {
		if info, e := os.Stat(candidate); e == nil && !info.IsDir() {
			return candidate
		}
	}
	return "sh"
}

type Metadata struct {
	Name  string   `json:"name"`
	Desc  string   `json:"desc"`
	Theme string   `json:"theme"`
	Tags  []string `json:"tags"`
	Tint  string   `json:"tint"`
}

type File struct {
	ID   string `json:"id"`
	Path string `json:"path"`
	Code string `json:"code"`
	ETag string `json:"etag"`
}

type FileInput struct {
	Path string `json:"path"`
	Code string `json:"code"`
}

type SnapshotFile struct {
	Path  string `json:"path"`
	Lines int    `json:"lines"`
}

type Snapshot struct {
	ID    string         `json:"id"`
	Hash  string         `json:"hash"`
	Msg   string         `json:"msg"`
	Who   string         `json:"who"`
	At    int64          `json:"at"`
	Files []SnapshotFile `json:"files"`
}

type Project struct {
	ID string `json:"id"`
	Metadata
	Role        string     `json:"role"`
	UpdatedAt   int64      `json:"updatedAt"`
	Revision    int        `json:"revision"`
	Files       []File     `json:"files"`
	Snaps       []Snapshot `json:"snaps"`
	Directories []string   `json:"directories"`
	Omitted     []string   `json:"omitted"`
	// Preview — адрес живого просмотра. Он несёт собственный секрет вместо
	// cookie: кадр просмотра изолирован, и браузер считает его подзапросы
	// межсайтовыми, поэтому cookie туда не доходит и страница теряет стили.
	Preview string `json:"preview"`
}

type User struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Name  string `json:"name"`
}

type snapshotRecord struct {
	ID    string      `json:"id"`
	Msg   string      `json:"msg"`
	At    time.Time   `json:"at"`
	Files []FileInput `json:"files"`
}

type projectRecord struct {
	ID string `json:"id"`
	Metadata
	// Dir — имя папки проекта на диске. UUID в терминале читать невозможно,
	// поэтому папка называется по проекту, а идентификатор остаётся для API.
	Dir       string           `json:"dir"`
	Token     string           `json:"token"`
	Revision  int              `json:"revision"`
	UpdatedAt time.Time        `json:"updatedAt"`
	Snapshots []snapshotRecord `json:"snapshots"`
}

// dir остаётся совместимым с проектами, созданными до читаемых папок.
func (p *projectRecord) dir() string {
	if p.Dir != "" {
		return p.Dir
	}
	return p.ID
}

type state struct {
	User      User             `json:"user"`
	TokenHash string           `json:"tokenHash"`
	Expires   time.Time        `json:"expires"`
	Chat      chatSettings     `json:"chat"`
	Projects  []*projectRecord `json:"projects"`
}

type apiError struct {
	Status        int
	Code, Message string
}

func (e *apiError) Error() string { return e.Message }

func problem(status int, code, message string) error { return &apiError{status, code, message} }

type Server struct {
	cfg       Config
	mu        sync.Mutex
	state     state
	fs        *os.Root
	terminals *terminals
	probes    chatProbe
}

func New(cfg Config) (*Server, error) {
	root, e := filepath.Abs(cfg.Root)
	if e != nil {
		return nil, e
	}
	// На Android /data/data/<пакет> и /data/user/0/<пакет> — один и тот же
	// каталог через ссылку. Оболочка берёт PWD из getcwd() и видит настоящий
	// путь, поэтому приглашение не совпадало с IDE_ROOT, ничего не отрезало и
	// показывало полный путь вместе с именем пакета. Приводим корень к тому же
	// виду, что и getcwd(), — тогда сравнение сходится.
	if e = os.MkdirAll(root, 0o700); e != nil {
		return nil, e
	}
	if resolved, err := filepath.EvalSymlinks(root); err == nil {
		root = resolved
	}
	cfg.Root = root
	// Установки до переименования держали проекты в «workspaces» — переносим.
	legacy, target := filepath.Join(root, "workspaces"), filepath.Join(root, WorkspaceDir)
	if _, err := os.Stat(target); os.IsNotExist(err) {
		if _, err = os.Stat(legacy); err == nil {
			_ = os.Rename(legacy, target)
		}
	}
	if e = os.MkdirAll(target, 0o700); e != nil {
		return nil, e
	}
	dir, e := os.OpenRoot(target)
	if e != nil {
		return nil, e
	}
	s := &Server{cfg: cfg, fs: dir}
	s.terminals = newTerminals(s)
	if e = s.load(); e != nil {
		dir.Close()
		return nil, e
	}
	return s, nil
}

func (s *Server) Close() {
	s.terminals.closeAll()
	s.fs.Close()
}

func (s *Server) statePath() string { return filepath.Join(s.cfg.Root, "state.json") }

func (s *Server) load() error {
	b, e := os.ReadFile(s.statePath())
	if errors.Is(e, os.ErrNotExist) {
		s.state = state{Projects: []*projectRecord{}}
		return nil
	}
	if e != nil {
		return e
	}
	if e = json.Unmarshal(b, &s.state); e != nil {
		return e
	}
	if s.state.Projects == nil {
		s.state.Projects = []*projectRecord{}
	}
	return nil
}

// Запись через временный файл: обрыв питания на телефоне не должен оставлять
// половину состояния.
func (s *Server) save() error {
	b, e := json.Marshal(s.state)
	if e != nil {
		return e
	}
	tmp := s.statePath() + ".tmp"
	if e = os.WriteFile(tmp, b, 0o600); e != nil {
		return e
	}
	return os.Rename(tmp, s.statePath())
}

// slug превращает название проекта в имя папки: буквы и цифры любых языков
// остаются, остальное становится дефисом. Имя должно быть удобным в оболочке,
// поэтому ни пробелов, ни кавычек в нём не бывает.
func slug(name string) string {
	var b strings.Builder
	dash := false
	for _, r := range name {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
			dash = false
		case r == '.' || r == '_' || r == '-':
			b.WriteRune(r)
			dash = false
		default:
			if !dash && b.Len() > 0 {
				b.WriteByte('-')
				dash = true
			}
		}
	}
	out := strings.Trim(b.String(), "-.")
	runes := []rune(out)
	if len(runes) > 40 {
		out = strings.Trim(string(runes[:40]), "-.")
	}
	if out == "" {
		return "project"
	}
	return out
}

// freeDir подбирает незанятое имя: два проекта могут называться одинаково.
func (s *Server) freeDir(name, exclude string) string {
	base := slug(name)
	taken := map[string]bool{}
	for _, p := range s.state.Projects {
		if p.ID != exclude {
			taken[p.dir()] = true
		}
	}
	candidate := base
	for n := 2; taken[candidate]; n++ {
		candidate = base + "-" + strconv.Itoa(n)
		if n > 999 {
			return base + "-" + newID()[:8]
		}
	}
	if _, e := s.fs.Stat(candidate); e == nil && candidate != base {
		return base + "-" + newID()[:8]
	}
	return candidate
}

func (s *Server) find(id string) *projectRecord {
	for _, p := range s.state.Projects {
		if p.ID == id {
			return p
		}
	}
	return nil
}

func newID() string {
	b := make([]byte, 16)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	h := hex.EncodeToString(b)
	return h[:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}

func token() string {
	b := make([]byte, 32)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return hex.EncodeToString(b)
}

func digest(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }

func tagOf(b []byte) string { return `"` + digest(b) + `"` }

func respond(w http.ResponseWriter, status int, v any) error {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v != nil {
		return json.NewEncoder(w).Encode(v)
	}
	return nil
}

func decode(w http.ResponseWriter, r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 9<<20)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		var large *http.MaxBytesError
		if errors.As(e, &large) {
			return problem(413, "body_too_large", "Request body exceeds 9 MiB")
		}
		return problem(400, "invalid_json", "Invalid JSON body")
	}
	if e := d.Decode(new(any)); e != io.EOF {
		return problem(400, "invalid_json", "Expected exactly one JSON value")
	}
	return nil
}
