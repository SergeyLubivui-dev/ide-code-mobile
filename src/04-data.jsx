/* =========================================================================
   Мок-данные проектов
   ========================================================================= */
const F_README = `# Astra Bot

Телеграм-бот дежурной смены: принимает заявки, раскидывает их по инженерам
и раз в час отправляет сводку в канал.

## Запуск

    pip install -r requirements.txt
    python main.py

## Структура

- **main.py** — точка входа, поллинг и graceful shutdown
- **bot/router.py** — разбор команд и маршрутизация
- **bot/storage.py** — хранилище заявок поверх SQLite
- **config.json** — токен, интервалы, список дежурных

## Заметки

Секреты не коммитим: config.json лежит в .gitignore, на устройстве
используется локальная копия.
`;
const F_MAIN_PY = `"""Точка входа Astra Bot."""
import asyncio
import json
import logging
from pathlib import Path

from bot.router import Router
from bot.storage import TicketStore

LOG = logging.getLogger("astra")
CONFIG = Path(__file__).parent / "config.json"


def load_config(path: Path) -> dict:
    with path.open(encoding="utf-8") as fh:
        data = json.load(fh)
    if not data.get("token"):
        raise ValueError("В config.json нет токена")
    return data


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s")
    config = load_config(CONFIG)
    store = TicketStore(config["database"])
    router = Router(store, duty=config["duty"])

    await store.migrate()
    LOG.info("Astra запущен, дежурных: %d", len(config["duty"]))

    try:
        await router.poll(interval=config.get("poll_interval", 2.0))
    except asyncio.CancelledError:
        LOG.info("Остановка по сигналу")
    finally:
        await store.close_db()


if __name__ == "__main__":
    asyncio.run(main())
`;
const F_ROUTER_PY = `"""Разбор команд и маршрутизация заявок."""
import asyncio
import re
from dataclasses import dataclass

COMMAND = re.compile(r"^/(?P<name>[a-z_]+)(?:\\s+(?P<args>.*))?$")


@dataclass(slots=True)
class Update:
    chat_id: int
    text: str
    author: str


class Router:
    def __init__(self, store, duty: list[str]):
        self.store = store
        self.duty = duty
        self.cursor = 0

    def next_engineer(self) -> str:
        engineer = self.duty[self.cursor % len(self.duty)]
        self.cursor += 1
        return engineer

    async def handle(self, update: Update) -> str:
        match = COMMAND.match(update.text.strip())
        if match is None:
            return "Не понял. Наберите /help"

        name = match.group("name")
        args = (match.group("args") or "").strip()

        if name == "new" and args:
            engineer = self.next_engineer()
            ticket = await self.store.create(args, engineer, update.author)
            return f"Заявка #{ticket.id} назначена на {engineer}"
        if name == "list":
            rows = await self.store.open_tickets()
            return "\\n".join(f"#{t.id} {t.title} — {t.engineer}" for t in rows) or "Открытых заявок нет"
        if name == "close" and args.isdigit():
            await self.store.close(int(args))
            return f"Заявка #{args} закрыта"
        return "Команды: /new, /list, /close, /help"

    async def poll(self, interval: float = 2.0) -> None:
        while True:
            await asyncio.sleep(interval)
`;
const F_STORAGE_PY = `"""Хранилище заявок поверх SQLite."""
import aiosqlite
from dataclasses import dataclass

SCHEMA = """
CREATE TABLE IF NOT EXISTS tickets (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    title     TEXT NOT NULL,
    engineer  TEXT NOT NULL,
    author    TEXT NOT NULL,
    closed_at TEXT
);
"""


@dataclass(slots=True)
class Ticket:
    id: int
    title: str
    engineer: str


class TicketStore:
    def __init__(self, path: str):
        self.path = path
        self._db = None

    async def migrate(self) -> None:
        self._db = await aiosqlite.connect(self.path)
        await self._db.executescript(SCHEMA)
        await self._db.commit()

    async def create(self, title: str, engineer: str, author: str) -> Ticket:
        cursor = await self._db.execute(
            "INSERT INTO tickets (title, engineer, author) VALUES (?, ?, ?)",
            (title, engineer, author),
        )
        await self._db.commit()
        return Ticket(cursor.lastrowid, title, engineer)

    async def open_tickets(self) -> list[Ticket]:
        rows = await self._db.execute_fetchall(
            "SELECT id, title, engineer FROM tickets WHERE closed_at IS NULL ORDER BY id"
        )
        return [Ticket(*row) for row in rows]

    async def close(self, ticket_id: int) -> None:
        await self._db.execute(
            "UPDATE tickets SET closed_at = datetime('now') WHERE id = ?", (ticket_id,)
        )
        await self._db.commit()

    async def close_db(self) -> None:
        if self._db is not None:
            await self._db.close()
`;
const F_CONFIG_JSON = `{
  "token": "REPLACE_ME",
  "database": "astra.sqlite3",
  "poll_interval": 2.0,
  "digest": {
    "channel": "-1001234567890",
    "cron": "0 * * * *",
    "quiet_hours": [23, 8]
  },
  "duty": ["kolya", "vera", "ilya", "sasha"],
  "labels": {
    "p1": "падение продакшена",
    "p2": "деградация",
    "p3": "вопрос"
  }
}
`;
const F_REQ = `aiogram==3.13.1
aiosqlite==0.20.0
pydantic==2.9.2
python-dotenv==1.0.1
uvloop==0.20.0 ; sys_platform != "win32"
`;
const F_INDEX_HTML = `<!doctype html>
<html lang="ru" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Skaner+</title>
    <link rel="stylesheet" href="/src/styles.css" />
  </head>
  <body>
    <div id="root" class="phone">
      <noscript>Для работы сканера нужен JavaScript.</noscript>
    </div>
    <script type="module" src="/src/main.tsx"><\/script>
  </body>
</html>
`;
const F_APP_TSX = `import { useCallback, useEffect, useState } from "react";
import { MOTION } from "./lib/motion";

type Tab = "scan" | "history" | "profile";

interface ScanResult {
  id: string;
  kind: "url" | "text" | "wifi";
  value: string;
  at: number;
}

export default function App() {
  const [tab, setTab] = useState<Tab>("scan");
  const [sheet, setSheet] = useState<ScanResult | null>(null);
  const [closing, setClosing] = useState(false);

  const closeSheet = useCallback(() => {
    setClosing(true);
    window.setTimeout(() => {
      setSheet(null);
      setClosing(false);
    }, MOTION.panelClose());
  }, []);

  useEffect(() => {
    document.documentElement.dataset.tab = tab;
  }, [tab]);

  return (
    <div className="app">
      <main className="panes">
        {tab === "scan" && <Scanner onResult={setSheet} />}
        {tab === "history" && <History onOpen={setSheet} />}
        {tab === "profile" && <Profile />}
      </main>

      <ResultSheet result={sheet} closing={closing} onClose={closeSheet} />
      <BottomNav value={tab} onChange={setTab} />
    </div>
  );
}
`;
const F_STYLES_CSS = `/* Экраны и оболочка. Токены живут в tokens.css */
.app {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100dvh;
  background: var(--bg-base);
  color: var(--text-primary);
}

.bottom-nav {
  position: absolute;
  inset: auto var(--nav-side) calc(var(--nav-gap) + var(--safe-bottom));
  height: var(--nav-bar-h);
  border-radius: var(--radius-lg);
  background: var(--nav-bg);
  backdrop-filter: blur(22px) saturate(1.35);
  -webkit-backdrop-filter: blur(22px) saturate(1.35);
  box-shadow: inset 0 0 0 1px var(--nav-stroke), 0 10px 28px rgb(0 0 0 / 0.22);
}

.nav-pill {
  position: absolute;
  inset: 5px auto 5px 0;
  border-radius: 16px;
  background: var(--accent-primary-dim);
  transition:
    transform var(--tabs-dur) var(--tabs-ease),
    width var(--tabs-dur) var(--tabs-ease);
}

@media (prefers-reduced-motion: reduce) {
  .nav-pill { transition: none; }
}
`;
const F_MOTION_TS = `/* JS читает те же длительности, что стоят в CSS. */
const cache = new Map<string, number>();

export function durationOf(token: string, fallback: number): number {
  const hit = cache.get(token);
  if (hit !== undefined) return hit;

  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(token)
    .trim();

  let value = fallback;
  if (raw.endsWith("ms")) value = Number.parseFloat(raw);
  else if (raw.endsWith("s")) value = Number.parseFloat(raw) * 1000;

  cache.set(token, value);
  return value;
}

export const MOTION = {
  panelOpen: () => durationOf("--panel-open-dur", 400),
  panelClose: () => durationOf("--panel-close-dur", 350),
  modalClose: () => durationOf("--modal-close-dur", 150),
  dropdownClose: () => durationOf("--dropdown-close-dur", 150),
} as const;
`;
const F_PKG_JSON = `{
  "name": "skaner-web",
  "version": "1.4.2",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "lint": "eslint src --max-warnings 0"
  },
  "dependencies": {
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "qr-code-styling": "1.6.0"
  },
  "devDependencies": {
    "typescript": "5.6.2",
    "vite": "5.4.8"
  }
}
`;
const F_MAIN_GO = `package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"time"
)

type Server struct {
	log   *slog.Logger
	store Store
}

func (s *Server) routes() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealth)
	mux.HandleFunc("GET /v1/tickets", s.handleTickets)
	return mux
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	srv := &Server{log: log, store: NewStore()}

	server := &http.Server{
		Addr:              ":8080",
		Handler:           srv.routes(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	go func() {
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("listen failed", "err", err)
			os.Exit(1)
		}
	}()

	log.Info("core-engine started", "addr", server.Addr)
	<-ctx.Done()

	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdown)
}
`;
const F_QUERY_SQL = `-- Сводка по заявкам за последние 30 дней.
WITH windowed AS (
    SELECT
        t.id,
        t.engineer,
        t.priority,
        t.created_at,
        COALESCE(t.closed_at, now()) AS finished_at
    FROM tickets AS t
    WHERE t.created_at >= now() - interval '30 days'
)
SELECT
    engineer,
    priority,
    count(*)                                        AS total,
    count(*) FILTER (WHERE priority = 'p1')         AS critical,
    round(avg(extract(epoch FROM finished_at - created_at)) / 60, 1) AS avg_minutes
FROM windowed
GROUP BY engineer, priority
HAVING count(*) > 3
ORDER BY critical DESC, total DESC
LIMIT 50;
`;
const F_LIB_RS = `use std::collections::HashMap;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq)]
pub enum Priority {
    Critical,
    Degraded,
    Question,
}

#[derive(Debug)]
pub struct Ticket {
    pub id: u64,
    pub title: String,
    pub priority: Priority,
    opened: Instant,
}

impl Ticket {
    pub fn new(id: u64, title: impl Into<String>, priority: Priority) -> Self {
        Self { id, title: title.into(), priority, opened: Instant::now() }
    }

    pub fn age(&self) -> Duration {
        self.opened.elapsed()
    }

    pub fn is_stale(&self, limit: Duration) -> bool {
        matches!(self.priority, Priority::Critical) && self.age() > limit
    }
}

pub fn group_by_engineer(tickets: &[(String, Ticket)]) -> HashMap<&str, Vec<&Ticket>> {
    let mut map: HashMap<&str, Vec<&Ticket>> = HashMap::new();
    for (engineer, ticket) in tickets {
        map.entry(engineer.as_str()).or_default().push(ticket);
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stale_only_for_critical() {
        let ticket = Ticket::new(1, "диск заполнен", Priority::Question);
        assert!(!ticket.is_stale(Duration::from_secs(0)));
    }
}
`;
const F_BUILD_SH = `#!/usr/bin/env bash
set -euo pipefail

VERSION="\${1:-dev}"
OUT="build/core-engine-\${VERSION}"

echo "==> сборка \${VERSION}"

mkdir -p build
go vet ./...
CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=\${VERSION}" -o "\${OUT}" ./cmd/server

if command -v upx >/dev/null 2>&1; then
  upx --best --quiet "\${OUT}"
fi

echo "==> готово: \${OUT}"
`;
const F_VAULT_RS = `use std::fs;
use std::path::PathBuf;

use aes_gcm::{Aes256Gcm, Key, Nonce};
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "vault", version, about = "Локальное хранилище секретов")]
struct Cli {
    #[arg(long, default_value = "~/.vault")]
    store: PathBuf,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    Put { key: String, value: String },
    Get { key: String },
    List,
    Rotate { key: String },
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    fs::create_dir_all(&cli.store)?;

    match cli.command {
        Command::Put { key, value } => vault::put(&cli.store, &key, value.as_bytes())?,
        Command::Get { key } => println!("{}", vault::get(&cli.store, &key)?),
        Command::List => vault::list(&cli.store)?.iter().for_each(|k| println!("{k}")),
        Command::Rotate { key } => vault::rotate(&cli.store, &key)?,
    }
    Ok(())
}
`;
const F_VAULT_SH = `#!/usr/bin/env bash
# Установка vault в ~/.local/bin
set -euo pipefail

TARGET="\${HOME}/.local/bin"
BIN="vault"

mkdir -p "\${TARGET}"
cargo build --release --locked

install -m 755 "target/release/\${BIN}" "\${TARGET}/\${BIN}"

if ! echo "\${PATH}" | grep -q "\${TARGET}"; then
  echo "Добавьте в ~/.bashrc:  export PATH=\\"\${TARGET}:\\\$PATH\\""
fi

echo "vault установлен: \${TARGET}/\${BIN}"
`;
const F_CHART_TS = `type Point = { t: number; v: number };

export interface SparkOptions {
  width: number;
  height: number;
  stroke: string;
  fill?: string;
}

/** Строит путь спарклайна по точкам, без внешних зависимостей. */
export function sparkline(points: Point[], o: SparkOptions): string {
  if (points.length < 2) return "";

  const xs = points.map((p) => p.t);
  const ys = points.map((p) => p.v);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys) || 1;

  const nx = (t: number) => ((t - minX) / (maxX - minX || 1)) * o.width;
  const ny = (v: number) => o.height - ((v - minY) / (maxY - minY || 1)) * o.height;

  return points
    .map((p, i) => (i === 0 ? "M" : "L") + nx(p.t).toFixed(1) + " " + ny(p.v).toFixed(1))
    .join(" ");
}

export function movingAverage(points: Point[], window = 5): Point[] {
  return points.map((p, i) => {
    const slice = points.slice(Math.max(0, i - window + 1), i + 1);
    const avg = slice.reduce((sum, q) => sum + q.v, 0) / slice.length;
    return { t: p.t, v: avg };
  });
}
`;
const F_THEME_CSS = `:root {
  --grid: 4px;
  --panel: #16181c;
  --panel-soft: #1e2126;
  --ink: #f2f4f7;
  --ink-soft: #99a0a9;
  --line: #2b2f35;
  --good: #3ecf8e;
  --bad: #f04444;
}

.dash {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: calc(var(--grid) * 2);
  padding: calc(var(--grid) * 3);
}

.tile {
  background: var(--panel);
  border-radius: calc(var(--grid) * 4);
  padding: calc(var(--grid) * 4);
  display: grid;
  gap: var(--grid);
}

.tile__value {
  font-size: 30px;
  font-weight: 650;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
}

.tile__delta[data-dir="up"] { color: var(--good); }
.tile__delta[data-dir="down"] { color: var(--bad); }
`;
const F_DASH_HTML = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <title>Pulse</title>
    <link rel="stylesheet" href="./src/theme.css" />
  </head>
  <body>
    <main class="dash">
      <section class="tile">
        <span class="tile__label">Активные сессии</span>
        <span class="tile__value">1 284</span>
        <span class="tile__delta" data-dir="up">+7,4% за неделю</span>
      </section>
      <section class="tile">
        <span class="tile__label">Ошибки 5xx</span>
        <span class="tile__value">0,21%</span>
        <span class="tile__delta" data-dir="down">−0,05 п.п.</span>
      </section>
    </main>
  </body>
</html>
`;
const F_LEDGER_JAVA = `package app.ledger;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

public final class LedgerService {

    private final EntryRepository repository;
    private final AuditLog audit;

    public LedgerService(EntryRepository repository, AuditLog audit) {
        this.repository = repository;
        this.audit = audit;
    }

    public Entry post(String account, BigDecimal amount, String reference) {
        if (amount.signum() == 0) {
            throw new IllegalArgumentException("Нулевая проводка не имеет смысла");
        }
        Optional<Entry> duplicate = repository.findByReference(reference);
        if (duplicate.isPresent()) {
            return duplicate.get();
        }

        Entry entry = new Entry(account, amount, reference, Instant.now());
        repository.save(entry);
        audit.record("posted", entry.id(), amount);
        return entry;
    }

    public BigDecimal balance(String account) {
        List<Entry> entries = repository.findByAccount(account);
        return entries.stream()
                .map(Entry::amount)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
    }
}
`;
const F_LEDGER_SQL = `CREATE TABLE entries (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account     text        NOT NULL,
    amount      numeric(18, 2) NOT NULL,
    reference   text        NOT NULL UNIQUE,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX entries_account_created_idx
    ON entries (account, created_at DESC);

-- Баланс по счетам на конец каждого дня.
CREATE VIEW daily_balance AS
SELECT
    account,
    date_trunc('day', created_at) AS day,
    sum(amount) OVER (PARTITION BY account ORDER BY created_at) AS running
FROM entries;
`;
const F_NOMAD_KT = `package app.nomad

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

data class Trip(
    val id: String,
    val city: String,
    val days: Int,
    val offline: Boolean = false,
)

class TripViewModel(private val repo: TripRepository) {

    private val _state = MutableStateFlow<List<Trip>>(emptyList())
    val state: StateFlow<List<Trip>> = _state

    suspend fun refresh() {
        val trips = runCatching { repo.load() }.getOrElse { repo.cached() }
        _state.value = trips.sortedBy { it.days }
    }
}

@Composable
fun TripRow(trip: Trip) {
    Column {
        Text(text = trip.city)
        Text(text = "\${trip.days} дн." + if (trip.offline) " · офлайн" else "")
    }
}
`;
const F_NOMAD_YAML = `app:
  name: Nomad
  version: 2.3.0
  min_sdk: 26

sync:
  interval_minutes: 30
  wifi_only: true
  retry:
    attempts: 3
    backoff: exponential

storage:
  cache_mb: 120
  purge_after_days: 14

features:
  offline_maps: true
  currency_widget: true
  push_digest: false
`;
const F_DOCS_MD = `# Портал документации

Собирается MkDocs, деплой — GitHub Pages. Правки в \`docs/\`, ветка \`main\`.

## Как добавить страницу

1. Создайте файл в \`docs/\`, например \`docs/api/limits.md\`.
2. Добавьте его в \`nav\` в \`mkdocs.yml\` — порядок в меню задаётся там.
3. Проверьте локально: \`mkdocs serve\`.

## Стиль

- Заголовки — по делу, без «Введения в введение».
- Код в примерах должен запускаться копипастой.
- Скриншоты — только там, где текст не справляется.

> Ошибки в документации заводятся как обычные баги: коротко и с ссылкой на страницу.
`;
const F_DOCS_YML = `site_name: Документация Astra
site_url: https://docs.example.dev
theme:
  name: material
  language: ru
  features:
    - navigation.sections
    - content.code.copy

nav:
  - Начало: index.md
  - API:
      - Лимиты: api/limits.md
      - Ошибки: api/errors.md
  - Эксплуатация:
      - Дежурство: ops/duty.md

markdown_extensions:
  - admonition
  - toc:
      permalink: true
`;
const F_SOLVER_CPP = `#include <algorithm>
#include <queue>
#include <vector>

namespace grid {

struct Cell {
    int row;
    int col;
    int cost;
};

// Поиск дешёвого пути по сетке весов: Дейкстра на четырёх соседях.
int cheapest_path(const std::vector<std::vector<int>>& weights) {
    const int rows = static_cast<int>(weights.size());
    const int cols = rows ? static_cast<int>(weights[0].size()) : 0;
    if (rows == 0 || cols == 0) return 0;

    const int kInf = 1 << 30;
    std::vector<std::vector<int>> best(rows, std::vector<int>(cols, kInf));
    auto worse = [](const Cell& a, const Cell& b) { return a.cost > b.cost; };
    std::priority_queue<Cell, std::vector<Cell>, decltype(worse)> queue(worse);

    best[0][0] = weights[0][0];
    queue.push({0, 0, best[0][0]});

    const int dr[] = {1, -1, 0, 0};
    const int dc[] = {0, 0, 1, -1};

    while (!queue.empty()) {
        const Cell cur = queue.top();
        queue.pop();
        if (cur.cost > best[cur.row][cur.col]) continue;

        for (int k = 0; k < 4; ++k) {
            const int r = cur.row + dr[k];
            const int c = cur.col + dc[k];
            if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
            const int next = cur.cost + weights[r][c];
            if (next < best[r][c]) {
                best[r][c] = next;
                queue.push({r, c, next});
            }
        }
    }
    return best[rows - 1][cols - 1];
}

}  // namespace grid
`;
const F_BENCH_PY = `"""Замер времени решателя на случайных сетках."""
import random
import statistics
import subprocess
import time

SIZES = (64, 128, 256, 512)
REPEATS = 5


def make_grid(size: int, seed: int) -> list[list[int]]:
    rng = random.Random(seed)
    return [[rng.randint(1, 9) for _ in range(size)] for _ in range(size)]


def run_once(size: int, seed: int) -> float:
    grid = make_grid(size, seed)
    payload = "\\n".join(" ".join(map(str, row)) for row in grid)
    started = time.perf_counter()
    subprocess.run(["./build/solver"], input=payload, text=True, capture_output=True, check=True)
    return (time.perf_counter() - started) * 1000


def main() -> None:
    for size in SIZES:
        samples = [run_once(size, seed) for seed in range(REPEATS)]
        print(f"{size:>4}  медиана {statistics.median(samples):7.1f} мс  разброс {max(samples) - min(samples):5.1f}")


if __name__ == "__main__":
    main()
`;

/* ---------- склонение ---------- */
function plural(n, forms, lang) {
  if (lang === 'en') return n === 1 ? forms[3] : forms[4];
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
const FILES_FORMS = ['файл', 'файла', 'файлов', 'file', 'files'];

let uid = 0;
const nid = (p) => p + '-' + (++uid) + '-' + Math.random().toString(36).slice(2, 6);
const mkFile = (path, code) => ({ id: nid('f'), path, code, dirty: false });
const snapFiles = (arr) => arr.map((x) => ({ path: x[0], code: x[1] }));
const shortHash = () => Math.random().toString(16).slice(2, 9);
const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const NOW = Date.now();
function fmtDT(ts, lang) {
  const d = new Date(ts);
  return d.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-GB',
    { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(' г.', '');
}
function fmtAgo(ts, lang) {
  const diff = Date.now() - ts;
  if (diff < HOUR) { const n = Math.max(1, Math.round(diff / MIN)); return lang === 'ru' ? n + ' ' + plural(n, ['минуту', 'минуты', 'минут'], lang) + ' назад' : n + ' min ago'; }
  if (diff < DAY) { const n = Math.round(diff / HOUR); return lang === 'ru' ? n + ' ' + plural(n, ['час', 'часа', 'часов'], lang) + ' назад' : n + ' h ago'; }
  const n = Math.round(diff / DAY);
  if (n < 30) return lang === 'ru' ? n + ' ' + plural(n, ['день', 'дня', 'дней'], lang) + ' назад' : n + ' d ago';
  const m = Math.round(n / 30);
  return lang === 'ru' ? m + ' ' + plural(m, ['месяц', 'месяца', 'месяцев'], lang) + ' назад' : m + ' mo ago';
}
const mkSnap = (msg, who, at, files) => ({ id: nid('s'), hash: shortHash(), msg, who, whoEn: who, at, files: snapFiles(files) });

const SEED_PROJECTS = [
  {
    id: 'p-astra', name: 'Astra Bot', demo: true,
    desc: 'Дежурный бот: заявки, маршрутизация, часовая сводка',
    theme: 'Боты', tags: ['python', 'asyncio', 'дежурство'],
    tint: '#8fb0ff', updatedAt: NOW - 2 * HOUR,
    files: [
      mkFile('README.md', F_README),
      mkFile('main.py', F_MAIN_PY),
      mkFile('bot/router.py', F_ROUTER_PY),
      mkFile('bot/storage.py', F_STORAGE_PY),
      mkFile('config.json', F_CONFIG_JSON),
      mkFile('requirements.txt', F_REQ),
    ],
    snaps: [
      mkSnap('router: очередь дежурных по кругу', 'вера', NOW - 2 * HOUR, [
        ['bot/router.py', F_ROUTER_PY.replace('        self.cursor += 1', '        self.cursor = (self.cursor + 1) % len(self.duty)')],
      ]),
      mkSnap('storage: закрытие пишет время', 'коля', NOW - DAY + 3 * HOUR, [
        ['bot/storage.py', F_STORAGE_PY.replace("datetime('now')", "datetime('now', 'localtime')")],
      ]),
      mkSnap('digest: тихие часы с 23 до 8', 'илья', NOW - 3 * DAY, [
        ['config.json', F_CONFIG_JSON.replace('"quiet_hours": [23, 8]', '"quiet_hours": [22, 9]')],
      ]),
      mkSnap('первый коммит', 'коля', NOW - 7 * DAY, [
        ['main.py', F_MAIN_PY.replace('    router = Router(store, duty=config["duty"])\n', '    router = Router(store, duty=["kolya"])\n')],
      ]),
    ],
  },
  {
    id: 'p-skaner', name: 'Skaner Web', demo: false,
    desc: 'Веб-сканер QR: оболочка, моторика, стеклянный навбар',
    theme: 'Веб', tags: ['react', 'typescript', 'моторика'],
    tint: '#5fc6da', updatedAt: NOW - DAY,
    files: [
      mkFile('index.html', F_INDEX_HTML),
      mkFile('package.json', F_PKG_JSON),
      mkFile('src/App.tsx', F_APP_TSX),
      mkFile('src/lib/motion.ts', F_MOTION_TS),
      mkFile('src/styles.css', F_STYLES_CSS),
    ],
    snaps: [
      mkSnap('motion: кэш длительностей', 'вы', NOW - DAY, [
        ['src/lib/motion.ts', F_MOTION_TS.replace('const cache = new Map<string, number>();', 'const cache = new Map<string, number>(); // читаем CSS один раз')],
      ]),
      mkSnap('navbar: стекло поверх камеры', 'вы', NOW - 4 * DAY, [
        ['src/styles.css', F_STYLES_CSS.replace('blur(22px) saturate(1.35)', 'blur(26px) saturate(1.5)')],
      ]),
    ],
  },
  {
    id: 'p-core', name: 'core-engine', demo: false,
    desc: 'HTTP-сервис заявок: Go, Rust-ядро, отчёты в SQL',
    theme: 'Бэкенд', tags: ['go', 'rust', 'sql'],
    tint: '#82c7a2', updatedAt: NOW - 3 * DAY,
    files: [
      mkFile('cmd/server/main.go', F_MAIN_GO),
      mkFile('internal/report/query.sql', F_QUERY_SQL),
      mkFile('src/lib.rs', F_LIB_RS),
      mkFile('scripts/build.sh', F_BUILD_SH),
    ],
    snaps: [
      mkSnap('server: таймаут на заголовки', 'коля', NOW - 3 * DAY, [
        ['cmd/server/main.go', F_MAIN_GO.replace('ReadHeaderTimeout: 5 * time.Second', 'ReadHeaderTimeout: 3 * time.Second')],
      ]),
      mkSnap('report: окно 30 дней', 'вера', NOW - 7 * DAY, [
        ['internal/report/query.sql', F_QUERY_SQL.replace("interval '30 days'", "interval '14 days'")],
      ]),
    ],
  },
  {
    id: 'p-vault', name: 'Vault CLI', demo: false,
    desc: 'Локальное хранилище секретов с ротацией ключей',
    theme: 'Инструменты', tags: ['rust', 'cli', 'безопасность'],
    tint: '#ff9b8a', updatedAt: NOW - 5 * DAY,
    files: [mkFile('src/main.rs', F_VAULT_RS), mkFile('install.sh', F_VAULT_SH)],
    snaps: [mkSnap('cli: подкоманда rotate', 'илья', NOW - 5 * DAY, [['src/main.rs', F_VAULT_RS.replace('    Rotate { key: String },\n', '')]])],
  },
  {
    id: 'p-pulse', name: 'Pulse Dashboard', demo: false,
    desc: 'Панель метрик: спарклайны без библиотек',
    theme: 'Веб', tags: ['typescript', 'css', 'аналитика'],
    tint: '#d3a2f2', updatedAt: NOW - 7 * DAY,
    files: [mkFile('index.html', F_DASH_HTML), mkFile('src/chart.ts', F_CHART_TS), mkFile('src/theme.css', F_THEME_CSS)],
    snaps: [mkSnap('chart: скользящее среднее', 'вы', NOW - 7 * DAY, [['src/chart.ts', F_CHART_TS.replace('window = 5', 'window = 3')]])],
  },
  {
    id: 'p-ledger', name: 'Ledger API', demo: false,
    desc: 'Проводки и балансы: идемпотентность по reference',
    theme: 'Бэкенд', tags: ['java', 'sql', 'финансы'],
    tint: '#e3b473', updatedAt: NOW - 14 * DAY,
    files: [mkFile('src/main/java/app/ledger/LedgerService.java', F_LEDGER_JAVA), mkFile('db/schema.sql', F_LEDGER_SQL)],
    snaps: [mkSnap('ledger: индекс по счёту и дате', 'вера', NOW - 14 * DAY, [['db/schema.sql', F_LEDGER_SQL.replace('    ON entries (account, created_at DESC);', '    ON entries (account);')]])],
  },
  {
    id: 'p-nomad', name: 'Nomad Mobile', demo: false,
    desc: 'Поездки офлайн: кеш, синхронизация по Wi-Fi',
    theme: 'Мобильное', tags: ['kotlin', 'compose', 'офлайн'],
    tint: '#a2a6f2', updatedAt: NOW - 21 * DAY,
    files: [mkFile('app/src/main/java/app/nomad/TripViewModel.kt', F_NOMAD_KT), mkFile('app/config.yaml', F_NOMAD_YAML)],
    snaps: [mkSnap('sync: только по Wi-Fi', 'коля', NOW - 21 * DAY, [['app/config.yaml', F_NOMAD_YAML.replace('wifi_only: true', 'wifi_only: false')]])],
  },
  {
    id: 'p-docs', name: 'Docs Portal', demo: false,
    desc: 'MkDocs-портал: навигация, стиль, деплой на Pages',
    theme: 'Документация', tags: ['markdown', 'yaml', 'mkdocs'],
    tint: '#9aa1a9', updatedAt: NOW - 30 * DAY,
    files: [mkFile('docs/index.md', F_DOCS_MD), mkFile('mkdocs.yml', F_DOCS_YML)],
    snaps: [mkSnap('nav: раздел эксплуатации', 'илья', NOW - 30 * DAY, [['mkdocs.yml', F_DOCS_YML.replace('  - Эксплуатация:\n      - Дежурство: ops/duty.md\n', '')]])],
  },
  {
    id: 'p-grid', name: 'Grid Solver', demo: false,
    desc: 'Дейкстра по сетке весов и бенчмарк на Python',
    theme: 'Алгоритмы', tags: ['c++', 'python', 'бенчмарк'],
    tint: '#5aa9f0', updatedAt: NOW - 33 * DAY,
    files: [mkFile('src/solver.cpp', F_SOLVER_CPP), mkFile('bench/bench.py', F_BENCH_PY)],
    snaps: [mkSnap('bench: пять повторов', 'вы', NOW - 30 * DAY, [['bench/bench.py', F_BENCH_PY.replace('REPEATS = 5', 'REPEATS = 3')]])],
  },
];

/* ---------- сводка по файлам проекта ---------- */
function projectStats(files) {
  let lines = 0;
  const byLang = {};
  files.forEach((f) => {
    lines += f.code.split('\n').length;
    const l = langOf(f.path);
    byLang[l] = (byLang[l] || 0) + 1;
  });
  const formats = Object.keys(byLang).sort((a, b) => byLang[b] - byLang[a]).map((k) => ({ lang: k, n: byLang[k] }));
  return { lines, formats, count: files.length };
}

/* =========================================================================
   Примитивы
   ========================================================================= */
function useMedia(q) {
  const [m, setM] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(q);
    const fn = (e) => setM(e.matches);
    mq.addEventListener ? mq.addEventListener('change', fn) : mq.addListener(fn);
    return () => { mq.removeEventListener ? mq.removeEventListener('change', fn) : mq.removeListener(fn); };
  }, [q]);
  return m;
}

function SuccessCheck({ size = 64, tone }) {
  return (
    <div className="t-check-wrap" style={{ width: size, height: size }}>
      <div className="t-check" data-state="in" style={{ color: tone || 'var(--text-primary)' }}>
        <svg className="t-check-svg" width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
          <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth="2" opacity=".22" />
          <path className="t-check-path" d="M15 24.5 21.5 31 33.5 18" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

function Toggle({ on, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label}
      className={'toggle' + (on ? ' is-on' : '')} onClick={() => onChange(!on)}><i /></button>
  );
}

function CheckBox({ on, onChange, danger, label }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} aria-label={label}
      className={'t-checkbox' + (danger ? ' is-danger' : '')} onClick={() => onChange(!on)}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M3 8.4 6.4 12 13 4.6" stroke={danger ? '#fff' : 'var(--accent-ink)'} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function TextSwap({ value, className }) {
  const [state, setState] = useState({ cur: value, prev: null, phase: 'rest' });
  const ref = useRef(null);
  useEffect(() => {
    if (value === state.cur) return;
    setState((s) => ({ cur: s.cur, prev: s.cur, phase: 'out' }));
    const t = setTimeout(() => {
      setState({ cur: value, prev: null, phase: 'pre' });
      requestAnimationFrame(() => {
        if (ref.current) void ref.current.offsetHeight;
        setState({ cur: value, prev: null, phase: 'rest' });
      });
    }, MOTION.quick());
    return () => clearTimeout(t);
  }, [value]);
  const cls = state.phase === 'out' ? 'is-out' : state.phase === 'pre' ? 'is-pre' : 'is-in';
  return (
    <span className={'t-text-swap ' + (className || '')} ref={ref}>
      <span className={cls}>{state.phase === 'out' ? state.prev : state.cur}</span>
    </span>
  );
}

/* Линия-разделитель: клик сворачивает секцию */
function Rule({ label, count, open, onToggle, right }) {
  return (
    <div className="row" style={{ gap: 6 }}>
      <button className={'rule' + (open ? '' : ' is-closed')} onClick={onToggle} aria-expanded={open}>
        <span className="rule-chev"><Ico n="chevDown" s={13} /></span>
        {label ? <span>{label}</span> : null}
        {count != null ? <span className="rule-count">{count}</span> : null}
        <span className="rule-line" />
      </button>
      {right}
    </div>
  );
}
function Fold({ open, children }) {
  return <div className={'fold' + (open ? '' : ' is-closed')}><div>{children}</div></div>;
}

/* Всплывающее окно на моторике dropdown */
function Popup({ open, onClose, title, children, foot, origin, sub }) {
  const [mounted, setMounted] = useState(open);
  const [state, setState] = useState(open ? 'open' : 'closed');
  useEffect(() => {
    if (open) {
      setMounted(true);
      const r = requestAnimationFrame(() => setState('open'));
      return () => cancelAnimationFrame(r);
    }
    setState((s) => (s === 'closed' ? s : 'closing'));
    const t = setTimeout(() => { setMounted(false); setState('closed'); }, MOTION.dropdownClose());
    return () => clearTimeout(t);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const fn = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [open, onClose]);
  if (!mounted) return null;
  return (
    <>
      <div className={'pop-overlay' + (state === 'open' ? ' is-open' : '')} onClick={onClose} />
      <div className="pop-wrap">
        <div className={'pop t-dropdown ' + (state === 'open' ? 'is-open' : state === 'closing' ? 'is-closing' : '')}
          data-origin={origin || 'bottom-center'} role="dialog" aria-modal="true" aria-label={title}>
          <div className="pop-head">
            <div style={{ minWidth: 0 }}>
              <h2 className="h2">{title}</h2>
              {sub ? <div className="meta" style={{ marginTop: 1 }}>{sub}</div> : null}
            </div>
            <button className="icon-btn is-ghost" onClick={onClose} aria-label="Закрыть"><Ico n="x" s={18} /></button>
          </div>
          <Fade className="pop-body">{children}</Fade>
          {foot ? <div className="pop-foot">{foot}</div> : null}
        </div>
      </div>
    </>
  );
}

/* Системные confirm и prompt рисуются поверх всего: они не знают ни про нижнюю
   навигацию, ни про тему приложения. Свой диалог — та же плашка, что у окна
   политики, и поднимается над навигацией. */
function useAsk() {
  const pending = useRef(null);
  const [state, setState] = useState(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const ask = useCallback((options) => new Promise((resolve) => {
    pending.current = resolve;
    setState(options);
    setValue(options.value || '');
    setOpen(true);
  }), []);
  const finish = (result) => {
    setOpen(false);
    const resolve = pending.current;
    pending.current = null;
    if (resolve) resolve(result);
  };
  const input = !!(state && state.input);
  const ready = !input || value.trim() !== '';
  const node = (
    <Popup open={open} onClose={() => finish(null)} title={state ? state.title : ''} sub={state ? state.sub : ''}
      foot={
        <div className="ask-foot">
          <button className="cta is-quiet" onClick={() => finish(null)}>{(state && state.cancel) || 'Отмена'}</button>
          <button className={'cta' + (state && state.danger ? ' is-danger' : '')} disabled={!ready}
            onClick={() => finish(input ? value.trim() : true)}>{(state && state.confirm) || 'Продолжить'}</button>
        </div>
      }>
      {state && state.body ? <p className="meta" style={{ marginTop: 0 }}>{state.body}</p> : null}
      {input ? (
        <input className="field mono" autoFocus value={value} placeholder={(state && state.placeholder) || ''}
          autoCapitalize="off" autoCorrect="off" spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && value.trim()) finish(value.trim()); }} />
      ) : null}
    </Popup>
  );
  return [ask, node];
}

/* =========================================================================
   Онбординг
   ========================================================================= */
function WelcomeMock({ variant }) {
  if (variant === 'files') {
    return (
      <div className="mock">
        <div className="mock-bar"><span className="mock-dot" /><span className="mock-dot" /><span className="mock-dot" /><span style={{ marginLeft: 4 }}>astra-bot</span></div>
        <div className="mock-body">
          <div className="mock-tree">
            <span style={{ color: 'var(--text-primary)' }}>▸ bot</span>
            <span style={{ paddingLeft: 10 }}>router.py</span>
            <span style={{ paddingLeft: 10 }}>storage.py</span>
            <span>main.py</span>
            <span>config.json</span>
          </div>
          <div className="mock-code">
            <div className="mock-line"><em>1</em><span><span className="tok-kw">async def</span> <span className="tok-fn">main</span><span className="tok-punct">()</span>:</span></div>
            <div className="mock-line"><em>2</em><span style={{ paddingLeft: 14 }}><span className="tok-var">cfg</span> = <span className="tok-fn">load</span><span className="tok-punct">(</span><span className="tok-str">"config.json"</span><span className="tok-punct">)</span></span></div>
            <div className="mock-line"><em>3</em><span style={{ paddingLeft: 14 }}><span className="tok-kw">await</span> <span className="tok-var">store</span>.<span className="tok-fn">migrate</span><span className="tok-punct">()</span></span></div>
            <div className="mock-line"><em>4</em><span style={{ paddingLeft: 14 }}><span className="tok-com"># поллинг обновлений</span></span></div>
          </div>
        </div>
      </div>
    );
  }
  if (variant === 'projects') {
    return (
      <div className="mock" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[['A', 'Astra Bot', '6 файлов · 214 строк', '#8fb0ff'], ['S', 'Skaner Web', '5 файлов · 186 строк', '#5fc6da'], ['C', 'core-engine', '4 файла · 165 строк', '#82c7a2']].map((r) => (
          <div key={r[1]} style={{ display: 'flex', gap: 9, alignItems: 'center', background: 'var(--bg-card)', borderRadius: 12, padding: 9 }}>
            <span style={{ width: 28, height: 28, borderRadius: 9, display: 'grid', placeItems: 'center', background: r[3] + '26', color: r[3], fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12 }}>{r[0]}</span>
            <span style={{ minWidth: 0 }}>
              <b style={{ display: 'block', fontSize: 12.5, fontWeight: 600 }}>{r[1]}</b>
              <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{r[2]}</span>
            </span>
          </div>
        ))}
      </div>
    );
  }
  if (variant === 'term') {
    return (
      <div className="mock" style={{ padding: 12, fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.7 }}>
        <div><span style={{ color: 'var(--syn-type)' }}>PS</span> <span style={{ color: 'var(--state-ok)' }}>C:\IDECode\astra</span><span style={{ color: 'var(--text-primary)' }}> ssh deploy@astra.dev</span></div>
        <div style={{ color: 'var(--state-info)' }}>подключение… ключ ed25519 принят</div>
        <div><span style={{ color: 'var(--state-ok)' }}>deploy@astra</span>:<span style={{ color: 'var(--syn-type)' }}>~</span><span style={{ color: 'var(--text-primary)' }}>$ systemctl status astra</span></div>
        <div style={{ color: 'var(--state-ok)' }}>● astra.service — active (running) 4d 6h</div>
      </div>
    );
  }
  return (
    <div className="mock" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ color: 'var(--state-ok)' }}><Ico n="shield" s={34} /></span>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
        Локальное хранилище устройства.<br />Ни один файл не уходит в сеть.
      </span>
    </div>
  );
}

function Welcome({ t, onDone, onLegal }) {
  const [step, setStep] = useState(0);
  const [agree, setAgree] = useState(false);
  const [warn, setWarn] = useState(false);
  const [finish, setFinish] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const pages = [
    { title: t.wlHiT, body: t.wlHiB, mock: 'shield' },
    { title: t.wl1t, body: t.wl1b, mock: 'files' },
    { title: t.wl2t, body: t.wl2b, mock: 'projects' },
    { title: t.wl3t, body: t.wl3b, mock: 'term' },
  ];
  const last = step === pages.length - 1;
  // Согласие спрашиваем на первом экране: дальше листать незачем, пока его нет.
  const gate = step === 0;
  const advance = () => {
    if (gate && !agree) { setWarn(true); setTimeout(() => setWarn(false), 2200); return; }
    if (last) finishUp(); else setStep(step + 1);
  };
  const finishUp = () => {
    setFinish(true);
    setTimeout(() => setLeaving(true), 900);
    setTimeout(onDone, 900 + MOTION.slow());
  };
  if (finish) {
    return (
      <div className={'welcome' + (leaving ? ' is-leaving' : '')} style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '0 28px', textAlign: 'center' }}>
          <SuccessCheck size={72} />
          <b style={{ fontSize: 18, fontWeight: 600 }}>{t.wlThanks}</b>
        </div>
      </div>
    );
  }
  return (
    <div className="welcome">
      <div className="wl-stage">
        {pages.map((p, i) => (
          <div key={i} className={'wl-page' + (i === step ? ' is-active' : '')}
            style={{ '--wl-from': (i < step ? '-' : '') + 'var(--distance-medium)' }} aria-hidden={i !== step}>
            <div className="wl-art"><WelcomeMock variant={p.mock} /></div>
            <div className={'t-stagger' + (i === step ? ' is-shown' : '')} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span className="t-stagger-line t-stagger-line--1 eyebrow">{String(i + 1).padStart(2, '0')} / {String(pages.length).padStart(2, '0')}</span>
              <h1 className="t-stagger-line t-stagger-line--2 wl-title">{p.title}</h1>
              <p className="t-stagger-line t-stagger-line--3 wl-text">{p.body}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="wl-foot">
        <div className="wl-dots" aria-hidden="true">
          {pages.map((_, i) => <span key={i} className={'wl-dot' + (i === step ? ' is-on' : '')} />)}
        </div>
        {gate && (
          <div className="wl-agree">
            <CheckBox on={agree} onChange={(v) => { setAgree(v); if (v) setWarn(false); }} label={t.wlAgreeLink} />
            <p>
              {t.wlAgree1}
              <a href="#legal" onClick={(e) => { e.preventDefault(); onLegal(); }}>{t.wlAgreeLink}</a>
              {t.wlAgree2}
            </p>
          </div>
        )}
        <button className="cta" onClick={advance} style={{ width: '100%' }}>
          <TextSwap value={warn ? t.wlNeedAgree : last ? t.wlStart : t.wlNext} />
        </button>
        {!last && !gate && <button className="wl-skip" onClick={() => setStep(pages.length - 1)}>{t.wlSkip}</button>}
      </div>
    </div>
  );
}
