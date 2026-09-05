# Adding a game to 2PLAY

You never touch the room manager, socket manager, chat, rematch, reconnection,
statistics or the UI shell. A new game needs four things.

## 1. Metadata (`shared/src/games/metadata.ts`)

```ts
export const ROCKETS_METADATA = {
  id: 'rockets',
  name: 'Rockets',
  description: '…',
  category: 'strategy',           // reflex | memory | word | strategy | math
  icon: '🚀',
  thumbnail: '🚀',
  minPlayers: 2,
  maxPlayers: 4,
  supportedPlayerCounts: [2, 3, 4],
  hasAI: true,
  aiDifficulties: ['easy', 'medium', 'hard'],
  estimatedDuration: 180,         // seconds
  difficulty: 'medium',
  controls: 'Tap …',
  rules: ['Rule one', 'Rule two'],
  scoring: '1 point per …',
  winCondition: 'Score the most …',
  tags: ['strategy', 'new'],
  featured: false,
  gridOptions: ['6x6'],           // optional, surfaced in the lobby
  hasRounds: false,               // optional
  version: '1.0.0',
} satisfies GameMetadata;
```

The registry validates metadata at registration time (ids, player counts, AI
difficulties, required strings).

## 2. Server module (`server/src/games/rockets/index.ts`)

Implement `GameModule<S>` (see `server/src/games/GameModule.ts`):

```ts
export const rocketsGame: GameModule<RocketsState> = {
  metadata: ROCKETS_METADATA,
  initialize(config) { /* … */ },
  createInitialState(players, config) { /* return fresh state */ },
  playerJoined(player, state, ctx) {},
  playerReady(playerId, state, ctx) {},
  playerLeft(playerId, state, ctx, reason) {},
  start(state, ctx) { /* schedule first turn, AI moves */ },
  validateAction(playerId, action, state, ctx) { return { valid: true }; },
  handlePlayerAction(playerId, action, state, ctx) { return actionAccepted(); },
  update(state, dt, ctx) {},
  tick(state, ctx) {},
  calculateScore(playerId, state) { return state.scores[playerId] ?? 0; },
  checkWinCondition(state) { return null; },
  checkDrawCondition(state) { return false; },
  isGameFinished(state) { return state.phase === 'finished'; },
  finish(state, ctx) { state.phase = 'finished'; },
  getResult(state, ctx) { return { winners, isDraw, rankings }; },
  reset(state) { /* zero scores, keep seats */ },
  cleanup(state) {},
  getPublicState(state, viewerId, ctx) { /* strip hidden data! */ },
  getAIMove(playerId, difficulty, state, ctx) { return { type: 'move', payload: { … } }; },
};
```

Rules of the road:

* **Never** import managers, sockets or the database. Use only `GameContext`:
  `now()`, `random()` (seeded), `schedule()`, `cancel()`, `requestAI()`,
  `markStateChanged()`, `finish()`, `logger`.
* Keep hidden information in the state and strip it in `getPublicState()`.
* Use `ctx.schedule(...)` (or `requestAI`) for every delay — never `setTimeout`.
* Call `ctx.markStateChanged()` after mutating state so the platform broadcasts.
* Return `GameResultDraft` with one ranking per player; the platform enriches it
  with nicknames, avatars and duration.

## 3. Client module (`client/src/games/rockets/index.tsx`)

```tsx
function RocketsGame({ state, players, myPlayerId, sendAction, play, vibrate }: GameComponentProps<RocketsState>) {
  // render the public state, send intents with sendAction({ type: 'move', payload: { … } })
}

export const rocketsClient: ClientGameModule = {
  metadata: ROCKETS_METADATA,
  Component: RocketsGame as unknown as ComponentType<GameComponentProps<never>>,
};
```

The component is a pure renderer: no rules, no timers of record, no scores decided
locally. Use `useServerDeadline()` to mirror server deadlines for UI only.

## 4. Registration

```ts
// server/src/managers/GameLoader.ts
import { rocketsGame } from '../games/rockets';
const games: GameModule[] = [ …, rocketsGame ];

// client/src/games/registry/index.ts
import { rocketsClient } from '../rockets';
const modules: ClientGameModule[] = [ …, rocketsClient ];
```

## 5. Tests

Add `server/src/games/rockets/index.test.ts` (rules, validation, hidden state, AI
legality) and, if useful, an integration case in `tests/integration/all-games.test.ts`.

## Checklist

- [ ] metadata registered and valid
- [ ] hidden state stripped in `getPublicState()`
- [ ] actions validated (`validateAction`) — turn, phase, bounds
- [ ] timers go through `ctx.schedule()` / `ctx.requestAI()`
- [ ] `reset()` keeps every seat and zeroes scores
- [ ] AI makes legal, difficulty-scaled moves (or `hasAI: false`)
- [ ] mobile friendly UI (44 px targets, no hover requirement)
