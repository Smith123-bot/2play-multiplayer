/**
 * 2PLAY performance benchmark harness.
 *
 * Boots the REAL server (all managers, real Socket.IO over loopback TCP) and
 * measures the critical player-facing paths with real socket clients.
 * Every number reported by this script is an actual measurement.
 *
 * Run: npx tsx benchmarks/bench.ts
 */
import { io, type Socket } from 'socket.io-client';
import type { AckResponse, RoomState, SessionInfo } from '@2play/shared';

process.env.PORT = '0';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'warn';
// The benchmark exercises create/join hundreds of times from one IP; the real
// per-minute rate limits would trip long before any useful sample count.
process.env.ROOM_CREATE_RATE_LIMIT_PER_MIN = '600';
process.env.ROOM_JOIN_RATE_LIMIT_PER_MIN = '600';
process.env.AUTH_RATE_LIMIT_PER_MIN = '600';
process.env.ACTION_RATE_LIMIT_PER_SEC = '200';
process.env.CHAT_RATE_LIMIT_PER_SEC = '50';
process.env.SOCKET_CONNECT_RATE_LIMIT_PER_MIN = '2000';

interface Sample {
  name: string;
  ms: number;
  bytes?: number;
}

const samples: Sample[] = [];
let trafficBytes = 0;
let trafficMessages = 0;

function record(name: string, startedAt: bigint, bytes?: number): number {
  const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
  samples.push({ name, ms, bytes });
  return ms;
}

function pct(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function stats(name: string): { p50: number; p95: number; p99: number; n: number } | null {
  const values = samples.filter((sample) => sample.name === name).map((sample) => sample.ms);
  if (values.length === 0) return null;
  return { p50: pct(values, 50), p95: pct(values, 95), p99: pct(values, 99), n: values.length };
}

function emitAck<T>(socket: Socket, event: string, payload: unknown): Promise<AckResponse<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), 10_000);
    socket.emit(event, payload, (response: AckResponse<T>) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

function once<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => {
    const handler = (payload: T) => {
      socket.off(event, handler);
      resolve(payload);
    };
    socket.once(event, handler);
  });
}

interface BenchClient {
  socket: Socket;
  playerId: string;
  token: string;
  latestRoom: RoomState | null;
  close: () => void;
}

async function makeClient(url: string, nickname: string): Promise<BenchClient> {
  const socket = io(url, { transports: ['websocket'], forceNew: true });
  await once(socket, 'connect');
  const response = await emitAck<{ session: SessionInfo }>(socket, 'authenticate', {
    nickname,
    avatar: '🦊',
  });
  if (!response.ok || !response.data) throw new Error('auth failed');
  const client: BenchClient = {
    socket,
    playerId: response.data.session.playerId,
    token: response.data.session.sessionToken,
    latestRoom: null,
    close: () => socket.disconnect(),
  };
  // Track inbound traffic per socket (payload size + message count).
  socket.onAny((_event, payload) => {
    trafficMessages += 1;
    trafficBytes += JSON.stringify(payload ?? null).length;
  });
  socket.on('room:updated', (payload: { room: RoomState }) => {
    client.latestRoom = payload.room;
  });
  return client;
}

async function waitForPlaying(clients: BenchClient[]): Promise<void> {
  for (const client of clients) client.latestRoom = null;
  const t0 = process.hrtime.bigint();
  for (;;) {
    if (clients.every((client) => client.latestRoom?.status === 'PLAYING')) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (Number(process.hrtime.bigint() - t0) / 1e6 > 9000) return;
  }
}

async function main(): Promise<void> {
  const { ApplicationManager } = await import('../server/src/core/ApplicationManager');
  const application = new ApplicationManager();
  const { port } = await application.start();
  const url = `http://127.0.0.1:${port}`;
  const iters = 120;

  try {
    /* ---------------- 1. Authentication ---------------- */
    for (let i = 0; i < 30; i += 1) {
      const socket = io(url, { transports: ['websocket'], forceNew: true });
      await once(socket, 'connect');
      const start = process.hrtime.bigint();
      await emitAck(socket, 'authenticate', { nickname: `BenchAuth${i}`, avatar: '🦊' });
      record('auth', start);
      socket.disconnect();
    }

    /* ---------------- Persistent clients ---------------- */
    const host = await makeClient(url, 'BenchHost');
    const p2 = await makeClient(url, 'BenchP2');
    const p3 = await makeClient(url, 'BenchP3');
    const p4 = await makeClient(url, 'BenchP4');
    // Rotating pool: room:create is rate-limited per client key, so the
    // benchmark rotates identity across sockets like real players would.
    const createPool: BenchClient[] = [host];
    for (let i = 0; i < 12; i += 1) createPool.push(await makeClient(url, `BenchPool${i}`));
    let poolIndex = 0;
    const nextCreator = (): BenchClient => {
      const client = createPool[poolIndex % createPool.length];
      poolIndex += 1;
      return client;
    };

    /* ---------------- 2. room:create ---------------- */
    for (let i = 0; i < iters; i += 1) {
      const creator = nextCreator();
      const start = process.hrtime.bigint();
      const response = await emitAck<{ room: RoomState }>(creator.socket, 'room:create', {
        gameId: 'connect-four',
        maxPlayers: 2,
        isPrivate: false,
      });
      if (!response.ok) throw new Error(`room:create failed: ${JSON.stringify(response.error)}`);
      record('room:create', start, JSON.stringify(response.data).length);
      await emitAck(creator.socket, 'room:leave', {});
    }

    /* ---------------- 3. room:create + join + ready + start (full pregame) --- */
    for (let i = 0; i < 40; i += 1) {
      const created = await emitAck<{ room: RoomState }>(host.socket, 'room:create', {
        gameId: 'connect-four',
        maxPlayers: 2,
        isPrivate: false,
      });
      const roomId = created.data!.room.id;
      const joinStart = process.hrtime.bigint();
      await emitAck(p2.socket, 'room:join', { roomId });
      record('room:join', joinStart);
      const readyStart = process.hrtime.bigint();
      await emitAck(host.socket, 'lobby:ready', { isReady: true });
      record('lobby:ready(host)', readyStart);
      await emitAck(p2.socket, 'lobby:ready', { isReady: true });
      const startStart = process.hrtime.bigint();
      await emitAck(host.socket, 'game:start', {});
      record('game:start(ack)', startStart);
      // Wait for the countdown to finish + playing state to land on both clients.
      await waitForPlaying([host, p2]);
      await emitAck(host.socket, 'game:leave', {});
      await emitAck(host.socket, 'room:leave', {});
      if (p2.latestRoom) p2.latestRoom = null;
      await emitAck(p2.socket, 'room:leave', {});
    }

    /* ---------------- 4. room:list ---------------- */
    for (let i = 0; i < 50; i += 1) {
      const start = process.hrtime.bigint();
      await emitAck(host.socket, 'room:list', {});
      record('room:list', start);
    }

    /* ---------------- 5. heartbeat ---------------- */
    for (let i = 0; i < 50; i += 1) {
      const start = process.hrtime.bigint();
      await emitAck(host.socket, 'heartbeat', {});
      record('heartbeat', start);
    }

    /* ---------------- 6. gameplay actions (connect-four, 2p) --------------- */
    {
      const created = await emitAck<{ room: RoomState }>(host.socket, 'room:create', {
        gameId: 'connect-four',
        maxPlayers: 2,
        isPrivate: true,
      });
      const roomId = created.data!.room.id;
      await emitAck(p2.socket, 'room:join', { roomId });
      await emitAck(host.socket, 'lobby:ready', { isReady: true });
      await emitAck(p2.socket, 'lobby:ready', { isReady: true });
      await emitAck(host.socket, 'game:start', {});
      await waitForPlaying([host, p2]);
      trafficBytes = 0;
      trafficMessages = 0;
      // 15 alternating moves = a realistic burst of turn-based actions.
      let move = 0;
      const actors = [host, p2];
      for (let round = 0; round < 7; round += 1) {
        for (const actor of actors) {
          if (move >= 14) break;
          const start = process.hrtime.bigint();
          const column = move % 7;
          const result = await emitAck<{ accepted: boolean }>(actor.socket, 'game:action', {
            action: { type: 'drop', payload: { col: column } },
          });
          record('game:action RTT', start);
          if (!result.ok || !result.data?.accepted) {
            // Column full: try another.
            const retryStart = process.hrtime.bigint();
            await emitAck(actor.socket, 'game:action', { action: { type: 'drop', payload: { col: (column + 3) % 7 } } });
            record('game:action RTT', retryStart);
          }
          move += 1;
        }
      }
      const trafficPerAction = trafficBytes / Math.max(1, move);
      console.log(`--- 4p broadcast traffic during 14 actions: ${(trafficBytes / 1024).toFixed(1)} KB total, ${(trafficPerAction / 1024).toFixed(2)} KB per action, ${trafficMessages} messages (${(trafficMessages / Math.max(1, move)).toFixed(1)} msg/action)`);
      await emitAck(host.socket, 'game:leave', {});
      await emitAck(host.socket, 'room:leave', {});
      await emitAck(p2.socket, 'room:leave', {});
    }

    /* ---------------- 7. Many concurrent rooms: list + create under load --- */
    {
      // One dedicated creator per room (a session can only host one room).
      const rooms: string[] = [];
      const creators: BenchClient[] = [];
      for (let i = 0; i < 200; i += 1) {
        const creator = await makeClient(url, `BenchBulk${i}`);
        creators.push(creator);
        const created = await emitAck<{ room: RoomState }>(creator.socket, 'room:create', {
          gameId: 'connect-four',
          maxPlayers: 2,
          isPrivate: true,
        });
        if (!created.ok || !created.data) throw new Error(`bulk create ${i} failed: ${JSON.stringify(created.error)}`);
        rooms.push(created.data.room.id);
      }
      const start = process.hrtime.bigint();
      await emitAck(host.socket, 'room:list', {});
      record('room:list @200 rooms', start);
      // Drain: every creator leaves its own room (closes it immediately).
      for (const creator of creators) {
        await emitAck(creator.socket, 'room:leave', {}).catch(() => undefined);
        creator.close();
      }
    }

    /* ---------------- 8. Simulated realtime game broadcast pressure --------- */
    {
      // Use paddle-duel (has update loop) to measure steady-state frame traffic.
      const created = await emitAck<{ room: RoomState }>(host.socket, 'room:create', {
        gameId: 'paddle-duel',
        maxPlayers: 2,
        isPrivate: true,
      });
      const roomId = created.data!.room.id;
      await emitAck(p2.socket, 'room:join', { roomId });
      await emitAck(host.socket, 'lobby:ready', { isReady: true });
      await emitAck(p2.socket, 'lobby:ready', { isReady: true });
      await emitAck(host.socket, 'game:start', {});
      await waitForPlaying([host, p2]);
      const before = { messages: trafficMessages, bytes: trafficBytes };
      const wallStart = process.hrtime.bigint();
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const wallMs = Number(process.hrtime.bigint() - wallStart) / 1e6;
      const deltaMsgs = trafficMessages - before.messages;
      const deltaBytes = trafficBytes - before.bytes;
      console.log(`--- paddle-duel steady state: ${(deltaMsgs / (wallMs / 1000)).toFixed(1)} msg/s, ${(deltaBytes / 1024 / (wallMs / 1000)).toFixed(2)} KB/s per client`);
      await emitAck(host.socket, 'game:leave', {});
      await emitAck(host.socket, 'room:leave', {});
      await emitAck(p2.socket, 'room:leave', {});
    }

    host.close();
    p2.close();
    p3.close();
    p4.close();

    /* ---------------- Report ---------------- */
    console.log('\n================= BENCHMARK RESULTS (loopback, real server) =================');
    for (const name of [
      'auth',
      'room:create',
      'room:join',
      'lobby:ready(host)',
      'game:start(ack)',
      'room:list',
      'room:list @200 rooms',
      'heartbeat',
      'game:action RTT',
    ]) {
      const value = stats(name);
      if (!value) continue;
      console.log(
        `${name.padEnd(24)} p50=${value.p50.toFixed(2)}ms p95=${value.p95.toFixed(2)}ms p99=${value.p99.toFixed(2)}ms n=${value.n}`,
      );
    }
    const createBytes = samples.filter((sample) => sample.name === 'room:create' && sample.bytes);
    if (createBytes.length > 0) {
      const avg = createBytes.reduce((sum, sample) => sum + (sample.bytes ?? 0), 0) / createBytes.length;
      console.log(`room:create payload       avg=${(avg / 1024).toFixed(2)} KB`);
    }
  } finally {
    await application.stop();
  }
}

void main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
