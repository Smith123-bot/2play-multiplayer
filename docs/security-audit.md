# 2PLAY security audit and hardening matrix

Audit date: 2026-09-09. Scope: the existing HTTP, Socket.IO, room/lifecycle, persistence, client, game-authority, configuration, repository, and dependency surfaces.

This document records verified controls and findings. It does not claim that the application is unhackable.

## Findings matrix

| Area | Severity | Finding | Status |
|---|---|---|---|
| Persistence authorization | High | Statistics, history, and favorites route authorization accepted an arbitrary route user ID when no session header was supplied. | Fixed: persistence routes now require a valid session and same-user authorization. |
| Reconnection authorization | High | A socket that already had an authenticated session could submit a different session token in `reconnect:attempt`. | Fixed: an authenticated socket token must match the reconnect token; unauthenticated refresh still requires the presented valid bearer session token. |
| CORS | High | Wildcard CORS with credentials was possible from configuration, including an unsafe production default. | Fixed: production fails closed unless an explicit origin allowlist is configured. |
| Database RPC | High | The initial migration granted the statistics-writing security-definer RPC to `anon` and `authenticated`, although the Node server is the only intended caller. | Fixed for new deployments and existing deployments through migration 003 revocation. |
| Authentication model | High | The current product has nickname + bearer session authentication, not password accounts, MFA, or password reset. | Documented residual risk; adding a second authentication system would violate the existing architecture. |
| Session token handling | Medium | Unknown supplied session tokens were treated as new sessions, which hides stale-token errors and weakens session lifecycle semantics. | Fixed: supplied but unknown tokens are rejected generically. |
| Socket handshake | Medium | Socket.IO connections are initially transport-authenticated and authenticate through the existing `authenticate` event. | Existing event authorization is retained; sensitive events require a valid server-side session. Full handshake middleware is a compatibility follow-up. |
| Dependencies | Medium | `npm audit --omit=dev` reported five moderate advisories involving `qs`/Express and React Router. | Recorded; dependency upgrades require compatibility testing and are not blindly applied. |
| Debug diagnostics | Low | Detailed health exposes topology and memory in development/test. | Production returns 404; retained for protected local diagnostics. |
| CSRF | Informational | Authentication uses a bearer token in a custom header, not an ambient cookie. | Traditional cookie CSRF does not apply; origin/CORS controls remain required. |

## Verified controls

- Server-side Zod validation is used for authentication, room, lobby, reconnect, chat, rematch, and game action envelopes; schemas are strict and bounded.
- Chat text is normalized and rendered as React text; no `innerHTML` or `dangerouslySetInnerHTML` use was found.
- Game scores, winners, timers, random dice/cards, movement, and completion are computed by server game modules.
- Room membership is resolved from the server session and room player record, never from a client player ID.
- Room create/join/auth/action/chat/HTTP traffic has separate rate-limit controls.
- Reconnection preserves the existing 120-second grace period while checking session ownership.
- Rematch votes are server-side and require room membership, connection, match state, and non-AI player status.
- JSON and URL-encoded HTTP bodies are capped at 32 KB; game payloads are bounded by Zod.
- Helmet, CSP, referrer policy, frame protections, `x-powered-by` removal, and non-wildcard production CORS are configured.
- Supabase service-role credentials are server-only environment variables. The browser receives only `VITE_*` public configuration.
- RLS is enabled for all persisted tables; server persistence uses parameterized Supabase APIs and server-side RPC.
- `.env`, local/production env files, private keys, logs, build output, and dependencies are ignored. No credential-shaped committed secret was found in tracked source during this audit.
- Production error responses omit stack traces and internal details; detailed logs remain server-side.

## Remaining risks and recommended actions

### Authentication/account assurance — High

**Risk:** A nickname session is not an account password or MFA. Theft of a bearer token can impersonate that session until it expires or is dropped.

**Impact:** Account impersonation and room-seat access if a token is exfiltrated from a client environment.

**Recommended action:** Adopt a separately designed identity provider/passwordless or OAuth flow with short-lived access tokens, rotation, revocation, and MFA before treating the platform as an account-authenticated production service. Do not add ad-hoc passwords to the current nickname session model.

### Socket handshake authentication — Medium

**Risk:** The transport connection is accepted before the `authenticate` event.

**Impact:** Unauthenticated clients can open sockets and consume connection resources, although protected events reject them.

**Recommended action:** Add Socket.IO middleware using a short-lived handshake credential once the client authentication flow supports it; retain the current event for session restoration during the migration.

### Dependency advisories — Medium

**Risk:** Five moderate production dependency advisories were reported by npm audit.

**Impact:** Potential denial-of-service or client-side routing issues depending on reachable code paths.

**Recommended action:** Upgrade `qs`/Express and React Router to compatible patched releases, run the complete regression suite, and review lockfile changes.

### Production deployment controls — Medium

**Risk:** HTTPS, HSTS, secret rotation, WAF/DDoS controls, database backup encryption, and external monitoring cannot be verified from this repository alone.

**Impact:** Infrastructure-level exposure despite application-level controls.

**Recommended action:** Enforce these at the deployment boundary and add CI secret scanning, dependency scanning, and protected environment configuration.

## Secret scan result

The repository contains only example environment files with blank secret values. No complete secret is reproduced here. A repository-history rotation review should still be performed by the repository owner if credentials were ever used in ignored local files or outside tracked history.
