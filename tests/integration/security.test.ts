import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import type { RoomState } from '@2play/shared';
import { createClient, emitAck, once, type TestClient } from '../helpers/client';
import { startTestServer, type TestServer } from '../helpers/server';

let server: TestServer;

function raw(): Socket {
  return io(server.url, { transports: ['websocket'], forceNew: true });
}

beforeAll(async () => {
  server = await startTestServer();
}, 30_000);

afterAll(async () => {
  await server?.stop();
});

describe('security & validation', () => {
  it('rejects nicknames that are too short or contain HTML', async () => {
    const socket = raw();
    await once(socket, 'connect');
    try {
      const short = await emitAck(socket, 'authenticate', { nickname: 'ab' });
      expect(short.ok).toBe(false);
      expect(short.error?.code).toBe('E001');

      const html = await emitAck(socket, 'authenticate', { nickname: '<b>bad</b>' });
      expect(html.ok).toBe(false);
      expect(html.error?.code).toBe('E001');

      const good = await emitAck(socket, 'authenticate', { nickname: 'ValidName' });
      expect(good.ok).toBe(true);
    } finally {
      socket.close();
    }
  }, 30_000);

  it('refuses room actions before authentication', async () => {
    const socket = raw();
    await once(socket, 'connect');
    try {
      const response = await emitAck(socket, 'room:create', {
        gameId: 'reaction-race',
        maxPlayers: 2,
        isPrivate: false,
      });
      expect(response.ok).toBe(false);
      expect(response.error?.code).toBe('E002');
    } finally {
      socket.close();
    }
  }, 30_000);

  it('requires a session for persistence endpoints and blocks cross-user access', async () => {
    const first = await createClient(server.url, 'PersistOne');
    const second = await createClient(server.url, 'PersistTwo');
    try {
      const anonymous = await fetch(`${server.url}/api/statistics/${first.session.userId}`);
      expect(anonymous.status).toBe(401);
      const crossUser = await fetch(`${server.url}/api/statistics/${first.session.userId}`, { headers: { 'x-session-token': second.session.sessionToken } });
      expect(crossUser.status).toBe(401);
      const own = await fetch(`${server.url}/api/statistics/${first.session.userId}`, { headers: { 'x-session-token': first.session.sessionToken } });
      expect(own.status).toBe(200);
    } finally {
      first.close();
      second.close();
    }
  }, 30_000);

  it('does not allow session identity switching or unknown-token minting', async () => {
    const host = await createClient(server.url, 'BoundHost');
    const attacker = raw();
    await once(attacker, 'connect');
    try {
      const created = await emitAck<{ room: RoomState }>(host.socket, 'room:create', { gameId: 'reaction-race', maxPlayers: 2, isPrivate: false });
      const auth = await emitAck<{ session: { sessionToken: string } }>(attacker, 'authenticate', { nickname: 'BoundAttacker' });
      expect(auth.ok).toBe(true);
      const switched = await emitAck(attacker, 'reconnect:attempt', { roomId: created.data!.room.id, sessionToken: host.session.sessionToken });
      expect(switched.ok).toBe(false);
      expect(switched.error?.code).toBe('E002');
      const unknown = await emitAck(attacker, 'authenticate', { nickname: 'BoundAttacker', sessionToken: 'a'.repeat(40) });
      expect(unknown.ok).toBe(false);
      expect(unknown.error?.code).toBe('E002');
    } finally {
      host.close();
      attacker.close();
    }
  }, 30_000);

  it('rejects malformed and unknown room codes', async () => {
    const client = await createClient(server.url, 'CodeTester');
    try {
      const malformed = await emitAck(client.socket, 'room:join', { roomId: 'ABC' });
      expect(malformed.error?.code).toBe('E001');

      const unknown = await emitAck(client.socket, 'room:join', { roomId: 'ZZZZZZ' });
      expect(unknown.error?.code).toBe('E003');
    } finally {
      client.close();
    }
  }, 30_000);

  it('rejects a third player joining a full room', async () => {
    const host = await createClient(server.url, 'FullHost');
    const guest = await createClient(server.url, 'FullGuest');
    const extra = await createClient(server.url, 'FullExtra');
    try {
      const created = await emitAck<{ room: RoomState }>(host.socket, 'room:create', {
        gameId: 'reaction-race',
        maxPlayers: 2,
        isPrivate: false,
      });
      const roomId = created.data!.room.id;
      expect((await emitAck(guest.socket, 'room:join', { roomId })).ok).toBe(true);
      const overflow = await emitAck(extra.socket, 'room:join', { roomId });
      expect(overflow.ok).toBe(false);
      expect(overflow.error?.code).toBe('E004');
    } finally {
      host.close();
      guest.close();
      extra.close();
    }
  }, 30_000);

  it('only lets the host start the match', async () => {
    const host = await createClient(server.url, 'StartHost');
    const guest = await createClient(server.url, 'StartGuest');
    try {
      const created = await emitAck<{ room: RoomState }>(host.socket, 'room:create', {
        gameId: 'math-rush',
        maxPlayers: 2,
        isPrivate: false,
      });
      await emitAck(guest.socket, 'room:join', { roomId: created.data!.room.id });
      await emitAck(host.socket, 'lobby:ready', { isReady: true });
      await emitAck(guest.socket, 'lobby:ready', { isReady: true });

      const guestStart = await emitAck(guest.socket, 'game:start', {});
      expect(guestStart.ok).toBe(false);
      expect(guestStart.error?.code).toBe('E002');

      expect((await emitAck(host.socket, 'game:start', {})).ok).toBe(true);
    } finally {
      host.close();
      guest.close();
    }
  }, 30_000);

  it('rejects invalid game actions and rate limits flooding', async () => {
    const host = await createClient(server.url, 'FloodHost');
    const guest = await createClient(server.url, 'FloodGuest');
    try {
      const created = await emitAck<{ room: RoomState }>(host.socket, 'room:create', {
        gameId: 'memory-match',
        maxPlayers: 2,
        isPrivate: false,
        settings: { gridSize: '4x4' },
      });
      await emitAck(guest.socket, 'room:join', { roomId: created.data!.room.id });
      await emitAck(host.socket, 'lobby:ready', { isReady: true });
      await emitAck(guest.socket, 'lobby:ready', { isReady: true });
      await emitAck(host.socket, 'game:start', {});
      await once(host.socket, 'game:started', 20_000);

      // The envelope is valid, but the game rejects the action: the ack is `ok`
      // (the request was processed) while `accepted` is false.
      const unknown = await emitAck<{ accepted: boolean }>(host.socket, 'game:action', {
        action: { type: 'nuke' },
      });
      expect(unknown.ok).toBe(true);
      expect(unknown.data?.accepted).toBe(false);

      // A malformed envelope (unknown field / bad type) is rejected outright.
      const malformed = await emitAck(host.socket, 'game:action', {
        action: { type: 'flip', payload: { cardId: 1 }, extra: true },
      } as never);
      expect(malformed.ok).toBe(false);
      expect(malformed.error?.code).toBe('E001');

      const codes: string[] = [];
      for (let index = 0; index < 30; index += 1) {
        const response = await emitAck(host.socket, 'game:action', {
          action: { type: 'flip', payload: { cardId: 999 } },
        });
        if (!response.ok && response.error?.code) codes.push(response.error.code);
      }
      expect(codes).toContain('E007');
    } finally {
      host.close();
      guest.close();
    }
  }, 60_000);

  it('never leaks hidden information (Memory Match cards, Math Rush answers)', async () => {
    const host = await createClient(server.url, 'HiddenHost');
    const guest = await createClient(server.url, 'HiddenGuest');
    try {
      const memory = await emitAck<{ room: RoomState }>(host.socket, 'room:create', {
        gameId: 'memory-match',
        maxPlayers: 2,
        isPrivate: false,
        settings: { gridSize: '4x4' },
      });
      await emitAck(guest.socket, 'room:join', { roomId: memory.data!.room.id });
      await emitAck(host.socket, 'lobby:ready', { isReady: true });
      await emitAck(guest.socket, 'lobby:ready', { isReady: true });
      await emitAck(host.socket, 'game:start', {});
      await once(host.socket, 'game:started', 20_000);

      const memoryRoom = await host.waitForRoom((room) => room.status === 'PLAYING', 20_000);
      const cards = (memoryRoom.gameState as { cards: Array<{ symbol: string | null }> }).cards;
      expect(cards).toHaveLength(16);
      expect(cards.every((card) => card.symbol === null)).toBe(true);
    } finally {
      host.close();
      guest.close();
    }

    const solo = await createClient(server.url, 'MathSolo');
    try {
      await emitAck<{ room: RoomState }>(solo.socket, 'room:create', {
        gameId: 'math-rush',
        maxPlayers: 2,
        isPrivate: false,
      });
      await emitAck(solo.socket, 'room:add-ai', { difficulty: 'easy' });
      await emitAck(solo.socket, 'lobby:ready', { isReady: true });
      await emitAck(solo.socket, 'game:start', {});
      await once(solo.socket, 'game:started', 20_000);

      const mathRoom = await solo.waitForRoom(
        (room) => Boolean((room.gameState as { question?: unknown } | null)?.question),
        20_000,
      );
      const question = (mathRoom.gameState as { question: { text: string; answer?: number } }).question;
      expect(question.text).toBeTruthy();
      expect(question.answer).toBeUndefined();
    } finally {
      solo.close();
    }
  }, 90_000);
});

export type { TestClient };
