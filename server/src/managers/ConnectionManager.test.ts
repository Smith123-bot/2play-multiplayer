import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestPlatform, type TestPlatform } from '../test/harness';
import type { Platform } from '../core/Platform';

describe('ConnectionManager persistent identity', () => {
  let harness: TestPlatform;
  let platform: Platform;

  beforeEach(() => {
    harness = createTestPlatform();
    platform = harness.platform;
  });

  afterEach(() => harness.destroy());

  const auth = (nickname: string, extra: { sessionToken?: string; socketId: string }) =>
    platform.connectionManager.authenticate({
      nickname,
      avatar: '🦊',
      socketId: extra.socketId,
      clientKey: `test-${nickname}-${extra.socketId}`,
      ...(extra.sessionToken ? { sessionToken: extra.sessionToken } : {}),
    });

  it('gives a new player a persistent identity backed by the database', async () => {
    const first = await auth('PersistA', { socketId: 'socket-a1' });
    expect(first.restored).toBe(false);
    expect(first.session.userId).toBeTruthy();
    expect(first.session.sessionToken).toBeTruthy();

    // The user row exists and is keyed by the token the client stores.
    const stored = await platform.database.findUserBySession(first.session.sessionToken);
    expect(stored?.id).toBe(first.session.userId);
  });

  it('restores the same user from memory on a normal reconnect', async () => {
    const first = await auth('PersistB', { socketId: 'socket-b1' });
    const second = await auth('PersistB', {
      sessionToken: first.session.sessionToken,
      socketId: 'socket-b2',
    });
    expect(second.restored).toBe(true);
    expect(second.session.userId).toBe(first.session.userId);
    expect(second.session.sessionToken).toBe(first.session.sessionToken);
  });

  it('restores the same database user after the in-memory session is pruned', async () => {
    const first = await auth('PersistC', { socketId: 'socket-c1' });
    const token = first.session.sessionToken;

    // Simulate the 30-minute idle prune / a server restart: the session map
    // is wiped while the database row survives.
    platform.connectionManager.dropSession(token);
    expect(platform.connectionManager.getSessionByToken(token)).toBeUndefined();

    const restored = await auth('PersistC', { sessionToken: token, socketId: 'socket-c2' });
    expect(restored.restored).toBe(true);
    expect(restored.session.userId).toBe(first.session.userId);
    expect(restored.session.sessionToken).toBe(token);

    // No duplicate user: the token still maps to the one original row.
    const stored = await platform.database.findUserBySession(token);
    expect(stored?.id).toBe(first.session.userId);
  });

  it('mints a new user only for genuinely unknown tokens', async () => {
    const first = await auth('PersistD', {
      sessionToken: 'definitely-not-a-real-token',
      socketId: 'socket-d1',
    });
    expect(first.restored).toBe(false);

    // A second presentation of the minted token restores (in memory now).
    const second = await auth('PersistD', {
      sessionToken: first.session.sessionToken,
      socketId: 'socket-d2',
    });
    expect(second.restored).toBe(true);
    expect(second.session.userId).toBe(first.session.userId);
  });

  it('updates nickname/avatar on database restore without changing identity', async () => {
    const first = await auth('OldNick', { socketId: 'socket-e1' });
    platform.connectionManager.dropSession(first.session.sessionToken);

    const restored = await auth('NewNick', {
      sessionToken: first.session.sessionToken,
      socketId: 'socket-e2',
    });
    expect(restored.session.userId).toBe(first.session.userId);
    expect(restored.session.nickname).toBe('NewNick');

    const stored = await platform.database.findUserById(first.session.userId);
    expect(stored?.nickname).toBe('NewNick');
  });
});
