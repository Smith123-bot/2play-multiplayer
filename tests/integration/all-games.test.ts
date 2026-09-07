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
    maxPlayers: 2,
    isPrivate: false,
    ...(game.settings ? { settings: game.settings } : {}),
  });
  expect(created.ok).toBe(true);

  const ai = await emitAck<{ playerId: string }>(client.socket, 'room:add-ai', { difficulty: 'hard' });
  expect(ai.ok).toBe(true);

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
        expect(room.players).toHaveLength(2);
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
