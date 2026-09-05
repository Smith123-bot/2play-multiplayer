# Troubleshooting

## The frontend loads but nothing happens

* Check `http://localhost:4000/api/health`. If it fails, the backend is not running.
* The header shows the connection state; the banner says `Connecting…` while the
  socket is being established.
* In development the browser must be able to reach the Vite dev server, which
  proxies `/api` and `/socket.io` to port 4000. If you changed `PORT`, set
  `VITE_PROXY_TARGET` or `VITE_SOCKET_URL`/`VITE_API_URL`.

## `database.mode` is `memory`

Supabase is not configured. The platform still works, but statistics, history and
favorites are not durable. Add `SUPABASE_URL` + keys to `server/.env`, run
`npm run db:migrate`, restart, then re-check `/api/health`.

## Migrations say "SUPABASE_DB_URL missing"

The migrator needs a direct Postgres connection string. Copy it from
*Supabase → Project Settings → Database → Connection string (URI)* and set
`SUPABASE_DB_URL`, or paste the SQL files into the SQL editor manually.

## "You are doing that too fast" (E007)

A rate limit was hit: 5 chat messages/second, 20 game actions/second, 20 room
creations/minute. Wait a moment and try again.

## "You were muted for 60 seconds"

Ten identical chat messages in a row trigger a temporary mute. Vary your messages.

## A player dropped out mid-match

Nothing is lost: the seat is held for `RECONNECT_GRACE_MS` (120 s by default). The
room shows `Reconnecting…` and restores the player automatically when they return.
If the window expires the match ends safely and everyone returns to the lobby.

## The match ended but the room disappeared

Rooms are closed only when empty for 5 minutes or older than 4 hours. If you were
the last human, the room is reclaimed — create a new one and share the code again.

## Rematch does nothing

Every connected human player must vote **Rematch**. With only one human in the room
the rematch is declined automatically (the minimum player count cannot be met) and
the room returns to the lobby.

## Start button disabled

`LobbyManager` requires: at least the game's minimum number of seats (AI counts) and
every connected human ready. The lobby always shows the exact reason next to the
button.

## Audio does not play

Browsers block audio until a user gesture. Click/tap anywhere once — the
`AudioManager` unlocks the context on the first interaction. Check the mute switch
and volumes in **Settings**.

## No vibration on mobile

Haptics require `navigator.vibrate` (not available on iOS Safari) and must be
enabled in **Settings → Haptics**.

## Tests fail with `EADDRINUSE`

The integration tests boot real servers on ephemeral ports (`PORT=0`). If you see
`EADDRINUSE :4000`, a dev server is already running and `tests/helpers/setup.ts` was
not applied — run the tests with `npm run test -w @2play/tests` from the repository
root.

## Type errors after changing `shared`

Run `npm run build -w @2play/shared` (or `npm run dev`, which watches it). The
server consumes `shared/dist`; the client compiles the sources directly.

## Something else

* Server logs: set `LOG_LEVEL=debug` (pretty console in development, JSON in
  production — never contains tokens or secrets).
* `npm run db:verify` checks persistence end to end.
* `npm run test:all` exercises the whole platform, including a complete two-player
  match with rematch.
