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

  it('exposes health and the game catalogue over HTTP', async () => {
    const health = (await fetch(`${server.url}/api/health`).then((res) => res.json())) as {
      status: string;
      database: { mode: string };
    };
    expect(health.status).toBe('ok');
    expect(health.database.mode).toBeDefined();

    const games = (await fetch(`${server.url}/api/games`).then((res) => res.json())) as {
      games: Array<{ id: string }>;
    };
    expect(games.games.map((game: { id: string }) => game.id).sort()).toEqual([
      'dots-and-boxes',
      'math-rush',
      'memory-match',
      'reaction-race',
      'word-race',
    ]);
  });
});
