import type { AIDifficulty, GameAction, GameFinishReason } from '@2play/shared';
import { ROCK_PAPER_SCISSORS_METADATA } from '@2play/shared';
export { ROCK_PAPER_SCISSORS_METADATA };
import type {
  ActionResult,
  GameContext,
  GameModule,
  GameResultDraft,
  RankingDraft,
  ValidationResult,
} from '../GameModule';
import { actionAccepted, actionRejected } from '../GameModule';

/**
 * Rock Paper Scissors — simultaneous, hidden throws resolved by the server.
 *
 * Both players throw behind a countdown. Neither client is ever told what the
 * other threw until the server reveals the round, and nothing but the shape a
 * player tapped is accepted from them: the server owns the timer, the
 * resolution, the score, the winner and the final result.
 *
 * A round can never stall — if a player does not throw before the timer expires
 * they forfeit that round, and if neither throws it is scored as a draw.
 */

export const CHOICES = ['rock', 'paper', 'scissors'] as const;
export type RpsChoice = (typeof CHOICES)[number];

export type RpsPhase = 'idle' | 'countdown' | 'choose' | 'reveal' | 'finished';

/** What happened to one player in one round. */
export type RpsOutcome = 'win' | 'loss' | 'draw' | 'forfeit';

export const COUNTDOWN_MS = 3_000;
export const CHOOSE_MS = 8_000;
export const REVEAL_MS = 2_500;
export const DEFAULT_WINS_NEEDED = 3;
export const MIN_WINS_NEEDED = 1;
export const MAX_WINS_NEEDED = 7;

/** Rock beats scissors, scissors beat paper, paper beats rock. */
export const BEATS: Record<RpsChoice, RpsChoice> = {
  rock: 'scissors',
  scissors: 'paper',
  paper: 'rock',
};

export const CHOICE_EMOJI: Record<RpsChoice, string> = {
  rock: '🪨',
  paper: '📄',
  scissors: '✂️',
};

/** One completed round, kept for the match log and for AI adaptation. */
export interface RoundRecord {
  round: number;
  choices: Record<string, RpsChoice | null>;
  outcomes: Record<string, RpsOutcome>;
  /** Players who let the timer expire. */
  forfeits: string[];
}

export interface RpsPlayerState {
  /** SERVER ONLY while the round is live — never projected before the reveal. */
  choice: RpsChoice | null;
  lockedAt: number | null;
  /** Rounds won. */
  score: number;
  draws: number;
  forfeits: number;
  disconnected: boolean;
  left: boolean;
}

export interface RpsState {
  phase: RpsPhase;
  /** 0-based index of the round currently being played. */
  round: number;
  winsNeeded: number;
  maxRounds: number;
  countdownUntil: number | null;
  chooseUntil: number | null;
  players: Record<string, RpsPlayerState>;
  /** Seat order, so rounds and rankings are stable. */
  seatOrder: string[];
  /** The round being revealed; null outside the reveal phase. */
  roundResult: RoundRecord | null;
  history: RoundRecord[];
  startedAt: number | null;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
}

/* ------------------------------------------------------------------ */
/* Rules                                                               */
/* ------------------------------------------------------------------ */

export function isRpsChoice(value: unknown): value is RpsChoice {
  return typeof value === 'string' && (CHOICES as readonly string[]).includes(value);
}

/**
 * Compares two throws: 1 if `a` wins, -1 if `b` wins, 0 for a draw.
 * Exported so the rule table can be tested directly.
 */
export function compareChoices(a: RpsChoice, b: RpsChoice): 1 | 0 | -1 {
  if (a === b) return 0;
  return BEATS[a] === b ? 1 : -1;
}

/** The throw that beats `choice`. */
export function counterOf(choice: RpsChoice): RpsChoice {
  return (CHOICES.find((candidate) => BEATS[candidate] === choice) ?? 'rock') as RpsChoice;
}

/**
 * Judges one round for the two seats.
 *
 * A missing throw forfeits the round to the opponent; if neither player threw
 * the round is a draw, so a stalled round can never award a free win.
 */
export function judgeRound(
  mine: RpsChoice | null,
  theirs: RpsChoice | null,
): { mine: RpsOutcome; theirs: RpsOutcome } {
  if (mine === null && theirs === null) return { mine: 'draw', theirs: 'draw' };
  if (mine === null) return { mine: 'forfeit', theirs: 'win' };
  if (theirs === null) return { mine: 'win', theirs: 'forfeit' };
  const result = compareChoices(mine, theirs);
  if (result === 0) return { mine: 'draw', theirs: 'draw' };
  return result === 1 ? { mine: 'win', theirs: 'loss' } : { mine: 'loss', theirs: 'win' };
}

/* ------------------------------------------------------------------ */
/* AI                                                                  */
/* ------------------------------------------------------------------ */

/**
 * Predicts an opponent's next throw from ALREADY REVEALED history only.
 *
 * `strength` is the chance the bot acts on its prediction instead of throwing
 * at random, which is what keeps it beatable: easy never predicts, medium is
 * right about half the time, hard most of the time but never certain.
 *
 * Deliberately takes no game state — only the opponent's public history — so it
 * is structurally impossible for a bot to read the throw the opponent has just
 * locked this round.
 */
export function pickAiChoice(
  opponentHistory: readonly RpsChoice[],
  difficulty: AIDifficulty,
  random: () => number,
): RpsChoice {
  const randomChoice = (): RpsChoice => CHOICES[Math.floor(random() * CHOICES.length)] as RpsChoice;

  if (difficulty === 'easy' || opponentHistory.length === 0) return randomChoice();

  const strength = difficulty === 'hard' ? 0.78 : 0.55;
  if (random() >= strength) return randomChoice();

  // Weight recent throws more heavily: a player who has just thrown rock twice
  // is more likely to be in a rock habit than one who threw it six rounds ago.
  const weights: Record<RpsChoice, number> = { rock: 0, paper: 0, scissors: 0 };
  opponentHistory.forEach((choice, index) => {
    weights[choice] += 1 + index / Math.max(1, opponentHistory.length);
  });

  let predicted = CHOICES[0] as RpsChoice;
  for (const choice of CHOICES) {
    if (weights[choice] > weights[predicted]) predicted = choice;
  }

  // On hard, break ties toward the opponent's most recent throw — the strongest
  // signal available — rather than always favouring rock.
  if (difficulty === 'hard') {
    const last = opponentHistory[opponentHistory.length - 1];
    const tied = CHOICES.filter((choice) => Math.abs(weights[choice] - weights[predicted]) < 1e-9);
    if (last && tied.length > 1 && tied.includes(last)) predicted = last;
  }

  return counterOf(predicted);
}

/* ------------------------------------------------------------------ */
/* Round flow                                                          */
/* ------------------------------------------------------------------ */

function makePlayer(): RpsPlayerState {
  return {
    choice: null,
    lockedAt: null,
    score: 0,
    draws: 0,
    forfeits: 0,
    disconnected: false,
    left: false,
  };
}

/** Players still in the match (a disconnected player is still in it). */
function activeEntries(state: RpsState): Array<[string, RpsPlayerState]> {
  return Object.entries(state.players).filter(([, player]) => !player.left);
}

/** Revealed throws for one player, oldest first. Public information. */
function revealedHistory(state: RpsState, playerId: string): RpsChoice[] {
  return state.history
    .map((record) => record.choices[playerId] ?? null)
    .filter((choice): choice is RpsChoice => choice !== null);
}

export function finishRps(state: RpsState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.countdownUntil = null;
  state.chooseUntil = null;
  state.finishReason = reason;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

/** Starts the 3-2-1-GO countdown for the current round. */
export function beginCountdown(state: RpsState, ctx: GameContext): void {
  if (state.phase === 'finished') return;
  state.phase = 'countdown';
  state.roundResult = null;
  for (const player of Object.values(state.players)) {
    player.choice = null;
    player.lockedAt = null;
  }
  state.countdownUntil = ctx.now() + COUNTDOWN_MS;
  state.chooseUntil = null;
  state.lastEvent = `countdown:${state.round}`;
  ctx.markStateChanged();
  ctx.schedule(COUNTDOWN_MS, () => beginChoose(state, ctx), 'turn', `countdown-${state.round}`);
}

/** Opens the throw window and asks the bots to throw. */
export function beginChoose(state: RpsState, ctx: GameContext): void {
  if (state.phase !== 'countdown') return;
  state.phase = 'choose';
  state.countdownUntil = null;
  state.chooseUntil = ctx.now() + CHOOSE_MS;
  state.lastEvent = `go:${state.round}`;
  ctx.markStateChanged();

  // Resolving on the timer is what guarantees the round cannot stall.
  ctx.schedule(CHOOSE_MS, () => resolveRound(state, ctx), 'turn', `choose-${state.round}`);

  for (const player of ctx.players) {
    if (player.isAI && !state.players[player.id]?.left) {
      // A short, varied "thinking" delay so the reveal does not feel instant.
      ctx.requestAI(player.id, 400 + Math.floor(ctx.random() * 1_600));
    }
  }
}

/** Scores the round and reveals both throws at the same time. */
export function resolveRound(state: RpsState, ctx: GameContext): void {
  if (state.phase !== 'choose') return;

  const seats = state.seatOrder.filter((id) => state.players[id] && !state.players[id]!.left);
  const choices: Record<string, RpsChoice | null> = {};
  const outcomes: Record<string, RpsOutcome> = {};
  const forfeits: string[] = [];

  for (const id of seats) {
    choices[id] = state.players[id]!.choice;
    if (state.players[id]!.choice === null) forfeits.push(id);
  }

  if (seats.length >= 2) {
    const [a, b] = [seats[0]!, seats[1]!];
    const judged = judgeRound(choices[a] ?? null, choices[b] ?? null);
    outcomes[a] = judged.mine;
    outcomes[b] = judged.theirs;

    const playerA = state.players[a]!;
    const playerB = state.players[b]!;
    if (judged.mine === 'win') playerA.score += 1;
    if (judged.theirs === 'win') playerB.score += 1;
    if (judged.mine === 'draw') playerA.draws += 1;
    if (judged.theirs === 'draw') playerB.draws += 1;
    if (judged.mine === 'forfeit') playerA.forfeits += 1;
    if (judged.theirs === 'forfeit') playerB.forfeits += 1;
  } else {
    // Only one seat left: the platform finishes the match, do not invent a win.
    for (const id of seats) outcomes[id] = 'draw';
  }

  const record: RoundRecord = { round: state.round, choices, outcomes, forfeits };
  state.history.push(record);
  state.roundResult = record;
  state.phase = 'reveal';
  state.chooseUntil = null;
  state.lastEvent = `reveal:${state.round}`;
  ctx.markStateChanged();

  ctx.schedule(
    REVEAL_MS,
    () => {
      if (state.phase !== 'reveal') return;
      advanceAfterReveal(state, ctx);
    },
    'turn',
    `reveal-${state.round}`,
  );
}

/** Decides whether the match is over, otherwise starts the next round. */
export function advanceAfterReveal(state: RpsState, ctx: GameContext): void {
  const seats = activeEntries(state);
  const leader = seats.reduce(
    (best, [, player]) => Math.max(best, player.score),
    0,
  );

  if (leader >= state.winsNeeded) {
    finishRps(state, ctx, 'completed');
    return;
  }
  if (state.round + 1 >= state.maxRounds) {
    // Round cap reached: the platform reports a draw when the scores are level.
    finishRps(state, ctx, 'completed');
    return;
  }
  if (seats.length < 2) {
    finishRps(state, ctx, 'abandoned');
    return;
  }

  state.round += 1;
  beginCountdown(state, ctx);
}

/* ------------------------------------------------------------------ */
/* Action validation                                                   */
/* ------------------------------------------------------------------ */

/**
 * The single source of truth for what a client is allowed to do.
 *
 * A client may express exactly one intent: "I throw this shape, now". Everything
 * else — asserting a score, a winner, a round result, a reveal, or throwing
 * outside the window, twice, or for a seat that is not theirs — is refused.
 */
export function validateThrow(playerId: string, action: GameAction, state: RpsState): ValidationResult {
  if (['score', 'win', 'lose', 'draw', 'finish', 'result', 'reveal', 'round', 'choice'].includes(action.type)) {
    return { valid: false, reason: 'The server owns the result.' };
  }
  if (action.type !== 'throw') return { valid: false, reason: 'Unknown action.' };
  if (state.phase !== 'choose') {
    return {
      valid: false,
      reason: state.phase === 'countdown' ? 'Wait for GO.' : 'That round is closed.',
    };
  }
  const player = state.players[playerId];
  if (!player || player.left) return { valid: false, reason: 'You are not in this match.' };
  // Locked means locked: no second throw and no changing your mind.
  if (player.choice !== null) return { valid: false, reason: 'Your throw is already locked in.' };
  if (!isRpsChoice(action.payload?.choice)) {
    return { valid: false, reason: 'Throw rock, paper or scissors.' };
  }
  return { valid: true };
}

/* ------------------------------------------------------------------ */
/* Module                                                              */
/* ------------------------------------------------------------------ */

export const rockPaperScissorsGame: GameModule<RpsState> = {
  metadata: ROCK_PAPER_SCISSORS_METADATA,

  initialize(): void {
    // Stateless module: all rules are pure functions of the state.
  },

  createInitialState(players, config): RpsState {
    const winsNeeded = Math.min(
      MAX_WINS_NEEDED,
      Math.max(MIN_WINS_NEEDED, Math.round(config.rounds ?? DEFAULT_WINS_NEEDED)),
    );
    return {
      phase: 'idle',
      round: 0,
      winsNeeded,
      // Enough headroom for draws without letting a match run forever.
      maxRounds: Math.max(3, winsNeeded * 4),
      countdownUntil: null,
      chooseUntil: null,
      players: Object.fromEntries(players.map((player) => [player.id, makePlayer()])),
      seatOrder: players.map((player) => player.id),
      roundResult: null,
      history: [],
      startedAt: null,
      finishReason: null,
      lastEvent: null,
    };
  },

  playerJoined(player, state): void {
    const existing = state.players[player.id];
    if (existing) {
      existing.disconnected = false;
      existing.left = false;
      return;
    }
    state.players[player.id] = makePlayer();
    if (!state.seatOrder.includes(player.id)) state.seatOrder.push(player.id);
  },

  playerReady(): void {
    // Lobby concern.
  },

  playerLeft(playerId, state, ctx, reason): void {
    const player = state.players[playerId];
    if (!player) return;
    if (reason === 'disconnect') {
      player.disconnected = true;
      // A disconnected player simply does not throw; the round timer resolves
      // it, so the match keeps moving and they can still reconnect.
      ctx.markStateChanged();
      return;
    }
    player.left = true;
    if (activeEntries(state).length < 2) finishRps(state, ctx, 'abandoned');
    else if (state.phase === 'choose') {
      // Everyone remaining has thrown: resolve now instead of waiting it out.
      const remaining = activeEntries(state);
      if (remaining.every(([, entry]) => entry.choice !== null)) resolveRound(state, ctx);
      else ctx.markStateChanged();
    } else {
      ctx.markStateChanged();
    }
  },

  start(state, ctx): void {
    if (state.phase === 'countdown' || state.phase === 'choose') return;
    state.players = {};
    state.seatOrder = ctx.players.map((player) => player.id);
    for (const player of ctx.players) state.players[player.id] = makePlayer();
    state.round = 0;
    state.history = [];
    state.roundResult = null;
    state.startedAt = ctx.now();
    state.finishReason = null;

    beginCountdown(state, ctx);

    // Hard backstop so a match can never outlive its rounds.
    ctx.schedule(
      state.maxRounds * (COUNTDOWN_MS + CHOOSE_MS + REVEAL_MS) + 5_000,
      () => finishRps(state, ctx, 'timeout'),
      'gameDuration',
      'match-timeout',
    );
  },

  validateAction(playerId, action, state): ValidationResult {
    return validateThrow(playerId, action, state);
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    // Re-checked here rather than trusting validateAction: this is the path that
    // mutates authoritative state.
    const validation = validateThrow(playerId, action, state);
    if (!validation.valid) return actionRejected(validation.reason);

    const player = state.players[playerId]!;
    player.choice = action.payload!.choice as RpsChoice;
    player.lockedAt = ctx.now();
    state.lastEvent = `locked:${playerId}`;
    ctx.markStateChanged();

    // Both throws in early: reveal now rather than making players wait it out.
    const seats = activeEntries(state);
    if (seats.length >= 2 && seats.every(([, entry]) => entry.choice !== null)) {
      resolveRound(state, ctx);
    }
    return actionAccepted();
  },

  update(): void {
    // Timer driven; no per-frame simulation.
  },

  tick(): void {
    // Timer driven.
  },

  calculateScore(playerId, state): number {
    return state.players[playerId]?.score ?? 0;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    const seats = activeEntries(state);
    if (seats.length === 0) return [];
    const best = Math.max(...seats.map(([, player]) => player.score));
    if (best === 0) return [];
    return seats.filter(([, player]) => player.score === best).map(([id]) => id);
  },

  checkDrawCondition(state): boolean {
    const winners = this.checkWinCondition(state);
    return winners !== null && winners.length !== 1;
  },

  isGameFinished(state): boolean {
    return state.phase === 'finished';
  },

  finish(state): void {
    state.phase = 'finished';
    state.countdownUntil = null;
    state.chooseUntil = null;
  },

  getResult(state, ctx): GameResultDraft {
    const ranked = [...ctx.players].sort(
      (a, b) => (state.players[b.id]?.score ?? 0) - (state.players[a.id]?.score ?? 0),
    );
    const best = ranked[0] ? state.players[ranked[0].id]?.score ?? 0 : 0;
    const winners = ranked
      .filter((player) => (state.players[player.id]?.score ?? 0) === best)
      .map((player) => player.id);
    const isDraw = winners.length !== 1;

    const rankings: RankingDraft[] = ranked.map((player, index) => {
      const entry = state.players[player.id];
      return {
        playerId: player.id,
        rank: index + 1,
        score: entry?.score ?? 0,
        isWinner: winners.length === 1 && winners.includes(player.id),
        isDraw,
        stats: {
          roundsWon: entry?.score ?? 0,
          draws: entry?.draws ?? 0,
          forfeits: entry?.forfeits ?? 0,
        },
      };
    });

    return { winners, isDraw, rankings, reason: state.finishReason ?? 'completed' };
  },

  reset(state): RpsState {
    const ids = state.seatOrder.length > 0 ? state.seatOrder : Object.keys(state.players);
    return {
      ...state,
      phase: 'idle',
      round: 0,
      countdownUntil: null,
      chooseUntil: null,
      players: Object.fromEntries(ids.map((id) => [id, makePlayer()])),
      seatOrder: [...ids],
      roundResult: null,
      history: [],
      startedAt: null,
      finishReason: null,
      lastEvent: null,
    };
  },

  cleanup(state): void {
    state.players = {};
    state.roundResult = null;
    state.history = [];
    state.phase = 'finished';
  },

  /**
   * Per-viewer projection.
   *
   * CRITICAL: while a round is live the only thing a viewer learns about the
   * opponent is WHETHER they have thrown — never what they threw. The shapes
   * are released to both players simultaneously, at the reveal.
   */
  getPublicState(state, viewerId, ctx) {
    const revealed = state.phase === 'reveal' || state.phase === 'finished';
    const now = ctx.now();

    return {
      phase: state.phase,
      round: state.round,
      winsNeeded: state.winsNeeded,
      maxRounds: state.maxRounds,
      countdownUntil: state.countdownUntil,
      chooseUntil: state.chooseUntil,
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: now,
      // The viewer's own locked throw, so their UI can show the locked state.
      myChoice: viewerId ? state.players[viewerId]?.choice ?? null : null,
      // Opponents: presence only until the reveal.
      opponents: Object.fromEntries(
        Object.entries(state.players)
          .filter(([id]) => id !== viewerId)
          .map(([id, player]) => [
            id,
            {
              score: player.score,
              draws: player.draws,
              forfeits: player.forfeits,
              hasThrown: player.choice !== null,
              disconnected: player.disconnected,
              left: player.left,
              choice: revealed ? player.choice : null,
            },
          ]),
      ),
      me: viewerId
        ? {
            score: state.players[viewerId]?.score ?? 0,
            draws: state.players[viewerId]?.draws ?? 0,
            forfeits: state.players[viewerId]?.forfeits ?? 0,
            disconnected: state.players[viewerId]?.disconnected ?? false,
          }
        : null,
      seatOrder: [...state.seatOrder],
      // The revealed round, and only the revealed round.
      roundResult: revealed ? state.roundResult : null,
      // Past rounds are public: both players watched them being revealed.
      history: state.history.map((record) => ({
        round: record.round,
        choices: { ...record.choices },
        outcomes: { ...record.outcomes },
        forfeits: [...record.forfeits],
      })),
    };
  },

  /**
   * Throws for a bot.
   *
   * Only ever reads the opponent's ALREADY REVEALED history, never the throw
   * they have locked this round — so a bot cannot cheat by peeking at state it
   * would not be allowed to see. Difficulty scales the chance it acts on its
   * prediction, which keeps hard strong but beatable.
   */
  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'choose') return null;
    const me = state.players[playerId];
    if (!me || me.left || me.choice !== null) return null;

    const opponentId = state.seatOrder.find((id) => id !== playerId && state.players[id] && !state.players[id]!.left);
    if (!opponentId) return null;

    const history = revealedHistory(state, opponentId);
    const choice = pickAiChoice(history, difficulty, ctx.random);
    return { type: 'throw', payload: { choice } };
  },

  maxDurationMs: 8 * 60 * 1000,
};
