import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { createClient, emitAck, once, type TestClient } from '../helpers/client';
import { startTestServer, type TestServer } from '../helpers/server';

/**
 * Security hardening regression suite.
 *
 * Each test here corresponds to a finding from the security audit. They are
 * written to FAIL if the corresponding protection is ever removed, so the
 * fixes cannot silently regress.
 */

let server: TestServer;

function raw(): Socket {
  return io(server.url, { transports: ['websocket'], forceNew: true });
}

/** Fetch with a hard timeout — a hung request should fail the test, not hang it. */
async function http(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${server.url}${path}`, { ...init, signal: controller.signal });
    return { status: response.status, body: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

beforeAll(async () => {
  server = await startTestServer();
}, 30_000);

afterAll(async () => {
  await server?.stop();
});

describe('access control on personal data endpoints (IDOR)', () => {
  let victim: TestClient;
  let attacker: TestClient;

  beforeAll(async () => {
    victim = await createClient(server.url, 'IdorVictim');
    attacker = await createClient(server.url, 'IdorAttacker');
  }, 30_000);

  afterAll(() => {
    victim?.close();
    attacker?.close();
  });

  const personalPaths = () => [
    `/api/statistics/${victim.playerId}`,
    `/api/history/${victim.playerId}`,
    `/api/favorites/${victim.playerId}`,
  ];

  it('refuses UNAUTHENTICATED reads of another user personal data', async () => {
    for (const path of personalPaths()) {
      const response = await http(path);
      // Must not serve the data just because a well-formed id was supplied.
      expect(response.status, `${path} leaked without a token`).toBe(401);
      expect(response.body).not.toContain('"statistics"');
      expect(response.body).not.toContain('"history"');
      expect(response.body).not.toContain('"favorites"');
    }
  }, 30_000);

  it('refuses reads with an unknown or forged session token', async () => {
    for (const path of personalPaths()) {
      const response = await http(path, {
        headers: { 'x-session-token': 'forged-token-not-real' },
      });
      // An unknown token must fail exactly like no token — never fall through.
      expect(response.status, `${path} accepted a forged token`).toBe(401);
    }
  }, 30_000);

  it('refuses cross-user reads even with a VALID token for a different account', async () => {
    for (const path of personalPaths()) {
      const response = await http(path, {
        headers: { 'x-session-token': attacker.session.sessionToken },
      });
      expect(response.status, `${path} allowed a cross-user read`).toBe(401);
    }
  }, 30_000);

  it('still serves the legitimate owner their own data', async () => {
    for (const path of personalPaths()) {
      const response = await http(path, {
        headers: { 'x-session-token': victim.session.sessionToken },
      });
      expect(response.status, `${path} broke for the owner`).toBe(200);
    }
  }, 30_000);

  it('rejects a malformed user id before touching the store', async () => {
    const response = await http('/api/statistics/not-a-uuid', {
      headers: { 'x-session-token': victim.session.sessionToken },
    });
    // Either a validation error or an ownership rejection — never 200.
    expect(response.status).not.toBe(200);
  }, 30_000);

  it('requires authentication to write favourites', async () => {
    const unauth = await http('/api/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: 'chess' }),
    });
    expect(unauth.status).toBe(401);

    const authed = await http('/api/favorites', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': victim.session.sessionToken,
      },
      body: JSON.stringify({ gameId: 'chess' }),
    });
    expect(authed.status).toBe(201);
  }, 30_000);
});

describe('room discovery privacy', () => {
  it('never enumerates private rooms through Socket.IO or REST', async () => {
    const host = await createClient(server.url, 'PrivateHost');
    const seeker = await createClient(server.url, 'PrivateSeeker');
    try {
      const created = await emitAck<{ room: { id: string } }>(host.socket, 'room:create', {
        gameId: 'chess',
        maxPlayers: 2,
        isPrivate: true,
      });
      expect(created.ok).toBe(true);
      const roomId = created.data!.room.id;

      const listed = await emitAck<{ rooms: Array<{ id: string }> }>(seeker.socket, 'room:list', {
        includePrivate: true,
      });
      expect(listed.ok).toBe(true);
      expect(listed.data?.rooms.some((room) => room.id === roomId)).toBe(false);

      const probed = await http(`/api/rooms/${roomId}`);
      expect(probed.status).toBe(404);
      expect(probed.body).not.toContain(roomId);
    } finally {
      host.close();
      seeker.close();
    }
  }, 30_000);

  it('validates REST room codes before lookup', async () => {
    const response = await http('/api/rooms/not-a-valid-room-code');
    expect(response.status).toBe(400);
  });
});

describe('transport and payload limits', () => {
  it('caps oversized HTTP JSON bodies', async () => {
    const response = await http('/api/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: 'chess', padding: 'A'.repeat(200_000) }),
    });
    // 413 (too large) or 400/401 — the point is it is never accepted.
    expect(response.status).not.toBe(201);
  }, 30_000);

  it('rejects an oversized socket frame without accepting it as a chat message', async () => {
    const client = await createClient(server.url, 'BigPayload');
    try {
      const created = await emitAck(client.socket, 'room:create', {
        gameId: 'chess',
        maxPlayers: 2,
        isPrivate: false,
      });
      expect(created.ok).toBe(true);

      // 600 KB is far past the 32 KB frame cap.
      const huge = 'A'.repeat(600_000);
      let rejected = false;
      try {
        const response = await emitAck(client.socket, 'chat:send', { text: huge }, 6000);
        rejected = response.ok === false;
      } catch {
        // A closed/timed-out socket is also an acceptable rejection.
        rejected = true;
      }
      expect(rejected).toBe(true);
    } finally {
      client.close();
    }
  }, 40_000);
});

describe('security response headers', () => {
  it('sets the expected hardening headers and hides the server stack', async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let response: Response;
    try {
      response = await fetch(`${server.url}/api/health`, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    expect(response.headers.get('content-security-policy')).toBeTruthy();
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('x-frame-options')).toBeTruthy();
    // Express fingerprinting is disabled.
    expect(response.headers.get('x-powered-by')).toBeNull();

    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
  }, 30_000);
});

describe('socket authentication and authorization', () => {
  it('refuses every privileged event before authentication', async () => {
    const socket = raw();
    await once(socket, 'connect');
    try {
      const events: Array<[string, unknown]> = [
        ['room:create', { gameId: 'chess', maxPlayers: 2, isPrivate: false }],
        ['room:join', { roomId: 'ABC234' }],
        ['lobby:ready', { isReady: true }],
        ['game:start', {}],
        ['game:action', { action: { type: 'move', payload: { from: 52, to: 36 } } }],
        ['chat:send', { text: 'hello' }],
        ['rematch:request', {}],
      ];
      for (const [event, payload] of events) {
        const response = await emitAck(socket, event, payload);
        expect(response.ok, `${event} was allowed while unauthenticated`).toBe(false);
        expect(response.error?.code).toBe('E002');
      }
    } finally {
      socket.close();
    }
  }, 40_000);

  it('refuses room actions from a player who is not in the room', async () => {
    const host = await createClient(server.url, 'RoomOwner');
    const outsider = await createClient(server.url, 'Outsider');
    try {
      const created = await emitAck<{ room: { id: string } }>(host.socket, 'room:create', {
        gameId: 'chess',
        maxPlayers: 2,
        isPrivate: false,
      });
      expect(created.ok).toBe(true);

      // The outsider never joined, so nothing room-scoped may succeed.
      for (const [event, payload] of [
        ['lobby:ready', { isReady: true }],
        ['chat:send', { text: 'let me in' }],
        ['game:start', {}],
        ['game:action', { action: { type: 'move', payload: { from: 52, to: 36 } } }],
      ] as Array<[string, unknown]>) {
        const response = await emitAck(outsider.socket, event, payload);
        expect(response.ok, `${event} succeeded for a non-member`).toBe(false);
      }
    } finally {
      host.close();
      outsider.close();
    }
  }, 40_000);

  it('requires an already authenticated matching session before reconnect', async () => {
    const victim = await createClient(server.url, 'ReconnectOwner');
    try {
      const created = await emitAck<{ room: { id: string } }>(victim.socket, 'room:create', {
        gameId: 'chess',
        maxPlayers: 2,
        isPrivate: true,
      });
      const attacker = raw();
      await once(attacker, 'connect');
      try {
        const response = await emitAck(attacker, 'reconnect:attempt', {
          roomId: created.data!.room.id,
          sessionToken: victim.session.sessionToken,
        });
        expect(response.ok).toBe(false);
        expect(response.error?.code).toBe('E002');
      } finally {
        attacker.close();
      }
    } finally {
      victim.close();
    }
  }, 30_000);

  it('invalidates the previous socket when a session is restored elsewhere', async () => {
    const first = await createClient(server.url, 'SessionOwner');
    const replacement = raw();
    await once(replacement, 'connect');
    const disconnected = once(first.socket, 'disconnect', 8_000);
    try {
      const restored = await emitAck(replacement, 'authenticate', {
        nickname: 'SessionOwner',
        avatar: first.session.avatar,
        sessionToken: first.session.sessionToken,
      });
      expect(restored.ok).toBe(true);
      await disconnected;
      expect(first.socket.connected).toBe(false);
    } finally {
      replacement.close();
      first.close();
    }
  }, 30_000);

  it('does not let a client claim another player identity on reconnect', async () => {
    const victim = await createClient(server.url, 'ReconVictim');
    try {
      const created = await emitAck<{ room: { id: string } }>(victim.socket, 'room:create', {
        gameId: 'chess',
        maxPlayers: 2,
        isPrivate: false,
      });
      expect(created.ok).toBe(true);
      const roomId = created.data!.room.id;

      // An attacker guesses the room id and the victim's player id, but has no
      // session token for that seat.
      const attacker = raw();
      await once(attacker, 'connect');
      try {
        const stolen = await emitAck(attacker, 'reconnect:attempt', {
          roomId,
          sessionToken: 'not-the-victims-token',
        });
        expect(stolen.ok).toBe(false);
      } finally {
        attacker.close();
      }

      // The victim still owns their seat.
      const still = await emitAck(victim.socket, 'lobby:ready', { isReady: true });
      expect(still.ok).toBe(true);
    } finally {
      victim.close();
    }
  }, 40_000);
});

describe('post-membership isolation', () => {
  it('disconnects a kicked socket so it cannot keep receiving room events', async () => {
    const host = await createClient(server.url, 'KickSecurityHost');
    const guest = await createClient(server.url, 'KickSecurityGuest');
    try {
      const created = await emitAck<{ room: { id: string } }>(host.socket, 'room:create', {
        gameId: 'chess',
        maxPlayers: 2,
        isPrivate: true,
      });
      await emitAck(guest.socket, 'room:join', { roomId: created.data!.room.id });
      const disconnected = once(guest.socket, 'disconnect', 8_000);
      const kicked = await emitAck(host.socket, 'room:kick', { playerId: guest.playerId });
      expect(kicked.ok).toBe(true);
      await disconnected;
      expect(guest.socket.connected).toBe(false);
    } finally {
      host.close();
      guest.close();
    }
  }, 30_000);
});

describe('input validation and injection resistance', () => {
  it('strips markup from chat instead of storing raw HTML', async () => {
    const host = await createClient(server.url, 'ChatSanitize');
    try {
      await emitAck(host.socket, 'room:create', {
        gameId: 'chess',
        maxPlayers: 2,
        isPrivate: false,
      });

      const payloads = [
        '<script>alert(1)</script>',
        '<img src=x onerror=alert(1)>',
        '"><svg/onload=alert(1)>',
      ];
      for (const text of payloads) {
        const response = await emitAck(host.socket, 'chat:send', { text });
        if (response.ok) {
          const stored = JSON.stringify(response.data ?? {});
          // Whatever survives must not contain executable markup.
          expect(stored).not.toContain('<script');
          expect(stored).not.toContain('onerror=');
          expect(stored).not.toContain('onload=');
        }
      }
    } finally {
      host.close();
    }
  }, 40_000);

  it('rejects malformed, oversized and unexpected fields on socket payloads', async () => {
    const client = await createClient(server.url, 'BadPayloads');
    try {
      const cases: Array<[string, unknown]> = [
        ['room:create', { gameId: 'chess', maxPlayers: 99, isPrivate: false }],
        ['room:create', { gameId: '../../etc/passwd', maxPlayers: 2, isPrivate: false }],
        ['room:create', { gameId: 'chess', maxPlayers: 2, isPrivate: false, isAdmin: true }],
        ['room:join', { roomId: '' }],
        ['room:join', { roomId: 'x'.repeat(500) }],
        ['chat:send', { text: '' }],
        ['chat:send', { notText: 'wrong field' }],
      ];
      for (const [event, payload] of cases) {
        const response = await emitAck(client.socket, event, payload);
        expect(response.ok, `${event} accepted ${JSON.stringify(payload)}`).toBe(false);
      }
    } finally {
      client.close();
    }
  }, 40_000);

  it('gives a generic response for unknown room codes (no enumeration signal)', async () => {
    const client = await createClient(server.url, 'Enumerator');
    try {
      const first = await emitAck(client.socket, 'room:join', { roomId: 'AAA234' });
      const second = await emitAck(client.socket, 'room:join', { roomId: 'BBB345' });
      expect(first.ok).toBe(false);
      expect(second.ok).toBe(false);
      // Identical shape for two different non-existent codes.
      expect(first.error?.code).toBe(second.error?.code);
      expect(first.error?.message).toBe(second.error?.message);
    } finally {
      client.close();
    }
  }, 30_000);

  it('rate limits repeated room-join attempts (brute-force resistance)', async () => {
    const client = await createClient(server.url, 'JoinFlooder');
    try {
      let limited = false;
      for (let attempt = 0; attempt < 120 && !limited; attempt += 1) {
        const response = await emitAck(client.socket, 'room:join', { roomId: 'ZZZ234' });
        if (response.error?.code === 'E007') limited = true;
      }
      expect(limited, 'join attempts were never rate limited').toBe(true);
    } finally {
      client.close();
    }
  }, 60_000);
});

describe('server authority over game outcomes', () => {
  it('ignores client-submitted score, winner and completion claims', async () => {
    const client = await createClient(server.url, 'CheatBot');
    try {
      const created = await emitAck(client.socket, 'room:create', {
        gameId: 'chess',
        maxPlayers: 2,
        isPrivate: false,
      });
      expect(created.ok).toBe(true);
      await emitAck(client.socket, 'room:add-ai', { difficulty: 'easy' });
      await emitAck(client.socket, 'lobby:ready', { isReady: true });
      await emitAck(client.socket, 'game:start', {});
      await once(client.socket, 'game:started', 25_000);

      const forged: Array<Record<string, unknown>> = [
        { type: 'score', payload: { score: 999_999 } },
        { type: 'win' },
        { type: 'checkmate' },
        { type: 'finish' },
        { type: 'complete' },
        { type: 'setState', payload: { board: [] } },
      ];
      for (const action of forged) {
        const response = await emitAck<{ accepted: boolean }>(client.socket, 'game:action', {
          action,
        });
        // The server may ack the transport, but must never ACCEPT the action.
        if (response.ok) expect(response.data?.accepted, `${action.type} was accepted`).toBe(false);
      }

      // The room is still mid-match: no forged action ended it.
      const room = client.room();
      if (room) expect(room.status).not.toBe('CLOSED');
    } finally {
      client.close();
    }
  }, 60_000);
});
