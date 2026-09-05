import { io, type Socket } from 'socket.io-client';
import type { AckResponse, RoomState, SessionInfo } from '@2play/shared';

export interface TestClient {
  socket: Socket;
  session: SessionInfo;
  playerId: string;
  room: () => RoomState | null;
  waitForRoom: (predicate: (room: RoomState) => boolean, timeoutMs?: number) => Promise<RoomState>;
  close: () => void;
}

export function once<T>(socket: Socket, event: string, timeoutMs = 15_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout waiting for "${event}"`));
    }, timeoutMs);
    const handler = (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    };
    socket.once(event, handler);
  });
}

export function emitAck<T>(
  socket: Socket,
  event: string,
  payload: unknown,
  timeoutMs = 10_000,
): Promise<AckResponse<T>> {
  return new Promise<AckResponse<T>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ack "${event}"`)), timeoutMs);
    socket.emit(event, payload, (response: AckResponse<T>) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

/**
 * Tracks the latest room snapshot so tests can assert on state that was
 * broadcast *before* they started listening (avoids flaky event races).
 */
export function watchRoom(socket: Socket): {
  current: () => RoomState | null;
  waitFor: (predicate: (room: RoomState) => boolean, timeoutMs?: number) => Promise<RoomState>;
  stop: () => void;
} {
  let latest: RoomState | null = null;
  const listeners = new Set<(room: RoomState) => void>();

  const handler = (payload: { room: RoomState }) => {
    latest = payload.room;
    for (const listener of [...listeners]) listener(payload.room);
  };
  socket.on('room:updated', handler);

  return {
    current: () => latest,
    waitFor: (predicate, timeoutMs = 20_000) =>
      new Promise<RoomState>((resolve, reject) => {
        if (latest && predicate(latest)) {
          resolve(latest);
          return;
        }
        const timer = setTimeout(() => {
          listeners.delete(listener);
          reject(
            new Error(
              `timeout waiting for room condition (last status: ${latest?.status ?? 'none'})`,
            ),
          );
        }, timeoutMs);
        const listener = (room: RoomState) => {
          if (predicate(room)) {
            clearTimeout(timer);
            listeners.delete(listener);
            resolve(room);
          }
        };
        listeners.add(listener);
      }),
    stop: () => socket.off('room:updated', handler),
  };
}

/** Standalone helper: waits until a broadcast room snapshot matches. */
export function waitForRoom(
  socket: Socket,
  predicate: (room: RoomState) => boolean,
  timeoutMs = 20_000,
): Promise<RoomState> {
  return watchRoom(socket).waitFor(predicate, timeoutMs);
}

/** Connects and authenticates a client in one step. */
export async function createClient(url: string, nickname: string, avatar = '🦊'): Promise<TestClient> {
  const socket = io(url, { transports: ['websocket'], forceNew: true });
  await once(socket, 'connect');
  const response = await emitAck<{ session: SessionInfo }>(socket, 'authenticate', {
    nickname,
    avatar,
  });
  if (!response.ok || !response.data) {
    throw new Error(`authentication failed: ${JSON.stringify(response.error)}`);
  }
  const watcher = watchRoom(socket);
  return {
    socket,
    session: response.data.session,
    playerId: response.data.session.playerId,
    room: () => watcher.current(),
    waitForRoom: (predicate, timeoutMs) => watcher.waitFor(predicate, timeoutMs),
    close: () => {
      watcher.stop();
      socket.close();
    },
  };
}
