import { Room } from './Room';
import { createLogger } from '../utils/logger';

/**
 * In-memory room registry.
 *
 * Rooms are intentionally NOT persisted: live multiplayer state belongs to the
 * server process (see spec §8 — no sockets, timers or frames in Postgres).
 */
export class RoomStore {
  private readonly rooms = new Map<string, Room>();
  private readonly logger = createLogger('RoomStore');

  get size(): number {
    return this.rooms.size;
  }

  has(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  get(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  set(room: Room): void {
    this.rooms.set(room.id, room);
  }

  delete(roomId: string): boolean {
    return this.rooms.delete(roomId);
  }

  all(): Room[] {
    return [...this.rooms.values()];
  }

  ids(): string[] {
    return [...this.rooms.keys()];
  }

  clear(): void {
    this.rooms.clear();
    this.logger.warn('room store cleared');
  }
}
