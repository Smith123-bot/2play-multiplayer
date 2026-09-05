import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GameFinishedPayload, RoomState } from '@2play/shared';
import { createClient, emitAck, once, type TestClient } from '../helpers/client';
import { startTestServer, type TestServer } from '../helpers/server';

let server: TestServer;
let host: TestClient;
let guest: TestClient;
let roomId: string;

async function setupMatch(gameId = 'reaction-race'): Promise<void> {
  const created = await emitAck<{ room: RoomState }>(host.socket, 'room:create', {
    gameId,
    maxPlayers: 2,
    isPrivate: false,
    settings: { rounds: 1 },
  });
  if (!created.ok || !created.data) throw new Error(JSON.stringify(created.error));
  roomId = created.data.room.id;

  const joined = await emitAck<{ room: RoomState }>(guest.socket, 'room:join', { roomId });
  expect(joined.ok).toBe(true);
}

beforeAll(async () => {
  server = await startTestServer();
  host = await createClient(server.url, 'HostA');
  guest = await createClient(server.url, 'GuestB');
}, 30_000);

afterAll(async () => {
  host?.close();
  guest?.close();
  await server?.stop();
});

describe('full match lifecycle (reaction race)', () => {
  it('runs ready → countdown → playing → finished → rematch → new match', async () => {
    await setupMatch();

    // Both players ready up (host can only start once everyone is ready).
    const blocked = await emitAck(host.socket, 'game:start', {});
    expect(blocked.ok).toBe(false);
    expect(blocked.error?.code).toBe('E006');

    await emitAck(host.socket, 'lobby:ready', { isReady: true });
    const hostReadyEvent = await once<{ playerId: string; isReady: boolean; allReady: boolean }>(
      guest.socket,
      'lobby:player-ready',
    );
    expect(hostReadyEvent.allReady).toBe(false);

    const readyStatePromise = host.waitForRoom((room) => room.status === 'READY');
    await emitAck(guest.socket, 'lobby:ready', { isReady: true });
    const readyState = await readyStatePromise;
    expect(readyState.players.every((player) => player.isReady)).toBe(true);

    // Countdown (server authoritative) then the match starts.
    const startedPromise = once<{ matchNumber: number }>(host.socket, 'game:started', 25_000);
    const start = await emitAck(host.socket, 'game:start', {});
    expect(start.ok).toBe(true);

    const countdownPromise = once<{ value: number }>(host.socket, 'game:countdown', 10_000);
    const countdown = await countdownPromise;
    expect(countdown.value).toBeGreaterThan(0);

    const started = await startedPromise;
    expect(started.matchNumber).toBe(1);

    // Wait for the server GO signal, then both players tap (after the minimum
    // human reaction window, otherwise the anti-cheat rejects the tap).
    await host.waitForRoom((room) => {
      const state = room.gameState as { phase?: string } | null;
      return state?.phase === 'go';
    }, 25_000);
    await new Promise((resolve) => setTimeout(resolve, 220));

    await emitAck(host.socket, 'game:action', { action: { type: 'tap' } });
    await emitAck(guest.socket, 'game:action', { action: { type: 'tap' } });

    const finished = await once<GameFinishedPayload>(host.socket, 'game:finished', 25_000);
    expect(finished.result.gameId).toBe('reaction-race');
    expect(finished.result.rankings).toHaveLength(2);
    expect(finished.result.matchNumber).toBe(1);

    // The room must survive the result: sockets stay connected, chat intact.
    const resultRoom = await host.waitForRoom((room) => room.status === 'REMATCH_WAITING');
    expect(resultRoom.players).toHaveLength(2);
    expect(host.socket.connected).toBe(true);
    expect(guest.socket.connected).toBe(true);

    // Rematch: both players must vote yes.
    const rematchStarted = once<{ matchNumber: number }>(host.socket, 'rematch:started', 25_000);
    const vote1 = await emitAck(host.socket, 'rematch:request', {});
    expect(vote1.ok).toBe(true);

    const started2 = once<{ matchNumber: number }>(host.socket, 'game:started', 30_000);
    const vote2 = await emitAck(guest.socket, 'rematch:request', {});
    expect(vote2.ok).toBe(true);

    const rematch = await rematchStarted;
    expect(rematch.matchNumber).toBe(2);

    const secondMatch = await started2;
    expect(secondMatch.matchNumber).toBe(2);

    // The new match is playable (fresh state, same room, same players).
    const freshRoom = await host.waitForRoom((room) => {
      const state = room.gameState as { phase?: string; round?: number } | null;
      return room.status === 'PLAYING' && state?.phase !== undefined;
    }, 25_000);
    expect(freshRoom.players).toHaveLength(2);
    expect(freshRoom.gameResult).toBeNull();
  }, 120_000);
});
