import type { AIDifficulty, GameAction, GameConfig, GameFinishReason } from '@2play/shared';
import { UNO_METADATA } from '@2play/shared';
export { UNO_METADATA };
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
import {
  buildDeck,
  cardPoints,
  handPoints,
  isColor,
  isPlayable,
  isWild,
  shuffle,
  UNO_COLORS,
  type UnoCard,
  type UnoColor,
} from './deck';

export * from './deck';

/**
 * UNO — original implementation of the classic shedding card game.
 *
 * THE RULESET (one consistent set, documented in How To Play):
 *  - Each player is dealt 7 cards. The first non-wild card starts the discard.
 *  - Play a card matching the ACTIVE COLOUR or the top card's VALUE, or a wild.
 *  - No legal card? Draw exactly ONE card. If it is playable you may play it
 *    immediately; otherwise your turn ends.
 *  - NO STACKING. A draw-two / draw-four cannot be countered by another one:
 *    the next player draws and loses their turn.
 *  - Wild Draw Four may be played at any time (the "no other colour" challenge
 *    rule is NOT implemented, and no challenge action exists).
 *  - Reverse with 2 players acts as a Skip (the player plays again).
 *  - Reaching one card sets an UNO flag automatically — there is no call
 *    action and therefore no penalty. This is deliberate and documented.
 *  - Round ends when a hand is empty; the winner scores the total value of
 *    every opponent's remaining cards. First to the target score wins.
 *
 * The server owns the deck, the shuffle, every hand, and all legality.
 * A client only ever sends a card id it already holds.
 */

export type UnoPhase = 'idle' | 'playing' | 'round-over' | 'finished';

export interface UnoPlayerSlot {
  hand: UnoCard[];
  score: number;
  roundsWon: number;
  cardsPlayed: number;
  /** True while the player is down to a single card. */
  uno: boolean;
  disconnected: boolean;
  left: boolean;
}

export interface UnoState {
  phase: UnoPhase;
  round: number;
  totalRounds: number;
  targetScore: number;
  /** SERVER ONLY — face-down draw pile, never projected. */
  drawPile: UnoCard[];
  /** Discard pile; only the top card is public. */
  discardPile: UnoCard[];
  /** Colour currently in force (a wild sets this explicitly). */
  activeColor: UnoColor;
  players: Record<string, UnoPlayerSlot>;
  turnOrder: string[];
  currentPlayerId: string | null;
  /** 1 = forward through turnOrder, -1 = reversed. */
  direction: 1 | -1;
  /** Cards the next player must draw before playing (never stacks). */
  pendingDraw: number;
  /** The player has drawn this turn and may only play that card or pass. */
  drawnCardId: string | null;
  turnEndsAt: number | null;
  turnMs: number;
  roundWinnerId: string | null;
  matchWinnerId: string | null;
  lastEvent: string | null;
  lastPlayed: { cardId: string; playerId: string } | null;
  finishReason: GameFinishReason | null;
}

/* ------------------------------------------------------------------ */
/* Tunables                                                            */
/* ------------------------------------------------------------------ */

export const STARTING_HAND = 7;
export const TURN_MS = 30_000;
export const DEFAULT_TARGET_SCORE = 200;
export const MAX_ROUNDS = 10;

const AI_DELAY: Record<AIDifficulty, number> = { easy: 1_100, medium: 800, hard: 550 };

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function topCard(state: UnoState): UnoCard | undefined {
  return state.discardPile[state.discardPile.length - 1];
}

function activePlayers(state: UnoState): Array<[string, UnoPlayerSlot]> {
  return Object.entries(state.players).filter(([, slot]) => !slot.left);
}

function seatsInPlay(state: UnoState, ctx: GameContext): string[] {
  return state.turnOrder.filter((id) => {
    const slot = state.players[id];
    return Boolean(slot) && !slot!.left && ctx.players.some((entry) => entry.id === id);
  });
}

/** The seat `steps` positions away from `fromId`, honouring direction. */
export function seatAfter(state: UnoState, fromId: string | null, steps = 1): string | null {
  const order = state.turnOrder.filter((id) => !state.players[id]?.left);
  if (order.length === 0) return null;
  const index = fromId ? order.indexOf(fromId) : -1;
  const next = (index + steps * state.direction + order.length * 8) % order.length;
  return order[next] ?? null;
}

/**
 * Draws `count` cards for a player, reshuffling the discard pile back into the
 * draw pile when it runs out. The active top card is always kept aside.
 */
export function drawCards(state: UnoState, ctx: GameContext, playerId: string, count: number): UnoCard[] {
  const slot = state.players[playerId];
  if (!slot) return [];
  const drawn: UnoCard[] = [];

  for (let i = 0; i < count; i += 1) {
    if (state.drawPile.length === 0) {
      // Reshuffle: everything below the active top card becomes the new pile.
      const top = state.discardPile.pop();
      const recycled = state.discardPile.splice(0, state.discardPile.length);
      if (top) state.discardPile.push(top);
      if (recycled.length === 0) break; // genuinely out of cards
      // A wild returns to the pile colourless so it can be re-chosen.
      state.drawPile = shuffle(
        recycled.map((card) => (isWild(card) ? { ...card, color: 'wild' as const } : card)),
        ctx.random,
      );
    }
    const card = state.drawPile.pop();
    if (!card) break;
    slot.hand.push(card);
    drawn.push(card);
  }
  slot.uno = slot.hand.length === 1;
  return drawn;
}

export function finishUno(state: UnoState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.currentPlayerId = null;
  state.turnEndsAt = null;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

/** Arms the turn timer. A missed turn draws one card and passes play on. */
export function beginTurn(state: UnoState, ctx: GameContext, playerId: string): void {
  if (state.phase !== 'playing') return;
  state.currentPlayerId = playerId;
  state.drawnCardId = null;
  state.turnEndsAt = ctx.now() + state.turnMs;
  ctx.markStateChanged();

  ctx.schedule(
    state.turnMs,
    () => {
      if (state.phase !== 'playing' || state.currentPlayerId !== playerId) return;
      drawCards(state, ctx, playerId, 1);
      state.lastEvent = `timeout:${playerId}`;
      advanceTurn(state, ctx);
    },
    'turn',
    'turn-timeout',
  );

  const view = ctx.players.find((entry) => entry.id === playerId);
  if (view?.isAI) ctx.requestAI(playerId, AI_DELAY[view.aiDifficulty ?? 'medium']);
}

/** Moves play on, applying any pending draw to the incoming player. */
export function advanceTurn(state: UnoState, ctx: GameContext, skip = false): void {
  if (state.phase !== 'playing') return;
  const seats = seatsInPlay(state, ctx);
  if (seats.length === 0) {
    finishUno(state, ctx, 'abandoned');
    return;
  }

  let next = seatAfter(state, state.currentPlayerId, 1);
  if (!next) {
    finishUno(state, ctx, 'abandoned');
    return;
  }

  // A pending draw hits the incoming player, who then loses their turn.
  if (state.pendingDraw > 0) {
    drawCards(state, ctx, next, state.pendingDraw);
    state.lastEvent = `forced-draw:${next}:${state.pendingDraw}`;
    state.pendingDraw = 0;
    const after = seatAfter(state, next, 1);
    if (after) next = after;
  } else if (skip) {
    // Skip / two-player reverse.
    const after = seatAfter(state, next, 1);
    if (after) next = after;
  }

  beginTurn(state, ctx, next);
}

/** Ends the round, scores it, then starts the next round or finishes. */
export function endRound(state: UnoState, ctx: GameContext, winnerId: string): void {
  if (state.phase !== 'playing') return;
  const winner = state.players[winnerId];
  if (!winner) return;

  // The winner scores the total value of every opponent's remaining cards.
  let gained = 0;
  for (const [id, slot] of activePlayers(state)) {
    if (id === winnerId) continue;
    gained += handPoints(slot.hand);
  }
  winner.score += gained;
  winner.roundsWon += 1;
  state.roundWinnerId = winnerId;
  state.phase = 'round-over';
  state.currentPlayerId = null;
  state.turnEndsAt = null;
  state.lastEvent = `round-win:${winnerId}:${gained}`;
  ctx.markStateChanged();

  const reachedTarget = winner.score >= state.targetScore;
  const lastRound = state.round + 1 >= state.totalRounds;
  if (reachedTarget || lastRound) {
    state.matchWinnerId = decideMatchWinner(state);
    finishUno(state, ctx, 'completed');
    return;
  }

  ctx.schedule(
    4_000,
    () => {
      if (state.phase !== 'round-over') return;
      state.round += 1;
      dealRound(state, ctx);
    },
    'turn',
    `round-${state.round}`,
  );
}

function decideMatchWinner(state: UnoState): string | null {
  const entries = activePlayers(state);
  if (entries.length === 0) return null;
  const best = Math.max(...entries.map(([, slot]) => slot.score));
  const leaders = entries.filter(([, slot]) => slot.score === best);
  return leaders.length === 1 ? (leaders[0]?.[0] ?? null) : null;
}

/** Shuffles a fresh deck, deals hands and opens the discard pile. */
export function dealRound(state: UnoState, ctx: GameContext): void {
  const deck = shuffle(buildDeck(), ctx.random);
  state.drawPile = deck;
  state.discardPile = [];
  state.pendingDraw = 0;
  state.drawnCardId = null;
  state.roundWinnerId = null;

  for (const [, slot] of activePlayers(state)) {
    slot.hand = [];
    slot.uno = false;
  }
  for (let i = 0; i < STARTING_HAND; i += 1) {
    for (const [id] of activePlayers(state)) {
      const card = state.drawPile.pop();
      if (card) state.players[id]?.hand.push(card);
    }
  }

  // The opening discard must not be a wild — otherwise no colour is in force.
  let opener = state.drawPile.pop();
  const buried: UnoCard[] = [];
  while (opener && isWild(opener)) {
    buried.push(opener);
    opener = state.drawPile.pop();
  }
  if (!opener) {
    finishUno(state, ctx, 'abandoned');
    return;
  }
  state.drawPile.unshift(...buried);
  state.discardPile.push(opener);
  state.activeColor = opener.color === 'wild' ? 'red' : opener.color;

  state.phase = 'playing';
  state.direction = 1;
  state.lastPlayed = null;
  state.lastEvent = `deal:${state.round}`;
  ctx.markStateChanged();

  const first = state.turnOrder.find((id) => !state.players[id]?.left) ?? state.turnOrder[0];
  if (!first) {
    finishUno(state, ctx, 'abandoned');
    return;
  }

  // The opening card's effect applies to the first player.
  if (opener.value === 'skip') {
    const after = seatAfter(state, first, 1);
    beginTurn(state, ctx, after ?? first);
    return;
  }
  if (opener.value === 'reverse') {
    state.direction = -1;
    const after = seatAfter(state, first, 1);
    beginTurn(state, ctx, activePlayers(state).length === 2 ? first : (after ?? first));
    return;
  }
  if (opener.value === 'draw-two') {
    drawCards(state, ctx, first, 2);
    const after = seatAfter(state, first, 1);
    beginTurn(state, ctx, after ?? first);
    return;
  }
  beginTurn(state, ctx, first);
}

function makeSlot(): UnoPlayerSlot {
  return {
    hand: [],
    score: 0,
    roundsWon: 0,
    cardsPlayed: 0,
    uno: false,
    disconnected: false,
    left: false,
  };
}

function resolveRounds(config: GameConfig): number {
  if (typeof config.rounds === 'number' && Number.isFinite(config.rounds)) {
    return Math.min(MAX_ROUNDS, Math.max(1, Math.round(config.rounds)));
  }
  return 3;
}

/* ------------------------------------------------------------------ */
/* Module                                                              */
/* ------------------------------------------------------------------ */

export const unoGame: GameModule<UnoState> = {
  metadata: UNO_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players: readonly GamePlayerView[], config: GameConfig): UnoState {
    const state: UnoState = {
      phase: 'idle',
      round: 0,
      totalRounds: resolveRounds(config),
      targetScore: DEFAULT_TARGET_SCORE,
      drawPile: [],
      discardPile: [],
      activeColor: 'red',
      players: {},
      turnOrder: players.map((player) => player.id),
      currentPlayerId: null,
      direction: 1,
      pendingDraw: 0,
      drawnCardId: null,
      turnEndsAt: null,
      turnMs: TURN_MS,
      roundWinnerId: null,
      matchWinnerId: null,
      lastEvent: null,
      lastPlayed: null,
      finishReason: null,
    };
    for (const player of players) state.players[player.id] = makeSlot();
    return state;
  },

  playerJoined(player, state): void {
    const existing = state.players[player.id];
    if (existing) {
      // Reconnection keeps the same hand and score.
      existing.disconnected = false;
      return;
    }
    state.players[player.id] = makeSlot();
    if (!state.turnOrder.includes(player.id)) state.turnOrder.push(player.id);
  },

  playerReady(): void {
    // Lobby concern.
  },

  playerLeft(playerId, state, ctx, reason): void {
    const slot = state.players[playerId];
    if (!slot) return;
    if (reason === 'disconnect') {
      slot.disconnected = true;
      if (state.currentPlayerId === playerId && state.phase === 'playing') advanceTurn(state, ctx);
      return;
    }
    slot.left = true;
    if (activePlayers(state).length < 2) {
      const remaining = activePlayers(state)[0];
      state.matchWinnerId = remaining?.[0] ?? null;
      finishUno(state, ctx, 'abandoned');
      return;
    }
    if (state.currentPlayerId === playerId && state.phase === 'playing') advanceTurn(state, ctx);
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    state.players = {};
    state.turnOrder = ctx.players.map((player) => player.id);
    for (const player of ctx.players) state.players[player.id] = makeSlot();
    state.round = 0;
    state.matchWinnerId = null;
    state.finishReason = null;
    dealRound(state, ctx);
  },

  validateAction(playerId, action, state): ValidationResult {
    // A client may never assert an outcome or invent randomness.
    if (['score', 'win', 'finish', 'complete', 'deck', 'draw-card', 'setHand'].includes(action.type)) {
      return { valid: false, reason: 'The server owns the deck and the score.' };
    }
    if (state.phase !== 'playing') return { valid: false, reason: 'No round is live.' };

    const slot = state.players[playerId];
    if (!slot || slot.left) return { valid: false, reason: 'You are not in this game.' };
    if (slot.disconnected) return { valid: false, reason: 'Reconnect to keep playing.' };
    if (state.currentPlayerId !== playerId) return { valid: false, reason: 'It is not your turn.' };

    if (action.type === 'draw') {
      if (state.drawnCardId) return { valid: false, reason: 'You already drew this turn.' };
      return { valid: true };
    }
    if (action.type === 'pass') {
      // Passing is only legal after drawing an unplayable card.
      if (!state.drawnCardId) return { valid: false, reason: 'Draw a card before passing.' };
      return { valid: true };
    }
    if (action.type !== 'play') return { valid: false, reason: 'Unknown action.' };

    const cardId = action.payload?.cardId;
    if (typeof cardId !== 'string') return { valid: false, reason: 'Pick a card.' };
    // Ownership: the card must be in THIS player's hand.
    const card = slot.hand.find((entry) => entry.id === cardId);
    if (!card) return { valid: false, reason: 'That card is not in your hand.' };
    // After drawing you may only play the card you just drew.
    if (state.drawnCardId && state.drawnCardId !== cardId) {
      return { valid: false, reason: 'You may only play the card you just drew.' };
    }

    const top = topCard(state);
    if (!top) return { valid: false, reason: 'The discard pile is empty.' };
    if (!isPlayable(card, top, state.activeColor)) {
      return { valid: false, reason: 'That card does not match the colour or value.' };
    }
    if (isWild(card)) {
      const chosen = action.payload?.color;
      if (!isColor(chosen)) return { valid: false, reason: 'Choose red, yellow, green or blue.' };
    }
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (state.phase !== 'playing') return actionRejected('No round is live.');
    const slot = state.players[playerId];
    if (!slot || slot.left || slot.disconnected) return actionRejected('You cannot act.');
    if (state.currentPlayerId !== playerId) return actionRejected('It is not your turn.');

    /* ---------------- draw ---------------- */
    if (action.type === 'draw') {
      if (state.drawnCardId) return actionRejected('You already drew this turn.');
      const drawn = drawCards(state, ctx, playerId, 1);
      const card = drawn[0];
      if (!card) {
        // No cards anywhere: pass play on rather than deadlock.
        state.lastEvent = `empty-deck:${playerId}`;
        advanceTurn(state, ctx);
        return actionAccepted();
      }
      state.drawnCardId = card.id;
      state.lastEvent = `draw:${playerId}`;
      ctx.markStateChanged();

      // If it cannot be played the turn simply ends.
      const top = topCard(state);
      if (!top || !isPlayable(card, top, state.activeColor)) {
        state.drawnCardId = null;
        advanceTurn(state, ctx);
      }
      return actionAccepted();
    }

    /* ---------------- pass ---------------- */
    if (action.type === 'pass') {
      if (!state.drawnCardId) return actionRejected('Draw a card before passing.');
      state.drawnCardId = null;
      state.lastEvent = `pass:${playerId}`;
      advanceTurn(state, ctx);
      return actionAccepted();
    }

    /* ---------------- play ---------------- */
    if (action.type !== 'play') return actionRejected('Unknown action.');
    const cardId = action.payload?.cardId;
    if (typeof cardId !== 'string') return actionRejected('Pick a card.');

    const index = slot.hand.findIndex((entry) => entry.id === cardId);
    if (index < 0) return actionRejected('That card is not in your hand.');
    if (state.drawnCardId && state.drawnCardId !== cardId) {
      return actionRejected('You may only play the card you just drew.');
    }

    const card = slot.hand[index] as UnoCard;
    const top = topCard(state);
    if (!top) return actionRejected('The discard pile is empty.');
    if (!isPlayable(card, top, state.activeColor)) return actionRejected('Illegal card.');

    let chosenColor: UnoColor | null = null;
    if (isWild(card)) {
      const requested = action.payload?.color;
      if (!isColor(requested)) return actionRejected('Choose a colour for the wild.');
      chosenColor = requested;
    }

    // Commit the play.
    slot.hand.splice(index, 1);
    slot.cardsPlayed += 1;
    state.drawnCardId = null;
    // A wild is discarded showing the chosen colour.
    const discarded: UnoCard = chosenColor ? { ...card, color: chosenColor } : card;
    state.discardPile.push(discarded);
    state.activeColor = chosenColor ?? (card.color === 'wild' ? state.activeColor : card.color);
    state.lastPlayed = { cardId: card.id, playerId };
    slot.uno = slot.hand.length === 1;
    state.lastEvent = `play:${playerId}:${card.value}`;

    // Round over when a hand empties.
    if (slot.hand.length === 0) {
      endRound(state, ctx, playerId);
      return actionAccepted();
    }

    const twoPlayer = activePlayers(state).length === 2;
    let skipNext = false;

    switch (card.value) {
      case 'skip':
        skipNext = true;
        break;
      case 'reverse':
        // With two players a reverse behaves as a skip (documented).
        if (twoPlayer) skipNext = true;
        else state.direction = state.direction === 1 ? -1 : 1;
        break;
      case 'draw-two':
        state.pendingDraw = 2;
        break;
      case 'wild-draw-four':
        state.pendingDraw = 4;
        break;
      default:
        break;
    }
    if (slot.uno) state.lastEvent = `uno:${playerId}`;

    ctx.markStateChanged();
    advanceTurn(state, ctx, skipNext);
    return actionAccepted();
  },

  update(): void {
    // Turn based.
  },

  tick(): void {
    // Not used.
  },

  calculateScore(playerId, state): number {
    return state.players[playerId]?.score ?? 0;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    if (state.matchWinnerId) return [state.matchWinnerId];
    const entries = activePlayers(state);
    if (entries.length === 0) return [];
    const best = Math.max(...entries.map(([, slot]) => slot.score));
    return entries.filter(([, slot]) => slot.score === best).map(([id]) => id);
  },

  checkDrawCondition(state): boolean {
    return (this.checkWinCondition(state)?.length ?? 0) > 1;
  },

  isGameFinished(state): boolean {
    return state.phase === 'finished';
  },

  finish(state): void {
    state.phase = 'finished';
    state.currentPlayerId = null;
    state.turnEndsAt = null;
  },

  getResult(state, ctx): GameResultDraft {
    const ranked = [...ctx.players].sort(
      (a, b) => (state.players[b.id]?.score ?? 0) - (state.players[a.id]?.score ?? 0),
    );
    const best = ranked.length > 0 ? state.players[ranked[0]?.id ?? '']?.score ?? 0 : 0;
    const winners = ranked
      .filter((player) => (state.players[player.id]?.score ?? 0) === best)
      .map((player) => player.id);
    const isDraw = winners.length > 1;

    const rankings: RankingDraft[] = ranked.map((player, index) => {
      const slot = state.players[player.id];
      return {
        playerId: player.id,
        rank: isDraw ? 1 : index + 1,
        score: slot?.score ?? 0,
        isWinner: winners.includes(player.id),
        isDraw,
        stats: {
          roundsWon: slot?.roundsWon ?? 0,
          cardsPlayed: slot?.cardsPlayed ?? 0,
          cardsLeft: slot?.hand.length ?? 0,
        },
      };
    });
    return { winners, isDraw, rankings, reason: state.finishReason ?? 'completed' };
  },

  reset(state): UnoState {
    const ids = Object.keys(state.players);
    return {
      ...state,
      phase: 'idle',
      round: 0,
      drawPile: [],
      discardPile: [],
      activeColor: 'red',
      players: Object.fromEntries(ids.map((id) => [id, makeSlot()])),
      currentPlayerId: null,
      direction: 1,
      pendingDraw: 0,
      drawnCardId: null,
      turnEndsAt: null,
      roundWinnerId: null,
      matchWinnerId: null,
      lastEvent: null,
      lastPlayed: null,
      finishReason: null,
    };
  },

  cleanup(state): void {
    state.players = {};
    state.drawPile = [];
    state.discardPile = [];
    state.turnOrder = [];
    state.phase = 'finished';
  },

  /**
   * Privacy boundary. A viewer receives ONLY their own hand; every opponent is
   * reduced to a card COUNT. The draw pile is never sent — only its size — so
   * the deck order cannot be read off the wire.
   */
  getPublicState(state, viewerId, ctx) {
    const me = viewerId ? state.players[viewerId] : undefined;
    const top = topCard(state);
    const playableIds =
      me && top && state.currentPlayerId === viewerId && state.phase === 'playing'
        ? me.hand
            .filter((card) =>
              state.drawnCardId ? card.id === state.drawnCardId : isPlayable(card, top, state.activeColor),
            )
            .map((card) => card.id)
        : [];

    return {
      phase: state.phase,
      round: state.round,
      totalRounds: state.totalRounds,
      targetScore: state.targetScore,
      // Only the top of the discard is public.
      topCard: top ? { ...top } : null,
      activeColor: state.activeColor,
      direction: state.direction,
      // Sizes only — never the contents or the order.
      drawPileCount: state.drawPile.length,
      discardPileCount: state.discardPile.length,
      pendingDraw: state.pendingDraw,
      currentPlayerId: state.currentPlayerId,
      isMyTurn: Boolean(viewerId) && state.currentPlayerId === viewerId,
      mustPlayDrawnCard: state.drawnCardId,
      turnEndsAt: state.turnEndsAt,
      roundWinnerId: state.roundWinnerId,
      matchWinnerId: state.matchWinnerId,
      lastEvent: state.lastEvent,
      lastPlayed: state.lastPlayed ? { ...state.lastPlayed } : null,
      finishReason: state.finishReason,
      serverTime: ctx.now(),
      // The viewer's own hand, plus which cards are legal right now.
      myHand: me ? me.hand.map((card) => ({ ...card })) : [],
      playableIds,
      players: Object.fromEntries(
        Object.entries(state.players).map(([id, slot]) => [
          id,
          {
            // Opponents expose a COUNT, never card faces.
            cardCount: slot.hand.length,
            score: slot.score,
            roundsWon: slot.roundsWon,
            cardsPlayed: slot.cardsPlayed,
            uno: slot.uno,
            disconnected: slot.disconnected,
          },
        ]),
      ),
    };
  },

  /**
   * AI opponent. It sees only its own hand and the public table — exactly what
   * a human sees — and always produces a legal action.
   */
  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing' || state.currentPlayerId !== playerId) return null;
    const slot = state.players[playerId];
    if (!slot || slot.left) return null;
    const top = topCard(state);
    if (!top) return null;

    const playable = slot.hand.filter((card) =>
      state.drawnCardId ? card.id === state.drawnCardId : isPlayable(card, top, state.activeColor),
    );

    if (playable.length === 0) {
      return state.drawnCardId ? { type: 'pass' } : { type: 'draw' };
    }

    /** The colour this bot holds most of — the sensible wild choice. */
    const bestColor = (): UnoColor => {
      const counts = new Map<UnoColor, number>();
      for (const card of slot.hand) {
        if (card.color === 'wild') continue;
        counts.set(card.color, (counts.get(card.color) ?? 0) + 1);
      }
      let chosen: UnoColor = UNO_COLORS[Math.floor(ctx.random() * UNO_COLORS.length)] as UnoColor;
      let most = -1;
      for (const [color, count] of counts) {
        if (count > most) {
          most = count;
          chosen = color;
        }
      }
      return chosen;
    };

    const withColor = (card: UnoCard): GameAction => ({
      type: 'play',
      payload: { cardId: card.id, ...(isWild(card) ? { color: bestColor() } : {}) },
    });

    // Easy bots pick at random from the legal set.
    if (difficulty === 'easy') {
      const pick = playable[Math.floor(ctx.random() * playable.length)] as UnoCard;
      return withColor(pick);
    }

    // Medium/hard: shed the most valuable non-wild card first, keeping wilds
    // in reserve; play an action card when an opponent is close to going out.
    const opponentNearOut = activePlayers(state).some(
      ([id, other]) => id !== playerId && other.hand.length <= 2,
    );
    const ranked = [...playable].sort((a, b) => {
      const aWild = isWild(a) ? 1 : 0;
      const bWild = isWild(b) ? 1 : 0;
      if (aWild !== bWild) return aWild - bWild; // save wilds for later
      if (opponentNearOut) {
        const aStop = a.value === 'skip' || a.value === 'draw-two' ? 1 : 0;
        const bStop = b.value === 'skip' || b.value === 'draw-two' ? 1 : 0;
        if (aStop !== bStop) return bStop - aStop;
      }
      return cardPoints(b) - cardPoints(a);
    });
    const choice = (ranked[0] ?? playable[0]) as UnoCard;
    if (difficulty === 'medium' && ctx.random() < 0.2) {
      const pick = playable[Math.floor(ctx.random() * playable.length)] as UnoCard;
      return withColor(pick);
    }
    return withColor(choice);
  },

  maxDurationMs: 45 * 60 * 1000,
};
