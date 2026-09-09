import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChatMessage, RoomState } from '@2play/shared';
import { createClient, emitAck, once, type TestClient } from '../helpers/client';
import { startTestServer, type TestServer } from '../helpers/server';

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
}, 30_000);

afterAll(async () => {
  await server?.stop();
});

async function lobbyPair(): Promise<{ host: TestClient; guest: TestClient; roomId: string }> {
  const host = await createClient(server.url, 'ChatHost');
  const guest = await createClient(server.url, 'ChatGuest');
  const created = await emitAck<{ room: RoomState }>(host.socket, 'room:create', {
    gameId: 'memory-match',
    maxPlayers: 2,
    isPrivate: false,
  });
  const roomId = created.data!.room.id;
  await emitAck(guest.socket, 'room:join', { roomId });
  return { host, guest, roomId };
}

describe('chat', () => {
  it('delivers messages and emotes to the whole room', async () => {
    const { host, guest } = await lobbyPair();
    try {
      const messagePromise = once<{ message: ChatMessage }>(guest.socket, 'chat:message', 10_000);
      const sentAt = performance.now();
      const sent = await emitAck(host.socket, 'chat:send', { text: 'hello team' });
      expect(sent.ok).toBe(true);

      const received = await messagePromise;
      const chatRoundTripMs = performance.now() - sentAt;
      expect(chatRoundTripMs).toBeLessThan(1000);
      console.info(`[audit] chat ack-to-peer delivery: ${chatRoundTripMs.toFixed(1)}ms`);
      expect(received.message.text).toBe('hello team');
      expect(received.message.nickname).toBe('ChatHost');

      // The server enforces a 200ms typing cooldown between chat events.
      await new Promise((resolve) => setTimeout(resolve, 260));
      const emotePromise = once<{ message: ChatMessage }>(guest.socket, 'chat:emote', 10_000);
      const emote = await emitAck(host.socket, 'chat:emote', { emote: '🔥' });
      expect(emote.ok).toBe(true);
      expect((await emotePromise).message.emote).toBe('🔥');
    } finally {
      host.close();
      guest.close();
    }
  }, 30_000);

  it('rejects empty messages and unknown emotes', async () => {
    const { host } = await lobbyPair();
    try {
      const empty = await emitAck(host.socket, 'chat:send', { text: '   ' });
      expect(empty.ok).toBe(false);
      expect(empty.error?.code).toBe('E001');

      const badEmote = await emitAck(host.socket, 'chat:emote', { emote: '💀' });
      expect(badEmote.ok).toBe(false);
      expect(badEmote.error?.code).toBe('E001');
    } finally {
      host.close();
    }
  }, 30_000);

  it('rate limits rapid-fire messages (5/second)', async () => {
    const { host } = await lobbyPair();
    try {
      const results = [];
      for (let index = 0; index < 10; index += 1) {
        results.push(await emitAck(host.socket, 'chat:send', { text: `spam ${index}` }));
      }
      const rejected = results.filter((result) => !result.ok);
      expect(rejected.length).toBeGreaterThan(0);
      expect(rejected[0]?.error?.code).toBe('E007');
    } finally {
      host.close();
    }
  }, 30_000);

  it('publishes system messages on join and leave', async () => {
    const { host, guest, roomId } = await lobbyPair();
    try {
      const room = await host.waitForRoom((current) => current.id === roomId, 10_000);
      const systemEvents = room.chat.filter((message) => message.type === 'system');
      expect(systemEvents.length).toBeGreaterThan(0);

      await emitAck(guest.socket, 'room:leave', {});
      const afterLeave = await host.waitForRoom(
        (current) => current.chat.some((message) => message.systemEvent === 'player_left'),
        10_000,
      );
      expect(afterLeave.players).toHaveLength(1);
    } finally {
      host.close();
      guest.close();
    }
  }, 30_000);
});
