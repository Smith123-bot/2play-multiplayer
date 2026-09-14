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
      const sent = await emitAck(host.socket, 'chat:send', { text: 'hello team' });
      expect(sent.ok).toBe(true);

      const received = await messagePromise;
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

  it('keeps lifecycle events out of the chat transcript (status UI only)', async () => {
    const { host, guest, roomId } = await lobbyPair();
    try {
      // Joins and leaves are room-status information, never chat lines. The
      // transcript holds only real player chat + explicit emotes.
      const room = await host.waitForRoom((current) => current.id === roomId, 10_000);
      const systemMessages = (room.chat ?? []).filter((message) => message.type === 'system');
      expect(systemMessages).toHaveLength(0);

      // A leave still updates the room roster through the normal status path.
      await emitAck(guest.socket, 'room:leave', {});
      const afterLeave = await host.waitForRoom(
        (current) => current.players.length === 1,
        10_000,
      );
      expect(afterLeave.players).toHaveLength(1);
      expect((afterLeave.chat ?? []).some((message) => message.type === 'system')).toBe(false);
    } finally {
      host.close();
      guest.close();
    }
  }, 30_000);
});

  it('omits chat from snapshots while unchanged and re-sends it on change', async () => {
    const { host, guest, roomId } = await lobbyPair();
    try {
      // The join ack (and the join broadcast) carry the full transcript.
      const initial = await guest.waitForRoom((current) => current.id === roomId, 10_000);
      expect(Array.isArray(initial.chat)).toBe(true);

      // Drive a state change that does NOT touch the transcript (both players
      // ready up): the resulting snapshot must flip the status but omit `chat`.
      await emitAck(host.socket, 'lobby:ready', { isReady: true });
      await emitAck(guest.socket, 'lobby:ready', { isReady: true });
      const withoutChat = await guest.waitForRoom(
        (current) => current.status === 'READY' && current.chat === undefined,
        10_000,
      );
      expect(withoutChat.id).toBe(roomId);

      // A new message bumps the transcript version: the next snapshot must
      // carry the full transcript again.
      const messagePromise = once<{ message: ChatMessage }>(guest.socket, 'chat:message', 10_000);
      await emitAck(host.socket, 'chat:send', { text: 'incremental delivery check' });
      await messagePromise;
      const withChat = await guest.waitForRoom(
        (current) => (current.chat ?? []).some((entry) => entry.text === 'incremental delivery check'),
        10_000,
      );
      expect(withChat.chat?.length).toBeGreaterThan(0);
    } finally {
      host.close();
      guest.close();
    }
  }, 30_000);
