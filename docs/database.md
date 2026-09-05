# Database (Supabase PostgreSQL)

## Schema

Migrations: `server/src/database/migrations/*.sql` (idempotent, tracked by
`schema_migrations`).

### `users`

| column | type | notes |
| ------ | ---- | ----- |
| `id` | uuid PK | `gen_random_uuid()` |
| `session_token` | text UNIQUE | the client's only credential |
| `nickname` | text | 3–20 chars (checked) |
| `avatar` | text | emoji |
| `created_at` / `updated_at` | timestamptz | `updated_at` maintained by trigger |

### `game_history`

| column | type |
| ------ | ---- |
| `id` | uuid PK |
| `user_id` | uuid → `users(id)` ON DELETE CASCADE |
| `game_id` | text |
| `room_id` | text |
| `players_json` | jsonb |
| `winner_id` | text |
| `result` | text CHECK (`win`/`loss`/`draw`) |
| `score` | integer |
| `duration_seconds` | integer |
| `played_at` | timestamptz |

Indexes: `(user_id, played_at DESC)`, `(game_id, played_at DESC)`, `(room_id)`.

### `statistics`

| column | type |
| ------ | ---- |
| `id` | uuid PK |
| `user_id` | uuid → `users(id)` |
| `game_id` | text |
| `wins` / `losses` / `draws` / `total_played` | integer ≥ 0 |
| `best_score` | integer |
| `updated_at` | timestamptz |

Unique: `(user_id, game_id)`.

### `favorites`

| column | type |
| ------ | ---- |
| `id` | uuid PK |
| `user_id` | uuid → `users(id)` |
| `game_id` | text |
| `created_at` | timestamptz |

Unique: `(user_id, game_id)`.

### Function `record_match_result(user_id, game_id, result, score)`

Atomically increments `wins`/`losses`/`draws`/`total_played` and raises
`best_score`. The server calls it via `supabase.rpc(...)` after each match, then
inserts the `game_history` row.

## What is **not** stored

Sockets, rooms, timers, countdown state, transient chat delivery and game frames
live in server memory only (spec §8). Live multiplayer is never persisted.

## Security

* Row Level Security is enabled on every table with **no public policies**: the
  browser never talks to Postgres. Only the Node server (service-role key) accesses
  data.
* `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL` are read from the server
  environment only and are never exposed through Vite variables.
* REST endpoints accept an optional `x-session-token` header; when present, the
  requested `userId` must match the session, and mutations (favorites) require it.
* Input is validated with Zod before it reaches the database; nicknames are length
  and character checked.

## Applying migrations

```bash
# automatic (needs SUPABASE_DB_URL)
npm run db:migrate

# verify connectivity + write a probe record
npm run db:verify
```

Without `SUPABASE_DB_URL` the migrator prints the SQL files to apply in the
Supabase SQL editor:

```
server/src/database/migrations/001_init.sql
server/src/database/migrations/002_functions.sql
```

## Graceful degradation

If Supabase is not configured or becomes unreachable, the server logs the problem,
switches to `MemoryRepository` and keeps serving gameplay. `/api/health` always
reports the active mode:

```json
{ "database": { "connected": true, "mode": "supabase" } }
```

Persistent features (statistics, history, favorites) still work for the lifetime of
the process in memory mode, but they are **not durable** until Supabase is
configured.
