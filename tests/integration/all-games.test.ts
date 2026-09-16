import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RoomState } from '@2play/shared';
import { createClient, emitAck, once, watchRoom, waitForRoom, type TestClient } from '../helpers/client';
import { startTestServer, type TestServer } from '../helpers/server';

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
}, 30_000);

afterAll(async () => {
  await server?.stop();
});

interface GameCase {
  id: string;
  settings?: Record<string, unknown>;
  expect: (state: Record<string, unknown>) => boolean;
  action?: { type: string; payload?: Record<string, unknown> };
  maxPlayers?: number;
  extraAi?: number;
}

const CASES: GameCase[] = [
  {
    id: 'reaction-race',
    settings: { rounds: 1 },
    expect: (state) => Boolean(state.phase) && typeof state.totalRounds === 'number',
    action: { type: 'tap' },
  },
  {
    id: 'memory-match',
    settings: { gridSize: '4x4' },
    expect: (state) =>
      Array.isArray(state.cards) &&
      (state.cards as unknown[]).length === 16 &&
      Boolean(state.currentPlayerId),
    action: { type: 'flip', payload: { cardId: 0 } },
  },
  {
    id: 'word-race',
    settings: { rounds: 1 },
    expect: (state) => Boolean(state.phase),
    action: { type: 'submit', payload: { word: 'test' } },
  },
  {
    id: 'dots-and-boxes',
    settings: { gridSize: '4x4' },
    expect: (state) =>
      Array.isArray(state.hLines) && Array.isArray(state.boxes) && state.totalBoxes === 9,
    action: { type: 'draw', payload: { orientation: 'h', row: 0, col: 0 } },
  },
  {
    id: 'math-rush',
    expect: (state) => Boolean(state.phase) && typeof state.totalQuestions === 'number',
    action: { type: 'answer', payload: { questionId: 'stale', value: 1 } },
  },
  {
    id: '2048-battle',
    expect: (state) =>
      Boolean(state.phase) &&
      Object.values(state.boards as Record<string, { tiles: unknown[] } | null>).every(
        (board) => Array.isArray(board?.tiles) && board!.tiles.length === 16,
      ) &&
      typeof state.endsAt === 'number',
    action: { type: 'move', payload: { direction: 'left' } },
  },
  {
    id: 'maze-race-2d',
    settings: { gridSize: '11x11' },
    expect: (state) =>
      Array.isArray(state.walls) && state.walls.length === 121 && Boolean(state.goal),
    action: { type: 'move', payload: { direction: 'right' } },
  },
  {
    id: 'word-scramble-battle',
    settings: { rounds: 1 },
    expect: (state) =>
      typeof state.scrambled === 'string' && state.scrambled.length > 0 && state.answer === null,
    action: { type: 'submit', payload: { answer: 'ZZZZZZ' } },
  },
  {
    id: 'shape-match-battle',
    settings: { rounds: 3 },
    expect: (state) =>
      Boolean(state.target) && Array.isArray(state.options) && state.options.length === 4,
    action: { type: 'select', payload: { optionId: 'shape-0' } },
  },
  {
    id: 'snake-battle',
    expect: (state) =>
      Array.isArray(state.foods) &&
      Boolean(state.snakes) &&
      typeof state.stepMs === 'number' &&
      typeof state.endsAt === 'number' &&
      // Every snake starts with exactly 3 lives and a respawn-grace flag.
      Object.values(state.snakes as Record<string, { lives: unknown; maxLives: unknown; safe: unknown } | null>).every(
        (snake) => snake !== null && snake.lives === 3 && snake.maxLives === 3 && snake.safe === false,
      ),
    action: { type: 'turn', payload: { direction: 'up' } },
  },
  {
    id: 'target-rush',
    settings: { rounds: 3 },
    expect: (state) =>
      typeof state.totalRounds === 'number' && Array.isArray(state.targets) && Boolean(state.scores),
    action: { type: 'hit', payload: { targetId: 'target-0' } },
  },
  {
    id: 'pattern-memory-battle',
    expect: (state) =>
      typeof state.totalRounds === 'number' &&
      typeof state.patternLength === 'number' &&
      Boolean(state.players) &&
      typeof state.round === 'number',
    action: { type: 'tap', payload: { tile: 0 } },
  },
  {
    id: 'draw-guess-battle',
    settings: { rounds: 2 },
    expect: (state) =>
      typeof state.round === 'number' &&
      Array.isArray(state.strokes) &&
      typeof state.drawerId === 'string' &&
      (state.word === null || typeof state.word === 'string'),
    action: { type: 'guess', payload: { text: 'cat' } },
  },
  {
    id: 'secret-role',
    settings: { rounds: 1 },
    maxPlayers: 3,
    extraAi: 2,
    expect: (state) =>
      typeof state.round === 'number' &&
      Array.isArray(state.topics) &&
      state.agentId === null &&
      (state.myRole === 'citizen' || state.myRole === 'agent'),
    action: { type: 'clue', payload: { text: 'busy place' } },
  },
  {
    id: 'color-clash',
    settings: { rounds: 4 },
    expect: (state) =>
      typeof state.totalRounds === 'number' &&
      typeof state.round === 'number' &&
      Boolean(state.scores) &&
      state.correctOptionId === null,
    action: { type: 'pick', payload: { optionId: 'opt-0' } },
  },
  {
    id: 'territory-rush',
    expect: (state) =>
      typeof state.cols === 'number' &&
      typeof state.rows === 'number' &&
      typeof state.grid === 'string' &&
      Boolean(state.runners) &&
      typeof state.endsAt === 'number',
    action: { type: 'turn', payload: { direction: 'down' } },
  },
  {
    id: 'fake-door-battle',
    settings: { rounds: 3 },
    expect: (state) =>
      Array.isArray(state.doors) &&
      (state.doors as unknown[]).length === 4 &&
      typeof state.clue === 'string' &&
      state.correctDoorId === null,
    action: { type: 'pick', payload: { doorId: 'door-0' } },
  },
  {
    id: 'split-world',
    expect: (state) =>
      Array.isArray(state.tiles) &&
      Boolean(state.players) &&
      typeof state.lens === 'string' &&
      typeof state.objective === 'string' &&
      state.totalRounds === 5 &&
      // Hidden information must never reach a client.
      state.trueTiles === undefined &&
      state.switches === undefined &&
      state.keys === undefined,
    action: { type: 'move', payload: { direction: 'right' } },
  },
  {
    id: 'ludo',
    expect: (state) =>
      Boolean(state.players) &&
      Array.isArray(state.trackCells) &&
      (state.trackCells as unknown[]).length === 52 &&
      typeof state.phase === 'string' &&
      Array.isArray(state.turnOrder) &&
      // Resolved-geometry contract: every token ships a grid cell + kind, the
      // lane starts at 51 and the full journey is exactly 56 steps.
      state.laneStart === 51 &&
      state.finishDistance === 56 &&
      Object.values(state.players as Record<string, { tokens: unknown[] }>).every((slot) =>
        (slot.tokens as Array<{ gridCell: unknown; kind: string }>).every(
          (token) => token.gridCell !== null && token.gridCell !== undefined && typeof token.kind === 'string',
        ),
      ),
    action: { type: 'roll' },
  },
  {
    id: 'arrow-puzzle',
    expect: (state) =>
      Array.isArray(state.board) &&
      (state.board as unknown[]).length > 0 &&
      typeof state.difficulty === 'string' &&
      Boolean(state.players) &&
      // The generator solution must never reach a client.
      state.layout === undefined &&
      state.seed === undefined,
    action: { type: 'hint' },
  },
  {
    id: 'black-blast',
    expect: (state) =>
      Array.isArray(state.nodes) &&
      (state.nodes as unknown[]).length > 0 &&
      Array.isArray(state.pulses) &&
      Boolean(state.players) &&
      typeof state.cols === 'number',
    action: { type: 'pulse' },
  },
  {
    id: 'couple-sync',
    maxPlayers: 2,
    expect: (state) =>
      typeof state.totalRounds === 'number' &&
      Boolean(state.current) &&
      Boolean(state.players) &&
      typeof state.teamScore === 'number',
    action: { type: 'act' },
  },
  {
    id: 'couple-memory',
    maxPlayers: 2,
    expect: (state) =>
      Array.isArray(state.cards) &&
      (state.cards as Array<{ symbol: string | null }>).length > 0 &&
      // Face-down symbols must never reach a client.
      (state.cards as Array<{ symbol: string | null }>).every((card) => card.symbol === null) &&
      Boolean(state.players),
    action: { type: 'hint' },
  },
  {
    id: 'connect-four',
    maxPlayers: 2,
    expect: (state) =>
      Array.isArray(state.board) &&
      (state.board as unknown[]).length === 42 &&
      state.cols === 7 &&
      state.rows === 6 &&
      Boolean(state.players),
    action: { type: 'drop', payload: { col: 3 } },
  },
  {
    id: 'hangman',
    maxPlayers: 2,
    expect: (state) =>
      typeof state.masked === 'string' &&
      (state.masked as string).length > 0 &&
      // The answer must never reach a client mid-round.
      state.secret === undefined &&
      state.revealedWord === null &&
      Boolean(state.players),
    action: { type: 'guess', payload: { letter: 'E' } },
  },
  {
    id: 'sos-game',
    maxPlayers: 2,
    expect: (state) =>
      Array.isArray(state.board) &&
      (state.board as unknown[]).length === 25 &&
      Array.isArray(state.lines) &&
      Boolean(state.players),
    action: { type: 'place', payload: { index: 0, letter: 'S' } },
  },
  {
    id: 'chess',
    maxPlayers: 2,
    expect: (state) =>
      Array.isArray(state.board) &&
      (state.board as unknown[]).length === 64 &&
      (state.turn === 'w' || state.turn === 'b') &&
      Boolean(state.clocks) &&
      Boolean(state.players),
    // e2-e4: from index 52 to index 36.
    action: { type: 'move', payload: { from: 52, to: 36 } },
  },
  {
    id: 'uno',
    maxPlayers: 2,
    expect: (state) =>
      Array.isArray(state.myHand) &&
      (state.myHand as unknown[]).length === 7 &&
      Boolean(state.topCard) &&
      typeof state.activeColor === 'string' &&
      typeof state.drawPileCount === 'number' &&
      // The deck and other hands must never reach a client.
      state.drawPile === undefined &&
      Boolean(state.players),
    action: { type: 'draw' },
  },
  {
    id: 'sim',
    maxPlayers: 2,
    expect: (state) =>
      Array.isArray(state.edges) &&
      (state.edges as unknown[]).length === 15 &&
      state.nodes === 6 &&
      Boolean(state.players),
    action: { type: 'claim', payload: { edgeId: 'e01' } },
  },
  {
    id: 'mirror-grid',
    maxPlayers: 2,
    expect: (state) =>
      Array.isArray(state.source) &&
      (state.source as unknown[]).length > 0 &&
      Array.isArray(state.myAnswer) &&
      typeof state.mirror === 'string' &&
      // The answer must never reach a client.
      state.solution === undefined &&
      Boolean(state.players),
    action: { type: 'set', payload: { index: 0, symbol: 'circle', color: 'red' } },
  },
  {
    id: 'fuse',
    maxPlayers: 2,
    expect: (state) =>
      Array.isArray(state.board) &&
      (state.board as unknown[]).length > 0 &&
      typeof state.circuits === 'number' &&
      (state.circuits as number) > 0 &&
      Boolean(state.players),
    action: { type: 'rotate', payload: { tileId: 't0-0' } },
  },
  {
    id: 'rock-paper-scissors',
    maxPlayers: 2,
    // The public state a client receives mid-round must carry the countdown or
    // the throw window, the win target, and NOTHING about the opponent's shape.
    expect: (state) =>
      (state.phase === 'countdown' || state.phase === 'choose') &&
      typeof state.winsNeeded === 'number' &&
      Array.isArray(state.seatOrder) &&
      state.myChoice === null &&
      Object.values(state.opponents as Record<string, { choice: unknown }>).every(
        (opponent) => opponent.choice === null,
      ),
    action: { type: 'throw', payload: { choice: 'rock' } },
  },
];

/** Finds the first undrawn line on the board (used to play a full match). */
function firstLegalMove(
  state: { cols: number; rows: number; hLines: boolean[]; vLines: boolean[] },
): { orientation: 'h' | 'v'; row: number; col: number } | null {
  for (let row = 0; row < state.rows; row += 1) {
    for (let col = 0; col < state.cols - 1; col += 1) {
      if (!state.hLines[row * (state.cols - 1) + col]) {
        return { orientation: 'h', row, col };
      }
    }
  }
  for (let row = 0; row < state.rows - 1; row += 1) {
    for (let col = 0; col < state.cols; col += 1) {
      if (!state.vLines[row * state.cols + col]) {
        return { orientation: 'v', row, col };
      }
    }
  }
  return null;
}

let soloCounter = 0;

async function playWithAI(game: GameCase): Promise<{ client: TestClient; room: RoomState }> {
  // Nicknames are capped at 20 characters — keep the derived name short & unique.
  soloCounter += 1;
  const client = await createClient(
    server.url,
    `Solo${soloCounter}${game.id.replace(/-/g, '').slice(0, 10)}`,
  );
  const created = await emitAck<{ room: RoomState }>(client.socket, 'room:create', {
    gameId: game.id,
    maxPlayers: game.maxPlayers ?? 2,
    isPrivate: false,
    ...(game.settings ? { settings: game.settings } : {}),
  });
  expect(created.ok).toBe(true);

  const aiCount = game.extraAi ?? 1;
  for (let i = 0; i < aiCount; i += 1) {
    const ai = await emitAck<{ playerId: string }>(client.socket, 'room:add-ai', { difficulty: 'hard' });
    expect(ai.ok).toBe(true);
  }

  await emitAck(client.socket, 'lobby:ready', { isReady: true });
  const started = await emitAck(client.socket, 'game:start', {});
  expect(started.ok).toBe(true);

  await once(client.socket, 'game:started', 25_000);
  const room = await waitForRoom(client.socket, (current) => current.status === 'PLAYING', 25_000);
  return { client, room };
}

describe('every shipped game is playable', () => {
  for (const game of CASES) {
    it(`${game.id} starts, exposes a valid public state and accepts actions`, async () => {
      const { client, room } = await playWithAI(game);
      try {
        expect(room.gameId).toBe(game.id);
        expect(room.players).toHaveLength(1 + (game.extraAi ?? 1));
        const state = room.gameState as Record<string, unknown>;
        expect(game.expect(state)).toBe(true);

        if (game.action) {
          const response = await emitAck(client.socket, 'game:action', { action: game.action });
          // Either the action is accepted or the server explains why not —
          // what matters is that the server (not the client) decides.
          expect(typeof response.ok).toBe('boolean');
          if (!response.ok) {
            expect(['E001', 'E006', 'E007']).toContain(response.error?.code);
          }
        }

        // The room must still be the same one we started.
        expect(client.room()?.id ?? room.id).toBe(room.id);
      } finally {
        client.close();
      }
    }, 90_000);
  }

  it('plays a full two-player Dots and Boxes match and keeps the room alive', async () => {
    const host = await createClient(server.url, 'BoxesHost');
    const guest = await createClient(server.url, 'BoxesGuest');

    type Board = {
      cols: number;
      rows: number;
      hLines: boolean[];
      vLines: boolean[];
      currentPlayerId: string | null;
      claimedBoxes: number;
    };

    let latest = host.room();
    const onUpdate = (payload: { room: RoomState }) => {
      latest = payload.room;
    };
    host.socket.on('room:updated', onUpdate);

    try {
      const created = await emitAck<{ room: RoomState }>(host.socket, 'room:create', {
        gameId: 'dots-and-boxes',
        maxPlayers: 2,
        isPrivate: false,
        settings: { gridSize: '4x4' },
      });
      expect(created.ok).toBe(true);
      const roomId = created.data!.room.id;
      await emitAck(guest.socket, 'room:join', { roomId });
      await emitAck(host.socket, 'lobby:ready', { isReady: true });
      await emitAck(guest.socket, 'lobby:ready', { isReady: true });
      await emitAck(host.socket, 'game:start', {});
      await once(host.socket, 'game:started', 25_000);

      const players: Array<{ client: TestClient; id: string }> = [
        { client: host, id: host.playerId },
        { client: guest, id: guest.playerId },
      ];

      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        if (!latest || latest.status !== 'PLAYING') break;
        const board = latest.gameState as Board | null;
        if (!board) break;

        const active = players.find((entry) => entry.id === board.currentPlayerId);
        if (!active) {
          await new Promise((resolve) => setTimeout(resolve, 120));
          continue;
        }

        const move = firstLegalMove(board);
        if (!move) break;
        const response = await emitAck(active.client.socket, 'game:action', {
          action: { type: 'draw', payload: move },
        });
        expect(response.ok).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 120));
      }

      const finished = latest as RoomState | null;
      expect(finished).not.toBeNull();
      expect(['RESULT', 'REMATCH_WAITING']).toContain(finished?.status);
      expect(finished?.id).toBe(roomId);
      expect(finished?.players).toHaveLength(2);
      expect(finished?.players.every((player) => player.isConnected)).toBe(true);
      expect(finished?.gameResult?.rankings).toHaveLength(2);
      expect((finished?.gameState as Board | null)?.claimedBoxes).toBe(9);

      // Sockets, players and chat all survive the finish line (spec §17/§66).
      expect(host.socket.connected).toBe(true);
      expect(guest.socket.connected).toBe(true);
      // Chat holds ONLY real player messages now — lifecycle events are status
      // UI, so a finished match must not have written any chat lines.
      expect((finished?.chat ?? []).every((message) => message.type !== 'system')).toBe(true);
      // A real player message still reaches the whole room after the result.
      const dotsChatAck = await emitAck(host.socket, 'chat:send', { text: 'gg, nice boxes' });
      expect(dotsChatAck.ok).toBe(true);
      const dotsChat = await waitForRoom(
        host.socket,
        (current) => (current.chat ?? []).some((message) => message.text === 'gg, nice boxes'),
        10_000,
      );
      expect((dotsChat.chat ?? []).some((message) => message.text === 'gg, nice boxes')).toBe(true);

      // A rematch can be requested immediately after the result.
      const vote = await emitAck(host.socket, 'rematch:request', {});
      expect(vote.ok).toBe(true);
    } finally {
      host.socket.off('room:updated', onUpdate);
      host.close();
      guest.close();
    }
  }, 200_000);

  it('plays a full two-player Rock Paper Scissors match without leaking a throw', async () => {
    const host = await createClient(server.url, 'RpsHost');
    const guest = await createClient(server.url, 'RpsGuest');
    const hostRoom = watchRoom(host.socket);
    const guestRoom = watchRoom(guest.socket);

    /** The per-viewer projection the server sends for this game. */
    type RpsView = {
      phase: string;
      round: number;
      winsNeeded: number;
      myChoice: string | null;
      me: { score: number; draws: number; forfeits: number; disconnected: boolean } | null;
      opponents: Record<string, { hasThrown: boolean; choice: string | null; score: number }>;
      roundResult: {
        choices: Record<string, string | null>;
        outcomes: Record<string, string>;
        forfeits: string[];
      } | null;
    };
    const viewOf = (room: RoomState | null): RpsView => room?.gameState as RpsView;
    const opponentOf = (room: RoomState | null, otherId: string) =>
      viewOf(room).opponents[otherId]!;

    try {
      const created = await emitAck<{ room: RoomState }>(host.socket, 'room:create', {
        gameId: 'rock-paper-scissors',
        maxPlayers: 2,
        isPrivate: false,
        settings: { rounds: 2 },
      });
      expect(created.ok).toBe(true);
      const roomId = created.data!.room.id;

      await emitAck(guest.socket, 'room:join', { roomId });
      await emitAck(host.socket, 'lobby:ready', { isReady: true });
      await emitAck(guest.socket, 'lobby:ready', { isReady: true });
      await emitAck(host.socket, 'game:start', {});
      await once(host.socket, 'game:started', 25_000);

      /* ---- round 1: the host throws first ---- */
      await hostRoom.waitFor((room) => viewOf(room).phase === 'choose');
      await guestRoom.waitFor((room) => viewOf(room).phase === 'choose');
      expect(viewOf(hostRoom.current()).winsNeeded).toBe(2);

      const thrown = await emitAck<{ accepted: boolean }>(host.socket, 'game:action', {
        action: { type: 'throw', payload: { choice: 'rock' } },
      });
      expect(thrown.ok).toBe(true);
      expect(thrown.data!.accepted).toBe(true);

      const hostLocked = await hostRoom.waitFor((room) => viewOf(room).myChoice === 'rock');
      expect(opponentOf(hostLocked, guest.playerId).hasThrown).toBe(false);

      /* ---- THE SECURITY INVARIANT ----
       * The guest is told that a throw happened, but never what it was. This is
       * asserted on the wire, over a real socket, from the server's own
       * projection — a leak here would be a cheat vector, not a UI nit. */
      const guestTold = await guestRoom.waitFor((room) =>
        opponentOf(room, host.playerId).hasThrown,
      );
      expect(opponentOf(guestTold, host.playerId).choice).toBeNull();
      expect(viewOf(guestTold).myChoice).toBeNull();
      expect(viewOf(guestTold).roundResult).toBeNull();
      expect(JSON.stringify(guestTold.gameState)).not.toContain('"rock"');

      // Locked means locked: a second throw from the same seat is refused.
      // `ok` only reports that the handler ran — the verdict is `accepted`.
      const duplicate = await emitAck<{ accepted: boolean }>(host.socket, 'game:action', {
        action: { type: 'throw', payload: { choice: 'paper' } },
      });
      expect(duplicate.ok).toBe(true);
      expect(duplicate.data!.accepted).toBe(false);
      // The refusal changed nothing.
      expect(viewOf(hostRoom.current()).myChoice).toBe('rock');

      // The client may not assert its own outcome either.
      const hostile = await emitAck<{ accepted: boolean }>(host.socket, 'game:action', {
        action: { type: 'score', payload: { score: 99 } },
      });
      expect(hostile.data!.accepted).toBe(false);

      /* ---- the guest throws the losing shape; both are revealed ---- */
      await emitAck(guest.socket, 'game:action', {
        action: { type: 'throw', payload: { choice: 'scissors' } },
      });

      const hostReveal = await hostRoom.waitFor((room) => viewOf(room).phase === 'reveal');
      const guestReveal = await guestRoom.waitFor((room) => viewOf(room).phase === 'reveal');

      // Both viewers now see both shapes, and agree on the server's verdict.
      expect(viewOf(hostReveal).roundResult!.choices[host.playerId]).toBe('rock');
      expect(viewOf(hostReveal).roundResult!.choices[guest.playerId]).toBe('scissors');
      expect(opponentOf(hostReveal, guest.playerId).choice).toBe('scissors');
      expect(opponentOf(guestReveal, host.playerId).choice).toBe('rock');
      expect(viewOf(hostReveal).roundResult!.outcomes[host.playerId]).toBe('win');
      expect(viewOf(guestReveal).roundResult!.outcomes[guest.playerId]).toBe('loss');
      // From the guest's seat the host is the opponent, and the host just won
      // the round — so the guest is shown 1 for them and 0 for itself.
      expect(opponentOf(guestReveal, host.playerId).score).toBe(1);
      expect(viewOf(guestReveal).me!.score).toBe(0);
      expect(viewOf(guestReveal).myChoice).toBe('scissors');

      /* ---- play the match out: rock beats scissors every round ---- */
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        const current = hostRoom.current();
        if (!current || current.status !== 'PLAYING') break;
        if (viewOf(current).phase === 'choose' && viewOf(current).myChoice === null) {
          await emitAck(host.socket, 'game:action', {
            action: { type: 'throw', payload: { choice: 'rock' } },
          });
          await emitAck(guest.socket, 'game:action', {
            action: { type: 'throw', payload: { choice: 'scissors' } },
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      /* ---- the finish line ---- */
      const finished = await hostRoom.waitFor(
        (room) => ['RESULT', 'REMATCH_WAITING'].includes(room.status),
        30_000,
      );
      expect(finished.id).toBe(roomId);
      expect(finished.players).toHaveLength(2);
      expect(finished.players.every((player) => player.isConnected)).toBe(true);

      const result = finished.gameResult!;
      expect(result.gameId).toBe('rock-paper-scissors');
      expect(result.winners).toEqual([host.playerId]);
      expect(result.isDraw).toBe(false);
      expect(result.rankings).toHaveLength(2);
      expect(result.rankings[0]!.playerId).toBe(host.playerId);
      expect(result.rankings[0]!.rank).toBe(1);
      expect(result.rankings[0]!.stats.roundsWon).toBe(2);
      expect(result.rankings[1]!.playerId).toBe(guest.playerId);

      // The guest sees exactly the same verdict — one server, one truth.
      const guestFinished = await guestRoom.waitFor(
        (room) => ['RESULT', 'REMATCH_WAITING'].includes(room.status),
        30_000,
      );
      expect(guestFinished.gameResult!.winners).toEqual([host.playerId]);
      expect(guestFinished.gameResult!.rankings[0]!.playerId).toBe(host.playerId);

      // Nothing is playable after the match is over.
      const afterFinish = await emitAck<{ accepted: boolean }>(host.socket, 'game:action', {
        action: { type: 'throw', payload: { choice: 'rock' } },
      });
      // Either the handler refuses outright (no live match to act on) or the
      // module rejects it — what must never happen is an accepted throw.
      const refused = afterFinish.ok === false || afterFinish.data?.accepted === false;
      expect(refused, 'a throw was accepted after the match finished').toBe(true);

      // Sockets and seats survive, so a rematch can start in the same room.
      expect(host.socket.connected).toBe(true);
      expect(guest.socket.connected).toBe(true);
      const vote = await emitAck(host.socket, 'rematch:request', {});
      expect(vote.ok).toBe(true);
    } finally {
      hostRoom.stop();
      guestRoom.stop();
      host.close();
      guest.close();
    }
  }, 200_000);

  it('plays a full Word Scramble Battle match, then rematches into a new match', async () => {
    const host = await createClient(server.url, 'ScrambleHost');
    const guest = await createClient(server.url, 'ScrambleGuest');

    try {
      const created = await emitAck<{ room: RoomState }>(host.socket, 'room:create', {
        gameId: 'word-scramble-battle',
        maxPlayers: 2,
        isPrivate: false,
        settings: { rounds: 1 },
      });
      expect(created.ok).toBe(true);
      const roomId = created.data!.room.id;

      await emitAck(guest.socket, 'room:join', { roomId });
      await emitAck(host.socket, 'lobby:ready', { isReady: true });
      await emitAck(guest.socket, 'lobby:ready', { isReady: true });
      await emitAck(host.socket, 'game:start', {});
      await once(host.socket, 'game:started', 25_000);

      // The scrambled word is public; the answer never is.
      const playing = await waitForRoom(host.socket, (current) => current.status === 'PLAYING', 25_000);
      const scrambleState = playing.gameState as { scrambled: string; answer: string | null };
      expect(scrambleState.scrambled).toMatch(/^[A-Z]+$/);
      expect(scrambleState.answer).toBeNull();

      // Both players submit one well-formed answer through the pipeline.
      for (const client of [host, guest]) {
        const response = await emitAck(client.socket, 'game:action', {
          action: { type: 'submit', payload: { answer: 'GUESS' } },
        });
        expect(typeof response.ok).toBe('boolean');
      }

      // Round 1 of 1 ends (early once both solved, else via its timer) → result.
      const resultRoom = await waitForRoom(
        host.socket,
        (current) => current.status === 'RESULT' || current.status === 'REMATCH_WAITING',
        60_000,
      );
      expect(resultRoom.gameResult?.rankings).toHaveLength(2);
      expect(resultRoom.gameResult?.gameId).toBe('word-scramble-battle');
      // Chat survives the finish but carries no lifecycle/system lines — only
      // what players actually said.
      expect((resultRoom.chat ?? []).every((message) => message.type !== 'system')).toBe(true);
      expect(host.socket.connected).toBe(true);
      expect(guest.socket.connected).toBe(true);

      // Both humans vote → rematch → new countdown → fresh match #2.
      // (Listeners are registered BEFORE voting — rematch:started can fire
      // while the vote acknowledgement is still in flight.)
      const rematchStarted = once(host.socket, 'rematch:started', 15_000);
      const secondStart = once(host.socket, 'game:started', 25_000);

      const hostVote = await emitAck(host.socket, 'rematch:request', {});
      expect(hostVote.ok).toBe(true);
      const guestVote = await emitAck(guest.socket, 'rematch:request', {});
      expect(guestVote.ok).toBe(true);

      await rematchStarted;
      await secondStart;
      const rematch = await waitForRoom(
        host.socket,
        (current) => current.status === 'PLAYING' && current.matchNumber === 2,
        25_000,
      );
      expect(rematch.matchNumber).toBe(2);
      expect(rematch.id).toBe(roomId);
      expect(rematch.players).toHaveLength(2);
      expect(rematch.players.every((player) => player.isConnected)).toBe(true);

      const secondScramble = rematch.gameState as { scrambled: string; answer: string | null };
      expect(secondScramble.scrambled).toMatch(/^[A-Z]+$/);
      expect(secondScramble.answer).toBeNull();
    } finally {
      host.close();
      guest.close();
    }
  }, 150_000);
});
