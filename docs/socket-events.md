# Socket.IO protocol

Every event name and payload type lives in `shared/src` (`socket-events/event-names.ts`
and `types/events.ts`) and is imported by both the server and the client — no string
literals, no drift.

Request-style events accept an **ack callback**:

```ts
socket.emit('room:create', payload, (res) => {
  // res: { ok: boolean; data?: T; error?: ApiError }
});
```

## Client → server

| Event | Payload | Result |
| ----- | ------- | ------ |
| `authenticate` | `{ nickname, avatar?, sessionToken? }` | `{ session, restored }` |
| `reconnect:attempt` | `{ roomId, sessionToken }` | `{ room, playerId }` |
| `room:list` | `{ gameId?, includePrivate? }` | `{ rooms }` |
| `room:create` | `{ gameId, maxPlayers, isPrivate, settings? }` | `{ room, playerId }` |
| `room:join` | `{ roomId }` | `{ room, playerId }` |
| `room:leave` | `{}` | `{ left }` |
| `room:kick` | `{ playerId }` | `{ kicked }` |
| `room:add-ai` | `{ difficulty? }` | `{ playerId }` |
| `room:remove-ai` | `{ playerId }` | `{ removed }` |
| `lobby:ready` | `{ isReady }` | `{ isReady }` |
| `lobby:select-game` | `{ gameId }` | `{ gameId }` |
| `lobby:settings` | `{ playerCount?, gridSize?, rounds?, aiDifficulty?, aiOpponents? }` | settings |
| `game:start` | `{}` | `{ started }` |
| `game:action` | `{ action: { type, payload? } }` | `{ accepted }` |
| `game:leave` | `{}` | `{ left }` |
| `rematch:request` | `{}` | `{ votes, pending, expiresAt, required }` |
| `rematch:cancel` | `{}` | `{ votes, pending, expiresAt, required }` |
| `chat:send` | `{ text }` | `{ sent }` |
| `chat:emote` | `{ emote }` | `{ sent }` |
| `heartbeat` | `{}` | `{ serverTime }` |

## Server → client

| Event | Payload | Notes |
| ----- | ------- | ----- |
| `connection:established` | `{ socketId, serverTime, appVersion }` | clock sync |
| `auth:success` / `auth:failed` | `{ session, restored }` / `{ error }` | |
| `room:list` | `{ rooms }` | |
| `room:created` / `room:joined` | `{ room, playerId }` | full snapshot |
| `room:updated` | `{ room }` | **source of truth**, per viewer (hidden data stripped) |
| `room:closed` | `{ roomId, reason }` | `empty` / `lifetime` / `host` / `server` |
| `room:player-joined` | `{ roomId, player }` | |
| `room:player-left` | `{ roomId, playerId, nickname, reason }` | `leave` / `kick` / `timeout` / `disconnect` |
| `room:error` | `{ roomId?, error }` | |
| `lobby:player-ready` | `{ roomId, playerId, isReady, allReady }` | |
| `lobby:all-ready` | `{ roomId, canStart }` | |
| `game:countdown` | `{ roomId, value, secondsRemaining }` | `3, 2, 1`, then `0` = GO |
| `game:started` | `{ roomId, gameId, matchNumber, startedAt, config }` | |
| `game:state-update` | — | state travels in `room:updated` |
| `game:player-action` | `{ roomId, playerId, action, accepted }` | feedback effects |
| `game:finished` | `{ roomId, gameId, result }` | result computed on the server |
| `game:error` | `{ roomId?, error }` | |
| `rematch:status` | `{ roomId, votes, pending, expiresAt, required }` | |
| `rematch:started` | `{ roomId, matchNumber, room }` | |
| `rematch:cancelled` | `{ roomId, room }` | |
| `chat:message` / `chat:emote` / `chat:system` | `{ roomId, message }` | |
| `chat:muted` | `{ roomId, playerId, until, reason }` | 60 s spam mute |
| `player:disconnected` | `{ roomId, playerId, nickname, reconnectDeadline, graceMs }` | |
| `player:reconnected` | `{ roomId, playerId, nickname }` | |
| `timer:tick` | `{ roomId, timerType, remainingMs, value? }` | countdown / rematch |
| `timer:expired` | `{ roomId, timerType }` | |
| `notification` | `{ roomId?, level, title, message?, code? }` | |
| `error` | `{ error }` | typed `ApiError` |

## Errors

```json
{ "code": "E004", "name": "ROOM_FULL", "message": "This room is full." }
```

| Code | Meaning | HTTP |
| ---- | ------- | ---- |
| `E001` | Invalid input (validation) | 400 |
| `E002` | Unauthorized (session / host / membership) | 401 |
| `E003` | Room not found | 404 |
| `E004` | Room full | 409 |
| `E005` | Game not found | 404 |
| `E006` | Invalid action (state / turn / rules) | 400 |
| `E007` | Rate limited | 429 |
| `E008` | Connection failed | 503 |
| `E009` | Database error | 503 |
| `E010` | Internal error | 500 |

Stack traces, SQL and secrets are never serialised to clients.

## Connection behaviour

* The client reconnects automatically (Socket.IO backoff) and re-authenticates with
  the stored session token.
* `player:disconnected` carries `reconnectDeadline`; the UI shows a countdown and a
  `ReconnectOverlay` while the seat is held.
* Duplicate connections are idempotent: the newest socket wins and the seat is
  restored instead of duplicated.
