# 2PLAY Security Model

This document describes how 2PLAY protects player accounts, rooms, matches and
data. It reflects what is actually implemented in the codebase — not
aspirations. Where a risk is accepted or deferred it is listed under
[Remaining risks](#remaining-risks).

> No system is "unhackable". This document describes hardening against specific,
> identified attack classes.

---

## 1. Authentication model

2PLAY uses **anonymous nickname sessions**, not passwords.

- A player supplies a nickname; the server mints a cryptographically random
  **session token** (`createSessionToken`) and returns it once.
- The token is the only credential. It is generated server-side, stored
  server-side in `ConnectionManager`, and is **not derivable from a player id**.
- There is **no password store**, so there are no password hashes, no password
  reset flow and no credential-stuffing surface. If passwords are introduced
  later, use Argon2id (or bcrypt with an appropriate work factor) — never MD5,
  SHA-1 or plain SHA-256.
- Authentication is rate limited per client key (`AUTH_RATE_LIMIT_PER_MIN`,
  default 60/min) to blunt automated session farming.

**Session lifecycle:** a token is bound to one socket at a time. Reconnecting
re-binds the same token to the new socket; the newest socket wins and the stale
mapping is dropped.

## 2. Authorization model

Authentication answers *who are you*; authorization answers *may you do this*.
Both are enforced server-side on every privileged path.

| Layer | Guard |
|---|---|
| Socket events | `requireSession()` — rejects anything without a known token |
| Room events | `requireRoomAndPlayer()` — the caller must be a member of that room |
| Turn-based actions | The game module checks `currentPlayerId` before mutating |
| REST personal data | `resolveUserId()` — valid token required **and** id must match |

A client is never trusted for: score, winner, completion, dice, timers, turn
ownership, room membership, or role.

## 3. REST API security

- Personal data endpoints (`/api/statistics/:userId`, `/api/history/:userId`,
  `/api/favorites/:userId`) require a valid `x-session-token` **and** the id in
  the path must equal the session's own user id.
- A missing token and an unknown token fail **identically** (`401`), so the
  response cannot be used to probe which tokens or ids exist.
- All async routes are wrapped in `asyncRoute()` so a rejected promise reaches
  the central error handler instead of hanging the request.
- JSON and urlencoded bodies are capped at **32 kB**.
- A coarse rate limiter (`HTTP_RATE_LIMIT_MAX`, default 300/min per IP) sits in
  front of every `/api` route; `/api/health` is exempt so probes stay cheap.

## 4. Socket.IO security

- Every privileged event runs through `safeHandler`, which converts thrown
  errors into typed acks — **never** a stack trace.
- Unauthenticated sockets can do nothing except `authenticate`. Room, lobby,
  game, chat and rematch events all reject with `E002`.
- Frames are capped at **32 kB** (`SOCKET_MAX_PAYLOAD_BYTES`), mirroring the HTTP
  body limit. The library default of 1 MB would let a client force large
  per-frame allocations.
- CORS for the socket server uses the same resolved origin list as the HTTP API.
- Per-action rate limiting: `ACTION_RATE_LIMIT_PER_SEC` (20/s),
  `CHAT_RATE_LIMIT_PER_SEC` (5/s), `ROOM_CREATE_RATE_LIMIT_PER_MIN` (20/min),
  `ROOM_JOIN_RATE_LIMIT_PER_MIN` (60/min).

## 5. Room security

- Room codes are 6 characters from a reduced alphabet (`A-Z`, `2-9` — no
  ambiguous `0/O/1/I`) and validated with a strict regex before use.
- Joining is rate limited per client, which is the primary defence against
  code enumeration.
- Unknown codes return a **generic** message (`Room not found or no longer
  available.`) that does not echo the attempted code back, so a scanner gets no
  per-code signal and no unvalidated input is reflected.
- Membership is derived from the session token, never from a client-supplied
  player or room id.

## 6. Reconnection security

The 120-second grace window is preserved and is keyed on the **session token**,
not on nickname, player id or socket id. An attacker who guesses a room id and a
player id still cannot take the seat, because they cannot present the token.

## 7. Rematch security

Rematch votes are validated server-side: the caller must be a member of the
finished match's room, and the room must actually be in a rematch-eligible
state. `rematchReady` is never taken from the client as fact.

## 8. Chat security

- Text is validated with Zod, then `sanitizeText()` strips control characters
  and HTML tags and collapses whitespace before storage.
- Length capped at `CHAT_MAX_LENGTH` (200); oversized input is rejected.
- Rate limit, cooldown, repeat-spam detection and temporary muting are enforced
  by `ChatManager`.
- Clients render chat as **plain text through React**, which escapes by default.

## 9. XSS protection

- The codebase contains **no** `innerHTML`, `dangerouslySetInnerHTML`, `eval` or
  `new Function`. All user-controlled values (nicknames, chat, room data) are
  rendered as React text nodes.
- Nicknames containing markup are **rejected** rather than silently escaped
  (`isSafeNickname`).
- A Content-Security-Policy is served on every response with
  `default-src 'self'`, `object-src 'none'` and `script-src 'self'`.

## 10. Security headers

Set via Helmet and verified by an automated test:

| Header | Value |
|---|---|
| `Content-Security-Policy` | `default-src 'self'; object-src 'none'; script-src 'self'; …` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `X-Frame-Options` | `SAMEORIGIN` |
| `Strict-Transport-Security` | `max-age=15552000; includeSubDomains` |
| `X-Powered-By` | removed |

## 11. CORS

`parseCorsOrigins()` resolves the allow-list:

- Explicit origins in `CORS_ORIGIN` (comma separated) are always used.
- In **production**, a missing or `*` value never yields a wildcard — it falls
  back to `CLIENT_URL`, or an empty allow-list. Because the API is credentialed
  (`credentials: true`), reflecting an arbitrary origin would let any site drive
  authenticated cross-origin requests, so this **fails closed**.
- In development and test the permissive behaviour is retained for local tooling
  and the sandbox preview.

## 12. Cookies and CSRF

2PLAY does **not** use cookies for authentication. The session token is sent in
an explicit `x-session-token` header (REST) or in the socket handshake payload.

Because no ambient credential is attached by the browser, classic CSRF does not
apply: a cross-site page cannot make the browser add the header. Adding CSRF
tokens would therefore be redundant. **If cookie auth is ever introduced, CSRF
protection and `SameSite`/`Secure`/`HttpOnly` flags become mandatory.**

## 13. Anti-cheat / server authority

Every game module is server-authoritative. The client sends an *intent*; the
server decides the outcome.

- **Movement / placement** — validated against the authoritative board.
- **Randomness** — dice, decks, puzzle seeds and arena layouts are generated
  from the server's seeded PRNG (`ctx.random()`). A client can never submit
  "I rolled a 6": Ludo ignores any dice value in the payload.
- **Timers** — all gameplay timers run on `TimerManager`. Client timestamps are
  never trusted for competitive outcomes; the chess clock is charged server-side.
- **Scores / winners** — computed by `calculateScore`, `checkWinCondition` and
  `getResult`. Actions named `score`, `win`, `finish`, `complete`, `checkmate`,
  `setState` and similar are explicitly rejected by every game.
- **Duplicate actions** — one-time rewards (keys, switches, cards, pairs) are
  flagged as consumed, so replaying an action scores nothing.
- **Actions after the game ends** — rejected once the phase is `finished`.

## 14. Database security

- Persistence runs through repositories (`SupabaseRepository`,
  `MemoryRepository`); the app never concatenates SQL from user input, so there
  is no string-built query surface.
- The **service-role key is server-only**. It is read from `SUPABASE_SERVICE_ROLE_KEY`
  in `server/src/config/env.ts` and is never bundled into the client.
- Live state (rooms, sockets, in-progress matches) is held **in memory only** —
  never written to the database.
- **Row Level Security:** when Supabase is configured, RLS should be enabled on
  `users`, `matches`, `statistics` and `favorites` so a leaked anon key cannot
  read or write another user's rows. The server uses the service-role key and
  therefore bypasses RLS by design; RLS is the defence-in-depth layer for any
  future direct client access. See [Remaining risks](#remaining-risks).

## 15. Secrets handling

- Nothing secret is committed: `git ls-files` shows only `.env.example` files.
- `.gitignore` covers `.env`, `.env.local`, `.env.*.local`, `.env.production`,
  `*.pem` and `*.key`.
- The **client** may only receive `VITE_`-prefixed public values
  (`VITE_API_URL`, `VITE_SOCKET_URL`, `VITE_APP_NAME`, `VITE_APP_VERSION`).
  No key, token or database URL is exposed to the browser.
- Environment is parsed and validated with Zod at boot; an invalid configuration
  refuses to start rather than running with unsafe defaults.

**Frontend source cannot be hidden.** A browser must receive the JS/CSS needed
to run the app. The defence is that the bundle contains no secrets and no
privileged logic — all authority lives on the server.

## 16. Error handling

- Production responses never include stack traces. The stack is attached only
  when `NODE_ENV !== 'production'`.
- Unexpected errors are logged server-side with full detail and returned to the
  user as a generic typed code.
- Socket handlers return typed `AckResponse` errors, never raw exceptions.

## 17. Logging

`server/src/utils/logger.ts` redacts a deny-list of sensitive keys:
`sessionToken`, `token`, `password`, `serviceRoleKey`, `apiKey`, `secret`.
Logs record event type, safe identifiers and error categories.

## 18. Rate limits (summary)

| Surface | Limit | Constant |
|---|---|---|
| HTTP `/api/*` | 300 / min / IP | `HTTP_RATE_LIMIT_MAX` |
| Authenticate | 60 / min | `AUTH_RATE_LIMIT_PER_MIN` |
| Room create | 20 / min | `ROOM_CREATE_RATE_LIMIT_PER_MIN` |
| Room join | 60 / min | `ROOM_JOIN_RATE_LIMIT_PER_MIN` |
| Chat | 5 / sec | `CHAT_RATE_LIMIT_PER_SEC` |
| Game actions | 20 / sec | `ACTION_RATE_LIMIT_PER_SEC` |
| HTTP body | 32 kB | `express.json({ limit })` |
| Socket frame | 32 kB | `SOCKET_MAX_PAYLOAD_BYTES` |

## 19. Security testing

`tests/integration/security.test.ts` and
`tests/integration/security-hardening.test.ts` cover:

- IDOR: unauthenticated, forged-token and cross-user reads of personal data
- Ownership: the legitimate owner still succeeds (no over-blocking)
- Unauthenticated socket events across all privileged channels
- Non-member room actions
- Reconnect seat-stealing with a wrong token
- Oversized HTTP bodies and oversized socket frames
- XSS payloads in chat
- Malformed / unexpected-field payloads
- Room-code enumeration signal and join rate limiting
- Forged score / winner / completion actions
- Presence of security response headers

These are regression tests: removing a protection makes them fail.

## 20. Remaining risks

| Risk | Impact | Recommended action |
|---|---|---|
| **Supabase RLS not verifiable from this repo** | If RLS is disabled and the anon key leaks, rows could be read/written directly, bypassing the API. | Enable RLS on `users`, `matches`, `statistics`, `favorites` in the Supabase dashboard with owner-only policies. The server uses the service-role key and is unaffected. |
| **Sessions are in-memory** | A server restart invalidates every session; multi-instance deployments will not share sessions. | Move sessions to Redis (or a shared store) before horizontal scaling. |
| **No account ownership** | Anonymous nickname sessions mean anyone can use any nickname; there is no durable account to take over, but also no recovery. | Acceptable for the current product. Introduce real accounts (Argon2id) only if durable identity is required. |
| **`react-router` moderate advisory** | 5 moderate `npm audit` findings via `react-router-dom`; the advisory concerns SSR hydration, and 2PLAY ships a client-only SPA with no SSR, so it is not reachable here. | Not force-updated: the fix is a breaking major (v7). Schedule a deliberate upgrade with regression testing. |
| **Rate limits are per-process, in memory** | A multi-instance deployment would multiply the effective limits. | Back the limiter with Redis when scaling out. |
| **`trust proxy` is configurable** | If set too high behind an untrusted proxy, `req.ip` could be spoofed, weakening IP rate limits. | Keep `TRUST_PROXY` at the real number of proxies in front of the app (default 1). |
| **No CAPTCHA on session creation** | Automated clients can still create sessions within rate limits. | Add a challenge if abuse is observed in production. |

## 21. Incident response basics

1. **Rotate** the affected credential first (Supabase service-role key,
   database password) — rotation is the only reliable remedy for exposure.
2. **Invalidate sessions** by restarting the server (sessions are in memory).
3. **Review logs** for the offending client key, IP and event pattern.
4. **Tighten** the relevant rate limit or add a targeted block.
5. **Add a regression test** to `security-hardening.test.ts` reproducing the
   issue before shipping the fix.
