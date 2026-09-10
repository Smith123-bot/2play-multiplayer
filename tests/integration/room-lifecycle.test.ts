import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import type { AckResponse, RoomState, SessionInfo } from '@2play/shared';
import { startTestServer, type TestServer } from '../helpers/server';

let server: TestServer;

function connect(url: string): Socket {
  const socket = io(url, { transports: ['websocket'], forceNew: true });
  return socket;
}

function once<T>(socket: Socket, event: string, timeoutMs = 5000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout waiting for "${event}"`));
    }, timeoutMs);
    const handler = (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    };
    socket.once(event, handler);
  });
}

function emitAck<T>(socket: Socket, event: string, payload: unknown, timeoutMs = 5000): Promise<AckResponse<T>> {
  return new Promise<AckResponse<T>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ack "${event}"`)), timeoutMs);
    socket.emit(event, payload, (response: AckResponse<T>) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

async function authenticate(socket: Socket, nickname: string): Promise<SessionInfo> {
  const response = await emitAck<{ session: SessionInfo }>(socket, 'authenticate', { nickname, avatar: '🦊' });
  if (!response.ok || !response.data) throw new Error(`auth failed: ${JSON.stringify(response.error)}`);
  return response.data.session;
}

beforeAll(async () => {
  server = await startTestServer();
}, 30_000);

afterAll(async () => {
  await server?.stop();
});

describe('room lifecycle over sockets', () => {
  it('creates a room, joins it and synchronises state', async () => {
    const host = connect(server.url);
    const guest = connect(server.url);
    try {
      await once(host, 'connect');
      await once(guest, 'connect');

      await authenticate(host, 'HostPlayer');
      await authenticate(guest, 'GuestPlayer');

      const created = await emitAck<{ room: RoomState; playerId: string }>(host, 'room:create', {
        gameId: 'reaction-race',
        maxPlayers: 2,
        isPrivate: false,
      });
      expect(created.ok).toBe(true);
      const roomId = created.data?.room.id;
      expect(roomId).toMatch(/^[A-Z0-9]{6}$/);

      // Listen BEFORE the join so the broadcast is not missed.
      const hostUpdatePromise = once<{ room: RoomState }>(host, 'room:updated');
      const joined = await emitAck<{ room: RoomState }>(guest, 'room:join', { roomId });
      expect(joined.ok).toBe(true);
      expect(joined.data?.room.players).toHaveLength(2);
      expect(joined.data?.room.gameId).toBe('reaction-race');

      const hostUpdate = await hostUpdatePromise;
      expect(hostUpdate.room.players.map((player) => player.nickname).sort()).toEqual([
        'GuestPlayer',
        'HostPlayer',
      ]);
    } finally {
      host.close();
      guest.close();
    }
  });

  it('rejects invalid room codes with a typed error', async () => {
    const socket = connect(server.url);
    try {
      await once(socket, 'connect');
      await authenticate(socket, 'JoinerOne');
      const response = await emitAck(socket, 'room:join', { roomId: 'nope' });
      expect(response.ok).toBe(false);
      expect(response.error?.code).toBe('E001');
    } finally {
      socket.close();
    }
  });

  it('rejects joining a room that does not exist', async () => {
    const socket = connect(server.url);
    try {
      await once(socket, 'connect');
      await authenticate(socket, 'JoinerTwo');
      const response = await emitAck(socket, 'room:join', { roomId: 'ABC234' });
      expect(response.ok).toBe(false);
      expect(response.error?.code).toBe('E003');
    } finally {
      socket.close();
    }
  });

  it('leave-room is idempotent and immediately frees the player to create/join again (fixes the "already in a room" bug)', async () => {
    const socket = connect(server.url);
    try {
      await once(socket, 'connect');
      await authenticate(socket, 'LeaveTwice');

      const created = await emitAck<{ room: RoomState }>(socket, 'room:create', {
        gameId: 'reaction-race',
        maxPlayers: 2,
        isPrivate: false,
      });
      expect(created.ok).toBe(true);

      // Creating a second room while still in the first must be rejected —
      // this is the exact "Already in a room" state the bug fix targets.
      const blocked = await emitAck(socket, 'room:create', {
        gameId: 'reaction-race',
        maxPlayers: 2,
        isPrivate: false,
      });
      expect(blocked.ok).toBe(false);

      // Intentional leave (what the phone/browser BACK button now triggers).
      const firstLeave = await emitAck<{ left: boolean }>(socket, 'room:leave', {});
      expect(firstLeave.ok).toBe(true);
      expect(firstLeave.data?.left).toBe(true);

      // A duplicate leave request must be safe (idempotent), never an error.
      const secondLeave = await emitAck<{ left: boolean }>(socket, 'room:leave', {});
      expect(secondLeave.ok).toBe(true);

      // Immediately afterwards the player must be free to create another room.
      const recreated = await emitAck<{ room: RoomState }>(socket, 'room:create', {
        gameId: 'memory-match',
        maxPlayers: 2,
        isPrivate: false,
      });
      expect(recreated.ok).toBe(true);
      expect(recreated.data?.room.gameId).toBe('memory-match');
    } finally {
      socket.close();
    }
  });

  it('room:quick-play starts a real AI match directly with no room-code UX and no "choose a game" step', async () => {
    const socket = connect(server.url);
    try {
      await once(socket, 'connect');
      await authenticate(socket, 'QuickPlayer');

      const result = await emitAck<{ room: RoomState; playerId: string }>(socket, 'room:quick-play', {
        gameId: 'reaction-race',
        aiDifficulty: 'medium',
      });

      expect(result.ok).toBe(true);
      expect(result.data?.room.isPrivate).toBe(true);
      expect(result.data?.room.isQuickPlay).toBe(true);
      expect(result.data?.room.players.some((player) => player.isAI)).toBe(true);
      // Real AI match starts right away — no lobby wait, no manual "start".
      expect(['COUNTDOWN', 'PLAYING']).toContain(result.data?.room.status);
    } finally {
      socket.close();
    }
  });

  it('exposes health and the game catalogue over HTTP', async () => {
    const health = (await fetch(`${server.url}/api/health`).then((res) => res.json())) as {
      status: string;
      database: { mode: string };
    };
    expect(health.status).toBe('ok');
    expect(health.database.mode).toBeDefined();

    const detailedResponse = await fetch(`${server.url}/api/health/detailed`);
    expect(detailedResponse.status).toBe(200);
    const detailed = (await detailedResponse.json()) as { status: string; rooms: number; timers: number; memory: { heapUsedBytes: number } };
    expect(detailed.status).toBe('ok');
    expect(detailed.rooms).toBeGreaterThanOrEqual(0);
    expect(detailed.timers).toBeGreaterThanOrEqual(0);
    expect(detailed.memory.heapUsedBytes).toBeGreaterThan(0);

    const games = (await fetch(`${server.url}/api/games`).then((res) => res.json())) as {
      games: Array<{ id: string }>;
    };
    expect(games.games.map((game: { id: string }) => game.id).sort()).toEqual([
      '2048-battle',
      'chess',
      'connect-four',
      'arrow-puzzle',
      'black-blast',
      'bomb-pass-2d',
      'brick-breaker-battle',
      'capture-the-flag-2d',
      'castle-siege-2d',
      'chain-reaction-battle',
      'coin-hunters-arena',
      'color-clash',
      'color-trails',
      'dots-and-boxes',
      'draw-guess-battle',
      'echo-maze',
      'fake-door-battle',
      'hangman',
      'hexa-conquest',
      'invisible-path',
      'ludo',
      'magnet-maze',
      'magnet-thief',
      'math-rush',
      'maze-race-2d',
      'memory-match',
      'mirror-arena',
      'moving-island',
      'one-button-battle',
      'paddle-duel',
      'pattern-memory-battle',
      'platform-dash-2d',
      'reaction-race',
      'reverse-race',
      'secret-role',
      'shadow-copy-battle',
      'shape-match-battle',
      'shop-rush-battle',
      'sos-game',
      'snake-battle',
      'split-world',
      'target-rush',
      'territory-rush',
      'traffic-control-battle',
      'traffic-dodge-race',
      'word-race',
      'word-scramble-battle',
    ]);
  });
});
