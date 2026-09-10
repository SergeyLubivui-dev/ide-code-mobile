package engine

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Terminal struct {
	ID                    string    `json:"id"`
	Project               string    `json:"projectId"`
	Created               time.Time `json:"createdAt"`
	user, auth, container string
	conn                  *attachment
	mu                    sync.Mutex
	replay                []byte
	sub                   chan []byte
	lastInput             time.Time
	done                  chan struct{}
	stopOnce              sync.Once
}
type Terminals struct {
	s     *Server
	mu    sync.Mutex
	items map[string]*Terminal
}

func NewTerminals(s *Server) *Terminals { return &Terminals{s: s, items: map[string]*Terminal{}} }
func (m *Terminals) Cleanup(ctx context.Context) error {
	if !regexp.MustCompile(`^[a-z0-9-]{1,30}$`).MatchString(m.s.cfg.Instance) {
		return errors.New("ENGINE_INSTANCE must contain 1–30 lowercase letters, digits or hyphens")
	}
	if !regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$`).MatchString(m.s.cfg.SandboxNetwork) {
		return errors.New("SANDBOX_NETWORK must be a valid Docker network name")
	}
	if e := m.s.docker.network(ctx, m.s.cfg.SandboxNetwork, m.s.cfg.Instance, m.s.cfg.SandboxSubnet); e != nil {
		return e
	}
	return m.s.docker.cleanup(ctx, m.s.cfg.Instance)
}
func (m *Terminals) HasProject(project string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, t := range m.items {
		if t.Project == project {
			return true
		}
	}
	return false
}
func (m *Terminals) Stop(id string) error {
	m.mu.Lock()
	t := m.items[id]
	m.mu.Unlock()
	if t == nil {
		return nil
	}
	// Keep the entry if Docker removal fails, so the reaper can retry and quotas remain accurate.
	if e := m.s.docker.remove(t.container); e != nil {
		return e
	}
	t.stopOnce.Do(func() { close(t.done); t.conn.Close() })
	m.mu.Lock()
	delete(m.items, id)
	m.mu.Unlock()
	return nil
}
func (m *Terminals) CloseProject(project, user string) error {
	m.mu.Lock()
	ids := []string{}
	for id, t := range m.items {
		if t.Project == project && (user == "" || user == t.user) {
			ids = append(ids, id)
		}
	}
	m.mu.Unlock()
	for _, id := range ids {
		if e := m.Stop(id); e != nil {
			return e
		}
	}
	return nil
}
func (m *Terminals) CloseAuth(auth string) {
	m.mu.Lock()
	ids := []string{}
	for id, t := range m.items {
		if t.auth == auth {
			ids = append(ids, id)
		}
	}
	m.mu.Unlock()
	for _, id := range ids {
		if e := m.Stop(id); e != nil {
			slog.Error("terminal cleanup", "error", e)
		}
	}
}
func (m *Terminals) Close() {
	m.mu.Lock()
	ids := []string{}
	for id := range m.items {
		ids = append(ids, id)
	}
	m.mu.Unlock()
	for _, id := range ids {
		if e := m.Stop(id); e != nil {
			slog.Error("terminal cleanup", "error", e)
		}
	}
}
func (m *Terminals) Reap(ctx context.Context) {
	tick := time.NewTicker(15 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			m.mu.Lock()
			list := []*Terminal{}
			for _, t := range m.items {
				list = append(list, t)
			}
			m.mu.Unlock()
			for _, t := range list {
				t.mu.Lock()
				expired := time.Since(t.lastInput) > m.s.cfg.TerminalIdle || time.Since(t.Created) > m.s.cfg.TerminalTTL
				select {
				case <-t.done:
					expired = true
				default:
				}
				t.mu.Unlock()
				var allowed bool
				e := m.s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM auth_sessions a JOIN projects p ON p.id=$2 LEFT JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=a.user_id WHERE a.token_hash=$1 AND a.expires_at>now() AND (p.owner_id=a.user_id OR pm.role='editor'))`, t.auth, t.Project).Scan(&allowed)
				if expired || e != nil || !allowed {
					if e = m.Stop(t.ID); e != nil {
						slog.Error("terminal reap", "error", e)
					}
				}
			}
			_, e := m.s.db.Exec(ctx, "DELETE FROM auth_sessions WHERE expires_at<now()")
			if e != nil {
				slog.Error("session reap", "error", e)
			}
		}
	}
}
func (t *Terminal) pump() {
	buf := make([]byte, 8192)
	for {
		n, e := t.conn.Read(buf)
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
			t.stopOnce.Do(func() { close(t.done); t.conn.Close() })
			return
		}
	}
}
func (s *Server) listTerminals(w http.ResponseWriter, r *http.Request) error {
	p, e := s.project(r, true, false)
	if e != nil {
		return e
	}
	s.terminals.mu.Lock()
	list := []*Terminal{}
	for _, t := range s.terminals.items {
		if t.Project == p.ID && t.user == current(r).ID {
			list = append(list, t)
		}
	}
	s.terminals.mu.Unlock()
	return respond(w, 200, list)
}
func (s *Server) createTerminal(w http.ResponseWriter, r *http.Request) error {
	// Serialize against project deletion and membership changes.
	defer s.lock(r.PathValue("project"))()
	p, e := s.project(r, true, false)
	if e != nil {
		return e
	}
	var size struct {
		Cols int `json:"cols"`
		Rows int `json:"rows"`
	}
	if e = decode(w, r, &size); e != nil {
		return e
	}
	if size.Cols == 0 {
		size.Cols = 80
	}
	if size.Rows == 0 {
		size.Rows = 24
	}
	if size.Cols < 2 || size.Cols > 500 || size.Rows < 2 || size.Rows > 200 {
		return problem(422, "invalid_size", "Invalid terminal size")
	}
	m := s.terminals
	m.mu.Lock()
	defer m.mu.Unlock()
	userCount := 0
	for _, t := range m.items {
		if t.user == current(r).ID {
			userCount++
		}
	}
	if userCount >= 2 || len(m.items) >= s.cfg.MaxTerminals {
		return problem(429, "terminal_limit", "Maximum 2 terminals per user and 8 per engine")
	}
	t := &Terminal{ID: newID(), Project: p.ID, Created: time.Now(), lastInput: time.Now(), user: current(r).ID, auth: current(r).TokenHash, done: make(chan struct{})}
	t.container, e = s.docker.create(r.Context(), s.cfg, p.ID, t.ID)
	if e != nil {
		slog.Error("sandbox create", "error", e)
		return problem(503, "sandbox_unavailable", "PowerShell sandbox is unavailable; check the image and Docker runtime")
	}
	ok := false
	defer func() {
		if !ok {
			_ = s.docker.remove(t.container)
		}
	}()
	t.conn, e = s.docker.attach(r.Context(), t.container)
	if e != nil {
		return e
	}
	if e = s.docker.call(r.Context(), "POST", "/containers/"+t.container+"/start", nil, nil); e != nil {
		t.conn.Close()
		return e
	}
	if e = s.docker.resize(t.container, size.Cols, size.Rows); e != nil {
		t.conn.Close()
		return e
	}
	m.items[t.ID] = t
	ok = true
	go t.pump()
	s.audit(r, "terminal.create", t.ID)
	return respond(w, 201, t)
}
func (s *Server) ownedTerminal(r *http.Request) (*Terminal, error) {
	if _, e := s.project(r, true, false); e != nil {
		return nil, e
	}
	s.terminals.mu.Lock()
	defer s.terminals.mu.Unlock()
	t := s.terminals.items[r.PathValue("terminal")]
	if t == nil || t.Project != r.PathValue("project") || t.user != current(r).ID {
		return nil, problem(404, "not_found", "Terminal not found")
	}
	return t, nil
}
func (s *Server) deleteTerminal(w http.ResponseWriter, r *http.Request) error {
	t, e := s.ownedTerminal(r)
	if e != nil {
		return e
	}
	if e = s.terminals.Stop(t.ID); e != nil {
		return e
	}
	s.audit(r, "terminal.close", t.ID)
	return respond(w, 204, nil)
}
func (s *Server) connectTerminal(w http.ResponseWriter, r *http.Request) error {
	t, e := s.ownedTerminal(r)
	if e != nil {
		return e
	}
	upgrade := websocket.Upgrader{ReadBufferSize: 4096, WriteBufferSize: 8192, HandshakeTimeout: 5 * time.Second, CheckOrigin: func(r *http.Request) bool { return true }} // Origin is checked by route before upgrade.
	ws, e := upgrade.Upgrade(w, r, nil)
	if e != nil {
		return nil
	}
	defer ws.Close()
	ws.SetReadLimit(32 << 10)
	_ = ws.SetReadDeadline(time.Now().Add(45 * time.Second))
	ws.SetPongHandler(func(string) error { return ws.SetReadDeadline(time.Now().Add(45 * time.Second)) })
	sub := make(chan []byte, 64)
	t.mu.Lock()
	if t.sub != nil {
		close(t.sub)
	}
	t.sub = sub
	replay := append([]byte(nil), t.replay...)
	t.mu.Unlock()
	defer func() {
		t.mu.Lock()
		if t.sub == sub {
			t.sub = nil
		}
		t.mu.Unlock()
	}()
	write := func(kind int, data []byte) error {
		_ = ws.SetWriteDeadline(time.Now().Add(5 * time.Second))
		return ws.WriteMessage(kind, data)
	}
	if len(replay) > 0 {
		if write(websocket.BinaryMessage, replay) != nil {
			return nil
		}
	}
	readDone := make(chan struct{})
	go func() {
		defer close(readDone)
		for {
			_, b, e := ws.ReadMessage()
			if e != nil {
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
				if len(in.Data) > 16384 {
					return
				}
				t.mu.Lock()
				t.lastInput = time.Now()
				t.mu.Unlock()
				_ = t.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
				if _, e = t.conn.Write([]byte(in.Data)); e != nil {
					return
				}
			case "resize":
				if s.docker.resize(t.container, in.Cols, in.Rows) != nil {
					return
				}
			default:
				return
			}
		}
	}()
	tick := time.NewTicker(15 * time.Second)
	defer tick.Stop()
	for {
		select {
		case b, ok := <-sub:
			if !ok {
				return nil
			}
			if write(websocket.BinaryMessage, b) != nil {
				return nil
			}
		case <-t.done:
			_ = write(websocket.TextMessage, []byte(`{"type":"exit"}`))
			return nil
		case <-readDone:
			return nil
		case <-r.Context().Done():
			return nil
		case <-tick.C:
			if _, e = s.authenticate(r); e != nil {
				return nil
			}
			if _, e = s.project(r, true, false); e != nil {
				return nil
			}
			if write(websocket.PingMessage, nil) != nil {
				return nil
			}
		}
	}
}
