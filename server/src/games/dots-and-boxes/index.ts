import type { AIDifficulty, GameAction, GameConfig } from '@2play/shared';
import type {
  ActionResult,
  GameContext,
  GameModule,
  GamePlayerView,
  GameResultDraft,
  RankingDraft,
  ValidationResult,
} from '../GameModule';
import { actionAccepted, actionRejected } from '../GameModule';
import { DOTS_AND_BOXES_METADATA } from '@2play/shared';
export { DOTS_AND_BOXES_METADATA };

export interface DotsAndBoxesState {
  cols: number;
  rows: number;
  /** Horizontal lines: index = row * (cols - 1) + col */
  hLines: boolean[];
  /** Vertical lines: index = row * cols + col */
  vLines: boolean[];
  /** Box owner by index = row * (cols - 1) + col */
  boxes: (string | null)[];
  scores: Record<string, number>;
  turnOrder: string[];
  currentPlayerId: string | null;
  phase: 'idle' | 'playing' | 'finished';
  moves: number;
  totalBoxes: number;
  claimedBoxes: number;
  lastMove: { orientation: 'h' | 'v'; row: number; col: number; playerId: string } | null;
  lastEvent: string | null;
}


const GRID_SIZE: Record<string, number> = { '4x4': 4, '6x6': 6, '8x8': 8 };

function boxIndex(state: DotsAndBoxesState, row: number, col: number): number {
  return row * (state.cols - 1) + col;
}

function legalMoves(state: DotsAndBoxesState): Array<{ orientation: 'h' | 'v'; row: number; col: number }> {
  const moves: Array<{ orientation: 'h' | 'v'; row: number; col: number }> = [];
  for (let row = 0; row < state.rows; row += 1) {
    for (let col = 0; col < state.cols - 1; col += 1) {
      if (!state.hLines[row * (state.cols - 1) + col]) moves.push({ orientation: 'h', row, col });
    }
  }
  for (let row = 0; row < state.rows - 1; row += 1) {
    for (let col = 0; col < state.cols; col += 1) {
      if (!state.vLines[row * state.cols + col]) moves.push({ orientation: 'v', row, col });
    }
  }
  return moves;
}

/** Boxes that would be completed by this move. */
function boxesCompletedBy(
  state: DotsAndBoxesState,
  move: { orientation: 'h' | 'v'; row: number; col: number },
): number[] {
  const completed: number[] = [];
  const { orientation, row, col } = move;

  if (orientation === 'h') {
    // Box above (row-1) and below (row).
    if (row > 0) {
      const idx = boxIndex(state, row - 1, col);
      if (
        state.boxes[idx] === null &&
        state.hLines[row * (state.cols - 1) + col] &&
        state.hLines[(row - 1) * (state.cols - 1) + col] &&
        state.vLines[(row - 1) * state.cols + col] &&
        state.vLines[(row - 1) * state.cols + col + 1]
      ) {
        completed.push(idx);
      }
    }
    if (row < state.rows - 1) {
      const idx = boxIndex(state, row, col);
      if (
        state.boxes[idx] === null &&
        state.hLines[row * (state.cols - 1) + col] &&
        state.hLines[(row + 1) * (state.cols - 1) + col] &&
        state.vLines[row * state.cols + col] &&
        state.vLines[row * state.cols + col + 1]
      ) {
        completed.push(idx);
      }
    }
    return completed;
  }

  // Vertical line: boxes to the left (col-1) and right (col).
  if (col > 0) {
    const idx = boxIndex(state, row, col - 1);
    if (
      state.boxes[idx] === null &&
      state.vLines[row * state.cols + col] &&
      state.vLines[row * state.cols + col - 1] &&
      state.hLines[row * (state.cols - 1) + col - 1] &&
      state.hLines[(row + 1) * (state.cols - 1) + col - 1]
    ) {
      completed.push(idx);
    }
  }
  if (col < state.cols - 1) {
    const idx = boxIndex(state, row, col);
    if (
      state.boxes[idx] === null &&
      state.vLines[row * state.cols + col] &&
      state.vLines[row * state.cols + col + 1] &&
      state.hLines[row * (state.cols - 1) + col] &&
      state.hLines[(row + 1) * (state.cols - 1) + col]
    ) {
      completed.push(idx);
    }
  }
  return completed;
}

/** How many lines a box already has (used for the "do not donate a box" heuristic). */
function boxLineCount(state: DotsAndBoxesState, index: number): number {
  const cols = state.cols;
  const row = Math.floor(index / (cols - 1));
  const col = index % (cols - 1);
  let count = 0;
  if (state.hLines[row * (cols - 1) + col]) count += 1;
  if (state.hLines[(row + 1) * (cols - 1) + col]) count += 1;
  if (state.vLines[row * cols + col]) count += 1;
  if (state.vLines[row * cols + col + 1]) count += 1;
  return count;
}

function affectedBoxes(
  state: DotsAndBoxesState,
  move: { orientation: 'h' | 'v'; row: number; col: number },
): number[] {
  const boxes: number[] = [];
  const { orientation, row, col } = move;
  if (orientation === 'h') {
    if (row > 0) boxes.push(boxIndex(state, row - 1, col));
    if (row < state.rows - 1) boxes.push(boxIndex(state, row, col));
  } else {
    if (col > 0) boxes.push(boxIndex(state, row, col - 1));
    if (col < state.cols - 1) boxes.push(boxIndex(state, row, col));
  }
  return boxes.filter((index) => state.boxes[index] === null);
}

/**
 * AI move selection.
 *  easy   → random legal move.
 *  medium → take a box when offered, otherwise avoid obvious donations.
 *  hard   → take the most boxes available; prefer safe moves; minimise damage.
 */
function chooseAIMove(
  state: DotsAndBoxesState,
  difficulty: AIDifficulty,
  ctx: GameContext,
): { orientation: 'h' | 'v'; row: number; col: number } | null {
  const moves = legalMoves(state);
  if (moves.length === 0) return null;

  if (difficulty === 'easy') {
    return moves[Math.floor(ctx.random() * moves.length)];
  }

  // 1) Immediate scoring moves.
  const scoring = moves
    .map((move) => ({ move, count: boxesCompletedBySimulated(state, move) }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count);
  if (scoring.length > 0) return scoring[0].move;

  // 2) Safe moves (do not create a 3-sided box for the opponent).
  const safe = moves.filter((move) =>
    affectedBoxes(state, move).every((index) => boxLineCount(state, index) <= 1),
  );
  if (safe.length > 0) {
    return safe[Math.floor(ctx.random() * safe.length)];
  }

  // 3) Minimise the number of boxes handed over.
  const scored = moves.map((move) => {
    const affected = affectedBoxes(state, move);
    const donation = affected.reduce(
      (worst, index) => Math.max(worst, boxLineCount(state, index) + 1),
      0,
    );
    return { move, donation };
  });
  const best = Math.min(...scored.map((entry) => entry.donation));
  const candidates = scored.filter((entry) => entry.donation === best);
  return candidates[Math.floor(ctx.random() * candidates.length)].move;
}

/** Simulates the move to see how many boxes it would complete. */
function boxesCompletedBySimulated(
  state: DotsAndBoxesState,
  move: { orientation: 'h' | 'v'; row: number; col: number },
): number {
  const hLines = [...state.hLines];
  const vLines = [...state.vLines];
  if (move.orientation === 'h') hLines[move.row * (state.cols - 1) + move.col] = true;
  else vLines[move.row * state.cols + move.col] = true;
  return boxesCompletedBy({ ...state, hLines, vLines }, move).length;
}

function advanceTurn(state: DotsAndBoxesState, players: readonly GamePlayerView[]): void {
  const order = state.turnOrder.filter((id) => players.some((player) => player.id === id));
  state.turnOrder = order.length > 0 ? order : players.map((player) => player.id);
  if (state.turnOrder.length === 0) return;
  const index = state.currentPlayerId ? state.turnOrder.indexOf(state.currentPlayerId) : -1;
  state.currentPlayerId = state.turnOrder[(index + 1) % state.turnOrder.length];
}

export const dotsAndBoxesGame: GameModule<DotsAndBoxesState> = {
  metadata: DOTS_AND_BOXES_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players, config): DotsAndBoxesState {
    const size = GRID_SIZE[config.gridSize ?? '6x6'] ?? 6;
    const cols = size;
    const rows = size;
    const totalBoxes = (cols - 1) * (rows - 1);
    return {
      cols,
      rows,
      hLines: new Array(rows * (cols - 1)).fill(false),
      vLines: new Array((rows - 1) * cols).fill(false),
      boxes: new Array(totalBoxes).fill(null),
      scores: Object.fromEntries(players.map((player) => [player.id, 0])),
      turnOrder: players.map((player) => player.id),
      currentPlayerId: players[0]?.id ?? null,
      phase: 'idle',
      moves: 0,
      totalBoxes,
      claimedBoxes: 0,
      lastMove: null,
      lastEvent: null,
    };
  },

  playerJoined(player, state): void {
    if (state.scores[player.id] === undefined) state.scores[player.id] = 0;
    if (!state.turnOrder.includes(player.id)) state.turnOrder.push(player.id);
  },

  playerReady(): void {
    // Lobby concern.
  },

  playerLeft(playerId, state, ctx): void {
    state.turnOrder = state.turnOrder.filter((id) => id !== playerId);
    if (state.currentPlayerId === playerId && state.phase === 'playing') {
      advanceTurn(state, ctx.players.filter((player) => player.id !== playerId));
    }
    if (ctx.players.filter((player) => player.isConnected).length < 2 && state.phase === 'playing') {
      ctx.finish('abandoned');
    }
  },

  start(state, ctx): void {
    state.phase = 'playing';
    if (!state.currentPlayerId || !state.turnOrder.includes(state.currentPlayerId)) {
      state.currentPlayerId = state.turnOrder[0] ?? null;
    }
    state.lastEvent = 'start';
    ctx.markStateChanged();
    scheduleAIIfNeeded(state, ctx);
  },

  validateAction(playerId, action, state): ValidationResult {
    if (action.type !== 'draw') return { valid: false, reason: 'Unknown action.' };
    if (state.phase !== 'playing') return { valid: false, reason: 'The match is not running.' };
    if (state.currentPlayerId !== playerId) return { valid: false, reason: 'It is not your turn.' };
    const orientation = action.payload?.orientation;
    const row = action.payload?.row;
    const col = action.payload?.col;
    if (orientation !== 'h' && orientation !== 'v') return { valid: false, reason: 'Invalid line.' };
    if (typeof row !== 'number' || typeof col !== 'number') return { valid: false, reason: 'Invalid line.' };
    if (orientation === 'h' && (row < 0 || row >= state.rows || col < 0 || col >= state.cols - 1)) {
      return { valid: false, reason: 'That line is off the board.' };
    }
    if (orientation === 'v' && (row < 0 || row >= state.rows - 1 || col < 0 || col >= state.cols)) {
      return { valid: false, reason: 'That line is off the board.' };
    }
    const index =
      orientation === 'h' ? row * (state.cols - 1) + col : row * state.cols + col;
    const taken = orientation === 'h' ? state.hLines[index] : state.vLines[index];
    if (taken) return { valid: false, reason: 'That line is already drawn.' };
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (action.type !== 'draw') return actionRejected('Unknown action.');
    const orientation = action.payload?.orientation === 'v' ? 'v' : 'h';
    const row = Number(action.payload?.row);
    const col = Number(action.payload?.col);

    if (orientation === 'h') state.hLines[row * (state.cols - 1) + col] = true;
    else state.vLines[row * state.cols + col] = true;

    state.moves += 1;
    state.lastMove = { orientation, row, col, playerId };

    const completed = boxesCompletedBy(state, { orientation, row, col });
    if (completed.length > 0) {
      for (const index of completed) state.boxes[index] = playerId;
      state.scores[playerId] = (state.scores[playerId] ?? 0) + completed.length;
      state.claimedBoxes += completed.length;
      state.lastEvent = `box:${playerId}:${completed.length}`;
    } else {
      state.lastEvent = `line:${playerId}`;
      advanceTurn(state, ctx.players);
    }

    ctx.markStateChanged();

    if (state.claimedBoxes >= state.totalBoxes) {
      state.phase = 'finished';
      ctx.markStateChanged();
      ctx.finish('completed');
      return actionAccepted();
    }

    scheduleAIIfNeeded(state, ctx);
    return actionAccepted();
  },

  update(): void {
    // Turn based.
  },

  tick(): void {
    // Turn based.
  },

  calculateScore(playerId, state): number {
    return state.scores[playerId] ?? 0;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    const entries = Object.entries(state.scores);
    if (entries.length === 0) return null;
    const best = Math.max(...entries.map(([, value]) => value));
    return entries.filter(([, value]) => value === best).map(([id]) => id);
  },

  checkDrawCondition(state): boolean {
    return (this.checkWinCondition(state)?.length ?? 0) > 1;
  },

  isGameFinished(state): boolean {
    return state.phase === 'finished';
  },

  finish(state): void {
    state.phase = 'finished';
  },

  getResult(state, ctx): GameResultDraft {
    const ranked = [...ctx.players].sort(
      (a, b) => (state.scores[b.id] ?? 0) - (state.scores[a.id] ?? 0),
    );
    const top = state.scores[ranked[0]?.id ?? ''] ?? 0;
    const winners = ranked.filter((player) => (state.scores[player.id] ?? 0) === top).map((player) => player.id);

    const rankings: RankingDraft[] = ranked.map((player, index) => ({
      playerId: player.id,
      rank: index + 1,
      score: state.scores[player.id] ?? 0,
      isWinner: winners.includes(player.id),
      isDraw: winners.length > 1,
      stats: {
        boxes: state.scores[player.id] ?? 0,
        share: Math.round(((state.scores[player.id] ?? 0) / Math.max(1, state.totalBoxes)) * 100),
      },
    }));

    return { winners, isDraw: winners.length > 1, rankings, reason: 'completed' };
  },

  reset(state): DotsAndBoxesState {
    const totalBoxes = (state.cols - 1) * (state.rows - 1);
    return {
      ...state,
      hLines: new Array(state.rows * (state.cols - 1)).fill(false),
      vLines: new Array((state.rows - 1) * state.cols).fill(false),
      boxes: new Array(totalBoxes).fill(null),
      scores: Object.fromEntries(Object.keys(state.scores).map((id) => [id, 0])),
      phase: 'idle',
      moves: 0,
      claimedBoxes: 0,
      lastMove: null,
      lastEvent: null,
    };
  },

  cleanup(state): void {
    state.hLines = [];
    state.vLines = [];
    state.boxes = [];
  },

  getPublicState(state, _viewerId, ctx) {
    return {
      cols: state.cols,
      rows: state.rows,
      hLines: [...state.hLines],
      vLines: [...state.vLines],
      boxes: [...state.boxes],
      scores: { ...state.scores },
      currentPlayerId: state.currentPlayerId,
      turnOrder: [...state.turnOrder],
      phase: state.phase,
      moves: state.moves,
      totalBoxes: state.totalBoxes,
      claimedBoxes: state.claimedBoxes,
      lastMove: state.lastMove,
      lastEvent: state.lastEvent,
      serverTime: ctx.now(),
    };
  },

  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing' || state.currentPlayerId !== playerId) return null;
    const move = chooseAIMove(state, difficulty, ctx);
    if (!move) return null;
    return { type: 'draw', payload: { orientation: move.orientation, row: move.row, col: move.col } };
  },

  maxDurationMs: 30 * 60 * 1000,
};

function scheduleAIIfNeeded(state: DotsAndBoxesState, ctx: GameContext): void {
  const current = ctx.players.find((player) => player.id === state.currentPlayerId);
  if (current?.isAI && state.phase === 'playing') {
    ctx.requestAI(current.id, 500 + Math.floor(ctx.random() * 900));
  }
}

export type { GameConfig };
