import type { FavoriteGame } from '@2play/shared';
import type { Platform } from '../core/Platform';
import { AppError } from '../utils/errors';
import { createLogger } from '../utils/logger';

/** Favorites persistence (per user, per game). Generic across all games. */
export class FavoriteManager {
  private readonly logger = createLogger('FavoriteManager');

  constructor(private readonly platform: Platform) {}

  private assertGame(gameId: string): void {
    if (!this.platform.registry.has(gameId)) {
      throw AppError.gameNotFound(`Game "${gameId}" does not exist.`);
    }
  }

  async list(userId: string): Promise<FavoriteGame[]> {
    return this.platform.database.getFavorites(userId);
  }

  async add(userId: string, gameId: string): Promise<FavoriteGame> {
    this.assertGame(gameId);
    await this.platform.database.addFavorite(userId, gameId);
    this.logger.debug('favorite added', { userId, gameId });
    // The write is idempotent; avoid a second full-list query merely to echo
    // the server timestamp. Subsequent list reads return the persisted value.
    return { gameId, createdAt: new Date().toISOString() };
  }

  async remove(userId: string, gameId: string): Promise<void> {
    this.assertGame(gameId);
    await this.platform.database.removeFavorite(userId, gameId);
    this.logger.debug('favorite removed', { userId, gameId });
  }

  async isFavorite(userId: string, gameId: string): Promise<boolean> {
    return this.platform.database.isFavorite(userId, gameId);
  }
}
