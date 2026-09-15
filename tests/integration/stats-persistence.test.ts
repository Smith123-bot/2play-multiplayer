import type { Socket } from 'socket.io-client';
import { io } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RoomState, SessionInfo } from '@2play/shared';
import { startTestServer, type TestServer } from '../helpers/server';
import { emitAck, once } from '../helpers/client';

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
}, 30_000);

afterAll(async () => {
  await server.stop();
});

async function connect(): Promise<Socket> {
  const socket = io(server.url, { transports: ['websocket'], forceNew: true });
  await once(socket, 'connect');
  return socket;
}

async function authenticate(
  socket: Socket,
  nickname: string,
  sessionToken?: string,
): Promise<SessionInfo> {
  const response = await emitAck<{ session: SessionInfo }>(socket, 'authenticate', {
    nickname,
    avatar: '🦊',
    ...(sessionToken ? { sessionToken } : {}),
  });
  if (!response.ok || !response.data) throw new Error(`auth failed: ${JSON.stringify(response.error)}`);
  return response.data.session;
}

async function api(path: string, token?: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${server.url}${path}`, {
    headers: token ? { 'x-session-token': token } : {},
  });
  const body = (await response.json().catch(() => null)) as unknown;
  return { status: response.status, body };
}

/** Drives a room to a finished match through the real lifecycle + eventBus. */
async function finishOneMatch(roomId: string): Promise<void> {
  const room = server.platform.roomStore.get(roomId);
  if (!room) throw new Error('room missing');
  server.platform.gameManager.createState(room);
  room.status = 'PLAYING';
  room.gameStartedAt = Date.now() - 60_000;
  server.platform.lifecycleManager.finishMatch(room, 'completed');
}

async function waitForStats(userId: string, token: string, totalPlayed: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const stats = (await api(`/api/statistics/${userId}`, token)).body as {
      summary: { totalPlayed: number };
    };
    if (stats.summary.totalPlayed === totalPlayed) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for totalPlayed=${totalPlayed}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('stats persistence across browser sessions', () => {
  it('records a finished match and serves it over the stats API', async () => {
    const socket = await connect();
    try {
      const session = await authenticate(socket, 'StatsApi');
      const created = await emitAck<{ room: RoomState }>(socket, 'room:create', {
        gameId: 'chess',
        maxPlayers: 2,
        isPrivate: false,
      });
      expect(created.ok).toBe(true);
      await finishOneMatch(created.data!.room.id);

      await waitForStats(session.userId, session.sessionToken, 1);
      const history = (await api(`/api/history/${session.userId}?limit=10`, session.sessionToken))
        .body as { history: Array<{ gameId: string; result: string }> };
      expect(history.history).toHaveLength(1);
      expect(history.history[0]!.gameId).toBe('chess');
    } finally {
      socket.close();
    }
  }, 60_000);

  it('survives a browser restart: same identity, same statistics, no duplicates', async () => {
    const firstSocket = await connect();
    const session = await authenticate(firstSocket, 'RestartMe');
    const created = await emitAck<{ room: RoomState }>(firstSocket, 'room:create', {
      gameId: 'ludo',
      maxPlayers: 2,
      isPrivate: false,
    });
    expect(created.ok).toBe(true);
    await finishOneMatch(created.data!.room.id);
    await waitForStats(session.userId, session.sessionToken, 1);

    // Browser closes; later the server prunes the idle in-memory session.
    firstSocket.close();
    server.platform.connectionManager.dropSession(session.sessionToken);

    // Fresh browser session: only the persisted token (localStorage) is known.
    const secondSocket = await connect();
    try {
      const restored = await authenticate(secondSocket, 'RestartMe', session.sessionToken);
      expect(restored.userId).toBe(session.userId);

      // Previously recorded statistics are still served for the same user.
      const stats = (await api(`/api/statistics/${restored.userId}`, restored.sessionToken)).body as {
        summary: { totalPlayed: number };
        statistics: Array<{ gameId: string; totalPlayed: number }>;
      };
      expect(stats.summary.totalPlayed).toBe(1);
      expect(stats.statistics).toHaveLength(1);
      expect(stats.statistics[0]!.gameId).toBe('ludo');

      // A plain reconnect changes nothing.
      const thirdSocket = await connect();
      try {
        const again = await authenticate(thirdSocket, 'RestartMe', session.sessionToken);
        expect(again.userId).toBe(session.userId);
        const after = (await api(`/api/statistics/${session.userId}`, session.sessionToken)).body as {
          summary: { totalPlayed: number };
        };
        expect(after.summary.totalPlayed).toBe(1);
      } finally {
        thirdSocket.close();
      }
    } finally {
      secondSocket.close();
    }
  }, 60_000);

  it('counts a rematch separately and never double-counts a duplicate finish', async () => {
    const socket = await connect();
    try {
      const session = await authenticate(socket, 'RematchMe');
      const created = await emitAck<{ room: RoomState }>(socket, 'room:create', {
        gameId: 'uno',
        maxPlayers: 2,
        isPrivate: false,
      });
      expect(created.ok).toBe(true);
      const roomId = created.data!.room.id;

      await finishOneMatch(roomId);
      await waitForStats(session.userId, session.sessionToken, 1);

      // Rematch: new match number, play + finish again.
      const room = server.platform.roomStore.get(roomId)!;
      room.matchNumber += 1;
      await finishOneMatch(roomId);
      await waitForStats(session.userId, session.sessionToken, 2);

      // Duplicate finish of the SAME match is ignored.
      await finishOneMatch(roomId);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const stats = (await api(`/api/statistics/${session.userId}`, session.sessionToken)).body as {
        summary: { totalPlayed: number };
      };
      expect(stats.summary.totalPlayed).toBe(2);
      const history = (await api(`/api/history/${session.userId}?limit=10`, session.sessionToken))
        .body as { history: unknown[] };
      expect(history.history).toHaveLength(2);
    } finally {
      socket.close();
    }
  }, 60_000);

  it('refuses statistics access without ownership (IDOR)', async () => {
    const victimSocket = await connect();
    const attackerSocket = await connect();
    try {
      const victim = await authenticate(victimSocket, 'StatsVictim');
      const attacker = await authenticate(attackerSocket, 'StatsAttacker');

      const noToken = await api(`/api/statistics/${victim.userId}`);
      expect(noToken.status).toBe(401);

      const wrongUser = await api(`/api/statistics/${victim.userId}`, attacker.sessionToken);
      expect(wrongUser.status).toBe(401);

      const history = await api(`/api/history/${victim.userId}`, attacker.sessionToken);
      expect(history.status).toBe(401);

      const own = await api(`/api/statistics/${attacker.userId}`, attacker.sessionToken);
      expect(own.status).toBe(200);
    } finally {
      victimSocket.close();
      attackerSocket.close();
    }
  }, 60_000);
});
