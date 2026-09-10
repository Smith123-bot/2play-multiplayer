import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RoomState } from '@2play/shared';
import { createClient, emitAck, once, waitForRoom, type TestClient } from '../helpers/client';
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
      typeof state.endsAt === 'number',
    action: { type: 'turn', payload: { direction: 'up' } },
  },
  {
    id: 'traffic-dodge-race',
    expect: (state) =>
      typeof state.lanes === 'number' &&
      typeof state.trackLength === 'number' &&
      Array.isArray(state.traffic) &&
      Boolean(state.racers),
    action: { type: 'move', payload: { direction: 'right' } },
  },
  {
    id: 'target-rush',
    settings: { rounds: 3 },
    expect: (state) =>
      typeof state.totalRounds === 'number' && Array.isArray(state.targets) && Boolean(state.scores),
    action: { type: 'hit', payload: { targetId: 'target-0' } },
  },
  {
    id: 'capture-the-flag-2d',
    expect: (state) =>
      Array.isArray(state.walls) &&
      state.walls.length === 225 &&
      Boolean(state.bases) &&
      Boolean(state.flags) &&
      Boolean(state.scores),
    action: { type: 'move', payload: { direction: 'right' } },
  },
  {
    id: 'paddle-duel',
    expect: (state) =>
      Boolean(state.paddles) &&
      Boolean(state.ball) &&
      typeof state.scoreLimit === 'number' &&
      typeof state.endsAt === 'number',
    action: { type: 'move', payload: { direction: 'up' } },
  },
  {
    id: 'brick-breaker-battle',
    expect: (state) =>
      typeof state.width === 'number' &&
      Boolean(state.arenas) &&
      Object.values(state.arenas as Record<string, { bricks: unknown[] } | null>).every(
        (arena) => Array.isArray(arena?.bricks) && arena!.bricks.length === 28,
      ),
    action: { type: 'move', payload: { direction: 'right' } },
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
    id: 'bomb-pass-2d',
    expect: (state) =>
      typeof state.totalRounds === 'number' &&
      typeof state.fuseMs === 'number' &&
      Boolean(state.players) &&
      typeof state.round === 'number',
    action: { type: 'pass', payload: { targetId: 'nobody' } },
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
    id: 'platform-dash-2d',
    expect: (state) =>
      typeof state.width === 'number' &&
      Array.isArray(state.platforms) &&
      Boolean(state.runners) &&
      typeof state.courseName === 'string',
    action: { type: 'input', payload: { left: false, right: true, jump: true } },
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
    id: 'hexa-conquest',
    expect: (state) =>
      Array.isArray(state.tiles) &&
      (state.tiles as unknown[]).length === 165 &&
      Boolean(state.currentPlayerId) &&
      Boolean(state.scores),
    action: { type: 'capture', payload: { col: 2, row: 1 } },
  },
  {
    id: 'color-trails',
    expect: (state) =>
      Array.isArray(state.tokens) &&
      Boolean(state.runners) &&
      typeof state.stepMs === 'number' &&
      typeof state.endsAt === 'number',
    action: { type: 'turn', payload: { direction: 'right' } },
  },
  {
    id: 'coin-hunters-arena',
    expect: (state) =>
      Array.isArray(state.coins) &&
      Boolean(state.hunters) &&
      Boolean(state.bonus) &&
      typeof state.endsAt === 'number',
    action: { type: 'move', payload: { direction: 'right' } },
  },
  {
    id: 'castle-siege-2d',
    expect: (state) =>
      Boolean(state.commanders) &&
      Array.isArray(state.nodes) &&
      typeof state.cols === 'number' &&
      typeof state.endsAt === 'number',
    action: { type: 'move', payload: { direction: 'down' } },
  },
  {
    id: 'traffic-control-battle',
    expect: (state) => Boolean(state.zones) && typeof state.stepMs === 'number' && typeof state.endsAt === 'number',
    action: { type: 'switch' },
  },
  {
    id: 'magnet-maze',
    expect: (state) =>
      Array.isArray(state.tiles) &&
      Boolean(state.runners) &&
      Boolean(state.finishCell) &&
      typeof state.endsAt === 'number',
    action: { type: 'move', payload: { direction: 'right' } },
  },
  {
    id: 'shop-rush-battle',
    expect: (state) =>
      Array.isArray(state.shelves) &&
      Boolean(state.shoppers) &&
      Boolean(state.till) &&
      typeof state.endsAt === 'number',
    action: { type: 'move', payload: { direction: 'up' } },
  },
  {
    id: 'shadow-copy-battle',
    expect: (state) =>
      Array.isArray(state.tiles) &&
      Boolean(state.runners) &&
      Array.isArray(state.shadows) &&
      typeof state.arenaName === 'string' &&
      typeof state.round === 'number',
    action: { type: 'move', payload: { direction: 'right' } },
  },
  {
    id: 'echo-maze',
    expect: (state) =>
      Array.isArray(state.tiles) &&
      Boolean(state.runners) &&
      Boolean(state.goal) &&
      typeof state.round === 'number',
    action: { type: 'move', payload: { direction: 'right' } },
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
    id: 'moving-island',
    expect: (state) =>
      Array.isArray(state.platforms) &&
      Boolean(state.players) &&
      typeof state.width === 'number' &&
      typeof state.endsAt === 'number',
    action: { type: 'move', payload: { dx: 1, dy: 0 } },
  },
  {
    id: 'magnet-thief',
    expect: (state) =>
      Array.isArray(state.gems) &&
      Boolean(state.players) &&
      typeof state.range === 'number' &&
      typeof state.endsAt === 'number',
    action: { type: 'move', payload: { dx: 1, dy: 0 } },
  },
  {
    id: 'invisible-path',
    settings: { rounds: 2 },
    expect: (state) =>
      Array.isArray(state.safe) &&
      Boolean(state.players) &&
      Boolean(state.start) &&
      Boolean(state.goal) &&
      typeof state.round === 'number',
    action: { type: 'move', payload: { x: 1, y: 3 } },
  },
  {
    id: 'reverse-race',
    settings: { rounds: 2 },
    expect: (state) =>
      Array.isArray(state.grid) &&
      Boolean(state.players) &&
      Boolean(state.objective) &&
      typeof state.round === 'number',
    action: { type: 'move', payload: { direction: 'right' } },
  },
  {
    id: 'mirror-arena',
    expect: (state) =>
      Array.isArray(state.grid) &&
      Array.isArray(state.plates) &&
      Boolean(state.players) &&
      typeof state.endsAt === 'number',
    action: { type: 'move', payload: { direction: 'right' } },
  },
  {
    id: 'chain-reaction-battle',
    settings: { rounds: 2 },
    expect: (state) =>
      Array.isArray(state.nodes) &&
      Boolean(state.players) &&
      typeof state.round === 'number' &&
      typeof state.cols === 'number',
    action: { type: 'TRIGGER_NODE', payload: { nodeId: '0,0' } },
  },
  {
    id: 'one-button-battle',
    expect: (state) =>
      Boolean(state.players) &&
      typeof state.currentIndex === 'number' &&
      typeof state.totalEvents === 'number' &&
      typeof state.endsAt === 'number',
    action: { type: 'tap' },
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
      Array.isArray(state.turnOrder),
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
    id: 'love-maze',
    maxPlayers: 2,
    expect: (state) =>
      Array.isArray(state.tiles) &&
      (state.tiles as unknown[]).length > 0 &&
      typeof state.levelName === 'string' &&
      state.totalLevels === 10 &&
      Boolean(state.players),
    action: { type: 'move', payload: { direction: 'right' } },
  },
  {
    id: 'sync-jump',
    maxPlayers: 2,
    expect: (state) =>
      Array.isArray(state.course) &&
      (state.course as unknown[]).length > 0 &&
      typeof state.syncMeter === 'number' &&
      state.totalLevels === 10 &&
      Boolean(state.players),
    action: { type: 'move', payload: { direction: 'right' } },
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
    id: 'build-together',
    maxPlayers: 2,
    expect: (state) =>
      Array.isArray(state.blueprint) &&
      (state.blueprint as unknown[]).length > 0 &&
      Boolean(state.inventory) &&
      state.totalLevels === 10 &&
      Boolean(state.players),
    action: { type: 'place', payload: { x: 0, y: 0, kind: 'a' } },
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
      expect((finished?.chat.length ?? 0)).toBeGreaterThan(0);

      // A rematch can be requested immediately after the result.
      const vote = await emitAck(host.socket, 'rematch:request', {});
      expect(vote.ok).toBe(true);
    } finally {
      host.socket.off('room:updated', onUpdate);
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
      expect(resultRoom.chat.length).toBeGreaterThan(0); // chat survives the finish
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
