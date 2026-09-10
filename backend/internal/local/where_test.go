package local

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSSHTarget(t *testing.T) {
	cases := []struct{ line, want string }{
		{"ssh user@10.0.0.5", "user@10.0.0.5"},
		{"ssh -p 2222 user@vm.local", "user@vm.local"},
		{"ssh -p2222 build-box", "build-box"},
		{"ssh -i /tmp/home/.ssh/id_ed25519 -o StrictHostKeyChecking=no root@vm", "root@vm"},
		{"ssh -tt -4 user@vm uptime", "user@vm"},
		{"ssh ssh://user@vm", "user@vm"},
		{"ssh -V", ""},
		{"ssh", ""},
	}
	for _, c := range cases {
		if got := sshTarget(strings.Fields(c.line)); got != c.want {
			t.Errorf("%q: got %q, want %q", c.line, got, c.want)
		}
	}
}

func TestLabelMatchesPrompt(t *testing.T) {
	root := filepath.Join(string(filepath.Separator), "data", "app", "files")
	ws := filepath.Join(root, WorkspaceDir)
	m := &terminals{s: &Server{cfg: Config{Root: root}}}
	cases := []struct{ dir, want string }{
		{ws, "~"},
		{filepath.Join(ws, "Проект"), "~/Проект"},
		{filepath.Join(ws, "Проект", "src"), "~/Проект/src"},
		// Ушли наружу — приглашение и подпись показывают честный полный путь.
		{filepath.Join(string(filepath.Separator), "system", "bin"), filepath.Join(string(filepath.Separator), "system", "bin")},
	}
	for _, c := range cases {
		if got := m.label(c.dir); got != c.want {
			t.Errorf("label(%q): got %q, want %q", c.dir, got, c.want)
		}
	}
}

// Приглашение и цвета доезжают до оболочки только вместе с файлом: пустой ENV
// на Android означал «взять системный профиль», а тот ставил своё длинное
// приглашение.
func TestShellRCCarriesPrompt(t *testing.T) {
	home := t.TempDir()
	rc, e := writeShellRC(home, promptShort)
	if e != nil {
		t.Fatal(e)
	}
	// ssh пишет known_hosts в ~/.ssh и на первом подключении спотыкается,
	// если папки нет.
	if info, err := os.Stat(filepath.Join(home, ".ssh")); err != nil || !info.IsDir() {
		t.Fatalf("shell home has no .ssh: %v", err)
	}
	raw, e := os.ReadFile(rc)
	if e != nil {
		t.Fatal(e)
	}
	body := string(raw)
	if !strings.Contains(body, "PS1='"+promptShort+"'") {
		t.Fatalf("rc file does not set the prompt: %s", body)
	}
	if !strings.Contains(body, "--color=auto") {
		t.Fatalf("rc file does not turn colour on: %s", body)
	}
	if args := interactiveArgs("/system/bin/sh", rc); len(args) != 1 || args[0] != "-i" {
		t.Errorf("sh should read $ENV on its own, got %v", args)
	}
	// bash на $ENV в интерактивном режиме не смотрит вовсе.
	if args := interactiveArgs("/bin/bash", rc); len(args) != 3 || args[0] != "--rcfile" || args[1] != rc {
		t.Errorf("bash needs the rc file by name, got %v", args)
	}
}
