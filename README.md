# 2PLAY — Universal 2D Multiplayer Gaming Platform

**"Play Together, Anywhere."**

2PLAY is a complete, production-quality platform for real-time 2D multiplayer games:
discover games, create or join rooms with a six character code, chat, play a
server-authoritative match, see the results and rematch instantly. Rooms survive
the finish line, sockets stay connected and a 120 second reconnection window keeps
players in their seat when a network drops.

Everything is strictly 2D (HTML5 Canvas / DOM / CSS / SVG). No 3D engine, no WebGL
3D, no fake gameplay.

```
Frontend : React 18 + TypeScript + Vite + Tailwind + Zustand + Framer Motion
Backend  : Node.js + TypeScript + Express + Socket.IO + Zod + Winston
Database : Supabase PostgreSQL (with a graceful in-memory fallback)
Realtime : Socket.IO (server-authoritative state)
Tests    : Vitest + Supertest + React Testing Library
```

---

## Table of contents

1. [Quick start](#quick-start)
2. [Environment variables](#environment-variables)
3. [Supabase setup](#supabase-setup)
4. [Scripts](#scripts)
5. [Development](#development)
6. [Testing](#testing)
7. [Production build](#production-build)
8. [Project structure](#project-structure)
9. [Adding a game](#adding-a-game)
10. [Games](#games)
11. [Architecture & further docs](#architecture--further-docs)

---

## Quick start

```bash
git clone <your-fork> 2play
cd 2play
npm install          # or: npm run install:all
cp .env.example .env # optional: configure Supabase (see below)
npm run dev
```

| Service | URL                                 |
| ------- | ----------------------------------- |
| Frontend| http://localhost:5173               |
| Backend | http://localhost:4000               |
| Health  | http://localhost:4000/api/health    |

The platform runs **without any database**: when Supabase credentials are absent the
server transparently uses an in-memory repository so local gameplay works out of the
box (the health endpoint reports `database.mode: "memory"`).

---

## Environment variables

Server (`server/.env`):

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `NODE_ENV` | `development` | `development` / `production` / `test` |
| `PORT` | `4000` | HTTP + Socket.IO port (`0` = ephemeral, used by tests) |
| `HOST` | `0.0.0.0` | Bind address |
| `CLIENT_URL` | `http://localhost:5173` | Documented client origin |
| `CORS_ORIGIN` | `http://localhost:5173` | Comma separated allow-list (`*` allowed in dev) |
| `SUPABASE_URL` | *(empty)* | Supabase project URL |
| `SUPABASE_ANON_KEY` | *(empty)* | Public anon key (server side use only) |
| `SUPABASE_SERVICE_ROLE_KEY` | *(empty)* | **Secret.** Never expose to the browser |
| `SUPABASE_DB_URL` | *(empty)* | Postgres connection string, used to run migrations |
| `LOG_LEVEL` | `info` | `error` / `warn` / `info` / `debug` |
| `MAX_ROOMS` | `1000` | Hard cap of concurrent rooms |
| `MAX_PLAYERS_PER_ROOM` | `4` | 2–4 |
| `ROOM_TIMEOUT_MS` | `300000` | Empty room lifetime (5 minutes) |
| `ROOM_MAX_LIFETIME_MS` | `14400000` | Maximum room lifetime (4 hours) |
| `RECONNECT_GRACE_MS` | `120000` | Reconnection grace period (120 seconds) |
| `REMATCH_TIMEOUT_MS` | `60000` | Rematch vote window |
| `CHAT_RATE_LIMIT_PER_SEC` | `5` | Chat messages per second per player |
| `ACTION_RATE_LIMIT_PER_SEC` | `20` | Game actions per second per player |
| `ROOM_CREATE_RATE_LIMIT_PER_MIN` | `20` | Room creation guard |
| `ROOM_JOIN_RATE_LIMIT_PER_MIN` | `60` | Room join guard |
| `AUTH_RATE_LIMIT_PER_MIN` | `60` | Authentication guard |

Client (`client/.env`) — **public values only**:

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `VITE_API_URL` | *(empty = same origin)* | REST base URL |
| `VITE_SOCKET_URL` | *(empty = same origin)* | Socket.IO URL |
| `VITE_APP_NAME` | `2PLAY` | Branding |
| `VITE_APP_VERSION` | `2.1.0` | Version badge |

> `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL` are **server only**. They are
> never read by Vite and never reach the browser.

---

## Supabase setup

1. **Create a project** at [supabase.com](https://supabase.com).
2. **Copy the credentials** from *Project Settings → API* (`URL`, `anon key`,
   `service_role key`) and, for migrations, the *Database → Connection string (URI)*.
3. **Configure the server** — put them in `server/.env`:
   ```env
   SUPABASE_URL=https://<project>.supabase.co
   SUPABASE_ANON_KEY=<anon-key>
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
   SUPABASE_DB_URL=postgresql://postgres.<project>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
   ```
4. **Run the migrations** (idempotent, tracked in `schema_migrations`):
   ```bash
   npm run db:migrate
   ```
   Without `SUPABASE_DB_URL` the command prints the SQL files to apply manually in
   the Supabase SQL editor (`server/src/database/migrations/*.sql`).
5. **Verify connectivity**:
   ```bash
   npm run db:verify
   ```
6. **Start the app** (`npm run dev`) and check
   `http://localhost:4000/api/health` → `database.mode` should be `"supabase"`
   and `database.connected` `true`.
7. **Persistent features** (statistics, history, favorites) now survive restarts.
   A finished match automatically writes one `game_history` row per human player
   and updates the `statistics` row for that user + game.

Tables: `users`, `game_history`, `statistics`, `favorites`
(see [docs/database.md](docs/database.md) for the full schema and security notes).

---

## Scripts

| Command | Description |
| ------- | ----------- |
| `npm install` / `npm run install:all` | Install every workspace |
| `npm run dev` | Start shared watcher + backend (4000) + frontend (5173) |
| `npm run build` | Build shared → server → client |
| `npm start` | Run the compiled server (serves `client/dist` when present) |
| `npm run typecheck` | TypeScript check for all workspaces |
| `npm run lint` | ESLint (flat config, zero warnings allowed) |
| `npm test` | Unit tests (shared, server, client) |
| `npm run test:integration` | End-to-end Socket.IO/HTTP tests |
| `npm run test:all` | Unit + integration |
| `npm run db:migrate` | Apply SQL migrations |
| `npm run db:verify` | Check database connectivity |
| `npm run clean` | Remove build output |

---

## Development

```bash
npm run dev
```

* `shared` is compiled in watch mode (the server consumes `shared/dist`, the client
  compiles the TypeScript sources directly through a Vite alias).
* The Vite dev server proxies `/api` and `/socket.io` to `http://localhost:4000`,
  so the browser talks to a single origin.
* Live reload for both processes; the server restarts on file change (`tsx watch`).

Useful checks while developing:

```bash
curl http://localhost:4000/api/health
curl http://localhost:4000/api/games
```

---

## Testing

```bash
npm run typecheck
npm run lint
npm test                 # 100+ unit tests (managers, games, stores, components)
npm run test:integration # full multiplayer flows over real sockets
```

Integration coverage includes: room creation/joining, multiple players, ready,
server countdown, match start, game actions, state synchronisation, completion,
results, rematch, new match, leaving, disconnect, reconnect, reconnection restore,
chat delivery, emotes, rate limiting, invalid actions, hidden-information checks
and a complete two-player Dots & Boxes match.

---

## Production build

```bash
npm run build     # shared → server → client
npm start         # serves API + Socket.IO + the built SPA from one origin
```

Set `NODE_ENV=production`, a restricted `CORS_ORIGIN` and your Supabase
credentials. The Express server serves `client/dist` with an SPA fallback, so the
browser can use relative `/api` and `/socket.io` URLs behind any domain.
See [docs/deployment.md](docs/deployment.md).

---

## Project structure

```
2play/
├── client/                 React + TypeScript + Vite frontend
│   └── src/
│       ├── audio/          procedural Web Audio manager
│       ├── components/     layout, ui, game, room, chat, rematch, result, connection
│       ├── core/           runtime config (no secrets)
│       ├── games/          one folder per client game + registry
│       ├── haptics/        navigator.vibrate wrapper
│       ├── hooks/          connection bridge, room/game actions, countdown…
│       ├── multiplayer/    typed Socket.IO client + session helper
│       ├── screens/        Home, Browser, Details, Create, Join, Room, Settings…
│       └── stores/         Zustand stores (session, room, chat, settings…)
├── server/                 Node + Express + Socket.IO backend
│   └── src/
│       ├── config/         zod-validated environment
│       ├── core/           Platform DI container, TimerManager, RateLimiter, EventBus
│       ├── database/       migrations, repositories (Supabase + in-memory)
│       ├── games/          GameModule contract, registry, one folder per game
│       ├── managers/       Room, Lobby, Game, Lifecycle, Rematch, Reconnection…
│       ├── rooms/          Room + ServerPlayer domain objects
│       ├── sockets/        SocketManager + protocol handlers
│       ├── routes/         REST: health, games, statistics, history, favorites
│       └── middleware/     helmet, cors, rate limit, validation, errors
├── shared/                 types, zod schemas, constants, socket protocol, metadata
├── tests/integration/      end-to-end multiplayer tests
└── docs/                   architecture, adding-a-game, socket-events, database…
```

---

## Adding a game

See [docs/adding-a-game.md](docs/adding-a-game.md). In short:

1. `shared/src/games/metadata.ts` — add the metadata.
2. `server/src/games/<id>/` — implement the `GameModule` contract (pure logic,
   hidden state stays server side, AI is optional but real).
3. `client/src/games/<id>/` — implement the React component (renders the *public*
   state only and sends intents).
4. Register both (one line each in `GameLoader` and the client registry).
5. Add tests; the platform handles rooms, lobby, countdown, results, rematch,
   reconnection, chat and statistics for you.

---

## Games

| Game | Category | Players | AI | Highlights |
| ---- | -------- | ------- | -- | ---------- |
| ⚡ Reaction Race | reflex | 2–4 | yes | Server GO timestamp, false-start detection, 150 ms anti-cheat floor, best of 5 |
| 🧠 Memory Match | memory | 2–4 | yes | Hidden layout never leaves the server, AI remembers what it has seen |
| 🔤 Word Race | word | 2–4 | yes | Server-owned dictionary, unique words score, 3 rounds |
| 🔲 Dots and Boxes | strategy | 2–4 | yes | Server-tracked lines/boxes, greedy + safety heuristics |
| 🧮 Math Rush | math | 2–4 | yes | Server questions/answers, speed bonus, difficulty scaling |
| 🔢 2048 Battle | strategy | 2 | yes | Private boards, server-owned tiles |
| 🧩 Maze Race 2D | reflex | 2–4 | yes | Seeded maze, first to the flag |
| 🔀 Word Scramble Battle | word | 2–4 | yes | Hidden word until reveal |
| 🔶 Shape Match Battle | reflex | 2–4 | yes | Server-owned matching target |
| 🐍 Snake Battle | reflex | 2 | yes | Shared grid, server-stepped snakes |
| 🏎️ Traffic Dodge Race | reflex | 2 | yes | Seeded traffic, first to the finish |
| 🎯 Target Rush | reflex | 2 | yes | First correct tap, combos |
| 🚩 Capture the Flag 2D | strategy | 2/4 | yes | Team captures, no spawn camping |
| 🏓 Paddle Duel | reflex | 2 | yes | Server-simulated ball |
| 🧱 Brick Breaker Battle | reflex | 2 | yes | Mirrored walls, combos |
| 🔮 Pattern Memory Battle | memory | 2 | yes | Hidden sequence until reveal |
| 🧨 Bomb Pass 2D | reflex | 2–4 | yes | Server-timed fuse |
| 🎨 Draw & Guess Battle | word | 2–4 | yes | Secret word, stroke sync, guess scoring |
| 🕵️ Secret Role | strategy | 3–4 | yes | Private roles, no identity leak |
| 🏃 Platform Dash 2D | reflex | 2–4 | yes | Server-simulated 2D race |
| 🌈 Color Clash | reflex | 2–4 | yes | Fast colour rounds, labelled buttons |
| 🗺️ Territory Rush | reflex | 2–4 | yes | Grid capture, flood-fill loops, trail cuts |
| ⬡ Hexa Conquest | strategy | 2–4 | yes | Turn-based hex expansion, Bridge special |
| 🌀 Color Trails | reflex | 2–4 | yes | Fading trails, colour combos, zone bonuses |
| 🪙 Coin Hunters Arena | reflex | 2–4 | yes | Server-spawned coins, multipliers, bonus zone |
| 🏰 Castle Siege 2D | strategy | 2–4 | yes | Castle HP, energy, defenses, capture nodes |
| 🚦 Traffic Control Battle | reflex | 2–4 | yes | Server-driven cars, lights, jam penalties |
| 🧲 Magnet Maze | reflex | 2–4 | yes | Seeded maze, polarity, server-verified finish |
| 🛒 Shop Rush Battle | strategy | 2–4 | yes | Private lists, limited inventory, server checkout |
| 🌑 Shadow Copy Battle | strategy | 2–4 | yes | Server-recorded paths replay as Shadow Copies; plates open gates |
| 🌀 Echo Maze | memory | 2–4 | yes | Preview then fog; echo trail; server-owned walls and finish |
| 🚪 Fake Door Battle | memory | 2–4 | yes | Learnable clues, server-owned safe door |
| 🏝️ Moving Island | reflex | 2–4 | yes | Sliding / blinking / spinning platforms, checkpoint respawns |
| 🧲 Magnet Thief | strategy | 2–4 | yes | Server magnet range, cooldown, steal and ownership |
| ✨ Invisible Path | memory | 2–4 | yes | Preview then hide; wrong-tile stun; server-owned safe set |
| 🔄 Reverse Race | reflex | 2–4 | yes | Changing round objectives; server-owned movement, tokens and finish times |
| 🪞 Mirror Arena | strategy | 2–4 | yes | Mirrored twin, plates, gates and crystals; server collisions |
| 💥 Chain Reaction Battle | strategy | 2–4 | yes | Trigger a node; the server owns chain length, multipliers and score |
| 🔘 One Button Battle | reflex | 2–4 | yes | One tap, many contexts; server-owned timing windows |
| 🌍 Split World | strategy | 2–4 | yes | Shared true world, per-player views; hidden tiles never leave the server |

Every game is server-authoritative: clients send *intents*, the server decides
legality, scores, winners and timers.

---

## Architecture & further docs

* [docs/architecture.md](docs/architecture.md) — systems, lifecycle, data flow
* [docs/adding-a-game.md](docs/adding-a-game.md) — plugin guide
* [docs/socket-events.md](docs/socket-events.md) — full protocol reference
* [docs/database.md](docs/database.md) — schema, migrations, security
* [docs/deployment.md](docs/deployment.md) — production checklist
* [docs/troubleshooting.md](docs/troubleshooting.md) — common issues

---

**2PLAY v2.1 — strictly 2D, genuinely multiplayer.**
