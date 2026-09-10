package local

import (
	"context"
	"crypto/subtle"
	"embed"
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

// Интерфейс лежит внутри бинарника: на устройстве нет nginx, а отдельные файлы
// в APK пришлось бы распаковывать при каждом обновлении.
//
//go:embed all:web
var webFiles embed.FS

var uuidRE = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

const sessionTTL = 365 * 24 * time.Hour

type endpoint func(http.ResponseWriter, *http.Request) error

func (s *Server) route(fn endpoint, auth bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		run := func() error {
			if origin := r.Header.Get("Origin"); origin != "" {
				u, e := url.Parse(origin)
				if e != nil || u.Host != r.Host {
					return problem(403, "origin_denied", "Origin is not allowed")
				}
			}
			if r.Method != "GET" && r.Method != "HEAD" && r.Header.Get("X-Requested-With") != "astracode" {
				return problem(403, "csrf", "X-Requested-With: astracode is required")
			}
			if auth && !s.signedIn(r) {
				return problem(401, "unauthorized", "Sign in required")
			}
			return fn(w, r)
		}
		if e := run(); e != nil {
			ae := &apiError{500, "internal_error", "Internal server error"}
			if !errors.As(e, &ae) {
				slog.Error("request failed", "method", r.Method, "path", r.URL.Path, "error", e)
			}
			_ = respond(w, ae.Status, map[string]any{"error": map[string]string{"code": ae.Code, "message": ae.Message}})
		}
	}
}

func (s *Server) signedIn(r *http.Request) bool {
	raw := ""
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		raw = strings.TrimPrefix(h, "Bearer ")
	} else if c, e := r.Cookie("astra_session"); e == nil {
		raw = c.Value
	}
	if len(raw) != 64 {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state.TokenHash != "" && s.state.TokenHash == digest([]byte(raw)) && time.Now().Before(s.state.Expires)
}

func (s *Server) Handler() http.Handler {
	m := http.NewServeMux()
	get := func(p string, fn endpoint, auth bool) { m.HandleFunc("GET /api/v1"+p, s.route(fn, auth)) }
	post := func(p string, fn endpoint, auth bool) { m.HandleFunc("POST /api/v1"+p, s.route(fn, auth)) }

	get("/health/live", func(w http.ResponseWriter, r *http.Request) error {
		return respond(w, 200, map[string]string{"status": "ok"})
	}, false)
	get("/health/ready", func(w http.ResponseWriter, r *http.Request) error {
		return respond(w, 200, map[string]string{"status": "ready"})
	}, false)
	get("/config", func(w http.ResponseWriter, r *http.Request) error {
		return respond(w, 200, map[string]any{"mode": "local", "registration": true,
			"shell": "Оболочка устройства", "shellShort": "Оболочка",
			// Движок сам объявляет, что умеет: интерфейс один на оба режима.
			"chat": true, "rootTerminal": true,
			"maxFileBytes": MaxFileBytes, "maxProjectBytes": MaxProjectBytes})
	}, false)

	post("/auth/login", s.signIn, false)
	post("/auth/register", s.signIn, false)
	get("/auth/me", func(w http.ResponseWriter, r *http.Request) error {
		s.mu.Lock()
		defer s.mu.Unlock()
		return respond(w, 200, s.state.User)
	}, true)
	post("/auth/logout", s.signOut, true)

	get("/projects", s.listProjects, true)
	post("/projects", s.createProject, true)
	get("/projects/{project}", s.getProject, true)
	m.HandleFunc("PATCH /api/v1/projects/{project}", s.route(s.patchProject, true))
	m.HandleFunc("DELETE /api/v1/projects/{project}", s.route(s.deleteProject, true))

	get("/projects/{project}/files", s.listFiles, true)
	get("/projects/{project}/file", s.readFile, true)
	m.HandleFunc("PUT /api/v1/projects/{project}/file", s.route(s.writeFile, true))
	m.HandleFunc("DELETE /api/v1/projects/{project}/file", s.route(s.deleteFile, true))
	post("/projects/{project}/directories", s.createDirectory, true)
	post("/projects/{project}/rename", s.renameFile, true)

	// Живой просмотр: страница проекта отдаётся как есть, относительные ссылки
	// внутри неё разрешаются в тот же каталог. Доступ — по секрету в адресе,
	// а не по cookie: изолированный кадр её не передаёт.
	m.HandleFunc("GET /api/v1/preview/{token}/{path...}", s.route(s.previewFile, false))

	get("/projects/{project}/snapshots", s.listSnapshots, true)
	post("/projects/{project}/snapshots", s.createSnapshot, true)
	post("/projects/{project}/snapshots/{snapshot}/restore", s.restoreSnapshot, true)

	// Совместное редактирование на одном устройстве не бывает: списки пустые,
	// чтобы интерфейс не спотыкался на отсутствующих ручках.
	get("/projects/{project}/members", func(w http.ResponseWriter, r *http.Request) error {
		return respond(w, 200, []any{})
	}, true)
	get("/projects/{project}/audit", func(w http.ResponseWriter, r *http.Request) error {
		return respond(w, 200, []any{})
	}, true)

	// Терминал существует сам по себе: проект для него не обязателен.
	get("/terminals", s.listRootTerminals, true)
	post("/terminals", s.createRootTerminal, true)
	m.HandleFunc("DELETE /api/v1/terminals/{terminal}", s.route(s.deleteRootTerminal, true))
	get("/terminals/{terminal}/ws", s.connectRootTerminal, true)

	get("/chat/config", s.getChatConfig, true)
	m.HandleFunc("PUT /api/v1/chat/config", s.route(s.putChatConfig, true))
	get("/chat/models", s.listChatModels, true)
	post("/chat/send", s.chatSend, true)

	get("/projects/{project}/terminals", s.listTerminals, true)
	post("/projects/{project}/terminals", s.createTerminal, true)
	m.HandleFunc("DELETE /api/v1/projects/{project}/terminals/{terminal}", s.route(s.deleteTerminal, true))
	get("/projects/{project}/terminals/{terminal}/ws", s.connectTerminal, true)

	m.Handle("/", s.static())

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				slog.Error("request panic", "error", v)
				http.Error(w, "Internal server error", 500)
			}
		}()
		m.ServeHTTP(w, r)
	})
}

func (s *Server) static() http.Handler {
	sub, e := fs.Sub(webFiles, "web")
	if e != nil {
		return http.NotFoundHandler()
	}
	files := http.FileServer(http.FS(sub))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name == "" {
			name = "index.html"
		}
		if _, err := fs.Stat(sub, name); err != nil {
			// Одностраничный интерфейс: всё неизвестное отдаём ему.
			r = r.Clone(r.Context())
			r.URL.Path = "/"
			w.Header().Set("Cache-Control", "no-store")
			files.ServeHTTP(w, r)
			return
		}
		if strings.HasPrefix(name, "vendor/") {
			w.Header().Set("Cache-Control", "public, max-age=86400")
		} else {
			w.Header().Set("Cache-Control", "no-store")
		}
		files.ServeHTTP(w, r)
	})
}

// ---------- вход ----------

func (s *Server) signIn(w http.ResponseWriter, r *http.Request) error {
	var c struct {
		Email string `json:"email"`
		Name  string `json:"name"`
	}
	if e := decode(w, r, &c); e != nil {
		return e
	}
	c.Email = strings.ToLower(strings.TrimSpace(c.Email))
	c.Name = strings.TrimSpace(c.Name)
	if len(c.Email) > 254 || !strings.Contains(c.Email, "@") || strings.ContainsAny(c.Email, " \r\n\t") {
		return problem(422, "invalid_email", "Use a valid email address")
	}
	if n := len([]rune(c.Name)); n < 1 || n > 64 || strings.ContainsAny(c.Name, "\r\n\t") {
		return problem(422, "invalid_name", "Name must be 1–64 characters")
	}
	raw := token()
	expires := time.Now().Add(sessionTTL)
	s.mu.Lock()
	status := 200
	if s.state.User.ID == "" {
		s.state.User.ID = newID()
		status = 201
	}
	s.state.User.Email, s.state.User.Name = c.Email, c.Name
	s.state.TokenHash, s.state.Expires = digest([]byte(raw)), expires
	user := s.state.User
	e := s.save()
	s.mu.Unlock()
	if e != nil {
		return e
	}
	http.SetCookie(w, &http.Cookie{Name: "astra_session", Value: raw, Path: "/", HttpOnly: true,
		SameSite: http.SameSiteStrictMode, Expires: expires, MaxAge: int(sessionTTL.Seconds())})
	out := map[string]any{"user": user, "expiresAt": expires}
	if r.Header.Get("X-Astra-Client") == "native" {
		out["token"] = raw
	}
	return respond(w, status, out)
}

func (s *Server) signOut(w http.ResponseWriter, r *http.Request) error {
	s.mu.Lock()
	s.state.TokenHash = ""
	e := s.save()
	s.mu.Unlock()
	if e != nil {
		return e
	}
	s.terminals.closeAll()
	http.SetCookie(w, &http.Cookie{Name: "astra_session", Value: "", Path: "/", HttpOnly: true,
		SameSite: http.SameSiteStrictMode, MaxAge: -1})
	return respond(w, 204, nil)
}

// ---------- проекты ----------

func validateMetadata(m *Metadata) error {
	m.Name = strings.TrimSpace(m.Name)
	if m.Name == "" || len(m.Name) > 160 || len(m.Desc) > 2000 || len(m.Theme) > 100 || len(m.Tags) > 8 {
		return problem(422, "invalid_project", "Invalid project metadata")
	}
	for _, tag := range m.Tags {
		if len(tag) > 50 {
			return problem(422, "invalid_project", "Tag is too long")
		}
	}
	if m.Tags == nil {
		m.Tags = []string{}
	}
	if !regexp.MustCompile(`^#[0-9a-fA-F]{6}$`).MatchString(m.Tint) {
		m.Tint = "#8fb0ff"
	}
	return nil
}

func (s *Server) record(r *http.Request) (*projectRecord, error) {
	id := r.PathValue("project")
	if !uuidRE.MatchString(id) {
		return nil, problem(404, "not_found", "Project not found")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.find(id)
	if p == nil {
		return nil, problem(404, "not_found", "Project not found")
	}
	return p, nil
}

func (s *Server) view(p *projectRecord, withFiles bool) (Project, error) {
	if p.Token == "" {
		p.Token = token()
		_ = s.save()
	}
	out := Project{ID: p.ID, Metadata: p.Metadata, Role: "owner", Preview: "/api/v1/preview/" + p.Token + "/",
		UpdatedAt: p.UpdatedAt.UnixMilli(), Revision: p.Revision,
		Files: []File{}, Snaps: []Snapshot{}, Directories: []string{}, Omitted: []string{}}
	out.Snaps = snapshotViews(p, s.state.User.Email)
	if !withFiles {
		return out, nil
	}
	root, e := s.workspace(p.dir())
	if e != nil {
		return out, e
	}
	defer root.Close()
	files, dirs, omitted, e := scan(root)
	if e != nil {
		return out, fsError(e)
	}
	out.Files, out.Directories, out.Omitted = files, dirs, omitted
	return out, nil
}

func (s *Server) listProjects(w http.ResponseWriter, r *http.Request) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	list := []Project{}
	sorted := slices.Clone(s.state.Projects)
	slices.SortFunc(sorted, func(a, b *projectRecord) int { return b.UpdatedAt.Compare(a.UpdatedAt) })
	for _, p := range sorted {
		v, e := s.view(p, false)
		if e != nil {
			return e
		}
		list = append(list, v)
	}
	return respond(w, 200, list)
}

func (s *Server) getProject(w http.ResponseWriter, r *http.Request) error {
	p, e := s.record(r)
	if e != nil {
		return e
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	v, e := s.view(p, true)
	if e != nil {
		return e
	}
	w.Header().Set("ETag", workspaceTag(v.Files))
	return respond(w, 200, v)
}

func workspaceTag(files []File) string {
	var b strings.Builder
	for _, f := range files {
		b.WriteString(f.Path)
		b.WriteByte(0)
		b.WriteString(f.ETag)
	}
	return tagOf([]byte(b.String()))
}

func (s *Server) createProject(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Metadata
		Files []FileInput `json:"files"`
	}
	if e := decode(w, r, &in); e != nil {
		return e
	}
	if e := validateMetadata(&in.Metadata); e != nil {
		return e
	}
	if len(in.Files) > MaxEntries {
		return problem(413, "quota_exceeded", "Too many files")
	}
	total := 0
	seen := map[string]bool{}
	for _, f := range in.Files {
		if e := validPath(f.Path); e != nil {
			return e
		}
		if seen[f.Path] {
			return problem(409, "duplicate_path", "Duplicate file path")
		}
		seen[f.Path] = true
		if len(f.Code) > MaxFileBytes {
			return problem(413, "file_too_large", "File exceeds 512 KiB")
		}
		total += len(f.Code)
	}
	if total > MaxProjectBytes {
		return problem(413, "quota_exceeded", "Project exceeds 8 MiB")
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	p := &projectRecord{ID: newID(), Metadata: in.Metadata, Revision: 1,
		UpdatedAt: time.Now(), Snapshots: []snapshotRecord{}}
	p.Dir = s.freeDir(p.Name, p.ID)
	root, e := s.makeWorkspace(p.Dir)
	if e != nil {
		return fsError(e)
	}
	defer root.Close()
	for _, f := range in.Files {
		if e = writeFile(root, f.Path, []byte(f.Code)); e != nil {
			_ = removeAll(s.fs, p.Dir)
			return e
		}
	}
	s.state.Projects = append(s.state.Projects, p)
	if e = s.save(); e != nil {
		return e
	}
	v, e := s.view(p, true)
	if e != nil {
		return e
	}
	return respond(w, 201, v)
}

func (s *Server) patchProject(w http.ResponseWriter, r *http.Request) error {
	p, e := s.record(r)
	if e != nil {
		return e
	}
	var in struct {
		Metadata
		Revision int `json:"revision"`
	}
	if e = decode(w, r, &in); e != nil {
		return e
	}
	if e = validateMetadata(&in.Metadata); e != nil {
		return e
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if p.Revision != in.Revision {
		return problem(409, "revision_conflict", "Project changed; reload before saving")
	}
	renamed := p.Name != in.Name
	p.Metadata = in.Metadata
	p.Revision++
	p.UpdatedAt = time.Now()
	if renamed && len(s.terminals.list(p.ID)) == 0 {
		// Открытая оболочка держала бы старый путь, поэтому папку двигаем
		// только когда терминалов у проекта нет.
		if target := s.freeDir(p.Name, p.ID); target != p.dir() {
			if e = s.fs.Rename(p.dir(), target); e == nil {
				p.Dir = target
			}
		}
	}
	if e = s.save(); e != nil {
		return e
	}
	v, e := s.view(p, false)
	if e != nil {
		return e
	}
	return respond(w, 200, v)
}

func (s *Server) deleteProject(w http.ResponseWriter, r *http.Request) error {
	p, e := s.record(r)
	if e != nil {
		return e
	}
	s.terminals.closeProject(p.ID)
	s.mu.Lock()
	defer s.mu.Unlock()
	if e = removeAll(s.fs, p.dir()); e != nil {
		return e
	}
	s.state.Projects = slices.DeleteFunc(s.state.Projects, func(x *projectRecord) bool { return x.ID == p.ID })
	if e = s.save(); e != nil {
		return e
	}
	return respond(w, 204, nil)
}

func (s *Server) touch(p *projectRecord) error {
	p.UpdatedAt = time.Now()
	return s.save()
}

// ---------- файлы ----------

func (s *Server) listFiles(w http.ResponseWriter, r *http.Request) error {
	p, e := s.record(r)
	if e != nil {
		return e
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	v, e := s.view(p, true)
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"files": v.Files, "directories": v.Directories, "omitted": v.Omitted})
}

func (s *Server) openFor(r *http.Request) (*projectRecord, string, error) {
	p, e := s.record(r)
	if e != nil {
		return nil, "", e
	}
	q := r.URL.Query().Get("path")
	if e = validPath(q); e != nil {
		return nil, "", e
	}
	return p, q, nil
}

func (s *Server) readFile(w http.ResponseWriter, r *http.Request) error {
	p, name, e := s.openFor(r)
	if e != nil {
		return e
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	root, e := s.workspace(p.dir())
	if e != nil {
		return e
	}
	defer root.Close()
	if e = checkComponents(root, name); e != nil {
		return e
	}
	b, e := readFile(root, name)
	if e != nil {
		return e
	}
	w.Header().Set("ETag", tagOf(b))
	return respond(w, 200, File{ID: digest([]byte(name))[:12], Path: name, Code: string(b), ETag: tagOf(b)})
}

func precondition(r *http.Request, b []byte, exists bool) error {
	if !exists {
		if r.Header.Get("If-None-Match") != "*" {
			return problem(428, "precondition_required", "Creating a file requires If-None-Match: *")
		}
		return nil
	}
	if r.Header.Get("If-None-Match") == "*" {
		return problem(409, "already_exists", "File already exists")
	}
	if r.Header.Get("If-Match") == "" {
		return problem(428, "precondition_required", "Editing requires the current ETag in If-Match")
	}
	if r.Header.Get("If-Match") != tagOf(b) {
		return problem(409, "conflict", "File changed on the server; refresh or keep your draft")
	}
	return nil
}

func (s *Server) writeFile(w http.ResponseWriter, r *http.Request) error {
	p, name, e := s.openFor(r)
	if e != nil {
		return e
	}
	var in struct {
		Code string `json:"code"`
	}
	if e = decode(w, r, &in); e != nil {
		return e
	}
	if len(in.Code) > MaxFileBytes {
		return problem(413, "file_too_large", "File exceeds 512 KiB")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	root, e := s.workspace(p.dir())
	if e != nil {
		return e
	}
	defer root.Close()
	if e = checkComponents(root, name); e != nil {
		return e
	}
	current, readErr := readFile(root, name)
	exists := readErr == nil
	if e = precondition(r, current, exists); e != nil {
		return e
	}
	if e = writeFile(root, name, []byte(in.Code)); e != nil {
		return e
	}
	if e = s.touch(p); e != nil {
		return e
	}
	etag := tagOf([]byte(in.Code))
	w.Header().Set("ETag", etag)
	status := 200
	if !exists {
		status = 201
	}
	return respond(w, status, File{ID: digest([]byte(name))[:12], Path: name, Code: in.Code, ETag: etag})
}

func (s *Server) deleteFile(w http.ResponseWriter, r *http.Request) error {
	p, name, e := s.openFor(r)
	if e != nil {
		return e
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	root, e := s.workspace(p.dir())
	if e != nil {
		return e
	}
	defer root.Close()
	if e = checkComponents(root, name); e != nil {
		return e
	}
	if b, readErr := readFile(root, name); readErr == nil {
		if match := r.Header.Get("If-Match"); match != "" && match != tagOf(b) {
			return problem(409, "conflict", "File changed on the server")
		}
	}
	if e = removeAll(root, name); e != nil {
		return e
	}
	if e = s.touch(p); e != nil {
		return e
	}
	return respond(w, 204, nil)
}

func (s *Server) createDirectory(w http.ResponseWriter, r *http.Request) error {
	p, e := s.record(r)
	if e != nil {
		return e
	}
	var in struct {
		Path string `json:"path"`
	}
	if e = decode(w, r, &in); e != nil {
		return e
	}
	if e = validPath(in.Path); e != nil {
		return e
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	root, e := s.workspace(p.dir())
	if e != nil {
		return e
	}
	defer root.Close()
	if e = checkComponents(root, in.Path); e != nil {
		return e
	}
	if e = mkdirAll(root, in.Path); e != nil {
		return e
	}
	if e = s.touch(p); e != nil {
		return e
	}
	return respond(w, 201, map[string]string{"path": in.Path})
}

func (s *Server) renameFile(w http.ResponseWriter, r *http.Request) error {
	p, e := s.record(r)
	if e != nil {
		return e
	}
	var in struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if e = decode(w, r, &in); e != nil {
		return e
	}
	if e = validPath(in.From); e != nil {
		return e
	}
	if e = validPath(in.To); e != nil {
		return e
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	root, e := s.workspace(p.dir())
	if e != nil {
		return e
	}
	defer root.Close()
	if e = checkComponents(root, in.From); e != nil {
		return e
	}
	if e = checkComponents(root, in.To); e != nil {
		return e
	}
	if _, err := root.Lstat(in.To); err == nil {
		return problem(409, "already_exists", "Target path already exists")
	}
	if e = mkdirAll(root, path.Dir(in.To)); e != nil {
		return e
	}
	if e = root.Rename(in.From, in.To); e != nil {
		return fsError(e)
	}
	if e = s.touch(p); e != nil {
		return e
	}
	b, _ := readFile(root, in.To)
	return respond(w, 200, File{ID: digest([]byte(in.To))[:12], Path: in.To, Code: string(b), ETag: tagOf(b)})
}

func previewType(name string) string {
	switch {
	case strings.HasSuffix(name, ".html"), strings.HasSuffix(name, ".htm"):
		return "text/html; charset=utf-8"
	case strings.HasSuffix(name, ".css"):
		return "text/css; charset=utf-8"
	case strings.HasSuffix(name, ".js"), strings.HasSuffix(name, ".mjs"):
		return "text/javascript; charset=utf-8"
	case strings.HasSuffix(name, ".json"):
		return "application/json; charset=utf-8"
	case strings.HasSuffix(name, ".svg"):
		return "image/svg+xml"
	case strings.HasSuffix(name, ".png"):
		return "image/png"
	case strings.HasSuffix(name, ".jpg"), strings.HasSuffix(name, ".jpeg"):
		return "image/jpeg"
	case strings.HasSuffix(name, ".gif"):
		return "image/gif"
	case strings.HasSuffix(name, ".webp"):
		return "image/webp"
	}
	return "text/plain; charset=utf-8"
}

func (s *Server) previewFile(w http.ResponseWriter, r *http.Request) error {
	secret := r.PathValue("token")
	s.mu.Lock()
	var p *projectRecord
	for _, candidate := range s.state.Projects {
		if candidate.Token != "" && subtle.ConstantTimeCompare([]byte(candidate.Token), []byte(secret)) == 1 {
			p = candidate
		}
	}
	s.mu.Unlock()
	if p == nil {
		return problem(404, "not_found", "Preview not found")
	}
	name := r.PathValue("path")
	if name == "" || strings.HasSuffix(name, "/") {
		name += "index.html"
	}
	if e := validPath(name); e != nil {
		return e
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	root, e := s.workspace(p.dir())
	if e != nil {
		return e
	}
	defer root.Close()
	if e := checkComponents(root, name); e != nil {
		return e
	}
	body, e := readFile(root, name)
	if e != nil {
		return e
	}
	// Кадр просмотра изолирован (sandbox без allow-same-origin), и его источник
	// становится непрозрачным — тогда 'self' в политике не совпадает ни с чем и
	// страница перестаёт видеть собственные css и js. Поэтому источник явный.
	origin := "http://" + r.Host
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		origin = "https://" + r.Host
	}
	// Наружу по https страница ходить может: без этого не подключить шрифты и
	// библиотеки с CDN и не запросить чужой API — просмотр перестаёт быть
	// просмотром. Плата понятная: код в кадре сам решает, куда обратиться, но
	// это код самого пользователя, и лежит он на его устройстве.
	// Обычный http остаётся закрытым, чтобы страницу нельзя было подменить по
	// дороге; сам движок при этом слушает петлю, и origin тут как раз http.
	net := origin + " https:"
	// Веб-сокеты нужны только соединениям: в списке шрифтов или картинок
	// схема wss: ничего не значит и лишь путает того, кто читает заголовок.
	w.Header().Set("Content-Security-Policy",
		"default-src 'none'; script-src "+net+" 'unsafe-inline' 'unsafe-eval' data: blob:; "+
			"style-src "+net+" 'unsafe-inline' data:; img-src "+net+" data: blob:; "+
			"font-src "+net+" data:; media-src "+net+" data: blob:; "+
			"connect-src "+net+" wss: data: blob:; frame-src "+net+" data: blob:; "+
			"frame-ancestors 'self'; base-uri 'none'; form-action "+net)
	w.Header().Set("Content-Type", previewType(name))
	w.Header().Set("X-Frame-Options", "SAMEORIGIN")
	w.WriteHeader(200)
	_, _ = w.Write(body)
	return nil
}

// ---------- точки восстановления ----------

func snapshotViews(p *projectRecord, who string) []Snapshot {
	out := []Snapshot{}
	for i := len(p.Snapshots) - 1; i >= 0; i-- {
		rec := p.Snapshots[i]
		files := []SnapshotFile{}
		for _, f := range rec.Files {
			files = append(files, SnapshotFile{Path: f.Path, Lines: strings.Count(f.Code, "\n") + 1})
		}
		data, _ := json.Marshal(rec.Files)
		out = append(out, Snapshot{ID: rec.ID, Hash: digest(data)[:8], Msg: rec.Msg,
			Who: who, At: rec.At.UnixMilli(), Files: files})
	}
	return out
}

func (s *Server) listSnapshots(w http.ResponseWriter, r *http.Request) error {
	p, e := s.record(r)
	if e != nil {
		return e
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return respond(w, 200, snapshotViews(p, s.state.User.Email))
}

func (s *Server) createSnapshot(w http.ResponseWriter, r *http.Request) error {
	p, e := s.record(r)
	if e != nil {
		return e
	}
	var in struct {
		Message string   `json:"message"`
		Paths   []string `json:"paths"`
	}
	if e = decode(w, r, &in); e != nil {
		return e
	}
	in.Message = strings.TrimSpace(in.Message)
	if in.Message == "" || len(in.Message) > 200 {
		return problem(422, "invalid_message", "Snapshot message must be 1–200 characters")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	root, e := s.workspace(p.dir())
	if e != nil {
		return e
	}
	defer root.Close()
	files, _, _, e := scan(root)
	if e != nil {
		return fsError(e)
	}
	keep := []FileInput{}
	for _, f := range files {
		if len(in.Paths) > 0 && !slices.Contains(in.Paths, f.Path) {
			continue
		}
		keep = append(keep, FileInput{Path: f.Path, Code: f.Code})
	}
	if len(keep) == 0 {
		return problem(422, "empty_snapshot", "Nothing to capture")
	}
	rec := snapshotRecord{ID: newID(), Msg: in.Message, At: time.Now(), Files: keep}
	p.Snapshots = append(p.Snapshots, rec)
	if len(p.Snapshots) > MaxSnapshots {
		p.Snapshots = p.Snapshots[len(p.Snapshots)-MaxSnapshots:]
	}
	if e = s.save(); e != nil {
		return e
	}
	views := snapshotViews(p, s.state.User.Email)
	return respond(w, 201, views[0])
}

func (s *Server) restoreSnapshot(w http.ResponseWriter, r *http.Request) error {
	p, e := s.record(r)
	if e != nil {
		return e
	}
	id := r.PathValue("snapshot")
	var in struct {
		Path string `json:"path"`
	}
	if r.ContentLength > 0 {
		if e = decode(w, r, &in); e != nil {
			return e
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	idx := slices.IndexFunc(p.Snapshots, func(x snapshotRecord) bool { return x.ID == id })
	if idx < 0 {
		return problem(404, "not_found", "Snapshot not found")
	}
	root, e := s.workspace(p.dir())
	if e != nil {
		return e
	}
	defer root.Close()
	restored := 0
	for _, f := range p.Snapshots[idx].Files {
		if in.Path != "" && f.Path != in.Path {
			continue
		}
		if e = writeFile(root, f.Path, []byte(f.Code)); e != nil {
			return e
		}
		restored++
	}
	if restored == 0 {
		return problem(404, "not_found", "Nothing to restore")
	}
	if e = s.touch(p); e != nil {
		return e
	}
	v, e := s.view(p, true)
	if e != nil {
		return e
	}
	return respond(w, 200, v)
}

// ---------- терминалы ----------

// Корневой терминал: тот же движок сессий, но без проекта в адресе.
const rootTerminal = "-"

func (s *Server) listRootTerminals(w http.ResponseWriter, r *http.Request) error {
	return respond(w, 200, s.terminals.list(rootTerminal))
}

func (s *Server) createRootTerminal(w http.ResponseWriter, r *http.Request) error {
	cols, rows, e := terminalSize(w, r)
	if e != nil {
		return e
	}
	t, e := s.terminals.create(rootTerminal, "", cols, rows)
	if e != nil {
		return e
	}
	return respond(w, 201, t)
}

func (s *Server) deleteRootTerminal(w http.ResponseWriter, r *http.Request) error {
	t := s.terminals.get(rootTerminal, r.PathValue("terminal"))
	if t == nil {
		return problem(404, "not_found", "Terminal not found")
	}
	s.terminals.stop(t.ID)
	return respond(w, 204, nil)
}

func (s *Server) connectRootTerminal(w http.ResponseWriter, r *http.Request) error {
	return s.attachTerminal(w, r, rootTerminal)
}

func terminalSize(w http.ResponseWriter, r *http.Request) (int, int, error) {
	var size struct {
		Cols int `json:"cols"`
		Rows int `json:"rows"`
	}
	if e := decode(w, r, &size); e != nil {
		return 0, 0, e
	}
	if size.Cols == 0 {
		size.Cols = 80
	}
	if size.Rows == 0 {
		size.Rows = 24
	}
	if size.Cols < 2 || size.Cols > 500 || size.Rows < 2 || size.Rows > 200 {
		return 0, 0, problem(422, "invalid_size", "Invalid terminal size")
	}
	return size.Cols, size.Rows, nil
}

func (s *Server) listTerminals(w http.ResponseWriter, r *http.Request) error {
	p, e := s.record(r)
	if e != nil {
		return e
	}
	return respond(w, 200, s.terminals.list(p.ID))
}

func (s *Server) createTerminal(w http.ResponseWriter, r *http.Request) error {
	p, e := s.record(r)
	if e != nil {
		return e
	}
	cols, rows, e := terminalSize(w, r)
	if e != nil {
		return e
	}
	t, e := s.terminals.create(p.ID, p.dir(), cols, rows)
	if e != nil {
		return e
	}
	return respond(w, 201, t)
}

func (s *Server) deleteTerminal(w http.ResponseWriter, r *http.Request) error {
	p, e := s.record(r)
	if e != nil {
		return e
	}
	t := s.terminals.get(p.ID, r.PathValue("terminal"))
	if t == nil {
		return problem(404, "not_found", "Terminal not found")
	}
	s.terminals.stop(t.ID)
	return respond(w, 204, nil)
}

func (s *Server) connectTerminal(w http.ResponseWriter, r *http.Request) error {
	p, e := s.record(r)
	if e != nil {
		return e
	}
	return s.attachTerminal(w, r, p.ID)
}

func (s *Server) attachTerminal(w http.ResponseWriter, r *http.Request, owner string) error {
	t := s.terminals.get(owner, r.PathValue("terminal"))
	if t == nil {
		return problem(404, "not_found", "Terminal not found")
	}
	upgrade := websocket.Upgrader{ReadBufferSize: 4096, WriteBufferSize: 8192,
		HandshakeTimeout: 5 * time.Second, CheckOrigin: func(*http.Request) bool { return true }}
	ws, e := upgrade.Upgrade(w, r, nil)
	if e != nil {
		return nil
	}
	defer ws.Close()
	ws.SetReadLimit(32 << 10)

	sub, replay := t.subscribe()
	defer t.unsubscribe(sub)
	write := func(kind int, b []byte) error {
		_ = ws.SetWriteDeadline(time.Now().Add(5 * time.Second))
		return ws.WriteMessage(kind, b)
	}
	if len(replay) > 0 && write(websocket.BinaryMessage, replay) != nil {
		return nil
	}

	readDone := make(chan struct{})
	go func() {
		defer close(readDone)
		for {
			_, b, err := ws.ReadMessage()
			if err != nil {
				return
			}
			var in struct {
				Type string `json:"type"`
				Data string `json:"data"`
				Cols int    `json:"cols"`
				Rows int    `json:"rows"`
			}
			if json.Unmarshal(b, &in) != nil {
				return
			}
			switch in.Type {
			case "input":
				if len(in.Data) > 16384 || t.write([]byte(in.Data)) != nil {
					return
				}
			case "resize":
				t.resize(in.Cols, in.Rows)
			default:
				return
			}
		}
	}()

	// Приглашение короткое, и по нему одному не видно, где мы: в проекте или уже
	// на удалённой машине после ssh. Положение оболочки шлём отдельной строкой и
	// только когда оно поменялось.
	var last terminalWhere
	place := func(first bool) bool {
		now := s.terminals.where(t)
		if now == last && !first {
			return true
		}
		last = now
		b, e := json.Marshal(struct {
			Type string `json:"type"`
			terminalWhere
		}{"where", now})
		return e == nil && write(websocket.TextMessage, b) == nil
	}
	if !place(true) {
		return nil
	}
	tick := time.NewTicker(time.Second)
	defer tick.Stop()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	for {
		select {
		case b, ok := <-sub:
			if !ok || write(websocket.BinaryMessage, b) != nil {
				return nil
			}
		case <-tick.C:
			if !place(false) {
				return nil
			}
		case <-t.done:
			_ = write(websocket.TextMessage, []byte(`{"type":"exit"}`))
			return nil
		case <-readDone:
			return nil
		case <-ctx.Done():
			return nil
		}
	}
}
