import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import type { AuthSuccessPayload, PlayerDisconnectedPayload, PlayerReconnectedPayload, RoomState } from '@2play/shared';
import { createClient, emitAck, once, type TestClient } from '../helpers/client';
import { startTestServer, type TestServer } from '../helpers/server';

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
}, 30_000);

afterAll(async () => {
  await server?.stop();
});

describe('reconnection', () => {
  it('keeps the seat, then restores the player after a network drop', async () => {
    const host = await createClient(server.url, 'StayHost');
    const guest = await createClient(server.url, 'DropGuest');

    try {
      const created = await emitAck<{ room: RoomState }>(host.socket, 'room:create', {
        gameId: 'math-rush',
        maxPlayers: 2,
        isPrivate: false,
      });
      const roomId = created.data!.room.id;
      await emitAck(guest.socket, 'room:join', { roomId });

      for (const client of [host, guest]) {
        await emitAck(client.socket, 'lobby:ready', { isReady: true });
      }
      await emitAck(host.socket, 'game:start', {});
      await once(host.socket, 'game:started', 20_000);

      // Drop the guest connection.
      const disconnectPromise = once<PlayerDisconnectedPayload>(host.socket, 'player:disconnected', 10_000);
      guest.socket.close();
      const disconnected = await disconnectPromise;
      expect(disconnected.playerId).toBe(guest.playerId);
      expect(disconnected.reconnectDeadline).toBeGreaterThan(Date.now());

      // The room survives and the host still sees the (disconnected) player.
      const roomAfterDrop = await host.waitForRoom(
        (room) => room.players.some((player) => player.isDisconnected),
        10_000,
      );
      expect(roomAfterDrop.players).toHaveLength(2);
      expect(roomAfterDrop.status).toBe('PLAYING');

      // Rejoin with the same session token.
      const reconnectedPromise = once<PlayerReconnectedPayload>(host.socket, 'player:reconnected', 15_000);
      const guestSocket: Socket = io(server.url, { transports: ['websocket'], forceNew: true });
      await once(guestSocket, 'connect');
      const auth = await emitAck<AuthSuccessPayload>(guestSocket, 'authenticate', {
        nickname: 'DropGuest',
        avatar: '🦊',
        sessionToken: guest.session.sessionToken,
      });
      expect(auth.ok).toBe(true);

      const reconnected = await reconnectedPromise;
      expect(reconnected.playerId).toBe(guest.playerId);

      const restored = await host.waitForRoom(
        (room) => room.players.every((player) => player.isConnected),
        10_000,
      );
      expect(restored.players).toHaveLength(2);
      guestSocket.close();
    } finally {
      host.close();
      guest.close();
    }
  }, 90_000);

  it('supports an explicit reconnect:attempt with room id and token', async () => {
    const host = await createClient(server.url, 'ExplicitHost');
    const guest = await createClient(server.url, 'ExplicitGuest');

    try {
      const created = await emitAck<{ room: RoomState }>(host.socket, 'room:create', {
        gameId: 'dots-and-boxes',
        maxPlayers: 2,
        isPrivate: false,
        settings: { gridSize: '4x4' },
      });
      const roomId = created.data!.room.id;
      await emitAck(guest.socket, 'room:join', { roomId });

      guest.socket.close();
      await host.waitForRoom((room) => room.players.some((player) => player.isDisconnected), 10_000);

      const socket: Socket = io(server.url, { transports: ['websocket'], forceNew: true });
      await once(socket, 'connect');
      const response = await emitAck<{ room: RoomState; playerId: string }>(socket, 'reconnect:attempt', {
        roomId,
        sessionToken: guest.session.sessionToken,
      });

      expect(response.ok).toBe(true);
      expect(response.data?.playerId).toBe(guest.playerId);
      expect(response.data?.room.id).toBe(roomId);
      socket.close();
    } finally {
      host.close();
      guest.close();
    }
  }, 60_000);

  it('rejects an unknown session token', async () => {
    const host = await createClient(server.url, 'TokenHost');
    try {
      const created = await emitAck<{ room: RoomState }>(host.socket, 'room:create', {
        gameId: 'word-race',
        maxPlayers: 2,
        isPrivate: false,
      });
      const socket: Socket = io(server.url, { transports: ['websocket'], forceNew: true });
      await once(socket, 'connect');
      const response = await emitAck(socket, 'reconnect:attempt', {
        roomId: created.data!.room.id,
        sessionToken: 'a'.repeat(40),
      });
      expect(response.ok).toBe(false);
      expect(response.error?.code).toBe('E002');
      socket.close();
    } finally {
      host.close();
    }
  }, 30_000);
});

export type { TestClient };
