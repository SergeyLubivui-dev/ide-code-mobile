package local

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"
)

// Чат ходит к платформе только через движок: ключ живёт рядом с ним и не
// попадает в веб-часть, которая целиком лежит в APK и читается кем угодно.
const (
	defaultChatBase = "https://api.experientiallabs.ai/v1"
	chatProbeTTL    = 12 * time.Hour
	chatTimeout     = 120 * time.Second
)

// Платформа не отдаёт признака «бесплатно»: ручек /pricing, /catalog, /limits
// у неё нет, карточка модели содержит только имя и владельца, а usage.cost
// приходит нулевым даже у заведомо платных. Единственный честный ответ даёт
// сам запрос — но сплошная проверка каталога вредна: три сотни запросов подряд
// упираются в квоту ключа, после чего платформа отвечает insufficient_quota на
// всё подряд, включая то, что работало секунду назад. Проверенная квота нужна
// пользователю для работы, а не для составления списка.
//
// Поэтому: каталог показываем целиком, как его отдаёт платформа, а пробуем
// только короткий список — чтобы выбрать рабочую модель по умолчанию.
var chatPreferred = []string{
	// Gemini flash отвечает быстро и коротко — хороший выбор по умолчанию.
	"gemini-3.7-flash", "gemini-3.8-flash", "gemini-flash-latest",
	// DeepSeek V4 Flash: хорош в коде, доступен и на платном тарифе.
	"deepseek-v4-flash", "deepseek-v4-pro",
	"gpt-4o-mini", "gpt-oss-20b", "gemma-3-12b-it", "claude-haiku-4.5", "glm-4.7-flash",
}

// Служебные модели каталога: распознавание, разметка изображений, проверка
// безопасности. В чате они не отвечают, и предлагать их незачем.
var chatSkip = []string{"-image", "ppocr", "guard", "relace-", "-det", "palmyra-vision", "ui-tars"}

func chatUsableID(id string) bool {
	for _, bad := range chatSkip {
		if strings.Contains(id, bad) {
			return false
		}
	}
	return true
}

type chatSettings struct {
	Key  string `json:"key"`
	Base string `json:"base"`
	// Proxy — выход в интернет через посредника. На телефоне с VPN трафик идёт
	// сам собой, а вот системный прокси приложению не наследуется, и без этого
	// поля чат в такой сети просто не достучится до платформы.
	Proxy string `json:"proxy"`
}

type chatModel struct {
	ID string `json:"id"`
	OK bool   `json:"ok"`
	// Checked — модель действительно спрашивали. Остальные показаны так, как их
	// перечисляет платформа: доступ проверится на первом же вопросе.
	Checked bool   `json:"checked"`
	Reason  string `json:"reason,omitempty"`
}

type chatProbe struct {
	mu      sync.Mutex
	at      time.Time
	models  []chatModel
	running bool
}

func (s *Server) chatKey() (key, base string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key, base = s.state.Chat.Key, s.state.Chat.Base
	if key == "" {
		key = s.cfg.APIKey
	}
	if base == "" {
		base = s.cfg.APIBase
	}
	if base == "" {
		base = defaultChatBase
	}
	return
}

func (s *Server) chatRequest(method, path string, body any, stream bool) (*http.Response, error) {
	key, base := s.chatKey()
	if key == "" {
		return nil, problem(428, "chat_key_missing", "Add an API key in settings to use the chat")
	}
	var reader io.Reader
	if body != nil {
		raw, e := json.Marshal(body)
		if e != nil {
			return nil, e
		}
		reader = bytes.NewReader(raw)
	}
	req, e := http.NewRequest(method, base+path, reader)
	if e != nil {
		return nil, e
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	if stream {
		req.Header.Set("Accept", "text/event-stream")
	}
	client, e := s.chatClient()
	if e != nil {
		return nil, e
	}
	res, err := client.Do(req)
	if err != nil {
		s.mu.Lock()
		viaProxy := s.state.Chat.Proxy != ""
		s.mu.Unlock()
		return nil, networkProblem(err, viaProxy)
	}
	return res, nil
}

// Клиент чата. Переменные окружения HTTP_PROXY/HTTPS_PROXY учитываются сами
// собой, поле в настройках их перекрывает.
func (s *Server) chatClient() (*http.Client, error) {
	s.mu.Lock()
	proxy := strings.TrimSpace(s.state.Chat.Proxy)
	s.mu.Unlock()
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if proxy != "" {
		u, e := url.Parse(proxy)
		if e != nil || u.Host == "" {
			return nil, problem(422, "invalid_proxy", "Proxy address is not a valid URL")
		}
		transport.Proxy = http.ProxyURL(u)
	}
	return &http.Client{Timeout: chatTimeout, Transport: transport}, nil
}

// Сетевые ошибки объясняем словами: «no such host» посреди экрана ничего не
// говорит, а причина почти всегда одна из трёх. Совет зависит от того, задан ли
// прокси: предлагать настроить уже настроенное — худший вид подсказки.
func networkProblem(err error, viaProxy bool) error {
	text := err.Error()
	advice := " Если выход в интернет идёт через прокси, укажите его в настройках чата."
	if viaProxy {
		advice = " Проверьте прокси из настроек чата: похоже, через него не пройти."
	}
	switch {
	case errors.Is(err, context.DeadlineExceeded) || strings.Contains(text, "timeout"):
		text = "Платформа не ответила вовремя. Проверьте связь — с медленным VPN это обычное дело."
	case strings.Contains(text, "no such host") || strings.Contains(text, "server misbehaving"):
		text = "Не удалось найти адрес платформы: сеть недоступна или DNS не отвечает." + advice
	case strings.Contains(text, "connection refused") || strings.Contains(text, "network is unreachable") ||
		strings.Contains(text, "proxyconnect"):
		text = "Соединение не установилось: интернета нет или его закрывает сеть." + advice
	default:
		text = "Не удалось связаться с платформой моделей: " + text
	}
	return problem(502, "chat_unreachable", text)
}

// probe спрашивает у модели один токен: платный доступ платформа отклоняет
// сразу, поэтому дешевле и честнее выяснить это заранее, чем на первом вопросе.
func (s *Server) probeModel(id string) chatModel {
	res, e := s.chatRequest("POST", "/chat/completions", map[string]any{
		"model": id, "max_tokens": 1,
		"messages": []map[string]string{{"role": "user", "content": "ping"}},
	}, false)
	if e != nil {
		return chatModel{ID: id, Reason: e.Error()}
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 2048))
	if res.StatusCode >= 200 && res.StatusCode < 300 {
		return chatModel{ID: id, OK: true, Checked: true}
	}
	reason := strings.TrimSpace(string(body))
	var wrapped struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(body, &wrapped) == nil && wrapped.Error.Message != "" {
		reason = wrapped.Error.Message
	}
	reason = chatReason(reason)
	if len(reason) > 120 {
		reason = reason[:120]
	}
	return chatModel{ID: id, Checked: true, Reason: reason}
}

func chatReason(reason string) string {
	switch {
	case strings.Contains(reason, "model_requires_purchase"):
		return "требует покупки кредитов"
	case strings.Contains(reason, "insufficient_quota"):
		return "квота на сегодня исчерпана"
	case strings.Contains(reason, "does not exist") || strings.Contains(reason, "not granted"):
		return "недоступна на этом ключе"
	}
	return reason
}

func (s *Server) chatModels(refresh bool) []chatModel {
	s.probes.mu.Lock()
	fresh := time.Since(s.probes.at) < chatProbeTTL && len(s.probes.models) > 0
	if fresh && !refresh {
		out := append([]chatModel(nil), s.probes.models...)
		s.probes.mu.Unlock()
		return out
	}
	if s.probes.running {
		out := append([]chatModel(nil), s.probes.models...)
		s.probes.mu.Unlock()
		return out
	}
	s.probes.running = true
	s.probes.mu.Unlock()

	// Каталог платформы — единственный достоверный список: имена в нём
	// появляются и исчезают, зашитый перечень устаревает молча.
	catalog := []string{}
	if res, e := s.chatRequest("GET", "/models", nil, false); e == nil {
		defer res.Body.Close()
		var list struct {
			Data []struct {
				ID string `json:"id"`
			} `json:"data"`
		}
		if json.NewDecoder(res.Body).Decode(&list) == nil {
			for _, m := range list.Data {
				if chatUsableID(m.ID) {
					catalog = append(catalog, m.ID)
				}
			}
		}
	}
	known := map[string]bool{}
	for _, id := range catalog {
		known[id] = true
	}

	// Пробуем только предпочтения и по три за раз: платформа считает частые
	// запросы расходом квоты, и жадная проверка отобрала бы её у самого чата.
	probe := []string{}
	for _, id := range chatPreferred {
		if len(known) == 0 || known[id] {
			probe = append(probe, id)
		}
	}
	checked := make([]chatModel, len(probe))
	var wg sync.WaitGroup
	gate := make(chan struct{}, 3)
	for i, id := range probe {
		wg.Add(1)
		go func(i int, id string) {
			defer wg.Done()
			gate <- struct{}{}
			defer func() { <-gate }()
			checked[i] = s.probeModel(id)
		}(i, id)
	}
	wg.Wait()

	// Сначала проверенные и ответившие, потом проверенные и отказавшие, потом
	// остальной каталог — его доступ выяснится на первом вопросе.
	seen := map[string]bool{}
	results := []chatModel{}
	for _, m := range checked {
		if m.ID != "" && !seen[m.ID] {
			seen[m.ID] = true
			results = append(results, m)
		}
	}
	if len(catalog) == 0 {
		catalog = chatPreferred
	}
	for _, id := range catalog {
		if !seen[id] {
			seen[id] = true
			results = append(results, chatModel{ID: id, OK: true})
		}
	}

	rank := func(m chatModel) int {
		switch {
		case m.Checked && m.OK:
			return 0
		case m.OK:
			return 1
		}
		return 2
	}
	sort.SliceStable(results, func(a, b int) bool { return rank(results[a]) < rank(results[b]) })
	s.probes.mu.Lock()
	s.probes.models, s.probes.at, s.probes.running = results, time.Now(), false
	s.probes.mu.Unlock()
	return results
}

func (s *Server) listChatModels(w http.ResponseWriter, r *http.Request) error {
	models := s.chatModels(r.URL.Query().Get("refresh") == "1")
	usable, checked := 0, 0
	for _, m := range models {
		if m.OK {
			usable++
		}
		if m.Checked {
			checked++
		}
	}
	return respond(w, 200, map[string]any{"models": models, "usable": usable, "checked": checked})
}

func (s *Server) getChatConfig(w http.ResponseWriter, r *http.Request) error {
	key, base := s.chatKey()
	hint := ""
	if len(key) > 10 {
		hint = key[:6] + "…" + key[len(key)-4:]
	} else if key != "" {
		hint = "задан"
	}
	s.mu.Lock()
	proxy := s.state.Chat.Proxy
	s.mu.Unlock()
	return respond(w, 200, map[string]any{"base": base, "hasKey": key != "", "keyHint": hint, "proxy": proxy})
}

func (s *Server) putChatConfig(w http.ResponseWriter, r *http.Request) error {
	// Указатели, а не строки: поле, которого нет в запросе, остаётся прежним.
	// Иначе сохранение прокси стирало бы ключ, которого форма не показывает.
	var in struct {
		Key   *string `json:"key"`
		Base  *string `json:"base"`
		Proxy *string `json:"proxy"`
	}
	if e := decode(w, r, &in); e != nil {
		return e
	}
	s.mu.Lock()
	next := s.state.Chat
	s.mu.Unlock()
	if in.Key != nil {
		next.Key = strings.TrimSpace(*in.Key)
	}
	if in.Base != nil {
		next.Base = strings.TrimSpace(*in.Base)
	}
	if in.Proxy != nil {
		next.Proxy = strings.TrimSpace(*in.Proxy)
	}
	if len(next.Key) > 200 || len(next.Base) > 200 || len(next.Proxy) > 200 {
		return problem(422, "invalid_chat_config", "Key, base URL or proxy is too long")
	}
	if next.Proxy != "" {
		u, e := url.Parse(next.Proxy)
		if e != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https" && u.Scheme != "socks5") {
			return problem(422, "invalid_chat_config", "Proxy must look like http://host:port or socks5://host:port")
		}
	}
	if next.Base != "" && !strings.HasPrefix(next.Base, "https://") && !strings.HasPrefix(next.Base, "http://") {
		return problem(422, "invalid_chat_config", "Base URL must start with http:// or https://")
	}
	s.mu.Lock()
	changedKey := s.state.Chat.Key != next.Key
	s.state.Chat = next
	e := s.save()
	s.mu.Unlock()
	if e != nil {
		return e
	}
	if changedKey {
		// Ключ сменился — прежние результаты проверки больше ничего не значат.
		s.probes.mu.Lock()
		s.probes.models, s.probes.at = nil, time.Time{}
		s.probes.mu.Unlock()
	}
	return s.getChatConfig(w, r)
}

// Модель отдаёт проект отдельным блоком, а не вызовом функции: набор моделей
// разношёрстный, и function calling поддерживают далеко не все.
const chatSystemPrompt = `Ты — помощник в мобильной среде разработки IDE Code. Отвечай кратко и по делу, на языке пользователя.
Весь код и файлы пользователя хранятся локально на его устройстве.

Если пользователь просит создать проект или набор файлов, добавь в конец ответа блок ровно такого вида:

` + "```idecode-project" + `
{"name": "название", "desc": "одна строка описания", "files": [{"path": "src/main.py", "code": "..."}]}
` + "```" + `

Пути относительные, без ../ и без ведущего слэша. Не более 20 файлов. Приложение покажет кнопку создания проекта.

Если к вопросу приложены файлы проекта, они даны целиком, каждый со своим путём. Правь именно их.
Изменённый файл верни ПОЛНОСТЬЮ — от первой строки до последней, без сокращений, без «...» и без
комментариев вида «остальное без изменений»: приложение записывает файл поверх прежнего, и всё,
чего нет в ответе, будет потеряно. Каждый изменённый файл — отдельным блоком:

` + "```idecode-file:путь/к/файлу" + `
полное содержимое файла
` + "```" + `

Путь пиши ровно тот, что указан у приложенного файла. Файлы, которых не касался, не возвращай.
Приложение покажет кнопку сохранения, и файл встанет на своё место в проекте.`

// Режим сборки: модель собирает работающую страницу, которую приложение тут же
// показывает. Правила описывают именно те ограничения, которые есть на деле:
// просмотр идёт из папки проекта с жёсткой политикой безопасности.
const chatBuildPrompt = chatSystemPrompt + `

РЕЖИМ СБОРКИ. Ты собираешь работающее приложение, которое пользователь сразу увидит в просмотре.

Как это устроено:
- Точка входа — index.html в корне проекта. Просмотр открывает именно его.
- Соседние файлы подключаются относительными путями: style.css, app.js, img/logo.svg.
- Внешние адреса заблокированы политикой безопасности: ни CDN, ни шрифтов, ни картинок из сети.
  Всё, что нужно, пиши прямо в файлах проекта; вместо CDN-библиотек — свой код.
- Работают обычные HTML, CSS и JavaScript, включая canvas, fetch к своим же файлам и localStorage.
- Python, сборщики и установка пакетов на устройстве недоступны: интерпретатора в системе нет.
  Если задача требует сервера или Python, скажи об этом прямо и предложи вариант на JavaScript.

Обязательное правило ответа: в КАЖДОМ ответе на просьбу что-то сделать должен быть код.
Либо блок idecode-project со всеми файлами, либо, если файл один, обычный блок кода с пометкой html — целиком.
Ответы вида «сейчас создам», «вот план» или описание без кода не принимаются: пользователь видит
только то, что попало в блок. Пиши файл целиком, без пропусков и без «...».

Правила:
- Делай законченный работающий результат, а не заготовку с TODO.
- Разметка, стиль и логика — по файлам, а не одной простынёй, если файлов больше двух экранов.
- Тёмная тема по умолчанию, читаемые размеры на телефоне, элементы не меньше 44px по высоте.
- Никаких внешних шрифтов: системный стек.
- После блока проекта одной строкой скажи, что проверить в просмотре.`

func (s *Server) chatSend(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Model    string `json:"model"`
		Mode     string `json:"mode"`
		Messages []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
	}
	if e := decode(w, r, &in); e != nil {
		return e
	}
	if in.Model == "" || len(in.Messages) == 0 {
		return problem(422, "invalid_chat_request", "Model and at least one message are required")
	}
	if len(in.Messages) > 60 {
		in.Messages = in.Messages[len(in.Messages)-60:]
	}
	prompt := chatSystemPrompt
	if in.Mode == "build" {
		prompt = chatBuildPrompt
	}
	payload := []map[string]string{{"role": "system", "content": prompt}}
	for _, m := range in.Messages {
		role := m.Role
		if role != "assistant" {
			role = "user"
		}
		if len(m.Content) > 200000 {
			return problem(413, "message_too_large", "Message is too large")
		}
		payload = append(payload, map[string]string{"role": role, "content": m.Content})
	}

	res, e := s.chatRequest("POST", "/chat/completions", map[string]any{
		"model": in.Model, "messages": payload, "stream": true,
	}, true)
	if e != nil {
		return e
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 2048))
		var wrapped struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		message := strings.TrimSpace(string(body))
		if json.Unmarshal(body, &wrapped) == nil && wrapped.Error.Message != "" {
			message = wrapped.Error.Message
		}
		if strings.Contains(message, "model_requires_purchase") || strings.Contains(message, "insufficient_quota") {
			// Доступ мог измениться после проверки — пусть список обновится.
			s.probes.mu.Lock()
			s.probes.at = time.Time{}
			s.probes.mu.Unlock()
			if strings.Contains(message, "insufficient_quota") {
				message = "Квота этой модели на платформе исчерпана. Выберите другую или вернитесь позже."
			} else {
				message = "Эта модель требует покупки кредитов на платформе. Выберите другую."
			}
		}
		if len(message) > 400 {
			message = message[:400]
		}
		return problem(res.StatusCode, "chat_failed", message)
	}

	// Поток отдаём как есть: интерфейсу нужны куски по мере готовности, иначе на
	// телефоне ответ появляется одним рывком через полминуты.
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(200)
	flusher, _ := w.(http.Flusher)
	scanner := bufio.NewScanner(res.Body)
	scanner.Buffer(make([]byte, 0, 64<<10), 1<<20)
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}
		if _, err := io.WriteString(w, line+"\n\n"); err != nil {
			return nil
		}
		if flusher != nil {
			flusher.Flush()
		}
	}
	return nil
}
