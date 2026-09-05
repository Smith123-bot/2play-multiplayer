# 2PLAY — Architecture

## 1. Guiding principle: platform ≠ game

The platform owns everything that is *not* game specific:

* sessions & authentication,
* rooms, lobby, readiness, host controls,
* countdown, match lifecycle, results,
* rematch voting,
* reconnection & disconnect handling,
* chat, emotes, notifications,
* statistics, history, favorites,
* timers, rate limiting, validation, logging.

A game owns only its rules. It receives a state object plus a `GameContext` and
returns results. It can never touch rooms, sockets or the database.

```
client/src/games/<id>/    React component: renders `getPublicState()`, sends intents
server/src/games/<id>/    GameModule: pure, server-authoritative rules
shared/src/games/metadata.ts  metadata shared by both sides
```

## 2. Request / action pipeline

```
CLIENT INTENT
   ↓ Socket.IO event
AUTHENTICATION (session token)
   ↓
ZOD ENVELOPE VALIDATION (shared/schemas)
   ↓
RATE LIMIT (per player, per room)
   ↓
PERMISSION CHECK (membership, host, turn)
   ↓
GAME validateAction(playerId, action, state)
   ↓
GAME handlePlayerAction(playerId, action, state)
   ↓
SERVER STATE UPDATE  →  stateVersion++
   ↓
BROADCAST (per viewer: getPublicState(viewerId))
```

The client never decides a winner, a score, a timer or a card identity. Reaction
times are measured with the server clock; the word dictionary, the maths answers and
the hidden Memory Match layout never leave the server.

## 3. Backend systems

| System | Responsibility |
| ------ | -------------- |
| `ApplicationManager` | builds the DI container, boots HTTP + Socket.IO, graceful shutdown |
| `EventBus` | internal events (`game:finished`, `player:disconnected`, …) that decouple managers |
| `TimerManager` | **the only place** where server timers are created |
| `RateLimiter` | sliding window, lazily pruned (no timers of its own) |
| `GameRegistry` | registers/validates game modules, exposes metadata |
| `GameLoader` | registers the shipped games |
| `GameManager` | bridges rooms ↔ modules: state creation, actions, AI, public state, results |
| `RoomManager` | create/join/leave/kick/list/close rooms, AI seats, cleanup sweep |
| `LobbyManager` | readiness, game selection, room settings, start conditions |
| `MultiplayerManager` | untrusted client action gateway |
| `GameLifecycleManager` | state machine + countdown + start/finish/rematch transitions |
| `RematchManager` | server-authoritative, idempotent rematch voting |
| `ConnectionManager` | sessions, tokens, socket binding |
| `ReconnectionManager` | 120s grace period, restore or expire |
| `ChatManager` | validation, cooldown, rate limit, spam mute, system messages |
| `StatisticsManager` / `FavoriteManager` | persistence (statistics, history, favorites) |
| `SocketManager` | Socket.IO server, per-viewer broadcasts |

## 4. Room lifecycle

```
WAITING → LOBBY → READY → COUNTDOWN → PLAYING → GAME_FINISHED → RESULT
                                          ↑         ↓
                                       PAUSED  REMATCH_WAITING → NEW_MATCH → COUNTDOWN …
```

Rules enforced by `GameLifecycleManager`:

* every transition is validated against `ROOM_TRANSITIONS`;
* finishing a match **never** disconnects sockets, destroys the room, deletes
  players or clears chat;
* all gameplay timers are cancelled on finish, the rematch timer starts;
* rooms are only closed when empty (5 min) or older than 4 hours (sweep).

## 5. Timers

`TimerManager` is the single owner of server timers. Every timer:

* belongs to a room (or `system`),
* has a type (`countdown`, `gameDuration`, `turn`, `reconnect`, `rematch`),
* can be de-duplicated with a `key` (creating the same key cancels the previous
  timer — this is what prevents duplicate countdowns, AI moves and rematches),
* cleans itself up and can be cancelled individually, by type, or per room,
* **never** runs its completion callback when cancelled.

No other file calls `setTimeout`/`setInterval` for gameplay or lifecycle work.
Clients may use `requestAnimationFrame` and local UI timers freely.

## 6. Reconnection

1. Socket drops → `ConnectionManager` keeps the session, `ReconnectionManager`
   marks the player disconnected and schedules a `reconnect` timer for the grace
   period (120 s by default).
2. The player keeps their seat, score and chat. The game module is notified via
   `playerLeft(..., 'disconnect')` so it can skip turns or continue.
3. The client reconnects (a fresh socket automatically re-authenticates with the
   stored token, or sends `reconnect:attempt`) → the timer is cancelled, the seat
   restored and `player:reconnected` broadcast.
4. On expiry the player is removed; if the minimum player count is no longer met
   the match ends safely (`abandoned`) and the room returns to the lobby.

## 7. AI opponents

AI is a *player* in the room:

* the game asks the platform to run an AI move with `ctx.requestAI(playerId, delayMs)`;
* the platform schedules it through `TimerManager` and then calls
  `GameManager.performAIAction`, which routes the move through **the same
  validation pipeline** as a human action;
* difficulty changes behaviour (pacing, accuracy, memory quality, false-start
  probability, move heuristics) — never "always wins".

## 8. Persistence

Only genuinely persistent data is stored: `users`, `game_history`, `statistics`,
`favorites`. Rooms, sockets, timers, countdowns, chat delivery and game frames live
in memory only.

`DatabaseLike` is a small facade: `SupabaseRepository` when credentials exist,
`MemoryRepository` otherwise. A runtime outage downgrades automatically
(`ensureHealthy()`), so gameplay never dies because of the database.

## 9. Frontend

* **Zustand** stores: session, room, chat, settings, games, favorites, statistics, ui.
* **`useConnection`** is mounted once and is the only bridge from sockets to stores
  (no duplicate listeners).
* `room:updated` is the single source of truth for room state; every other event
  (`chat:message`, `game:countdown`, `rematch:status`, …) is used for effects
  (sound, haptics, toasts, animations).
* Audio is fully procedural (Web Audio oscillators) — no assets, no licensing.
* Haptics use `navigator.vibrate` when available and can be switched off.
* Mobile first: 44 px touch targets, bottom navigation, safe-area padding, and no
  hover-dependent interactions.
