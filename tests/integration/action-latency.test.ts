import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RoomState } from '@2play/shared';
import { GAME_STATE_BROADCAST_THROTTLE_MS } from '@2play/shared';
import { createClient, emitAck, type TestClient } from '../helpers/client';
import { startTestServer, type TestServer } from '../helpers/server';

/**
 * Gameplay latency: a player must see the consequence of their own move
 * immediately, not after the room's broadcast throttle window has elapsed.
 *
 * `room:updated` is throttled so bursts of actions coalesce into one snapshot
 * per room. That is right for the room as a whole, but it used to mean the
 * *acting* player also waited — up to a full throttle window on top of the
 * game's own tick — to see their hit, capture or elimination land.
 *
 * Connect Four is the ideal probe: it is turn based with no update loop, so
 * every snapshot here comes from an action and there is no tick to mask the
 * behaviour. Two moves in quick succession put the second one squarely inside
 * the throttle window opened by the first.
 */

let server: TestServer;
let host: TestClient;
let guest: TestClient;

/** Bound well under the 100ms throttle window: the deferred path lands at ~95ms. */
const IMMEDIATE_MS = 60;

interface Recorder {
  /** Arrival time (ms epoch) of the first snapshot at or after `version`. */
  arrivalAtLeast: (version: number) => number | undefined;
  waitForVersion: (version: number, timeoutMs?: number) => Promise<number>;
  latest: () => RoomState | null;
  stop: () => void;
}

function recordSnapshots(client: TestClient): Recorder {
  const arrivals = new Map<number, number>();
  let latest: RoomState | null = client.room();
  const waiters: Array<{ version: number; resolve: (at: number) => void }> = [];

  const handler = (payload: { room: RoomState }): void => {
    latest = payload.room;
    const at = Date.now();
    if (!arrivals.has(payload.room.stateVersion)) arrivals.set(payload.room.stateVersion, at);
    for (const waiter of [...waiters]) {
      if (payload.room.stateVersion >= waiter.version) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(arrivals.get(payload.room.stateVersion) ?? at);
      }
    }
  };

  client.socket.on('room:updated', handler);

  return {
    arrivalAtLeast: (version) => {
      for (const [seen, at] of arrivals) if (seen >= version) return at;
      return undefined;
    },
    waitForVersion: (version, timeoutMs = 10_000) => {
      for (const [seen, at] of arrivals) if (seen >= version) return Promise.resolve(at);
      return new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = waiters.findIndex((waiter) => waiter.resolve === onSnapshot);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error(`timeout waiting for stateVersion >= ${version}`));
        }, timeoutMs);
        const onSnapshot = (at: number): void => {
          clearTimeout(timer);
          resolve(at);
        };
        waiters.push({ version, resolve: onSnapshot });
      });
    },
    latest: () => latest,
    stop: () => {
      client.socket.off('room:updated', handler);
    },
  };
}

async function setupConnectFour(): Promise<void> {
  const created = await emitAck<{ room: RoomState }>(host.socket, 'room:create', {
    gameId: 'connect-four',
    maxPlayers: 2,
    isPrivate: true,
  });
  if (!created.ok || !created.data) throw new Error(JSON.stringify(created.error));

  const joined = await emitAck<{ room: RoomState }>(guest.socket, 'room:join', {
    roomId: created.data.room.id,
  });
  expect(joined.ok).toBe(true);

  await emitAck(host.socket, 'lobby:ready', { isReady: true });
  await emitAck(guest.socket, 'lobby:ready', { isReady: true });

  const playing = host.waitForRoom((room) => room.status === 'PLAYING', 25_000);
  const started = await emitAck(host.socket, 'game:start', {});
  expect(started.ok).toBe(true);
  await playing;
  await guest.waitForRoom((room) => room.status === 'PLAYING', 25_000);
}

function turnOf(client: TestClient): string | undefined {
  const state = client.room()?.gameState as { currentPlayerId?: string } | null | undefined;
  return state?.currentPlayerId;
}

beforeAll(async () => {
  server = await startTestServer();
  host = await createClient(server.url, 'LatencyA');
  guest = await createClient(server.url, 'LatencyB');
}, 30_000);

afterAll(async () => {
  host?.close();
  guest?.close();
  await server?.stop();
});

describe('action latency', () => {
  it('delivers the acting player their own move without waiting out the broadcast throttle', async () => {
    await setupConnectFour();

    const hostSnaps = recordSnapshots(host);
    const guestSnaps = recordSnapshots(guest);

    try {
      // Both clients agree on the live board before we measure anything.
      await host.waitForRoom(
        (room) => Boolean((room.gameState as { currentPlayerId?: string } | null)?.currentPlayerId),
        10_000,
      );
      await guest.waitForRoom(
        (room) => Boolean((room.gameState as { currentPlayerId?: string } | null)?.currentPlayerId),
        10_000,
      );

      const columns = [0, 1, 2, 3, 4, 5];
      let proven = false;
      let cursor = (host.room() ?? guest.room())!.stateVersion;

      for (let pair = 0; pair < columns.length - 1 && !proven; pair += 1) {
        const currentTurn = turnOf(host) ?? turnOf(guest);
        expect(currentTurn).toBeTruthy();

        const first = currentTurn === host.playerId ? host : guest;
        const second = first === host ? guest : host;
        const secondSnaps = first === host ? guestSnaps : hostSnaps;
        const firstSnaps = first === host ? hostSnaps : guestSnaps;

        // Move 1. One action bumps `stateVersion` more than once (the module
        // marks its own change and the pipeline bumps again), so nothing below
        // may assume how far the version advances — only that it does.
        const firstAck = await emitAck<{ accepted: boolean }>(first.socket, 'game:action', {
          action: { type: 'drop', payload: { col: columns[pair]! } },
        });
        expect(firstAck.ok).toBe(true);
        expect(firstAck.data?.accepted).toBe(true);

        await firstSnaps.waitForVersion(cursor + 1, 10_000);
        const afterFirst = firstSnaps.latest()!.stateVersion;
        expect(afterFirst).toBeGreaterThan(cursor);

        // Wait for the *coalesced room broadcast* to reach the opponent. That
        // frame is what stamps the server's `lastBroadcast`, so once it has
        // landed the throttle window is provably open — which is exactly the
        // condition that used to make the next mover wait.
        const windowOpenedAt = await secondSnaps.waitForVersion(afterFirst, 10_000);
        cursor = afterFirst;

        // Move 2, straight into the open window.
        const sentAt = Date.now();
        const secondAck = await emitAck<{ accepted: boolean }>(second.socket, 'game:action', {
          action: { type: 'drop', payload: { col: columns[pair + 1]! } },
        });
        expect(secondAck.ok).toBe(true);
        expect(secondAck.data?.accepted).toBe(true);

        // Precondition: still inside the window when move 2 was sent, otherwise
        // the group broadcast was never suppressed and this pair proves
        // nothing — take the next two columns.
        if (sentAt - windowOpenedAt >= GAME_STATE_BROADCAST_THROTTLE_MS) continue;

        const arrivedAt = await secondSnaps.waitForVersion(cursor + 1, 10_000);
        const afterSecond = secondSnaps.latest()!.stateVersion;
        cursor = afterSecond;
        const delay = arrivedAt - sentAt;

        // The acting player must not have been made to wait out the window.
        expect(
          delay,
          `acting player waited ${delay}ms for their own move (throttle window is ${GAME_STATE_BROADCAST_THROTTLE_MS}ms)`,
        ).toBeLessThan(IMMEDIATE_MS);

        // And they get it ahead of the opponent, who still rides the coalesced
        // room broadcast — that is what keeps outbound traffic bounded.
        const opponentArrival = firstSnaps.arrivalAtLeast(afterSecond);
        if (opponentArrival !== undefined) {
          expect(
            arrivedAt,
            'the acting player should see their own move before the coalesced room broadcast reaches the opponent',
          ).toBeLessThanOrEqual(opponentArrival);
        }

        proven = true;
      }

      expect(proven, 'never managed to land a move inside the throttle window').toBe(true);
    } finally {
      hostSnaps.stop();
      guestSnaps.stop();
    }
  }, 60_000);
});
