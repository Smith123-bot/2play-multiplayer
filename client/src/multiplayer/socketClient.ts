import { io, type Socket } from 'socket.io-client';
import type {
  AckResponse,
  ClientToServerEvents,
  ConnectionState,
  ServerToClientEvents,
} from '@2play/shared';
import { SOCKET_URL } from '../core/config';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export type ServerEventName = keyof ServerToClientEvents;
export type ClientEventName = keyof ClientToServerEvents;

type Listener = (payload: never) => void;

const CONNECT_OPTIONS = {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: Number.POSITIVE_INFINITY,
  reconnectionDelay: 500,
  reconnectionDelayMax: 4000,
  timeout: 10000,
  transports: ['websocket', 'polling'] as string[],
};

/**
 * Thin, typed Socket.IO wrapper.
 *
 * Responsibilities kept deliberately narrow: connection lifecycle, typed emit
 * with ack support, and a listener registry that lets stores subscribe without
 * ever holding the raw socket.
 */
class SocketClient {
  private socket: ClientSocket | null = null;
  private readonly listeners = new Map<string, Set<Listener>>();
  private status: ConnectionState = 'DISCONNECTED';
  private readonly statusListeners = new Set<(state: ConnectionState) => void>();
  private reconnectAttempts = 0;

  get connectionState(): ConnectionState {
    return this.status;
  }

  get id(): string | null {
    return this.socket?.id ?? null;
  }

  get connected(): boolean {
    return this.socket?.connected ?? false;
  }

  private setStatus(status: ConnectionState): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of [...this.statusListeners]) listener(status);
  }

  onStatusChange(listener: (state: ConnectionState) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  connect(): ClientSocket {
    if (this.socket) {
      if (!this.socket.connected) this.socket.connect();
      return this.socket;
    }

    this.setStatus('CONNECTING');
    const socket: ClientSocket = SOCKET_URL
      ? io(SOCKET_URL, CONNECT_OPTIONS)
      : io(CONNECT_OPTIONS);

    this.socket = socket;

    socket.on('connect', () => {
      this.reconnectAttempts = 0;
      this.setStatus('CONNECTED');
      this.dispatch('__internal:connect', undefined as never);
    });

    socket.on('disconnect', (reason) => {
      this.setStatus(reason === 'io client disconnect' ? 'DISCONNECTED' : 'RECONNECTING');
      this.dispatch('__internal:disconnect', reason as never);
    });

    socket.io.on('reconnect_attempt', (attempt: number) => {
      this.reconnectAttempts = attempt;
      this.setStatus('RECONNECTING');
    });

    socket.io.on('reconnect_failed', () => {
      this.setStatus('DISCONNECTED');
    });

    // Forward every protocol event to registered listeners.
    socket.onAny((event: string, payload: unknown) => {
      this.dispatch(event, payload as never);
    });

    socket.connect();
    return socket;
  }

  disconnect(): void {
    if (!this.socket) return;
    this.socket.removeAllListeners();
    this.socket.io.off('reconnect_attempt');
    this.socket.io.off('reconnect_failed');
    this.socket.disconnect();
    this.socket = null;
    this.setStatus('DISCONNECTED');
  }

  /** Subscribe to a server event. Returns an unsubscribe function. */
  on<TPayload>(event: ServerEventName | '__internal:connect' | '__internal:disconnect', listener: (payload: TPayload) => void): () => void {
    const set = this.listeners.get(event) ?? new Set<Listener>();
    set.add(listener as Listener);
    this.listeners.set(event, set);
    return () => {
      set.delete(listener as Listener);
    };
  }

  private dispatch(event: string, payload: never): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        listener(payload);
      } catch (error) {
        // A broken UI listener must never break the transport.
        console.error('[2PLAY] socket listener error', error);
      }
    }
  }

  /** Typed emit (fire and forget). */
  emit<TPayload>(event: ClientEventName, payload: TPayload): void {
    if (!this.socket) return;
    (this.socket.emit as (name: string, body: TPayload) => void)(event, payload);
  }

  /** Typed emit waiting for the server acknowledgement. */
  emitAck<TResult, TPayload = unknown>(
    event: ClientEventName,
    payload: TPayload,
    timeoutMs = 10000,
  ): Promise<AckResponse<TResult>> {
    const socket = this.socket;
    if (!socket || !socket.connected) {
      return Promise.resolve({
        ok: false,
        error: { code: 'E008', name: 'CONNECTION_FAILED', message: 'Not connected to the server.' },
      });
    }
    return new Promise<AckResponse<TResult>>((resolve) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({
          ok: false,
          error: { code: 'E008', name: 'CONNECTION_FAILED', message: 'The server did not respond in time.' },
        });
      }, timeoutMs);

      (socket.emit as unknown as (
        name: string,
        body: TPayload,
        ack: (response: AckResponse<TResult>) => void,
      ) => void)(event, payload, (response) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(response ?? { ok: true });
      });
    });
  }

  get attempts(): number {
    return this.reconnectAttempts;
  }
}

export const socketClient = new SocketClient();
export type { ClientSocket };
