# Internal gameplay quality matrix

Audit date: 2026-09-09. This is an engineering checklist, not a claim of device-level certification. `PASS` means the concern has an authoritative server implementation and is exercised by the repository's module/integration coverage; visual/mobile items still require browser/device QA.

| Game | Objective/rules | Core loop | Scoring/end state | Server authority | Result/rematch | AI/multiplayer | Controls/mobile |
|---|---|---|---|---|---|---|---|
| `2048-battle` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `arrow-puzzle` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `black-blast` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `bomb-pass-2d` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `brick-breaker-battle` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `capture-the-flag-2d` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `castle-siege-2d` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `chain-reaction-battle` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `coin-hunters-arena` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `color-clash` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `color-trails` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `dots-and-boxes` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `draw-guess-battle` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `echo-maze` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `fake-door-battle` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `hexa-conquest` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `invisible-path` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `ludo` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `magnet-maze` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `magnet-thief` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `math-rush` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `maze-race-2d` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `memory-match` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `mirror-arena` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `moving-island` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `one-button-battle` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `paddle-duel` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `pattern-memory-battle` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `platform-dash-2d` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `reaction-race` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `reverse-race` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `secret-role` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `shadow-copy-battle` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `shape-match-battle` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `shop-rush-battle` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `snake-battle` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `split-world` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `target-rush` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `territory-rush` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `traffic-control-battle` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `traffic-dodge-race` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `word-race` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |
| `word-scramble-battle` | PASS | PASS | PASS | PASS | PASS | PASS | QA-covered |

## Review method

For every row, the audit inspected the registered server module, client renderer, shared metadata, loader/registry entries, and the game-specific test. The all-games integration suite starts each game and submits a valid action. Shared lifecycle suites cover room start, finish, reconnect, rematch, chat, and action validation. `QA-covered` intentionally distinguishes automated coverage from a physical browser/device pass.

## Follow-up risks

- Browser/device layout and touch ergonomics remain environment-dependent and are not represented as automated PASS claims.
- Full match completion is covered by representative lifecycle tests rather than 43 separate long-running matches.
- Game-specific rules should remain synchronized between server validation, metadata, and the reusable in-room Rules modal; changes to any one should add or update a focused test.
