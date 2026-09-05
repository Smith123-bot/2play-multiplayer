import type { GameMetadata } from '@2play/shared';
import { AppError } from '../../utils/errors';
import { createLogger } from '../../utils/logger';
import { isGameModule, type GameModule } from '../GameModule';

/**
 * GameRegistry — the platform's catalogue of games.
 *
 * Core managers never contain game-specific logic; they ask the registry for a
 * module by id. Adding a game = registering it here (spec §42).
 */
export class GameRegistry {
  private readonly games = new Map<string, GameModule>();
  private readonly logger = createLogger('GameRegistry');

  register(game: GameModule): void {
    if (!isGameModule(game)) {
      throw AppError.internal(`Game module "${String((game as { metadata?: { id?: string } })?.metadata?.id ?? 'unknown')}" does not implement GameModule.`);
    }
    this.validateMetadata(game.metadata);
    if (this.games.has(game.metadata.id)) {
      this.logger.warn('game replaced in registry', { gameId: game.metadata.id });
    }
    this.games.set(game.metadata.id, game);
    this.logger.info('game registered', {
      gameId: game.metadata.id,
      name: game.metadata.name,
      players: `${game.metadata.minPlayers}-${game.metadata.maxPlayers}`,
      ai: game.metadata.hasAI,
    });
  }

  unregister(gameId: string): boolean {
    const removed = this.games.delete(gameId);
    if (removed) this.logger.info('game unregistered', { gameId });
    return removed;
  }

  has(gameId: string): boolean {
    return this.games.has(gameId);
  }

  get(gameId: string): GameModule {
    const game = this.games.get(gameId);
    if (!game) throw AppError.gameNotFound(`Game "${gameId}" is not available.`);
    return game;
  }

  /** Non-throwing variant used by validators and metadata endpoints. */
  find(gameId: string): GameModule | undefined {
    return this.games.get(gameId);
  }

  getAll(): GameModule[] {
    return [...this.games.values()];
  }

  getAllMetadata(): GameMetadata[] {
    return this.getAll().map((game) => game.metadata);
  }

  ids(): string[] {
    return [...this.games.keys()];
  }

  get size(): number {
    return this.games.size;
  }

  supportsPlayerCount(gameId: string, playerCount: number): boolean {
    const game = this.find(gameId);
    if (!game) return false;
    return game.metadata.supportedPlayerCounts.includes(playerCount);
  }

  /** Metadata sanity check — catches typos at registration time, not at runtime. */
  validateMetadata(metadata: GameMetadata): void {
    const errors: string[] = [];
    const push = (message: string) => errors.push(`[${metadata?.id ?? 'unknown'}] ${message}`);

    if (!metadata?.id || !/^[a-z0-9-]+$/.test(metadata.id)) push('id must be kebab-case.');
    if (!metadata?.name?.trim()) push('name is required.');
    if (!metadata?.description?.trim()) push('description is required.');
    if (!metadata?.category) push('category is required.');
    if (!metadata?.icon?.trim()) push('icon is required.');
    if (!metadata?.thumbnail?.trim()) push('thumbnail is required.');
    if (!Array.isArray(metadata?.supportedPlayerCounts) || metadata.supportedPlayerCounts.length === 0) {
      push('supportedPlayerCounts must be a non-empty array.');
    } else {
      const min = metadata.supportedPlayerCounts[0];
      const max = metadata.supportedPlayerCounts[metadata.supportedPlayerCounts.length - 1];
      if (metadata.minPlayers !== min) push(`minPlayers must match supportedPlayerCounts (${min}).`);
      if (metadata.maxPlayers !== max) push(`maxPlayers must match supportedPlayerCounts (${max}).`);
      if (metadata.supportedPlayerCounts.some((count) => count < 2 || count > 4)) {
        push('supportedPlayerCounts must be between 2 and 4.');
      }
    }
    if (metadata?.hasAI && (!Array.isArray(metadata.aiDifficulties) || metadata.aiDifficulties.length === 0)) {
      push('aiDifficulties must list at least one difficulty when hasAI is true.');
    }
    if (!metadata?.estimatedDuration || metadata.estimatedDuration <= 0) {
      push('estimatedDuration must be a positive number of seconds.');
    }
    if (!metadata?.controls?.trim()) push('controls is required.');
    if (!Array.isArray(metadata?.rules) || metadata.rules.length === 0) push('rules are required.');
    if (!metadata?.scoring?.trim()) push('scoring is required.');
    if (!metadata?.winCondition?.trim()) push('winCondition is required.');
    if (!Array.isArray(metadata?.tags)) push('tags must be an array.');

    if (errors.length > 0) {
      throw AppError.internal(`Invalid game metadata:\n  ${errors.join('\n  ')}`);
    }
  }
}
