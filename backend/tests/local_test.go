package tests

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"astracode/backend/internal/local"

	"github.com/gorilla/websocket"
)

type localClient struct {
	t    *testing.T
	http *http.Client
	base string
}

func (c *localClient) do(method, path string, body any, status int, headers ...map[string]string) map[string]any {
	c.t.Helper()
	var raw []byte
	if body != nil {
		raw, _ = json.Marshal(body)
	}
	r, e := http.NewRequest(method, c.base+path, bytes.NewReader(raw))
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
	if len(b) > 0 && b[0] == '[' {
		var list []any
		if e = json.Unmarshal(b, &list); e != nil {
			c.t.Fatal(e)
		}
		out["items"] = list
	} else if len(b) > 0 {
		if e = json.Unmarshal(b, &out); e != nil {
			c.t.Fatalf("invalid JSON %s", b)
		}
	}
	return out
}

// Локальный движок целиком в процессе: диск, состояние и настоящий PTY.
func TestLocalEngine(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("PTY-часть движка работает на Linux и Android")
	}
	dataRoot := t.TempDir()
	engine, e := local.New(local.Config{Root: dataRoot, Listen: "127.0.0.1:0", Shell: "/bin/sh"})
	if e != nil {
		t.Fatal(e)
	}
	defer engine.Close()
	srv := httptest.NewServer(engine.Handler())
	defer srv.Close()
	jar, _ := cookiejar.New(nil)
	c := &localClient{t, &http.Client{Jar: jar, Timeout: 20 * time.Second}, srv.URL + "/api/v1"}

	c.do("GET", "/health/ready", nil, 200)
	if cfg := c.do("GET", "/config", nil, 200); cfg["mode"] != "local" {
		t.Fatalf("expected local mode, got %v", cfg["mode"])
	}
	c.do("GET", "/projects", nil, 401)

	c.do("POST", "/auth/login", map[string]string{"email": "me@example.test", "name": "Я"}, 201)
	c.do("GET", "/auth/me", nil, 200)

	project := c.do("POST", "/projects", map[string]any{
		"name": "Локальный", "desc": "", "theme": "", "tags": []string{}, "tint": "#8fb0ff",
		"files": []map[string]string{{"path": "README.md", "code": "# Привет\n"}},
	}, 201)
	id := project["id"].(string)
	p := "/projects/" + id

	if files := project["files"].([]any); len(files) != 1 {
		t.Fatalf("expected one file, got %d", len(files))
	}

	// Папка проекта названа по проекту, а не по UUID: путь в терминале читается.
	entries, e := os.ReadDir(filepath.Join(dataRoot, local.WorkspaceDir))
	if e != nil || len(entries) != 1 {
		t.Fatalf("expected one workspace folder: %v %v", entries, e)
	}
	folder := entries[0].Name()
	if folder != "Локальный" {
		t.Fatalf("workspace folder is not named after the project: %q", folder)
	}
	read := c.do("GET", p+"/file?path=README.md", nil, 200)
	if read["code"] != "# Привет\n" {
		t.Fatalf("UTF-8 round trip broken: %q", read["code"])
	}

	// Условная запись: без ETag правку не принимаем, с устаревшим — конфликт.
	c.do("PUT", p+"/file?path=README.md", map[string]string{"code": "x"}, 428)
	saved := c.do("PUT", p+"/file?path=README.md", map[string]string{"code": "# Обновлено\n"}, 200,
		map[string]string{"If-Match": read["etag"].(string)})
	c.do("PUT", p+"/file?path=README.md", map[string]string{"code": "снова"}, 409,
		map[string]string{"If-Match": read["etag"].(string)})
	_ = saved

	c.do("POST", p+"/snapshots", map[string]any{"message": "первая точка", "paths": []string{"README.md"}}, 201)
	if snaps := c.do("GET", p+"/snapshots", nil, 200)["items"].([]any); len(snaps) != 1 {
		t.Fatalf("expected one snapshot, got %d", len(snaps))
	}

	// Пути наружу проекта закрыты.
	c.do("GET", p+"/file?path=../state.json", nil, 422)
	c.do("PUT", p+"/file?path=/etc/passwd", map[string]string{"code": "no"}, 422,
		map[string]string{"If-None-Match": "*"})

	terminal := c.do("POST", p+"/terminals", map[string]int{"cols": 80, "rows": 24}, 201)
	tid := terminal["id"].(string)
	u, _ := url.Parse(srv.URL)
	header := http.Header{}
	for _, cookie := range jar.Cookies(u) {
		header.Add("Cookie", cookie.String())
	}
	ws, _, e := websocket.DefaultDialer.Dial(
		strings.Replace(srv.URL, "http", "ws", 1)+"/api/v1"+p+"/terminals/"+tid+"/ws", header)
	if e != nil {
		t.Fatal(e)
	}
	defer ws.Close()

	// Ждём любую из подходящих строк: оболочки с заменой префикса печатают
	// приглашение с «~», остальные — с именем папки проектов.
	awaitAny := func(want []string, why string) string {
		var seen strings.Builder
		hit := func() bool {
			for _, w := range want {
				if strings.Contains(seen.String(), w) {
					return true
				}
			}
			return false
		}
		_ = ws.SetReadDeadline(time.Now().Add(15 * time.Second))
		for !hit() {
			_, b, err := ws.ReadMessage()
			if err != nil {
				t.Fatalf("%s: %v (seen %q)", why, err, seen.String())
			}
			seen.Write(b)
		}
		return seen.String()
	}
	awaitOutput := func(want, why string) string { return awaitAny([]string{want}, why) }
	// Приглашение считается от корня рабочих папок, а не печатает путь целиком.
	awaitPrompt := func(tail, why string) string {
		return awaitAny([]string{"~/" + tail, local.WorkspaceDir + "/" + tail}, why)
	}
	greeting := awaitPrompt(folder+" $", "shell prompt never appeared")
	if strings.Contains(greeting, dataRoot) {
		t.Fatalf("prompt leaks the absolute data path: %q", greeting)
	}
	if e = ws.WriteJSON(map[string]any{"type": "input", "data": "mkdir -p deep && cd deep\n"}); e != nil {
		t.Fatal(e)
	}
	awaitPrompt(folder+"/deep $", "prompt did not follow cd into a subfolder")
	// Приглашение короткое, поэтому положение оболочки движок сообщает отдельной
	// строкой: интерфейс подписывает по ней проект, а после ssh — удалённый хост.
	awaitOutput(`"path":"~/`+folder+`/deep"`, "engine never reported the shell location")
	if e = ws.WriteJSON(map[string]any{"type": "input", "data": "cd ..\n"}); e != nil {
		t.Fatal(e)
	}

	marker := fmt.Sprint(time.Now().UnixNano())
	if e = ws.WriteJSON(map[string]any{"type": "input", "data": "echo local-" + marker + "\n"}); e != nil {
		t.Fatal(e)
	}
	// Оболочка живая, если эхо вернулось своим потоком, а не подстановкой.
	awaitOutput("local-"+marker, "shell produced no output")

	// Терминал работает в папке проекта: файл, созданный оболочкой, виден движку.
	if e = ws.WriteJSON(map[string]any{"type": "input", "data": "printf hi > shell.txt\n"}); e != nil {
		t.Fatal(e)
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		listing := c.do("GET", p+"/files", nil, 200)
		found := false
		for _, f := range listing["files"].([]any) {
			if f.(map[string]any)["path"] == "shell.txt" {
				found = true
			}
		}
		if found {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("file written by the shell never appeared in the project")
		}
		time.Sleep(200 * time.Millisecond)
	}

	c.do("DELETE", p+"/terminals/"+tid, nil, 204)
	c.do("DELETE", p, nil, 204)
	c.do("GET", p, nil, 404)
	c.do("POST", "/auth/logout", nil, 204)
	c.do("GET", "/auth/me", nil, 401)
	t.Log("Local engine: JSON state, readable folders, relative shell prompt, sandboxed filesystem, ETag conditions, snapshots and a real PTY passed")
}
