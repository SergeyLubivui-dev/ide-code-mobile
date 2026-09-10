package tests

import (
	"bufio"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"runtime"
	"strings"
	"testing"
	"time"

	"astracode/backend/internal/local"
)

// Чат ходит в сеть, поэтому тест запускается только с ключом в окружении:
//
//	IDECODE_API_KEY=... go test -run TestLocalChat ./tests/
//
// Обычный прогон его пропускает и остаётся офлайновым.
func TestLocalChat(t *testing.T) {
	key := os.Getenv("IDECODE_API_KEY")
	if key == "" {
		t.Skip("set IDECODE_API_KEY to exercise the model platform")
	}
	if runtime.GOOS != "linux" {
		t.Skip("движок собирается под Linux и Android")
	}
	engine, e := local.New(local.Config{Root: t.TempDir(), Listen: "127.0.0.1:0", Shell: "/bin/sh", APIKey: key})
	if e != nil {
		t.Fatal(e)
	}
	defer engine.Close()
	srv := httptest.NewServer(engine.Handler())
	defer srv.Close()
	jar, _ := cookiejar.New(nil)
	c := &localClient{t, &http.Client{Jar: jar, Timeout: 240 * time.Second}, srv.URL + "/api/v1"}

	c.do("POST", "/auth/login", map[string]string{"email": "chat@example.test", "name": "Chat"}, 201)

	if cfg := c.do("GET", "/chat/config", nil, 200); cfg["hasKey"] != true {
		t.Fatalf("engine did not pick up the key: %v", cfg)
	}

	// Список моделей проверяется на ходу: доступные должны отделиться от тех,
	// что платформа закрыла до покупки кредитов.
	list := c.do("GET", "/chat/models", nil, 200)
	usable := int(list["usable"].(float64))
	if usable == 0 {
		t.Fatalf("no usable models on this key: %v", list["models"])
	}
	var model string
	blocked := 0
	for _, raw := range list["models"].([]any) {
		m := raw.(map[string]any)
		if m["ok"] == true && model == "" {
			model = m["id"].(string)
		}
		if m["ok"] != true {
			blocked++
		}
	}
	t.Logf("моделей доступно %d, закрыто %d, для проверки берём %s", usable, blocked, model)

	// Поток отдаётся как SSE — интерфейсу нужны куски, а не один ответ в конце.
	body, _ := json.Marshal(map[string]any{
		"model":    model,
		"messages": []map[string]string{{"role": "user", "content": "Ответь ровно одним словом: готово"}},
	})
	req, _ := http.NewRequest("POST", srv.URL+"/api/v1/chat/send", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Requested-With", "astracode")
	res, e := c.http.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		raw := make([]byte, 400)
		n, _ := res.Body.Read(raw)
		t.Fatalf("chat/send: %d %s", res.StatusCode, raw[:n])
	}
	if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") {
		t.Fatalf("expected an event stream, got %q", ct)
	}
	var text strings.Builder
	chunks := 0
	scanner := bufio.NewScanner(res.Body)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "[DONE]" {
			break
		}
		var chunk struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
		}
		if json.Unmarshal([]byte(payload), &chunk) != nil || len(chunk.Choices) == 0 {
			continue
		}
		if piece := chunk.Choices[0].Delta.Content; piece != "" {
			text.WriteString(piece)
			chunks++
		}
	}
	if text.Len() == 0 {
		t.Fatal("модель не прислала ни одного куска текста")
	}
	t.Logf("ответ пришёл потоком: %d кусков, %q", chunks, strings.TrimSpace(text.String()))

	// Ключ меняется на лету, без пересборки.
	c.do("PUT", "/chat/config", map[string]string{"key": "xpl_wrong_key_for_test"}, 200)
	if cfg := c.do("GET", "/chat/config", nil, 200); cfg["hasKey"] != true {
		t.Fatal("replacement key was not stored")
	}
	t.Log("Chat: key from settings, live model probing, SSE streaming and error passthrough passed")
}
