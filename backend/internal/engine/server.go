package engine

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Config struct {
	DatabaseURL, Workspace, Volume, Image, Instance, Listen string
	SandboxNetwork, SandboxSubnet                           string
	SecureCookies, Registration                             bool
	SessionTTL, TerminalIdle, TerminalTTL                   time.Duration
	MaxTerminals                                            int
}

func EnvConfig() Config {
	env := func(k, d string) string {
		if v := os.Getenv(k); v != "" {
			return v
		}
		return d
	}
	return Config{DatabaseURL: os.Getenv("DATABASE_URL"), Workspace: env("WORKSPACE_ROOT", "/workspaces"),
		Volume: env("WORKSPACE_VOLUME", "astracode-workspaces"), Image: env("SANDBOX_IMAGE", "astracode-powershell:local"),
		Instance: env("ENGINE_INSTANCE", "local"), Listen: env("LISTEN_ADDR", ":8080"),
		SandboxNetwork: env("SANDBOX_NETWORK", "astracode-sandbox"), SandboxSubnet: env("SANDBOX_SUBNET", "10.201.7.0/24"),
		SecureCookies: env("COOKIE_SECURE", "true") == "true", Registration: env("ALLOW_REGISTRATION", "false") == "true",
		SessionTTL: 24 * time.Hour, TerminalIdle: 30 * time.Minute, TerminalTTL: 2 * time.Hour, MaxTerminals: 8}
}

type Server struct {
	cfg       Config
	db        *pgxpool.Pool
	fs        *os.Root
	docker    *Docker
	terminals *Terminals
	locks     [128]sync.Mutex
	rateMu    sync.Mutex
	rates     map[string]rateEntry
}
type rateEntry struct {
	count int
	until time.Time
}
type User struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Name  string `json:"name"`
}
type identity struct {
	User
	TokenHash string
}
type identityKey struct{}
type apiError struct {
	Status        int
	Code, Message string
}

func (e *apiError) Error() string                    { return e.Message }
func problem(status int, code, message string) error { return &apiError{status, code, message} }

type endpoint func(http.ResponseWriter, *http.Request) error

func New(ctx context.Context, cfg Config) (*Server, error) {
	if cfg.DatabaseURL == "" {
		return nil, errors.New("DATABASE_URL is required")
	}
	db, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return nil, err
	}
	if err = db.Ping(ctx); err != nil {
		db.Close()
		return nil, err
	}
	var revision string
	if err = db.QueryRow(ctx, "SELECT version_num FROM alembic_version").Scan(&revision); err != nil || revision != "0002_passwordless" {
		db.Close()
		return nil, errors.New("run alembic upgrade head before starting API")
	}
	if err = os.MkdirAll(cfg.Workspace, 0755); err != nil {
		db.Close()
		return nil, err
	}
	root, err := os.OpenRoot(cfg.Workspace)
	if err != nil {
		db.Close()
		return nil, err
	}
	s := &Server{cfg: cfg, db: db, fs: root, rates: map[string]rateEntry{}, docker: NewDocker()}
	s.terminals = NewTerminals(s)
	if err = s.terminals.Cleanup(ctx); err != nil {
		root.Close()
		db.Close()
		return nil, fmt.Errorf("sandbox runtime: %w", err)
	}
	go s.terminals.Reap(ctx)
	return s, nil
}
func (s *Server) Close() { s.terminals.Close(); s.fs.Close(); s.db.Close() }
func (s *Server) lock(id string) func() {
	n := sha256.Sum256([]byte(id))
	m := &s.locks[int(n[0])%len(s.locks)]
	m.Lock()
	return m.Unlock
}
func newID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	h := hex.EncodeToString(b)
	return h[:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}
func token() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
func digest(b []byte) string           { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
func current(r *http.Request) identity { return r.Context().Value(identityKey{}).(identity) }
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
	if err := d.Decode(v); err != nil {
		var large *http.MaxBytesError
		if errors.As(err, &large) {
			return problem(413, "body_too_large", "Request body exceeds 9 MiB")
		}
		return problem(400, "invalid_json", "Invalid JSON body")
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return problem(400, "invalid_json", "Expected exactly one JSON value")
	}
	return nil
}
func (s *Server) route(fn endpoint, auth bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		run := func() error {
			if origin := r.Header.Get("Origin"); origin != "" {
				u, e := url.Parse(origin)
				if e != nil || u.Host != r.Host || (u.Scheme != "https" && u.Scheme != "http") {
					return problem(403, "origin_denied", "Origin is not allowed")
				}
			}
			if r.Method != "GET" && r.Method != "HEAD" && r.Header.Get("X-Requested-With") != "astracode" {
				return problem(403, "csrf", "X-Requested-With: astracode is required")
			}
			if auth {
				who, err := s.authenticate(r)
				if err != nil {
					return err
				}
				r = r.WithContext(context.WithValue(r.Context(), identityKey{}, who))
			}
			return fn(w, r)
		}
		if err := run(); err != nil {
			ae := &apiError{500, "internal_error", "Internal server error"}
			if !errors.As(err, &ae) {
				slog.Error("request failed", "method", r.Method, "path", r.URL.Path, "error", err)
			}
			_ = respond(w, ae.Status, map[string]any{"error": map[string]string{"code": ae.Code, "message": ae.Message}})
		}
	}
}
func (s *Server) Handler() http.Handler {
	m := http.NewServeMux()
	m.HandleFunc("GET /api/v1/health/live", s.route(func(w http.ResponseWriter, r *http.Request) error {
		return respond(w, 200, map[string]string{"status": "ok"})
	}, false))
	m.HandleFunc("GET /api/v1/health/ready", s.route(func(w http.ResponseWriter, r *http.Request) error {
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()
		if s.db.Ping(ctx) != nil {
			return problem(503, "database_unavailable", "Database unavailable")
		}
		return respond(w, 200, map[string]string{"status": "ready"})
	}, false))
	m.HandleFunc("GET /api/v1/config", s.route(func(w http.ResponseWriter, r *http.Request) error {
		return respond(w, 200, map[string]any{"mode": "server", "registration": s.cfg.Registration, "shell": "PowerShell 7 / Linux", "shellShort": "PowerShell", "chat": false, "rootTerminal": false, "maxFileBytes": MaxFileBytes, "maxProjectBytes": MaxProjectBytes})
	}, false))
	m.HandleFunc("POST /api/v1/auth/register", s.route(s.signIn, false))
	m.HandleFunc("POST /api/v1/auth/login", s.route(s.signIn, false))
	m.HandleFunc("GET /api/v1/auth/me", s.route(func(w http.ResponseWriter, r *http.Request) error { return respond(w, 200, current(r).User) }, true))
	m.HandleFunc("POST /api/v1/auth/logout", s.route(s.logout, true))
	m.HandleFunc("GET /api/v1/projects", s.route(s.listProjects, true))
	m.HandleFunc("POST /api/v1/projects", s.route(s.createProject, true))
	m.HandleFunc("GET /api/v1/projects/{project}", s.route(s.getProject, true))
	m.HandleFunc("PATCH /api/v1/projects/{project}", s.route(s.patchProject, true))
	m.HandleFunc("DELETE /api/v1/projects/{project}", s.route(s.deleteProject, true))
	m.HandleFunc("GET /api/v1/projects/{project}/files", s.route(s.listFiles, true))
	m.HandleFunc("GET /api/v1/projects/{project}/file", s.route(s.readFile, true))
	m.HandleFunc("PUT /api/v1/projects/{project}/file", s.route(s.writeFile, true))
	m.HandleFunc("DELETE /api/v1/projects/{project}/file", s.route(s.deleteFile, true))
	m.HandleFunc("POST /api/v1/projects/{project}/directories", s.route(s.createDirectory, true))
	m.HandleFunc("POST /api/v1/projects/{project}/rename", s.route(s.renameFile, true))
	m.HandleFunc("GET /api/v1/projects/{project}/snapshots", s.route(s.listSnapshots, true))
	m.HandleFunc("POST /api/v1/projects/{project}/snapshots", s.route(s.createSnapshot, true))
	m.HandleFunc("POST /api/v1/projects/{project}/snapshots/{snapshot}/restore", s.route(s.restoreSnapshot, true))
	m.HandleFunc("GET /api/v1/projects/{project}/members", s.route(s.listMembers, true))
	m.HandleFunc("PUT /api/v1/projects/{project}/members", s.route(s.putMember, true))
	m.HandleFunc("DELETE /api/v1/projects/{project}/members/{user}", s.route(s.deleteMember, true))
	m.HandleFunc("GET /api/v1/projects/{project}/audit", s.route(s.listAudit, true))
	m.HandleFunc("GET /api/v1/projects/{project}/terminals", s.route(s.listTerminals, true))
	m.HandleFunc("POST /api/v1/projects/{project}/terminals", s.route(s.createTerminal, true))
	m.HandleFunc("DELETE /api/v1/projects/{project}/terminals/{terminal}", s.route(s.deleteTerminal, true))
	m.HandleFunc("GET /api/v1/projects/{project}/terminals/{terminal}/ws", s.route(s.connectTerminal, true))
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

func (s *Server) authenticate(r *http.Request) (identity, error) {
	raw := ""
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		raw = strings.TrimPrefix(h, "Bearer ")
	} else if c, e := r.Cookie("astra_session"); e == nil {
		raw = c.Value
	}
	if len(raw) != 64 {
		return identity{}, problem(401, "unauthorized", "Sign in required")
	}
	who := identity{TokenHash: digest([]byte(raw))}
	err := s.db.QueryRow(r.Context(), "SELECT u.id,u.email,u.name FROM auth_sessions a JOIN users u ON u.id=a.user_id WHERE a.token_hash=$1 AND a.expires_at>now()", who.TokenHash).Scan(&who.ID, &who.Email, &who.Name)
	if errors.Is(err, pgx.ErrNoRows) {
		return who, problem(401, "unauthorized", "Session expired")
	}
	return who, err
}
func (s *Server) authRate(r *http.Request) error {
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	s.rateMu.Lock()
	defer s.rateMu.Unlock()
	now := time.Now()
	for k, v := range s.rates {
		if now.After(v.until) {
			delete(s.rates, k)
		}
	}
	key := ip
	v := s.rates[key]
	if now.After(v.until) {
		v = rateEntry{until: now.Add(time.Minute)}
	}
	v.count++
	s.rates[key] = v
	if v.count > 30 {
		return problem(429, "rate_limited", "Too many attempts; retry in one minute")
	}
	return nil
}

type credentials struct {
	Email string `json:"email"`
	Name  string `json:"name"`
}

// signIn is passwordless: an email identifies the account, the name is the display label.
// A first sign-in creates the account when ALLOW_REGISTRATION is on; later ones update the name.
func (s *Server) signIn(w http.ResponseWriter, r *http.Request) error {
	if e := s.authRate(r); e != nil {
		return e
	}
	var c credentials
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
	user, status := User{Email: c.Email, Name: c.Name}, 200
	e := s.db.QueryRow(r.Context(), "SELECT id FROM users WHERE email=$1", c.Email).Scan(&user.ID)
	if e != nil && !errors.Is(e, pgx.ErrNoRows) {
		return e
	}
	if user.ID == "" {
		if !s.cfg.Registration {
			return problem(403, "registration_disabled", "This server does not accept new accounts")
		}
		user.ID, status = newID(), 201
	}
	// One statement covers both cases, so a concurrent first sign-in cannot lose the race.
	if e = s.db.QueryRow(r.Context(), `INSERT INTO users(id,email,name) VALUES($1,$2,$3)
		ON CONFLICT(email) DO UPDATE SET name=excluded.name RETURNING id,email,name`,
		user.ID, user.Email, user.Name).Scan(&user.ID, &user.Email, &user.Name); e != nil {
		return e
	}
	return s.issueSession(w, r, user, status)
}
func (s *Server) issueSession(w http.ResponseWriter, r *http.Request, user User, status int) error {
	raw := token()
	expires := time.Now().Add(s.cfg.SessionTTL)
	_, e := s.db.Exec(r.Context(), "INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)", digest([]byte(raw)), user.ID, expires)
	if e != nil {
		return e
	}
	http.SetCookie(w, &http.Cookie{Name: "astra_session", Value: raw, Path: "/", HttpOnly: true, Secure: s.cfg.SecureCookies, SameSite: http.SameSiteStrictMode, Expires: expires, MaxAge: int(s.cfg.SessionTTL.Seconds())})
	// The token is returned only on explicit native-client opt-in; browser uses HttpOnly cookies.
	out := map[string]any{"user": user, "expiresAt": expires}
	if r.Header.Get("X-Astra-Client") == "native" {
		out["token"] = raw
	}
	return respond(w, status, out)
}
func (s *Server) logout(w http.ResponseWriter, r *http.Request) error {
	_, e := s.db.Exec(r.Context(), "DELETE FROM auth_sessions WHERE token_hash=$1", current(r).TokenHash)
	if e != nil {
		return e
	}
	s.terminals.CloseAuth(current(r).TokenHash)
	http.SetCookie(w, &http.Cookie{Name: "astra_session", Value: "", Path: "/", HttpOnly: true, Secure: s.cfg.SecureCookies, SameSite: http.SameSiteStrictMode, MaxAge: -1})
	return respond(w, 204, nil)
}
func (s *Server) audit(r *http.Request, action, path string) {
	_, e := s.db.Exec(r.Context(), "INSERT INTO audit_events(project_id,user_id,action,path) VALUES($1,$2,$3,$4)", r.PathValue("project"), current(r).ID, action, path)
	if e != nil {
		slog.Error("audit failed", "error", e)
	}
}
func limitQuery(r *http.Request) int {
	n, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if n < 1 || n > 100 {
		n = 100
	}
	return n
}
