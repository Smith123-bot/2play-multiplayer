import type { GameAction, GameConfig, GameFinishReason, GameResult, TimerType } from '@2play/shared';
import { createRandom } from '@2play/shared';
import type { Platform } from '../core/Platform';
import type {
  ActionResult,
  GameContext,
  GameModule,
  GamePlayerView,
  GameResultDraft,
} from '../games/GameModule';
import { ACTION_REJECTED, actionRejected } from '../games/GameModule';
import type { Room } from '../rooms/Room';
import type { ServerPlayer } from '../rooms/ServerPlayer';
import { AppError } from '../utils/errors';
import { randomSeed } from '../utils/ids';
import { createLogger } from '../utils/logger';

interface RoomGameRuntime {
  seed: number;
  random: () => number;
  context: GameContext;
}

/**
 * GameManager — the only bridge between the platform and game modules.
 *
 * Responsibilities:
 *  - build the (isolated) GameContext a module is allowed to use,
 *  - create/reset/finish game state,
 *  - funnel every player and AI action through validation,
 *  - run AI turns through the exact same validation path as humans,
 *  - produce per-viewer public state so hidden information stays server-side.
 */
export class GameManager {
  private readonly runtimes = new Map<string, RoomGameRuntime>();
  private readonly logger = createLogger('GameManager');

  constructor(private readonly platform: Platform) {}

  /* ---------------------------------------------------------------- */
  /* Player projection                                                 */
  /* ---------------------------------------------------------------- */

  toPlayerView(player: ServerPlayer): GamePlayerView {
    return {
      id: player.id,
      nickname: player.nickname,
      avatar: player.avatar,
      isAI: player.isAI,
      aiDifficulty: player.aiDifficulty,
      isConnected: player.isConnected,
      seatIndex: player.seatIndex,
      isHost: player.isHost,
    };
  }

  playerViews(room: Room): GamePlayerView[] {
    return room.orderedPlayers.map((player) => this.toPlayerView(player));
  }

  /* ---------------------------------------------------------------- */
  /* Configuration                                                     */
  /* ---------------------------------------------------------------- */

  buildConfig(room: Room): GameConfig {
    const metadata = this.module(room).metadata;
    const humans = room.humanPlayers.length;
    const ai = room.aiPlayers.length;
    return {
      playerCount: Math.max(room.settings.playerCount, humans + ai, metadata.minPlayers),
      humanCount: humans,
      aiOpponents: ai,
      aiDifficulty: room.settings.aiDifficulty,
      ...(room.settings.gridSize ? { gridSize: room.settings.gridSize } : {}),
      ...(room.settings.rounds ? { rounds: room.settings.rounds } : {}),
    };
  }

  /* ---------------------------------------------------------------- */
  /* Module access                                                     */
  /* ---------------------------------------------------------------- */

  module(room: Room): GameModule {
    return this.platform.registry.get(room.gameId);
  }

  /* ---------------------------------------------------------------- */
  /* Runtime / context                                                 */
  /* ---------------------------------------------------------------- */

  private runtimeFor(room: Room): RoomGameRuntime {
    let runtime = this.runtimes.get(room.id);
    if (!runtime) {
      const seed = randomSeed();
      runtime = {
        seed,
        random: createRandom(seed),
        context: undefined as unknown as GameContext,
      };
      runtime.context = this.buildContext(room, runtime);
      this.runtimes.set(room.id, runtime);
    }
    return runtime;
  }

  private buildContext(room: Room, runtime: RoomGameRuntime): GameContext {
    const context: GameContext = {
      roomId: room.id,
      gameId: room.gameId,
      matchNumber: room.matchNumber,
      config: this.buildConfig(room),
      players: this.playerViews(room),
      seed: runtime.seed,
      logger: createLogger(`Game:${room.gameId}`),
      now: () => Date.now(),
      random: () => runtime.random(),
      schedule: (delayMs, callback, type: TimerType = 'turn', key = 'custom') =>
        this.platform.timerManager.create({
          roomId: room.id,
          type,
          delayMs,
          key: `${type}:${key}`,
          label: `game:${room.gameId}:${key}`,
          onComplete: callback,
        }),
      cancel: (timerId: string) => {
        this.platform.timerManager.cancel(timerId);
      },
      requestAI: (playerId: string, delayMs: number) => {
        this.scheduleAI(room, playerId, delayMs);
      },
      markStateChanged: () => {
        room.bumpVersion();
        this.platform.eventBus.emit('room:state-changed', { room });
      },
      finish: (reason: GameFinishReason = 'completed') => {
        this.platform.lifecycleManager.finishMatch(room, reason);
      },
    };
    return context;
  }

  getContext(room: Room): GameContext {
    const runtime = this.runtimeFor(room);
    // Refresh mutable fields so modules always see current players/settings.
    const context = runtime.context as unknown as {
      matchNumber: number;
      config: GameConfig;
      players: GamePlayerView[];
    };
    context.matchNumber = room.matchNumber;
    context.config = this.buildConfig(room);
    context.players = this.playerViews(room);
    return runtime.context;
  }

  /** New random stream per match so rematches are not replayable. */
  reseed(room: Room): void {
    const seed = randomSeed();
    this.runtimes.set(room.id, {
      seed,
      random: createRandom(seed),
      context: undefined as unknown as GameContext,
    });
    const runtime = this.runtimes.get(room.id);
    if (runtime) runtime.context = this.buildContext(room, runtime);
  }

  /* ---------------------------------------------------------------- */
  /* State lifecycle                                                   */
  /* ---------------------------------------------------------------- */

  createState(room: Room): unknown {
    const game = this.module(room);
    const config = this.buildConfig(room);
    game.initialize(config);
    const state = game.createInitialState(this.playerViews(room), config);
    room.gameState = state;
    this.logger.debug('game state created', { roomId: room.id, gameId: room.gameId });
    return state;
  }

  /** Resets for a rematch (same players, new match). */
  resetState(room: Room): unknown {
    const game = this.module(room);
    const current = room.gameState;
    let next: unknown;
    try {
      next = current === null || current === undefined ? game.createInitialState(this.playerViews(room), this.buildConfig(room)) : game.reset(current);
    } catch (error) {
      this.logger.warn('reset failed — recreating state', {
        roomId: room.id,
        message: error instanceof Error ? error.message : String(error),
      });
      next = game.createInitialState(this.playerViews(room), this.buildConfig(room));
    }
    this.reseed(room);
    room.gameState = next;
    this.logger.debug('game state reset', { roomId: room.id, matchNumber: room.matchNumber });
    return next;
  }

  start(room: Room): void {
    const game = this.module(room);
    const state = room.gameState ?? this.createState(room);
    game.start(state, this.getContext(room));
    room.bumpVersion();
  }

  update(room: Room, deltaMs: number): void {
    const game = this.module(room);
    if (room.gameState === null || room.gameState === undefined) return;
    const ctx = this.getContext(room);
    game.update(room.gameState, deltaMs, ctx);
    game.tick(room.gameState, ctx);
  }

  cleanup(room: Room): void {
    const runtime = this.runtimes.get(room.id);
    if (!runtime) return;
    try {
      if (room.gameState !== null && room.gameState !== undefined) {
        this.module(room).cleanup(room.gameState);
      }
    } catch (error) {
      this.logger.warn('game cleanup failed', {
        roomId: room.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    this.runtimes.delete(room.id);
    room.gameState = null;
  }

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Single entry point for player AND AI actions:
   * validate → module → completion check → broadcast.
   */
  handleAction(room: Room, playerId: string, action: GameAction): ActionResult {
    const game = this.module(room);
    const ctx = this.getContext(room);
    if (room.gameState === null || room.gameState === undefined) {
      return actionRejected('The match has not started yet.');
    }

    const validation = game.validateAction(playerId, action, room.gameState, ctx);
    if (!validation.valid) {
      return actionRejected(validation.reason ?? 'That move is not allowed.');
    }

    let result: ActionResult;
    try {
      result = game.handlePlayerAction(playerId, action, room.gameState, ctx);
    } catch (error) {
      this.logger.error('game action crashed', {
        roomId: room.id,
        gameId: room.gameId,
        action: action.type,
        message: error instanceof Error ? error.message : String(error),
      });
      throw AppError.internal('The game could not process that action.');
    }

    if (result.stateChanged) {
      room.bumpVersion();
      this.platform.eventBus.emit('room:state-changed', { room });
      this.checkCompletion(room);
    }
    return result;
  }

  /** After every state change: did the game just finish? */
  checkCompletion(room: Room): void {
    if (room.status !== 'PLAYING' && room.status !== 'PAUSED') return;
    const game = this.module(room);
    if (room.gameState === null || room.gameState === undefined) return;
    if (game.isGameFinished(room.gameState)) {
      this.platform.lifecycleManager.finishMatch(room, 'completed');
    }
  }

  /* ---------------------------------------------------------------- */
  /* Player events                                                     */
  /* ---------------------------------------------------------------- */

  playerJoined(room: Room, player: ServerPlayer): void {
    if (room.gameState === null || room.gameState === undefined) return;
    const game = this.module(room);
    game.playerJoined(this.toPlayerView(player), room.gameState, this.getContext(room));
    room.bumpVersion();
  }

  playerReady(room: Room, playerId: string): void {
    if (room.gameState === null || room.gameState === undefined) return;
    this.module(room).playerReady(playerId, room.gameState, this.getContext(room));
  }

  playerLeft(room: Room, playerId: string, reason: 'leave' | 'disconnect' | 'kick' | 'timeout'): void {
    if (room.gameState === null || room.gameState === undefined) return;
    try {
      this.module(room).playerLeft(playerId, room.gameState, this.getContext(room), reason);
      room.bumpVersion();
    } catch (error) {
      this.logger.warn('playerLeft hook failed', {
        roomId: room.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /* ---------------------------------------------------------------- */
  /* AI                                                                */
  /* ---------------------------------------------------------------- */

  private scheduleAI(room: Room, playerId: string, delayMs: number): void {
    this.platform.timerManager.create({
      roomId: room.id,
      type: 'turn',
      delayMs: Math.max(50, delayMs),
      key: `ai:${playerId}`,
      label: `ai:${playerId}`,
      onComplete: () => {
        this.performAIAction(room, playerId);
      },
    });
  }

  /** Executes an AI move through the ordinary validation pipeline. */
  performAIAction(room: Room, playerId: string): void {
    const game = this.module(room);
    const player = room.getPlayer(playerId);
    if (!player || !player.isAI) return;
    if (room.status !== 'PLAYING') return;
    if (room.gameState === null || room.gameState === undefined) return;
    if (!game.getAIMove) return;

    const ctx = this.getContext(room);
    const difficulty = player.aiDifficulty ?? room.settings.aiDifficulty ?? 'medium';

    let action: GameAction | null = null;
    try {
      action = game.getAIMove(playerId, difficulty, room.gameState, ctx);
    } catch (error) {
      this.logger.error('AI move generation failed', {
        roomId: room.id,
        gameId: room.gameId,
        playerId,
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    if (!action) return;

    try {
      const result = this.handleAction(room, playerId, action);
      if (!result.accepted) {
        this.logger.debug('AI action rejected by validation', {
          roomId: room.id,
          playerId,
          action: action.type,
          reason: result.reason,
        });
      }
    } catch (error) {
      this.logger.error('AI action failed', {
        roomId: room.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Kicks off AI thinking for every AI seat (used at match start). */
  requestAITurns(room: Room): void {
    for (const ai of room.aiPlayers) {
      this.platform.timerManager.create({
        roomId: room.id,
        type: 'turn',
        delayMs: 400,
        key: `ai:${ai.id}`,
        label: `ai-boot:${ai.id}`,
        onComplete: () => this.performAIAction(room, ai.id),
      });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Results                                                           */
  /* ---------------------------------------------------------------- */

  buildResult(room: Room, reason: GameFinishReason): GameResult {
    const game = this.module(room);
    const ctx = this.getContext(room);
    if (room.gameState === null || room.gameState === undefined) {
      throw AppError.invalidAction('Cannot finish a match that has no state.');
    }

    game.finish(room.gameState, ctx);
    const draft: GameResultDraft = game.getResult(room.gameState, ctx);

    const players = room.orderedPlayers;
    const rankings = draft.rankings
      .map((entry) => {
        const player = players.find((candidate) => candidate.id === entry.playerId);
        return {
          ...entry,
          nickname: player?.nickname ?? 'Player',
          avatar: player?.avatar ?? '🎮',
          isAI: player?.isAI ?? false,
        };
      })
      .sort((a, b) => a.rank - b.rank || b.score - a.score);

    const winners = draft.winners.filter((id) => players.some((player) => player.id === id));
    const finishedAt = Date.now();

    return {
      gameId: room.gameId,
      roomId: room.id,
      matchNumber: room.matchNumber,
      winners,
      rankings,
      isDraw: draft.isDraw || (winners.length === 0 && !draft.isDraw ? false : draft.isDraw),
      durationSeconds: Math.max(0, Math.round((finishedAt - (room.gameStartedAt ?? finishedAt)) / 1000)),
      finishedAt,
      reason: draft.reason ?? reason,
    } satisfies GameResult;
  }

  calculateScore(room: Room, playerId: string): number {
    if (room.gameState === null || room.gameState === undefined) return 0;
    return this.module(room).calculateScore(playerId, room.gameState);
  }

  /* ---------------------------------------------------------------- */
  /* Serialisation                                                     */
  /* ---------------------------------------------------------------- */

  /** Per-viewer projection: hidden state never reaches the wrong client. */
  getPublicState(room: Room, viewerId?: string): unknown {
    if (room.gameState === null || room.gameState === undefined) return null;
    const game = this.module(room);
    try {
      return game.getPublicState(room.gameState, viewerId, this.getContext(room));
    } catch (error) {
      this.logger.error('getPublicState failed', {
        roomId: room.id,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  get runtimeCount(): number {
    return this.runtimes.size;
  }

  static get rejected(): ActionResult {
    return ACTION_REJECTED;
  }
}
