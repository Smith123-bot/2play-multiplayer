import type { Socket } from 'socket.io-client';
import { io } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AckResponse, SessionInfo } from '@2play/shared';
import { startTestServer, type TestServer } from '../helpers/server';
import { once } from '../helpers/client';

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
  const response = await new Promise<AckResponse<{ session: SessionInfo }>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('authenticate timed out')), 8000);
    socket.emit(
      'authenticate',
      { nickname, avatar: '🦊', ...(sessionToken ? { sessionToken } : {}) },
      (ack: AckResponse<{ session: SessionInfo }>) => {
        clearTimeout(timer);
        resolve(ack);
      },
    );
  });
  if (!response.ok || !response.data)
    throw new Error(`auth failed: ${JSON.stringify(response.error)}`);
  return response.data.session;
}

async function request(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${server.url}${path}`, init);
  return { status: response.status, body: await response.json().catch(() => null) };
}

function tokenHeaders(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', 'x-session-token': token };
}

describe('database-backed favorites', () => {
  it('persists across session restoration, deduplicates adds, and tolerates missing deletes', async () => {
    const firstSocket = await connect();
    const session = await authenticate(firstSocket, 'FavoriteOwner');
    try {
      const add = await request('/api/favorites', {
        method: 'POST',
        headers: tokenHeaders(session.sessionToken),
        body: JSON.stringify({ gameId: 'chess' }),
      });
      expect(add.status).toBe(201);

      const duplicate = await request('/api/favorites', {
        method: 'POST',
        headers: tokenHeaders(session.sessionToken),
        body: JSON.stringify({ gameId: 'chess' }),
      });
      expect(duplicate.status).toBe(201);

      const beforeRestore = await request(`/api/favorites/${session.userId}`, {
        headers: { 'x-session-token': session.sessionToken },
      });
      expect(beforeRestore.status).toBe(200);
      expect(
        (beforeRestore.body as { favorites: Array<{ gameId: string }> }).favorites,
      ).toHaveLength(1);

      firstSocket.close();
      server.platform.connectionManager.dropSession(session.sessionToken);

      const restoredSocket = await connect();
      try {
        const restored = await authenticate(restoredSocket, 'FavoriteOwner', session.sessionToken);
        expect(restored.userId).toBe(session.userId);
        const afterRestore = await request(`/api/favorites/${restored.userId}`, {
          headers: { 'x-session-token': restored.sessionToken },
        });
        expect(
          (afterRestore.body as { favorites: Array<{ gameId: string }> }).favorites.map(
            (item) => item.gameId,
          ),
        ).toEqual(['chess']);

        expect(
          (
            await request('/api/favorites/chess', {
              method: 'DELETE',
              headers: { 'x-session-token': restored.sessionToken },
            })
          ).status,
        ).toBe(204);
        // DELETE is idempotent from the API consumer's perspective.
        expect(
          (
            await request('/api/favorites/chess', {
              method: 'DELETE',
              headers: { 'x-session-token': restored.sessionToken },
            })
          ).status,
        ).toBe(204);
      } finally {
        restoredSocket.close();
      }
    } finally {
      firstSocket.close();
    }
  }, 60_000);

  it('enforces ownership, authentication, payload validation, and live game validation', async () => {
    const ownerSocket = await connect();
    const attackerSocket = await connect();
    try {
      const owner = await authenticate(ownerSocket, 'FavoriteVictim');
      const attacker = await authenticate(attackerSocket, 'FavoriteAttacker');

      expect((await request(`/api/favorites/${owner.userId}`)).status).toBe(401);
      expect(
        (
          await request(`/api/favorites/${owner.userId}`, {
            headers: { 'x-session-token': attacker.sessionToken },
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await request('/api/favorites', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameId: 'chess' }),
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await request('/api/favorites', {
            method: 'POST',
            headers: tokenHeaders(owner.sessionToken),
            body: JSON.stringify({ gameId: 'not-a-real-game' }),
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await request('/api/favorites', {
            method: 'POST',
            headers: tokenHeaders(owner.sessionToken),
            body: JSON.stringify({ gameId: 'chess', extra: true }),
          })
        ).status,
      ).toBe(400);
    } finally {
      ownerSocket.close();
      attackerSocket.close();
    }
  }, 60_000);
});
