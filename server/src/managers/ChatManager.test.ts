import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatSendSchema } from '@2play/shared';
import { createPlayer, createTestPlatform, type TestPlatform } from '../test/harness';
import type { Platform } from '../core/Platform';
import { AppError } from '../utils/errors';
import type { Room } from '../rooms/Room';

async function roomWithTwoPlayers(platform: Platform): Promise<Room> {
  const host = await createPlayer(platform, 'ChatHost');
  const guest = await createPlayer(platform, 'ChatGuest');
  const room = platform.roomManager.createRoom({
    gameId: 'reaction-race',
    maxPlayers: 2,
    isPrivate: false,
    host,
  });
  platform.roomManager.joinRoom({ roomId: room.id, player: guest });
  return room;
}

describe('ChatManager', () => {
  let harness: TestPlatform;
  let platform: Platform;

  beforeEach(() => {
    harness = createTestPlatform();
    platform = harness.platform;
  });

  afterEach(() => harness.destroy());

  it('appends messages to the room and emits them', async () => {
    const room = await roomWithTwoPlayers(platform);
    const player = room.humanPlayers[0]!;
    harness.clearEmissions();

    const message = platform.chatManager.sendMessage(room, player, 'hello friends');
    expect(message.type).toBe('message');
    expect(room.chat.at(-1)?.text).toBe('hello friends');
    expect(harness.emissions.some((entry) => entry.event.endsWith(':chat:message'))).toBe(true);
  });

  it('enforces the 200ms typing cooldown', async () => {
    vi.useFakeTimers();
    try {
      const room = await roomWithTwoPlayers(platform);
      const player = room.humanPlayers[0]!;

      platform.chatManager.sendMessage(room, player, 'first');
      expect(() => platform.chatManager.sendMessage(room, player, 'too soon')).toThrow(/too fast/);

      vi.advanceTimersByTime(250);
      platform.chatManager.sendMessage(room, player, 'second');
      expect(room.chat.filter((message) => message.type === 'message')).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shares the 5 messages/second rate limit bucket', async () => {
    const room = await roomWithTwoPlayers(platform);
    const player = room.humanPlayers[0]!;

    // Exhaust the sliding window budget for this player.
    for (let index = 0; index < 5; index += 1) {
      platform.rateLimiter.consume(`chat:${room.id}:${player.id}`, 5, 1000);
    }

    expect(() => platform.chatManager.sendMessage(room, player, 'blocked')).toThrow(AppError);
    expect(room.chat.filter((message) => message.type === 'message')).toHaveLength(0);
  });

  it('rejects empty and HTML messages before they reach the room', async () => {
    const room = await roomWithTwoPlayers(platform);
    const player = room.humanPlayers[0]!;

    expect(chatSendSchema.safeParse({ text: '   ' }).success).toBe(false);
    const parsed = chatSendSchema.parse({ text: '<script>alert(1)</script> hi' });
    expect(parsed.text).not.toContain('<');
    expect(parsed.text).not.toContain('>');

    platform.chatManager.sendMessage(room, player, parsed.text);
    expect(room.chat.at(-1)?.text).toBe('alert(1) hi');
  });

  it('mutes a player after 10 identical messages', async () => {
    vi.useFakeTimers();
    try {
      const room = await roomWithTwoPlayers(platform);
      const player = room.humanPlayers[0]!;

      for (let index = 0; index < 9; index += 1) {
        platform.chatManager.sendMessage(room, player, 'same message');
        vi.advanceTimersByTime(1100);
      }

      expect(platform.chatManager.isMuted(player.id)).toBe(false);

      // The 10th repeat is rejected *and* triggers the 60s mute.
      expect(() => platform.chatManager.sendMessage(room, player, 'same message')).toThrow(/muted/);
      expect(platform.chatManager.isMuted(player.id)).toBe(true);

      vi.advanceTimersByTime(1100);
      expect(() => platform.chatManager.sendMessage(room, player, 'anything')).toThrow(/muted/);

      vi.advanceTimersByTime(61_000);
      expect(platform.chatManager.isMuted(player.id)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('publishes system messages for room events', async () => {
    const room = await roomWithTwoPlayers(platform);
    const systemEvents = room.chat
      .filter((message) => message.type === 'system')
      .map((message) => message.systemEvent);

    expect(systemEvents).toContain('player_joined');

    const guest = room.humanPlayers[1]!;
    platform.roomManager.leaveRoom(room, guest.id, 'leave');
    expect(room.chat.some((message) => message.systemEvent === 'player_left')).toBe(true);
  });

  it('sends only allow-listed emotes', async () => {
    const room = await roomWithTwoPlayers(platform);
    const player = room.humanPlayers[0]!;
    const message = platform.chatManager.sendEmote(room, player, '🔥');
    expect(message.type).toBe('emote');
    expect(message.emote).toBe('🔥');
    expect(room.chat.at(-1)?.emote).toBe('🔥');
  });
});
