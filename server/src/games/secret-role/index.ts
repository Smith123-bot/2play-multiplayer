import type { AIDifficulty, GameAction, GameFinishReason } from '@2play/shared';
import { SECRET_ROLE_METADATA } from '@2play/shared';
export { SECRET_ROLE_METADATA };
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
  AGENT_CLUES,
  CITIZEN_CLUES,
  SECRET_TOPICS,
  topicMatches,
  type SecretTopic,
} from './topics';

/**
 * Secret Role — family-friendly hidden-role deduction.
 *
 * The server assigns one Secret Agent per round. getPublicState never leaks
 * other players' roles, the topic (except to Citizens), or the agent id
 * until the reveal phase.
 */

export type SecretPhase = 'idle' | 'intro' | 'clue' | 'voting' | 'guess' | 'reveal' | 'finished';
export type SecretRole = 'citizen' | 'agent';

export interface SecretClue {
  playerId: string;
  text: string;
}

export interface SecretRound {
  number: number;
  topic: SecretTopic;
  agentId: string;
  roles: Record<string, SecretRole>;
  turnOrder: string[];
  turnIndex: number;
  clues: SecretClue[];
  votes: Record<string, string>;
  topicGuess: string | null;
  topicGuessCorrect: boolean;
  accusedId: string | null;
  citizensWon: boolean | null;
}

export interface SecretRoleState {
  phase: SecretPhase;
  round: number;
  totalRounds: number;
  introMs: number;
  clueMs: number;
  voteMs: number;
  guessMs: number;
  revealMs: number;
  current: SecretRound | null;
  history: Array<{
    number: number;
    topicId: string;
    topicName: string;
    agentId: string;
    accusedId: string | null;
    citizensWon: boolean;
    topicGuessCorrect: boolean;
  }>;
  scores: Record<string, number>;
  correctVotes: Record<string, number>;
  agentWins: Record<string, number>;
  usedTopics: string[];
  endsAt: number | null;
  startedAt: number | null;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
}

const DEFAULT_ROUNDS = 4;
const MIN_ROUNDS = 2;
const MAX_ROUNDS = 8;
const INTRO_MS = 4000;
const CLUE_MS = 20_000;
const VOTE_MS = 18_000;
const GUESS_MS = 12_000;
const REVEAL_MS = 4000;
const MAX_CLUE_LENGTH = 48;
const CITIZEN_VOTE_POINTS = 100;
const AGENT_SURVIVE_POINTS = 150;
const AGENT_TOPIC_POINTS = 200;

const AI_CLUE_DELAY: Record<AIDifficulty, number> = { easy: 2500, medium: 1400, hard: 700 };
const AI_VOTE_DELAY: Record<AIDifficulty, number> = { easy: 4000, medium: 2200, hard: 900 };
const AI_AGENT_ACCURACY: Record<AIDifficulty, number> = { easy: 0.25, medium: 0.5, hard: 0.78 };

function roundsFor(requested?: number): number {
  if (typeof requested === 'number' && Number.isFinite(requested)) {
    return Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, Math.round(requested)));
  }
  return DEFAULT_ROUNDS;
}

function sanitizeClue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_CLUE_LENGTH);
  return text.length === 0 ? null : text;
}

function activePlayers(ctx: GameContext): GamePlayerView[] {
  return ctx.players.filter((player) => player.isAI || player.isConnected);
}

function pickTopic(used: string[], rng: () => number): SecretTopic {
  const unused = SECRET_TOPICS.filter((topic) => !used.includes(topic.id));
  const pool = unused.length > 0 ? unused : SECRET_TOPICS;
  return pool[Math.floor(rng() * pool.length)]!;
}

function majorityAccused(votes: Record<string, string>): string | null {
  const counts = new Map<string, number>();
  for (const target of Object.values(votes)) {
    counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  let tied = false;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      best = id;
      bestCount = count;
      tied = false;
    } else if (count === bestCount) {
      tied = true;
    }
  }
  if (tied || bestCount === 0) return null;
  return best;
}

export function assignRoles(playerIds: string[], rng: () => number): { agentId: string; roles: Record<string, SecretRole> } {
  const agentId = playerIds[Math.floor(rng() * playerIds.length)]!;
  const roles: Record<string, SecretRole> = {};
  for (const id of playerIds) roles[id] = id === agentId ? 'agent' : 'citizen';
  return { agentId, roles };
}

/** Opens a new round at intro. Exported for tests. */
export function beginSecretRound(state: SecretRoleState, ctx: GameContext): void {
  const players = activePlayers(ctx);
  const ids = players.map((player) => player.id);
  if (ids.length < 2) {
    finishSecretMatch(state, ctx, 'abandoned');
    return;
  }
  const topic = pickTopic(state.usedTopics, ctx.random);
  state.usedTopics.push(topic.id);
  const { agentId, roles } = assignRoles(ids, ctx.random);
  const now = ctx.now();
  state.current = {
    number: state.round,
    topic,
    agentId,
    roles,
    turnOrder: ids,
    turnIndex: 0,
    clues: [],
    votes: {},
    topicGuess: null,
    topicGuessCorrect: false,
    accusedId: null,
    citizensWon: null,
  };
  state.phase = 'intro';
  state.endsAt = now + state.introMs;
  state.lastEvent = 'intro';
  ctx.markStateChanged();

  ctx.schedule(
    state.introMs,
    () => {
      if (state.phase !== 'intro' || state.current?.number !== state.round) return;
      openCluePhase(state, ctx);
    },
    'turn',
    'intro',
  );
}

export function openCluePhase(state: SecretRoleState, ctx: GameContext): void {
  if (!state.current) return;
  state.phase = 'clue';
  state.current.turnIndex = 0;
  state.endsAt = ctx.now() + state.clueMs;
  state.lastEvent = `turn:${currentCluePlayer(state)}`;
  ctx.markStateChanged();
  scheduleClueTimer(state, ctx);
  requestClueAI(state, ctx);
}

function currentCluePlayer(state: SecretRoleState): string | null {
  const round = state.current;
  if (!round) return null;
  return round.turnOrder[round.turnIndex] ?? null;
}

function scheduleClueTimer(state: SecretRoleState, ctx: GameContext): void {
  ctx.schedule(
    state.clueMs,
    () => {
      if (state.phase !== 'clue' || state.current?.number !== state.round) return;
      skipClue(state, ctx);
    },
    'turn',
    'clue',
  );
}

function skipClue(state: SecretRoleState, ctx: GameContext): void {
  const round = state.current;
  if (!round || state.phase !== 'clue') return;
  const playerId = currentCluePlayer(state);
  if (playerId && !round.clues.some((clue) => clue.playerId === playerId)) {
    round.clues.push({ playerId, text: '…' });
  }
  advanceClueTurn(state, ctx);
}

function advanceClueTurn(state: SecretRoleState, ctx: GameContext): void {
  const round = state.current;
  if (!round) return;
  round.turnIndex += 1;
  if (round.turnIndex >= round.turnOrder.length) {
    openVoting(state, ctx);
    return;
  }
  state.endsAt = ctx.now() + state.clueMs;
  state.lastEvent = `turn:${currentCluePlayer(state)}`;
  ctx.markStateChanged();
  scheduleClueTimer(state, ctx);
  requestClueAI(state, ctx);
}

function requestClueAI(state: SecretRoleState, ctx: GameContext): void {
  const playerId = currentCluePlayer(state);
  if (!playerId) return;
  const player = ctx.players.find((entry) => entry.id === playerId);
  if (!player?.isAI) return;
  const difficulty = player.aiDifficulty ?? 'medium';
  ctx.requestAI(playerId, AI_CLUE_DELAY[difficulty] + Math.floor(ctx.random() * 800));
}

export function openVoting(state: SecretRoleState, ctx: GameContext): void {
  if (!state.current) return;
  state.phase = 'voting';
  state.endsAt = ctx.now() + state.voteMs;
  state.lastEvent = 'voting';
  ctx.markStateChanged();
  ctx.schedule(
    state.voteMs,
    () => {
      if (state.phase !== 'voting' || state.current?.number !== state.round) return;
      openGuessPhase(state, ctx);
    },
    'turn',
    'vote',
  );
  for (const player of ctx.players) {
    if (!player.isAI) continue;
    const difficulty = player.aiDifficulty ?? 'medium';
    ctx.requestAI(player.id, AI_VOTE_DELAY[difficulty] + Math.floor(ctx.random() * 900));
  }
}

export function openGuessPhase(state: SecretRoleState, ctx: GameContext): void {
  const round = state.current;
  if (!round) return;
  round.accusedId = majorityAccused(round.votes);
  state.phase = 'guess';
  state.endsAt = ctx.now() + state.guessMs;
  state.lastEvent = 'guess';
  ctx.markStateChanged();
  ctx.schedule(
    state.guessMs,
    () => {
      if (state.phase !== 'guess' || state.current?.number !== state.round) return;
      completeSecretRound(state, ctx);
    },
    'turn',
    'guess',
  );
  const agent = ctx.players.find((player) => player.id === round.agentId);
  if (agent?.isAI) {
    const difficulty = agent.aiDifficulty ?? 'medium';
    ctx.requestAI(agent.id, 800 + Math.floor(ctx.random() * 1200) + (difficulty === 'easy' ? 1500 : 0));
  }
}

export function completeSecretRound(state: SecretRoleState, ctx: GameContext): void {
  const round = state.current;
  if (!round || (state.phase !== 'guess' && state.phase !== 'voting' && state.phase !== 'clue')) return;

  if (round.accusedId === null) round.accusedId = majorityAccused(round.votes);

  const agentCaught = round.accusedId === round.agentId;
  const agentGuessed = round.topicGuessCorrect;
  const citizensWon = agentCaught && !agentGuessed;
  round.citizensWon = citizensWon;

  if (agentGuessed) {
    state.scores[round.agentId] = (state.scores[round.agentId] ?? 0) + AGENT_TOPIC_POINTS;
    state.agentWins[round.agentId] = (state.agentWins[round.agentId] ?? 0) + 1;
  } else if (citizensWon) {
    for (const [playerId, role] of Object.entries(round.roles)) {
      if (role !== 'citizen') continue;
      if (round.votes[playerId] === round.agentId) {
        state.scores[playerId] = (state.scores[playerId] ?? 0) + CITIZEN_VOTE_POINTS;
        state.correctVotes[playerId] = (state.correctVotes[playerId] ?? 0) + 1;
      }
    }
  } else {
    state.scores[round.agentId] = (state.scores[round.agentId] ?? 0) + AGENT_SURVIVE_POINTS;
    state.agentWins[round.agentId] = (state.agentWins[round.agentId] ?? 0) + 1;
  }

  state.history.push({
    number: round.number,
    topicId: round.topic.id,
    topicName: round.topic.name,
    agentId: round.agentId,
    accusedId: round.accusedId,
    citizensWon,
    topicGuessCorrect: agentGuessed,
  });
  state.phase = 'reveal';
  state.endsAt = ctx.now() + state.revealMs;
  state.lastEvent = citizensWon ? 'citizens' : 'agent';
  ctx.markStateChanged();

  ctx.schedule(
    state.revealMs,
    () => {
      if (state.phase !== 'reveal') return;
      beginNextSecretRound(state, ctx);
    },
    'turn',
    'reveal',
  );
}

export function beginNextSecretRound(state: SecretRoleState, ctx: GameContext): void {
  if (state.phase !== 'reveal') return;
  if (state.round >= state.totalRounds) {
    finishSecretMatch(state, ctx, 'completed');
    return;
  }
  state.round += 1;
  beginSecretRound(state, ctx);
}

export function finishSecretMatch(state: SecretRoleState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.endsAt = null;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

export const secretRoleGame: GameModule<SecretRoleState> = {
  metadata: SECRET_ROLE_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players, config): SecretRoleState {
    return {
      phase: 'idle',
      round: 0,
      totalRounds: roundsFor(config.rounds),
      introMs: INTRO_MS,
      clueMs: CLUE_MS,
      voteMs: VOTE_MS,
      guessMs: GUESS_MS,
      revealMs: REVEAL_MS,
      current: null,
      history: [],
      scores: Object.fromEntries(players.map((player) => [player.id, 0])),
      correctVotes: Object.fromEntries(players.map((player) => [player.id, 0])),
      agentWins: Object.fromEntries(players.map((player) => [player.id, 0])),
      usedTopics: [],
      endsAt: null,
      startedAt: null,
      finishReason: null,
      lastEvent: null,
    };
  },

  playerJoined(player, state): void {
    if (state.scores[player.id] === undefined) state.scores[player.id] = 0;
    if (state.correctVotes[player.id] === undefined) state.correctVotes[player.id] = 0;
    if (state.agentWins[player.id] === undefined) state.agentWins[player.id] = 0;
  },

  playerReady(): void {
    // No per-player readiness behaviour.
  },

  playerLeft(playerId, state, ctx, reason): void {
    if (reason === 'disconnect') return;
    const remaining = activePlayers(ctx).filter((player) => player.id !== playerId);
    if (state.phase !== 'finished' && remaining.length < 2) {
      finishSecretMatch(state, ctx, 'abandoned');
      return;
    }
    const round = state.current;
    if (state.phase === 'clue' && currentCluePlayer(state) === playerId) {
      skipClue(state, ctx);
    }
    if (state.phase === 'voting' && round) {
      const voters = round.turnOrder.filter((id) => id !== playerId);
      if (voters.every((id) => round.votes[id])) openGuessPhase(state, ctx);
    }
  },

  start(state, ctx): void {
    if (state.phase !== 'idle') return;
    for (const player of ctx.players) {
      if (state.scores[player.id] === undefined) state.scores[player.id] = 0;
      if (state.correctVotes[player.id] === undefined) state.correctVotes[player.id] = 0;
      if (state.agentWins[player.id] === undefined) state.agentWins[player.id] = 0;
    }
    state.round = 1;
    state.startedAt = ctx.now();
    const worst =
      state.totalRounds * (state.introMs + state.clueMs * 4 + state.voteMs + state.guessMs + state.revealMs) + 8000;
    ctx.schedule(worst, () => finishSecretMatch(state, ctx, 'timeout'), 'gameDuration', 'match-timeout');
    beginSecretRound(state, ctx);
  },

  validateAction(playerId, action, state): ValidationResult {
    const round = state.current;
    if (!round) return { valid: false, reason: 'The round has not started.' };

    if (action.type === 'clue') {
      if (state.phase !== 'clue') return { valid: false, reason: 'It is not clue time.' };
      if (currentCluePlayer(state) !== playerId) return { valid: false, reason: 'It is not your turn.' };
      if (round.clues.some((clue) => clue.playerId === playerId)) {
        return { valid: false, reason: 'You already gave a clue.' };
      }
      if (!sanitizeClue(action.payload?.text)) return { valid: false, reason: 'Type a short clue.' };
      return { valid: true };
    }

    if (action.type === 'vote') {
      if (state.phase !== 'voting') return { valid: false, reason: 'Voting is not open.' };
      if (round.votes[playerId]) return { valid: false, reason: 'You already voted.' };
      const targetId = action.payload?.targetId;
      if (typeof targetId !== 'string') return { valid: false, reason: 'Pick a player.' };
      if (targetId === playerId) return { valid: false, reason: 'You cannot vote for yourself.' };
      if (!round.turnOrder.includes(targetId)) return { valid: false, reason: 'That player is not in this round.' };
      return { valid: true };
    }

    if (action.type === 'guess-topic') {
      if (state.phase !== 'guess') return { valid: false, reason: 'Topic guessing is not open.' };
      if (round.agentId !== playerId) return { valid: false, reason: 'Only the Secret Agent can guess the location.' };
      if (round.topicGuess !== null) return { valid: false, reason: 'You already guessed.' };
      if (typeof action.payload?.topic !== 'string' || action.payload.topic.trim().length === 0) {
        return { valid: false, reason: 'Pick a location.' };
      }
      return { valid: true };
    }

    return { valid: false, reason: 'Unknown action.' };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    const round = state.current;
    if (!round) return actionRejected('The round has not started.');

    if (action.type === 'clue') {
      const text = sanitizeClue(action.payload?.text);
      if (!text) return actionRejected('Type a short clue.');
      if (state.phase !== 'clue' || currentCluePlayer(state) !== playerId) {
        return actionRejected('It is not your turn.');
      }
      if (round.clues.some((clue) => clue.playerId === playerId)) {
        return actionRejected('You already gave a clue.');
      }
      round.clues.push({ playerId, text });
      state.lastEvent = `clue:${playerId}`;
      ctx.markStateChanged();
      advanceClueTurn(state, ctx);
      return actionAccepted();
    }

    if (action.type === 'vote') {
      if (state.phase !== 'voting') return actionRejected('Voting is not open.');
      if (round.votes[playerId]) return actionRejected('You already voted.');
      const targetId = action.payload?.targetId;
      if (typeof targetId !== 'string' || targetId === playerId || !round.turnOrder.includes(targetId)) {
        return actionRejected('That vote is not allowed.');
      }
      round.votes[playerId] = targetId;
      state.lastEvent = `vote:${playerId}`;
      ctx.markStateChanged();
      const remaining = round.turnOrder.filter((id) => {
        const player = ctx.players.find((entry) => entry.id === id);
        return player && (player.isAI || player.isConnected) && !round.votes[id];
      });
      if (remaining.length === 0) openGuessPhase(state, ctx);
      return actionAccepted();
    }

    if (action.type === 'guess-topic') {
      if (state.phase !== 'guess') return actionRejected('Topic guessing is not open.');
      if (round.agentId !== playerId) return actionRejected('Only the Secret Agent can guess.');
      if (round.topicGuess !== null) return actionRejected('You already guessed.');
      const topic = typeof action.payload?.topic === 'string' ? action.payload.topic : '';
      round.topicGuess = topic;
      round.topicGuessCorrect = topicMatches(round.topic, topic);
      state.lastEvent = round.topicGuessCorrect ? 'guess-hit' : 'guess-miss';
      ctx.markStateChanged();
      completeSecretRound(state, ctx);
      return actionAccepted();
    }

    return actionRejected('Unknown action.');
  },

  update(): void {
    // Timer driven.
  },

  tick(): void {
    // Timer driven.
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
    const ranked = [...ctx.players].sort((a, b) => (state.scores[b.id] ?? 0) - (state.scores[a.id] ?? 0));
    const top = state.scores[ranked[0]?.id ?? ''] ?? 0;
    const winners = ranked.filter((player) => (state.scores[player.id] ?? 0) === top).map((player) => player.id);
    const rankings: RankingDraft[] = ranked.map((player) => {
      const score = state.scores[player.id] ?? 0;
      const rank = ranked.filter((other) => (state.scores[other.id] ?? 0) > score).length + 1;
      return {
        playerId: player.id,
        rank,
        score,
        isWinner: winners.includes(player.id),
        isDraw: winners.length > 1,
        stats: {
          correctVotes: state.correctVotes[player.id] ?? 0,
          agentWins: state.agentWins[player.id] ?? 0,
        },
      };
    });
    return { winners, isDraw: winners.length > 1, rankings, reason: state.finishReason ?? 'completed' };
  },

  reset(state): SecretRoleState {
    const zero = (table: Record<string, number>) => Object.fromEntries(Object.keys(table).map((id) => [id, 0]));
    return {
      ...state,
      phase: 'idle',
      round: 0,
      current: null,
      history: [],
      scores: zero(state.scores),
      correctVotes: zero(state.correctVotes),
      agentWins: zero(state.agentWins),
      usedTopics: [],
      endsAt: null,
      startedAt: null,
      finishReason: null,
      lastEvent: null,
    };
  },

  cleanup(state): void {
    state.current = null;
    state.history = [];
    state.phase = 'finished';
  },

  getPublicState(state, viewerId, ctx) {
    const round = state.current;
    const reveal = state.phase === 'reveal' || state.phase === 'finished';
    const myRole = viewerId && round ? (round.roles[viewerId] ?? null) : null;
    const isAgent = myRole === 'agent';
    const showTopic = Boolean(reveal || (myRole === 'citizen'));
    return {
      phase: state.phase,
      round: state.round,
      totalRounds: state.totalRounds,
      endsAt: state.endsAt,
      currentPlayerId: state.phase === 'clue' ? currentCluePlayer(state) : null,
      turnOrder: round ? [...round.turnOrder] : [],
      clues: round ? round.clues.map((clue) => ({ ...clue })) : [],
      voted: round ? Object.keys(round.votes) : [],
      myVote: viewerId && round ? (round.votes[viewerId] ?? null) : null,
      myRole,
      myTopic: showTopic ? (round?.topic.name ?? null) : null,
      topicId: showTopic ? (round?.topic.id ?? null) : null,
      topics: SECRET_TOPICS.map((topic) => ({ id: topic.id, name: topic.name })),
      agentId: reveal ? (round?.agentId ?? null) : null,
      accusedId: reveal || state.phase === 'guess' ? (round?.accusedId ?? null) : null,
      topicGuessCorrect: reveal ? Boolean(round?.topicGuessCorrect) : false,
      citizensWon: reveal ? (round?.citizensWon ?? null) : null,
      scores: { ...state.scores },
      history: state.history.map((entry) => ({ ...entry })),
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      isAgent,
      serverTime: ctx.now(),
    };
  },

  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    const round = state.current;
    if (!round) return null;
    if (state.phase === 'clue' && currentCluePlayer(state) === playerId) {
      const role = round.roles[playerId];
      if (role === 'agent') {
        const line = AGENT_CLUES[Math.floor(ctx.random() * AGENT_CLUES.length)]!;
        return { type: 'clue', payload: { text: line } };
      }
      const bank = CITIZEN_CLUES[round.topic.id] ?? ['this place'];
      const line = bank[Math.floor(ctx.random() * bank.length)]!;
      return { type: 'clue', payload: { text: line } };
    }
    if (state.phase === 'voting' && !round.votes[playerId]) {
      const others = round.turnOrder.filter((id) => id !== playerId);
      if (others.length === 0) return null;
      let target = others[Math.floor(ctx.random() * others.length)]!;
      if (difficulty === 'hard' && round.roles[playerId] === 'citizen' && ctx.random() < 0.45) {
        target = round.agentId === playerId ? target : round.agentId;
      }
      if (round.roles[playerId] === 'agent') {
        target = others[Math.floor(ctx.random() * others.length)]!;
      }
      return { type: 'vote', payload: { targetId: target } };
    }
    if (state.phase === 'guess' && round.agentId === playerId && round.topicGuess === null) {
      const hit = ctx.random() < AI_AGENT_ACCURACY[difficulty];
      const topic = hit
        ? round.topic.id
        : SECRET_TOPICS.filter((entry) => entry.id !== round.topic.id)[
            Math.floor(ctx.random() * (SECRET_TOPICS.length - 1))
          ]!.id;
      return { type: 'guess-topic', payload: { topic } };
    }
    return null;
  },

  maxDurationMs: 16 * 60 * 1000,
};
