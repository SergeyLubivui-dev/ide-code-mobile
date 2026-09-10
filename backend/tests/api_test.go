package tests

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

type apiClient struct {
	t    *testing.T
	http *http.Client
	base string
}

func client(t *testing.T, base string) *apiClient {
	jar, _ := cookiejar.New(nil)
	return &apiClient{t, &http.Client{Jar: jar, Timeout: 40 * time.Second}, base}
}
func (c *apiClient) req(method, path string, body any, status int, headers ...map[string]string) (map[string]any, http.Header) {
	c.t.Helper()
	var raw []byte
	if body != nil {
		raw, _ = json.Marshal(body)
	}
	r, e := http.NewRequest(method, c.base+"/api/v1"+path, bytes.NewReader(raw))
	if e != nil {
		c.t.Fatal(e)
	}
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Requested-With", "astracode")
	for _, h := range headers {
		for k, v := range h {
			r.Header.Set(k, v)
		}
	}
	res, e := c.http.Do(r)
	if e != nil {
		c.t.Fatal(e)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	if res.StatusCode != status {
		c.t.Fatalf("%s %s: got %d want %d: %s", method, path, res.StatusCode, status, b)
	}
	out := map[string]any{}
	if len(b) > 0 {
		if b[0] == '[' {
			var list []any
			if e = json.Unmarshal(b, &list); e != nil {
				c.t.Fatal(e)
			}
			out["items"] = list
		} else if e = json.Unmarshal(b, &out); e != nil {
			c.t.Fatalf("invalid JSON %s", b)
		}
	}
	return out, res.Header
}
func (c *apiClient) ws(path string, origin string) (*websocket.Conn, *http.Response, error) {
	u, _ := url.Parse(c.base)
	h := http.Header{}
	for _, cookie := range c.http.Jar.Cookies(u) {
		h.Add("Cookie", cookie.String())
	}
	h.Set("Origin", origin)
	return websocket.DefaultDialer.Dial(strings.Replace(c.base, "http", "ws", 1)+"/api/v1"+path, h)
}
func TestAPIEndToEnd(t *testing.T) {
	base := os.Getenv("TEST_BASE_URL")
	if base == "" {
		t.Skip("set TEST_BASE_URL to run real Docker/PostgreSQL integration tests")
	}
	a, b, anon := client(t, base), client(t, base), client(t, base)
	a.req("GET", "/health/live", nil, 200)
	a.req("GET", "/health/ready", nil, 200)
	a.req("GET", "/config", nil, 200)
	anon.req("GET", "/projects", nil, 401)
	suffix := fmt.Sprint(time.Now().UnixNano())
	nameA := "Owner " + suffix
	emailA := "owner-" + suffix + "@example.test"
	emailB := "member-" + suffix + "@example.test"
	// Passwordless sign-in: the email is the account, the name is its label, a repeat sign-in renames.
	a.req("POST", "/auth/login", map[string]string{"email": "not-an-email", "name": nameA}, 422)
	a.req("POST", "/auth/login", map[string]string{"email": emailA, "name": ""}, 422)
	a.req("POST", "/auth/login", map[string]string{"email": emailA, "name": nameA, "password": "legacy"}, 400)
	a.req("POST", "/auth/login", map[string]string{"email": emailA, "name": nameA}, 403, map[string]string{"X-Requested-With": ""})
	a.req("POST", "/auth/login", map[string]string{"email": emailA, "name": nameA}, 201)
	renamed, _ := a.req("POST", "/auth/login", map[string]string{"email": emailA, "name": nameA + " again"}, 200)
	if renamed["user"].(map[string]any)["name"].(string) != nameA+" again" {
		t.Fatalf("second sign-in did not update the name: %v", renamed["user"])
	}
	member, _ := b.req("POST", "/auth/login", map[string]string{"email": emailB, "name": "Member"}, 201)
	memberID := member["user"].(map[string]any)["id"].(string)
	a.req("GET", "/auth/me", nil, 200)
	meta := map[string]any{"name": "Integration project", "desc": "Disposable integration fixture", "theme": "Tests", "tags": []string{"go"}, "tint": "#8fb0ff", "files": []map[string]string{{"path": "README.md", "code": "# Hello\n"}}}
	project, _ := a.req("POST", "/projects", meta, 201)
	id := project["id"].(string)
	p := "/projects/" + id
	deleted := false
	t.Cleanup(func() {
		if !deleted {
			a.req("DELETE", p, nil, 204)
		}
	})
	a.req("GET", "/projects", nil, 200)
	b.req("GET", p, nil, 404)
	b.req("PUT", p+"/file?path=foreign.txt", map[string]string{"code": "no"}, 404, map[string]string{"If-None-Match": "*"})
	anon.req("GET", p, nil, 401)
	updated := map[string]any{"name": "Renamed", "desc": "test", "theme": "Tests", "tags": []string{}, "tint": "#8fb0ff", "revision": 1}
	a.req("PATCH", p, updated, 200)
	a.req("PATCH", p, updated, 409)
	_, head := a.req("GET", p+"/file?path=README.md", nil, 200)
	oldTag := head.Get("ETag")
	if oldTag == "" {
		t.Fatal("ETag missing")
	}
	a.req("PUT", p+"/file?path=README.md", map[string]string{"code": "new"}, 428)
	a.req("PUT", p+"/file?path=README.md", map[string]string{"code": "new"}, 409, map[string]string{"If-Match": "stale"})
	a.req("PUT", p+"/file?path=README.md", map[string]string{"code": "new"}, 409, map[string]string{"If-None-Match": "*"})
	a.req("PUT", p+"/file?path=README.md", map[string]string{"code": "new"}, 403, map[string]string{"If-Match": oldTag, "Origin": "https://evil.example"})
	_, head = a.req("PUT", p+"/file?path=README.md", map[string]string{"code": "# Обновлено\n"}, 200, map[string]string{"If-Match": oldTag})
	newTag := head.Get("ETag")
	a.req("PUT", p+"/file?path=README.md", map[string]string{"code": "stale browser"}, 409, map[string]string{"If-Match": oldTag})
	for _, path := range []string{"../secret", "/etc/passwd", "a/../../secret", "C:\\Windows\\file", "a//b", "a/./b"} {
		a.req("PUT", p+"/file?path="+url.QueryEscape(path), map[string]string{"code": "escape"}, 422, map[string]string{"If-None-Match": "*"})
	}
	a.req("PUT", p+"/file?path=large", map[string]string{"code": strings.Repeat("a", (512<<10)+1)}, 413, map[string]string{"If-None-Match": "*"})
	a.req("POST", p+"/directories", map[string]string{"path": "src/русский"}, 201)
	file, _ := a.req("PUT", p+"/file?path=src/hello.ps1", map[string]string{"code": "Write-Output 'API_OK'\n"}, 201, map[string]string{"If-None-Match": "*"})
	a.req("GET", p+"/files", nil, 200)
	moved, _ := a.req("POST", p+"/rename", map[string]string{"from": "src/hello.ps1", "to": "src/run.ps1"}, 200, map[string]string{"If-Match": file["etag"].(string)})
	a.req("GET", p+"/file?path=src/hello.ps1", nil, 404)
	snap, _ := a.req("POST", p+"/snapshots", map[string]any{"message": "before edit", "paths": []string{"README.md"}}, 201)
	sid := snap["id"].(string)
	a.req("GET", p+"/snapshots", nil, 200)
	a.req("PUT", p+"/file?path=README.md", map[string]string{"code": "changed after snapshot"}, 200, map[string]string{"If-Match": newTag})
	_, workspaceHead := a.req("GET", p, nil, 200)
	a.req("POST", p+"/snapshots/"+sid+"/restore", map[string]string{}, 428)
	a.req("POST", p+"/snapshots/"+sid+"/restore", map[string]string{}, 409, map[string]string{"If-Match": "stale"})
	a.req("POST", p+"/snapshots/"+sid+"/restore", map[string]string{}, 200, map[string]string{"If-Match": workspaceHead.Get("ETag")})
	restored, _ := a.req("GET", p+"/file?path=README.md", nil, 200)
	if restored["code"] != "# Обновлено\n" {
		t.Fatal("snapshot restore failed")
	}
	a.req("PUT", p+"/members", map[string]string{"email": emailB, "role": "viewer"}, 200)
	a.req("GET", p+"/members", nil, 200)
	b.req("GET", p, nil, 200)
	b.req("PUT", p+"/file?path=blocked", map[string]string{"code": "no"}, 403, map[string]string{"If-None-Match": "*"})
	b.req("POST", p+"/terminals", map[string]int{}, 403)
	b.req("DELETE", p, nil, 403)
	a.req("PUT", p+"/members", map[string]string{"email": emailB, "role": "editor"}, 200)
	b.req("PUT", p+"/file?path=shared.txt", map[string]string{"code": "shared"}, 201, map[string]string{"If-None-Match": "*"})
	b.req("GET", p+"/members", nil, 403)
	t.Log("Auth, CSRF, IDOR, roles, project/file CRUD, ETags, UTF-8, quotas, snapshots passed")

	terminal, _ := a.req("POST", p+"/terminals", map[string]int{"cols": 100, "rows": 30}, 201)
	tid := terminal["id"].(string)
	termPath := p + "/terminals/" + tid
	t.Cleanup(func() {
		if !deleted {
			a.req("DELETE", termPath, nil, 204)
		}
	})
	a.req("GET", p+"/terminals", nil, 200)
	b.req("DELETE", termPath, nil, 404)
	if ws, res, e := a.ws(termPath+"/ws", "https://evil.example"); e == nil {
		ws.Close()
		t.Fatal("cross-origin WebSocket accepted")
	} else if res == nil || res.StatusCode != 403 {
		t.Fatalf("expected WS origin 403: %v %v", res, e)
	}
	ws, _, e := a.ws(termPath+"/ws", base)
	if e != nil {
		t.Fatal(e)
	}
	defer ws.Close()
	_ = ws.SetReadDeadline(time.Now().Add(30 * time.Second))
	var mu, writeMu sync.Mutex
	var output strings.Builder
	readErr := make(chan error, 1)
	send := func(v any) error { writeMu.Lock(); defer writeMu.Unlock(); return ws.WriteJSON(v) }
	go func() {
		for {
			_, data, e := ws.ReadMessage()
			if e != nil {
				readErr <- e
				return
			}
			// A real terminal answers VT cursor-position requests; emulate that response for PSReadLine.
			for i := 0; i < bytes.Count(data, []byte("\x1b[6n")); i++ {
				if e = send(map[string]string{"type": "input", "data": "\x1b[1;1R"}); e != nil {
					readErr <- e
					return
				}
			}
			mu.Lock()
			output.Write(data)
			mu.Unlock()
		}
	}()
	waitText := func(text string) {
		t.Helper()
		deadline := time.Now().Add(25 * time.Second)
		for time.Now().Before(deadline) {
			mu.Lock()
			got := output.String()
			mu.Unlock()
			if strings.Contains(got, text) {
				return
			}
			select {
			case e := <-readErr:
				t.Fatalf("WebSocket ended before %q: %v output=%s", text, e, got)
			default:
			}
			time.Sleep(50 * time.Millisecond)
		}
		mu.Lock()
		got := output.String()
		mu.Unlock()
		t.Fatalf("missing %q: %s", text, got)
	}
	// The sandbox prompt is deliberately short: the container path in full
	// ("PS /workspace/src>") ate half a line on a phone. "~" is the project root.
	waitText("~>")
	if e = send(map[string]any{"type": "resize", "cols": 90, "rows": 28}); e != nil {
		t.Fatal(e)
	}
	// Split the marker to ensure command echo cannot satisfy the assertion.
	command := "$v = 'SHELL_' + 'LIVE'; Write-Output $v; Set-Content -Path shell.txt -Value ('FROM_' + 'POWERSHELL'); & ./src/run.ps1\r"
	if e = send(map[string]string{"type": "input", "data": command}); e != nil {
		t.Fatal(e)
	}
	waitText("SHELL_LIVE")
	waitText("API_OK")
	created, _ := a.req("GET", p+"/file?path=shell.txt", nil, 200)
	if !strings.Contains(created["code"].(string), "FROM_POWERSHELL") {
		t.Fatal("shell file was not visible to API")
	}
	a.req("PUT", p+"/file?path=api.txt", map[string]string{"code": "API_TO_SHELL"}, 201, map[string]string{"If-None-Match": "*"})
	if e = send(map[string]string{"type": "input", "data": "Get-Content api.txt\r"}); e != nil {
		t.Fatal(e)
	}
	waitText("API_TO_SHELL")
	if e = send(map[string]string{"type": "input", "data": "Write-Output ('CWD_' + $PWD.Path); Write-Output ($PSVersionTable.PSVersion.ToString()); Write-Output ('SOCKET_' + (Test-Path /var/run/docker.sock)); Write-Output ('DB_' + [bool]$env:DATABASE_URL); Write-Output ('HOST_' + (Test-Path /workspaces)); Write-Output ('USER_' + (& id -u)); & ln -s /etc/passwd escape.txt; & mkfifo pipe.txt\r"}); e != nil {
		t.Fatal(e)
	}
	// A short prompt must not cost the shell its real location.
	waitText("CWD_/workspace")
	waitText("SOCKET_False")
	waitText("DB_False")
	waitText("HOST_False")
	waitText("USER_1000")
	// Wait for the shell to finish creating both adversarial paths.
	if e = send(map[string]string{"type": "input", "data": "Write-Output ('PATHS_' + 'READY')\r"}); e != nil {
		t.Fatal(e)
	}
	waitText("PATHS_READY")
	a.req("GET", p+"/file?path=escape.txt", nil, 422)
	a.req("GET", p+"/file?path=pipe.txt", nil, 422)
	_, workspaceHead = a.req("GET", p, nil, 200)
	a.req("POST", p+"/snapshots/"+sid+"/restore", map[string]string{}, 409, map[string]string{"If-Match": workspaceHead.Get("ETag")})
	if e = send(map[string]string{"type": "input", "data": "Start-Sleep -Seconds 60\r"}); e != nil {
		t.Fatal(e)
	}
	time.Sleep(200 * time.Millisecond)
	if e = send(map[string]string{"type": "input", "data": "\x03"}); e != nil {
		t.Fatal(e)
	}
	time.Sleep(200 * time.Millisecond)
	if e = send(map[string]string{"type": "input", "data": "Write-Output ('INTERRUPT_' + 'OK')\r"}); e != nil {
		t.Fatal(e)
	}
	waitText("INTERRUPT_OK")
	ws.Close()
	ws2, _, e := a.ws(termPath+"/ws", base)
	if e != nil {
		t.Fatal(e)
	}
	_ = ws2.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, replay, e := ws2.ReadMessage()
	if e != nil || !bytes.Contains(replay, []byte("SHELL_LIVE")) {
		t.Fatalf("replay missing: %v", e)
	}
	ws2.Close()
	a.req("DELETE", termPath, nil, 204)
	// Remove the terminal cleanup now that the explicit endpoint was verified.
	terminal2, _ := b.req("POST", p+"/terminals", map[string]int{}, 201)
	a.req("DELETE", p+"/members/"+memberID, nil, 204)
	b.req("GET", p, nil, 404)
	a.req("GET", p+"/terminals", nil, 200)
	_ = terminal2
	a.req("GET", p+"/audit", nil, 200)
	a.req("DELETE", p+"/file?path=src/run.ps1", nil, 204, map[string]string{"If-Match": moved["etag"].(string)})
	a.req("DELETE", p, nil, 204)
	deleted = true
	a.req("GET", p, nil, 404)
	a.req("POST", "/auth/logout", nil, 204)
	a.req("GET", "/auth/me", nil, 401)
	a.req("POST", "/auth/login", map[string]string{"email": emailA, "name": nameA}, 200)
	a.req("POST", "/auth/logout", nil, 204)
	b.req("POST", "/auth/logout", nil, 204)
	t.Log("Real PowerShell PTY, resize, bidirectional files, symlink/FIFO rejection, Ctrl+C, replay and membership revocation passed")
}
