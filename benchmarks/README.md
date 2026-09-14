# 2PLAY Performance Benchmark Harness

Measures the real, player-facing critical paths by booting the **actual server**
(all managers, real Socket.IO over loopback TCP) and driving it with real
socket clients. Every number this harness prints is an actual measurement —
nothing is estimated or simulated.

```bash
# From the repository root:
npx tsx benchmarks/bench.ts
```

The harness raises the per-IP rate limits **in its own process only** (via the
documented environment variables) so it can take hundreds of samples; the
defaults that ship to production are untouched.

## What it measures

| Metric | Meaning |
| --- | --- |
| `auth` | `authenticate` round-trip (session mint/restore) |
| `room:create` | room creation round-trip + payload size |
| `room:join` | join-by-code round-trip |
| `lobby:ready(host)` | readiness toggle round-trip |
| `game:start(ack)` | host "start match" ack (countdown begins) |
| `room:list` | public room listing (empty and under 200 live rooms) |
| `heartbeat` | keep-alive round-trip |
| `game:action RTT` | action → server-validated ack (turn-based game) |
| steady-state lines | inbound messages/second and KB/second per client for a realtime (tick-based) game, and per accepted action |

Notes for interpreting results:

- Numbers are loopback (same machine). Network latency adds on top in the real
  world; relative changes remain meaningful.
- The steady-state numbers are the dominant mobile-data cost: they are what a
  client downloads per second while sitting in a running realtime match.
  Compare them against the broadcast payload composition when they regress.
