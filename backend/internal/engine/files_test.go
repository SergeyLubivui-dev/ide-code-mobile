package engine

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestPathValidation(t *testing.T) {
	for _, p := range []string{"../secret", "/etc/passwd", "a/../../b", "C:/Windows", "a\\b", "a//b", "a/./b", "a/../b", "", ".", "a\x00b", ".astra-tmp/test"} {
		if validPath(p) == nil {
			t.Errorf("accepted unsafe path %q", p)
		}
	}
	for _, p := range []string{"README.md", "src/main.go", "русский/файл.txt", ".git/config"} {
		if e := validPath(p); e != nil {
			t.Errorf("rejected %q: %v", p, e)
		}
	}
}
func TestFilesystemIsolation(t *testing.T) {
	dir := t.TempDir()
	workspace := filepath.Join(dir, "workspace")
	if e := os.Mkdir(workspace, 0755); e != nil {
		t.Fatal(e)
	}
	root, e := os.OpenRoot(workspace)
	if e != nil {
		t.Fatal(e)
	}
	defer root.Close()
	outside := filepath.Join(dir, "secret")
	if e = os.WriteFile(outside, []byte("secret"), 0600); e != nil {
		t.Fatal(e)
	}
	if e = os.Symlink(outside, filepath.Join(workspace, "link")); e != nil {
		t.Fatal(e)
	}
	if _, e = readSafe(root, "link"); e == nil {
		t.Fatal("symlink read was allowed")
	}
	if e = putAtomic(root, "link", []byte("overwrite")); e == nil {
		t.Fatal("symlink overwrite was allowed")
	}
	if e = os.Symlink(dir, filepath.Join(workspace, "escape")); e != nil {
		t.Fatal(e)
	}
	if e = putAtomic(root, "escape/secret", []byte("overwrite")); e == nil {
		t.Fatal("parent symlink was allowed")
	}
	if e = putAtomic(root, "src/hello.ps1", []byte("Write-Output 'Привет'")); e != nil {
		t.Fatal(e)
	}
	b, e := readSafe(root, "src/hello.ps1")
	if e != nil || !strings.Contains(string(b), "Привет") {
		t.Fatalf("UTF-8 roundtrip: %q %v", b, e)
	}
	if e = syscall.Mkfifo(filepath.Join(workspace, "fifo"), 0600); e != nil {
		t.Fatal(e)
	}
	done := make(chan error, 1)
	go func() { _, e := readSafe(root, "fifo"); done <- e }()
	select {
	case e := <-done:
		if e == nil {
			t.Fatal("FIFO read allowed")
		}
	case <-time.After(time.Second):
		t.Fatal("FIFO blocked reader")
	}
	secret, _ := os.ReadFile(outside)
	if string(secret) != "secret" {
		t.Fatal("outside file changed")
	}
}
func TestConditionalWrites(t *testing.T) {
	b := []byte("original")
	r := httptest.NewRequest("PUT", "/", nil)
	if precondition(r, b, true) == nil {
		t.Fatal("unconditional overwrite allowed")
	}
	r.Header.Set("If-Match", tag([]byte("stale")))
	if precondition(r, b, true) == nil {
		t.Fatal("stale overwrite allowed")
	}
	r.Header.Set("If-Match", tag(b))
	if e := precondition(r, b, true); e != nil {
		t.Fatal(e)
	}
	r.Header.Set("If-None-Match", "*")
	if precondition(r, b, true) == nil {
		t.Fatal("create replaced existing file")
	}
	if e := precondition(r, nil, false); e != nil {
		t.Fatal(e)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestSandboxPolicy(t *testing.T) {
	var payload map[string]any
	d := &Docker{&http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if e := json.NewDecoder(r.Body).Decode(&payload); e != nil {
			t.Fatal(e)
		}
		return &http.Response{StatusCode: 201, Body: io.NopCloser(strings.NewReader(`{"Id":"sandbox"}`)), Header: make(http.Header)}, nil
	})}}
	cfg := Config{Instance: "test", Image: "fixed-image", Volume: "fixed-volume", SandboxNetwork: "fixed-network"}
	_, e := d.create(context.Background(), cfg, "project-uuid", "session-uuid")
	if e != nil {
		t.Fatal(e)
	}
	host := payload["HostConfig"].(map[string]any)
	if payload["User"] != "1000:1000" || host["ReadonlyRootfs"] != true || host["PidsLimit"].(float64) > 128 {
		t.Fatal("sandbox hardening missing")
	}
	// Terminals get their own network, never the compose network the database sits on.
	if host["NetworkMode"] != "fixed-network" {
		t.Fatalf("sandbox network not applied: %v", host["NetworkMode"])
	}
	mounts := host["Mounts"].([]any)
	if len(mounts) != 1 {
		t.Fatal("unexpected mounts")
	}
	mount := mounts[0].(map[string]any)
	if mount["Source"] != "fixed-volume" || mount["VolumeOptions"].(map[string]any)["Subpath"] != "project-uuid" {
		t.Fatal("project mount escaped scope")
	}
	if len(payload["Env"].([]any)) != 6 {
		t.Fatal("unexpected environment injection")
	}
}
