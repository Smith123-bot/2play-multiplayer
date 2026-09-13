import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGameFixture, createPlayer, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  advanceAfterReveal,
  BEATS,
  beginChoose,
  beginCountdown,
  CHOICES,
  CHOOSE_MS,
  compareChoices,
  counterOf,
  COUNTDOWN_MS,
  DEFAULT_WINS_NEEDED,
  judgeRound,
  pickAiChoice,
  resolveRound,
  REVEAL_MS,
  rockPaperScissorsGame,
  type RoundRecord,
  type RpsChoice,
  type RpsState,
} from './index';
import type { Room } from '../../rooms/Room';

/**
 * Rock Paper Scissors — module contract.
 *
 * Three layers are covered: the pure rule table (every one of the nine
 * matchups), the authoritative round flow driven through the REAL GameManager
 * (so validation, timers, scoring and the finish line are the platform's, not a
 * stub's), and the information boundary — a viewer must never receive the
 * opponent's throw before the server reveals it, and the AI must never receive
 * the throw its opponent has locked this round.
 */

const rngFrom = (values: number[]): (() => number) => {
  let index = 0;
  return () => values[index++ % values.length] as number;
};

/** A round record whose only job is to feed revealed history to the AI. */
function record(round: number, choices: Record<string, RpsChoice | null>): RoundRecord {
  return { round, choices, outcomes: {}, forfeits: [] };
}

/** A deterministic pseudo-random stream, so distributions are reproducible. */
function lcg(seed = 1): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

/** Revealed throws as the AI sees them: a flat list of shapes, oldest first. */
const throws = (list: RpsChoice[]): RpsChoice[] => [...list];

/** The same throws, wrapped as the round log the server actually keeps. */
const roundLog = (list: RpsChoice[]): RoundRecord[] =>
  list.map((choice, index) => record(index, { opp: choice }));

describe('Rock Paper Scissors — rules', () => {
  it('rock beats scissors, scissors beat paper, paper beats rock', () => {
    expect(compareChoices('rock', 'scissors')).toBe(1);
    expect(compareChoices('scissors', 'paper')).toBe(1);
    expect(compareChoices('paper', 'rock')).toBe(1);
  });

  it('loses the same three matchups from the other seat', () => {
    expect(compareChoices('scissors', 'rock')).toBe(-1);
    expect(compareChoices('paper', 'scissors')).toBe(-1);
    expect(compareChoices('rock', 'paper')).toBe(-1);
  });

  it('same throw is a draw', () => {
    for (const choice of CHOICES) expect(compareChoices(choice, choice)).toBe(0);
  });

  it('covers all nine matchups exactly once, antisymmetrically', () => {
    const seen = new Set<string>();
    for (const a of CHOICES) {
      for (const b of CHOICES) {
        const result = compareChoices(a, b);
        expect([1, 0, -1]).toContain(result);
        expect(compareChoices(b, a)).toBe(result === 0 ? 0 : (-result as 1 | -1));
        seen.add(`${a}>${b}:${result}`);
      }
    }
    expect(seen.size).toBe(9);
  });

  it('BEATS and counterOf agree with the rule table', () => {
    for (const choice of CHOICES) {
      expect(compareChoices(choice, BEATS[choice])).toBe(1);
      expect(compareChoices(counterOf(choice), choice)).toBe(1);
      expect(BEATS[counterOf(choice)]).toBe(choice);
    }
  });

  it('judges a round: wins, losses, draws', () => {
    expect(judgeRound('rock', 'scissors')).toEqual({ mine: 'win', theirs: 'loss' });
    expect(judgeRound('scissors', 'rock')).toEqual({ mine: 'loss', theirs: 'win' });
    expect(judgeRound('paper', 'paper')).toEqual({ mine: 'draw', theirs: 'draw' });
  });

  it('a missing throw forfeits the round; two missing throws draw', () => {
    expect(judgeRound(null, 'rock')).toEqual({ mine: 'forfeit', theirs: 'win' });
    expect(judgeRound('rock', null)).toEqual({ mine: 'win', theirs: 'forfeit' });
    // Neither threw: nobody is awarded a free win.
    expect(judgeRound(null, null)).toEqual({ mine: 'draw', theirs: 'draw' });
  });
});

describe('Rock Paper Scissors — AI', () => {
  it('easy throws at random and ignores history entirely', () => {
    const seen = new Set<RpsChoice>();
    // A history that screams "rock": easy must not exploit it.
    for (const value of [0.05, 0.4, 0.75]) {
      seen.add(pickAiChoice(throws(['rock', 'rock', 'rock', 'rock']), 'easy', () => value));
    }
    expect(seen.size).toBeGreaterThan(1);
    // Deterministic: same rng, same history, same answer.
    const first = pickAiChoice(throws(['rock']), 'easy', () => 0.4);
    const second = pickAiChoice(throws(['rock']), 'easy', () => 0.4);
    expect(first).toBe(second);
  });

  it('easy is uniform over a long run', () => {
    const counts: Record<RpsChoice, number> = { rock: 0, paper: 0, scissors: 0 };
    const rng = lcg(1);
    for (let i = 0; i < 900; i += 1) counts[pickAiChoice([], 'easy', rng)] += 1;
    for (const choice of CHOICES) {
      expect(counts[choice], `${choice} starved`).toBeGreaterThan(150);
      expect(counts[choice], `${choice} over-represented`).toBeLessThan(450);
    }
  });

  it('medium adapts to a repeated throw about half the time', () => {
    // Opponent has thrown scissors every round → medium should favour rock.
    const picks = [0.1, 0.2, 0.9, 0.95].map((value) =>
      pickAiChoice(throws(['scissors', 'scissors', 'scissors']), 'medium', () => value),
    );
    // Low rng values act on the prediction…
    expect(picks[0]).toBe('rock');
    expect(picks[1]).toBe('rock');
    // …high ones fall back to a random throw, which keeps it beatable.
    expect(picks.some((pick) => pick !== 'rock')).toBe(true);
  });

  it('hard counters the opponent\'s habit more reliably than medium', () => {
    const paperHabit = throws(['paper', 'paper', 'paper', 'paper', 'paper']);
    const trials = 600;
    let hardScissors = 0;
    let mediumScissors = 0;
    const hardRng = lcg(7);
    const mediumRng = lcg(7);
    for (let i = 0; i < trials; i += 1) {
      if (pickAiChoice(paperHabit, 'hard', hardRng) === 'scissors') hardScissors += 1;
      if (pickAiChoice(paperHabit, 'medium', mediumRng) === 'scissors') mediumScissors += 1;
    }
    const hardRate = hardScissors / trials;
    const mediumRate = mediumScissors / trials;

    // Hard reads the habit far more often than medium does.
    expect(hardRate).toBeGreaterThan(mediumRate);
    expect(hardRate).toBeGreaterThan(0.75);
    expect(mediumRate).toBeGreaterThan(0.5);
    expect(mediumRate).toBeLessThan(0.8);

    // Strong, but NOT unbeatable: hard must still throw the other shapes.
    expect(hardRate).toBeLessThan(0.97);
    expect(hardScissors).toBeLessThan(trials);
  });

  it('hard weights recent throws, so a fresh habit beats an older one', () => {
    // Four rounds of rock, then three of paper. Recency weighting must let the
    // newer habit win the prediction, so the bot counters paper with scissors.
    const mixed = throws(['rock', 'rock', 'rock', 'rock', 'paper', 'paper', 'paper']);
    expect(pickAiChoice(mixed, 'hard', () => 0.1)).toBe('scissors');
    // Without the paper habit it would counter rock with paper instead.
    expect(pickAiChoice(throws(['rock', 'rock', 'rock', 'rock']), 'hard', () => 0.1)).toBe('paper');
  });

  it('is deterministic for a given history and rng stream', () => {
    const mixed = throws(['rock', 'paper', 'scissors', 'rock']);
    const a = pickAiChoice(mixed, 'hard', rngFrom([0.1, 0.2, 0.3]));
    const b = pickAiChoice(mixed, 'hard', rngFrom([0.1, 0.2, 0.3]));
    expect(a).toBe(b);
  });

  it('the AI can only see REVEALED history, never the throw locked this round', () => {
    // The opponent has a habit of scissors (so a fair predictor throws rock) but
    // has ALREADY LOCKED paper this round — paper beats rock. A cheating AI would
    // switch to scissors; a fair one keeps throwing rock.
    const build = (lockedChoice: RpsChoice | null): RpsState => {
      const state = rockPaperScissorsGame.createInitialState(
        [{ id: 'ai' }, { id: 'opp' }] as unknown as GamePlayerView[],
        { rounds: DEFAULT_WINS_NEEDED },
      );
      state.phase = 'choose';
      state.history = roundLog(['scissors', 'scissors', 'scissors', 'scissors']);
      state.players.opp!.choice = lockedChoice;
      return state;
    };
    const ctx = { random: () => 0.05 } as unknown as GameContext;

    const fair = rockPaperScissorsGame.getAIMove!('ai', 'hard', build(null), ctx);
    const peeked = rockPaperScissorsGame.getAIMove!('ai', 'hard', build('paper'), ctx);
    const peekedRock = rockPaperScissorsGame.getAIMove!('ai', 'hard', build('rock'), ctx);

    expect(fair).toEqual({ type: 'throw', payload: { choice: 'rock' } });
    // Identical decision regardless of what the opponent has locked: proof the
    // hidden throw cannot influence the bot.
    expect(peeked).toEqual(fair);
    expect(peekedRock).toEqual(fair);
  });

  it('the AI never counters the hidden throw, empirically', () => {
    // Sweep every possible hidden throw against a scissors-heavy history. The
    // cheat-optimal answer differs per hidden throw; a fair bot gives one answer.
    const answers = CHOICES.map((hidden) => {
      const state = rockPaperScissorsGame.createInitialState(
        [{ id: 'ai' }, { id: 'opp' }] as unknown as GamePlayerView[],
        { rounds: DEFAULT_WINS_NEEDED },
      );
      state.phase = 'choose';
      state.history = roundLog(['scissors', 'scissors', 'scissors']);
      state.players.opp!.choice = hidden;
      const ctx = { random: () => 0.02 } as unknown as GameContext;
      return (rockPaperScissorsGame.getAIMove!('ai', 'hard', state, ctx)?.payload as { choice: RpsChoice }).choice;
    });
    expect(new Set(answers).size).toBe(1);
  });

  it('the AI declines outside the throw window and once it has thrown', () => {
    const state = rockPaperScissorsGame.createInitialState(
      [{ id: 'ai' }, { id: 'opp' }] as unknown as GamePlayerView[],
      { rounds: DEFAULT_WINS_NEEDED },
    );
    const ctx = { random: () => 0.5 } as unknown as GameContext;
    state.phase = 'countdown';
    expect(rockPaperScissorsGame.getAIMove!('ai', 'hard', state, ctx)).toBeNull();
    state.phase = 'finished';
    expect(rockPaperScissorsGame.getAIMove!('ai', 'hard', state, ctx)).toBeNull();
    state.phase = 'choose';
    state.players.ai!.choice = 'rock';
    expect(rockPaperScissorsGame.getAIMove!('ai', 'hard', state, ctx)).toBeNull();
    // A seat that is not in the match.
    expect(rockPaperScissorsGame.getAIMove!('ghost', 'hard', state, ctx)).toBeNull();
  });

  it('getAIMove returns a legal choice for every difficulty', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const state = rockPaperScissorsGame.createInitialState(
        [{ id: 'ai' }, { id: 'opp' }] as unknown as GamePlayerView[],
        { rounds: DEFAULT_WINS_NEEDED },
      );
      state.phase = 'choose';
      const move = rockPaperScissorsGame.getAIMove!(
        'ai',
        difficulty,
        state,
        { random: () => 0.33 } as unknown as GameContext,
      );
      expect(move?.type).toBe('throw');
      expect(CHOICES).toContain((move?.payload as { choice: RpsChoice }).choice);
    }
  });
});

describe('Rock Paper Scissors — match flow on the real platform', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];
  let first: string;
  let second: string;

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'rock-paper-scissors');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
    [first, second] = players.map((player) => player.id) as [string, string];
  });

  afterEach(() => {
    vi.useRealTimers();
    harness.destroy();
  });

  const state = (): RpsState => room.gameState as RpsState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const view = (viewerId: string) =>
    platform.gameManager.getPublicState(room, viewerId) as {
      phase: string;
      round: number;
      winsNeeded: number;
      myChoice: RpsChoice | null;
      opponents: Record<string, { hasThrown: boolean; choice: RpsChoice | null; score: number }>;
      roundResult: RoundRecord | null;
    };
  const throwAction = (playerId: string, choice: string) =>
    platform.gameManager.handleAction(room, playerId, { type: 'throw', payload: { choice } });

  /** Drives the match into the throw window for the current round. */
  function openThrowWindow(): void {
    if (state().phase === 'countdown') beginChoose(state(), context());
  }

  it('registers in the catalogue and the server registry as game #40', () => {
    expect(platform.registry.has('rock-paper-scissors')).toBe(true);
    expect(platform.registry.get('rock-paper-scissors').metadata.name).toBe('Rock Paper Scissors');
    expect(rockPaperScissorsGame.metadata.minPlayers).toBe(2);
    expect(rockPaperScissorsGame.metadata.maxPlayers).toBe(2);
    expect(rockPaperScissorsGame.metadata.category).toBe('reflex');
    expect(rockPaperScissorsGame.metadata.hasAI).toBe(true);
  });

  it('starts into a countdown with both seats and a first-to-3 target', () => {
    expect(state().phase).toBe('countdown');
    expect(state().round).toBe(0);
    expect(state().winsNeeded).toBe(DEFAULT_WINS_NEEDED);
    expect(Object.keys(state().players).sort()).toEqual([first, second].sort());
    expect(state().countdownUntil).toBeGreaterThan(context().now());
    expect(state().countdownUntil! - context().now()).toBeLessThanOrEqual(COUNTDOWN_MS);
  });

  it('honours config.rounds as the win target, clamped to a sane range', () => {
    const low = rockPaperScissorsGame.createInitialState(players, { rounds: 0 });
    const high = rockPaperScissorsGame.createInitialState(players, { rounds: 99 });
    const absent = rockPaperScissorsGame.createInitialState(players, {});
    expect(low.winsNeeded).toBe(1);
    expect(high.winsNeeded).toBe(7);
    expect(absent.winsNeeded).toBe(DEFAULT_WINS_NEEDED);
    // The round cap always leaves room for draws.
    expect(absent.maxRounds).toBeGreaterThan(absent.winsNeeded);
  });

  it('rejects a throw before GO', () => {
    expect(state().phase).toBe('countdown');
    const result = throwAction(first, 'rock');
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/Wait for GO/i);
    expect(state().players[first]!.choice).toBeNull();
  });

  it('opens the throw window after the countdown', () => {
    openThrowWindow();
    expect(state().phase).toBe('choose');
    expect(state().countdownUntil).toBeNull();
    expect(state().chooseUntil! - context().now()).toBeLessThanOrEqual(CHOOSE_MS);
    expect(state().chooseUntil! - context().now()).toBeGreaterThan(CHOOSE_MS - 1_000);
  });

  it('scores a won round and updates both scores', () => {
    openThrowWindow();
    expect(throwAction(first, 'rock').accepted).toBe(true);
    expect(throwAction(second, 'scissors').accepted).toBe(true);
    // Both locked → the server resolves immediately rather than waiting it out.
    expect(state().phase).toBe('reveal');
    expect(state().players[first]!.score).toBe(1);
    expect(state().players[second]!.score).toBe(0);
    expect(state().roundResult?.outcomes[first]).toBe('win');
    expect(state().roundResult?.outcomes[second]).toBe('loss');
    expect(rockPaperScissorsGame.calculateScore(first, state())).toBe(1);
  });

  it('scores every matchup correctly through the real dispatcher', () => {
    const cases: Array<[RpsChoice, RpsChoice, string]> = [
      ['rock', 'scissors', first],
      ['scissors', 'paper', first],
      ['paper', 'rock', first],
      ['scissors', 'rock', second],
      ['paper', 'scissors', second],
      ['rock', 'paper', second],
    ];
    for (const [mine, theirs, winner] of cases) {
      const local = state();
      local.phase = 'choose';
      local.players[first]!.choice = null;
      local.players[second]!.choice = null;
      expect(throwAction(first, mine).accepted).toBe(true);
      expect(throwAction(second, theirs).accepted).toBe(true);
      expect(local.players[winner]!.score, `${mine} vs ${theirs}`).toBeGreaterThan(0);
      local.phase = 'choose';
      local.players[first]!.score = 0;
      local.players[second]!.score = 0;
      local.players[first]!.choice = null;
      local.players[second]!.choice = null;
      local.roundResult = null;
    }
  });

  it('scores a draw when both throw the same shape', () => {
    openThrowWindow();
    throwAction(first, 'paper');
    throwAction(second, 'paper');
    expect(state().phase).toBe('reveal');
    expect(state().players[first]!.score).toBe(0);
    expect(state().players[second]!.score).toBe(0);
    expect(state().players[first]!.draws).toBe(1);
    expect(state().players[second]!.draws).toBe(1);
    expect(state().roundResult?.outcomes[first]).toBe('draw');
  });

  it('hides the opponent throw until the reveal, for BOTH viewers', () => {
    openThrowWindow();
    throwAction(first, 'rock');

    // First has locked; second has not. Neither may see the other's shape.
    const firstView = view(first);
    const secondView = view(second);
    expect(firstView.myChoice).toBe('rock');
    expect(firstView.opponents[second]!.choice).toBeNull();
    expect(firstView.opponents[second]!.hasThrown).toBe(false);
    expect(secondView.myChoice).toBeNull();
    // The leak that matters: second must not learn what first threw.
    expect(secondView.opponents[first]!.choice).toBeNull();
    expect(secondView.opponents[first]!.hasThrown).toBe(true);
    expect(secondView.roundResult).toBeNull();
    // No stray field anywhere in the projection carries the hidden shape.
    expect(JSON.stringify(secondView)).not.toContain('"rock"');

    throwAction(second, 'scissors');
    const afterReveal = view(second);
    expect(afterReveal.phase).toBe('reveal');
    expect(afterReveal.opponents[first]!.choice).toBe('rock');
    expect(afterReveal.myChoice).toBe('scissors');
    expect(afterReveal.roundResult?.choices[first]).toBe('rock');
  });

  it('never serialises the hidden choice into either viewer state pre-reveal', () => {
    openThrowWindow();
    throwAction(first, 'scissors');
    for (const viewerId of [first, second]) {
      const payload = JSON.stringify(view(viewerId));
      // "scissors" may only appear as the viewer's OWN choice.
      const parsed = JSON.parse(payload) as { myChoice: string | null; roundResult: unknown };
      if (viewerId === second) expect(parsed.myChoice).toBeNull();
      expect(parsed.roundResult).toBeNull();
      expect(payload).not.toContain('"choices"');
    }
  });

  it('rejects a duplicate throw and a change of mind after locking', () => {
    openThrowWindow();
    expect(throwAction(first, 'rock').accepted).toBe(true);
    const duplicate = throwAction(first, 'rock');
    expect(duplicate.accepted).toBe(false);
    expect(duplicate.reason).toMatch(/locked/i);
    const changed = throwAction(first, 'paper');
    expect(changed.accepted).toBe(false);
    expect(state().players[first]!.choice).toBe('rock');
    // Replaying the same intent many times must not corrupt the score.
    for (let i = 0; i < 5; i += 1) throwAction(first, 'scissors');
    expect(state().players[first]!.score).toBe(0);
    expect(state().players[first]!.choice).toBe('rock');
  });

  it('rejects invalid choices', () => {
    openThrowWindow();
    for (const choice of ['lizard', 'spock', 'ROCK', '', 'rock ', 42, null, true, {}, []]) {
      const result = platform.gameManager.handleAction(room, first, {
        type: 'throw',
        payload: { choice } as never,
      });
      expect(result.accepted, `choice ${JSON.stringify(choice)}`).toBe(false);
    }
    expect(
      platform.gameManager.handleAction(room, first, { type: 'throw' }).accepted,
      'missing payload',
    ).toBe(false);
    expect(state().players[first]!.choice).toBeNull();
    expect(state().phase).toBe('choose');
  });

  it('rejects client-owned results, replays and unknown actions', () => {
    openThrowWindow();
    const hostile: Array<{ type: string; payload?: Record<string, unknown> }> = [
      { type: 'score', payload: { score: 999 } },
      { type: 'win' },
      { type: 'lose' },
      { type: 'draw' },
      { type: 'finish' },
      { type: 'result', payload: { winners: [first] } },
      { type: 'reveal' },
      { type: 'round', payload: { round: 9 } },
      { type: 'choice', payload: { choice: 'rock' } },
      { type: 'pick', payload: { doorId: 'x' } },
      { type: '' },
    ];
    for (const action of hostile) {
      const result = platform.gameManager.handleAction(room, first, action as never);
      expect(result.accepted, `action ${action.type || '<empty>'}`).toBe(false);
    }
    expect(state().players[first]!.score).toBe(0);
    expect(state().phase).toBe('choose');
  });

  it('rejects an action from a player who is not in this match', () => {
    openThrowWindow();
    expect(state().players.ghost).toBeUndefined();
    const result = platform.gameManager.handleAction(room, 'ghost', {
      type: 'throw',
      payload: { choice: 'rock' },
    });
    expect(result.accepted).toBe(false);
    expect(state().players.ghost).toBeUndefined();
  });

  it('forfeits the round to a player who throws, when the other times out', () => {
    openThrowWindow();
    throwAction(first, 'rock');
    expect(state().phase).toBe('choose');
    // Second never throws; the timer resolves the round.
    resolveRound(state(), context());
    expect(state().phase).toBe('reveal');
    expect(state().players[first]!.score).toBe(1);
    expect(state().players[second]!.score).toBe(0);
    expect(state().roundResult?.outcomes[first]).toBe('win');
    expect(state().roundResult?.outcomes[second]).toBe('forfeit');
    expect(state().roundResult?.forfeits).toEqual([second]);
    expect(state().roundResult?.choices[second]).toBeNull();
  });

  it('draws the round when NEITHER player throws, and never stalls', () => {
    openThrowWindow();
    resolveRound(state(), context());
    expect(state().phase).toBe('reveal');
    expect(state().players[first]!.score).toBe(0);
    expect(state().players[second]!.score).toBe(0);
    expect(state().roundResult?.outcomes[first]).toBe('draw');
    expect(state().roundResult?.outcomes[second]).toBe('draw');
    // The match still moves on.
    advanceAfterReveal(state(), context());
    expect(state().round).toBe(1);
    expect(state().phase).toBe('countdown');
  });

  /**
   * A match whose timers are fake from the moment it starts.
   *
   * TimerManager schedules with real setTimeout, so `vi.useFakeTimers()` has to
   * be installed BEFORE `start()` — otherwise the countdown timer is already a
   * real one and advancing the fake clock does nothing.
   */
  async function timedMatch(): Promise<{
    local: TestPlatform;
    timed: Room;
    a: string;
    b: string;
  }> {
    const local = createTestPlatform();
    const host = await createPlayer(local.platform, 'RpsClockA');
    const guest = await createPlayer(local.platform, 'RpsClockB');
    vi.useFakeTimers();
    const timed = local.platform.roomManager.createRoom({
      gameId: 'rock-paper-scissors',
      maxPlayers: 2,
      isPrivate: true,
      host,
    });
    local.platform.roomManager.joinRoom({ roomId: timed.id, player: guest });
    timed.status = 'PLAYING';
    timed.gameStartedAt = Date.now();
    local.platform.gameManager.createState(timed);
    local.platform.gameManager.start(timed);
    return { local, timed, a: host.playerId, b: guest.playerId };
  }

  it('the round timer resolves the match on its own, with no client input', async () => {
    const { local, timed, a, b } = await timedMatch();
    try {
      const clocked = () => timed.gameState as RpsState;
      expect(clocked().phase).toBe('countdown');

      // The countdown expires and the throw window opens by itself.
      await vi.advanceTimersByTimeAsync(COUNTDOWN_MS + 10);
      expect(clocked().phase).toBe('choose');

      // Nobody throws: the window expires and the round resolves anyway, so the
      // match can never wait forever on an idle client.
      await vi.advanceTimersByTimeAsync(CHOOSE_MS + 10);
      expect(clocked().phase).toBe('reveal');
      expect(clocked().history).toHaveLength(1);
      expect(clocked().roundResult?.outcomes[a]).toBe('draw');
      expect(clocked().roundResult?.outcomes[b]).toBe('draw');
      expect(clocked().roundResult?.forfeits.sort()).toEqual([a, b].sort());

      // The reveal expires and the next round starts with no client input.
      await vi.advanceTimersByTimeAsync(REVEAL_MS + 10);
      expect(clocked().phase).toBe('countdown');
      expect(clocked().round).toBe(1);
    } finally {
      vi.useRealTimers();
      local.destroy();
    }
  });

  it('plays a full match to a winner and produces a complete result', () => {
    // First wins three rounds in a row with rock vs scissors.
    for (let round = 0; round < DEFAULT_WINS_NEEDED; round += 1) {
      openThrowWindow();
      expect(throwAction(first, 'rock').accepted).toBe(true);
      expect(throwAction(second, 'scissors').accepted).toBe(true);
      expect(state().phase).toBe('reveal');
      advanceAfterReveal(state(), context());
    }
    expect(state().players[first]!.score).toBe(3);
    expect(state().players[second]!.score).toBe(0);
    expect(state().phase).toBe('finished');
    expect(state().finishReason).toBe('completed');
    expect(rockPaperScissorsGame.isGameFinished(state())).toBe(true);
    expect(rockPaperScissorsGame.checkWinCondition(state())).toEqual([first]);
    expect(rockPaperScissorsGame.checkDrawCondition(state())).toBe(false);

    const result = room.gameResult;
    expect(result, 'match produced no result').not.toBeNull();
    expect(result!.winners).toEqual([first]);
    expect(result!.isDraw).toBe(false);
    expect(result!.rankings).toHaveLength(2);
    expect(result!.rankings[0]!.playerId).toBe(first);
    expect(result!.rankings[0]!.rank).toBe(1);
    expect(result!.rankings[0]!.isWinner).toBe(true);
    expect(result!.rankings[1]!.rank).toBe(2);
    expect(result!.rankings[1]!.isWinner).toBe(false);
    expect(result!.rankings[0]!.stats.roundsWon).toBe(3);

    // Nothing is accepted after the finish line.
    expect(throwAction(first, 'rock').accepted).toBe(false);
    expect(throwAction(second, 'paper').accepted).toBe(false);
    expect(state().players[first]!.score).toBe(3);
  });

  it('reaches the win target from behind: the leader is whoever has 3 first', () => {
    const script: Array<[RpsChoice, RpsChoice]> = [
      ['rock', 'paper'], // second
      ['rock', 'paper'], // second
      ['paper', 'rock'], // first
      ['paper', 'rock'], // first
      ['scissors', 'rock'], // second → 3
    ];
    for (const [mine, theirs] of script) {
      openThrowWindow();
      throwAction(first, mine);
      throwAction(second, theirs);
      if (state().phase === 'reveal') advanceAfterReveal(state(), context());
    }
    expect(state().players[second]!.score).toBe(3);
    expect(state().players[first]!.score).toBe(2);
    expect(state().phase).toBe('finished');
    expect(room.gameResult!.winners).toEqual([second]);
  });

  it('declares a draw when the round cap is reached level', () => {
    const local = state();
    local.maxRounds = 2;
    local.winsNeeded = 5;
    for (let round = 0; round < 2; round += 1) {
      local.phase = 'choose';
      local.players[first]!.choice = 'rock';
      local.players[second]!.choice = 'rock';
      resolveRound(local, context());
      advanceAfterReveal(local, context());
    }
    expect(local.phase).toBe('finished');
    expect(local.players[first]!.score).toBe(0);
    expect(local.players[second]!.score).toBe(0);
    expect(rockPaperScissorsGame.checkDrawCondition(local)).toBe(true);
    expect(room.gameResult!.isDraw).toBe(true);
  });

  it('keeps a full round log of revealed throws', () => {
    for (let round = 0; round < 3; round += 1) {
      openThrowWindow();
      throwAction(first, 'rock');
      throwAction(second, 'paper');
      advanceAfterReveal(state(), context());
    }
    expect(state().history).toHaveLength(3);
    expect(state().history[0]!.choices[first]).toBe('rock');
    expect(state().history[2]!.outcomes[second]).toBe('win');
    // Revealed history is public to both viewers.
    expect(view(second).roundResult).not.toBeNull();
  });

  it('survives a disconnect and a reconnect without stalling', () => {
    openThrowWindow();
    throwAction(first, 'rock');

    // A dropped socket keeps the seat: the player is flagged, not removed.
    rockPaperScissorsGame.playerLeft(second, state(), context(), 'disconnect');
    expect(state().players[second]!.disconnected).toBe(true);
    expect(state().players[second]!.left).toBe(false);
    expect(state().phase).toBe('choose');

    // The round still resolves on the timer: the disconnected seat forfeits it,
    // so a dropped connection can never hang the match.
    resolveRound(state(), context());
    expect(state().players[first]!.score).toBe(1);
    expect(state().roundResult?.outcomes[second]).toBe('forfeit');

    // Reconnecting restores the seat with its score intact.
    const returning = players.find((player) => player.id === second)!;
    rockPaperScissorsGame.playerJoined(returning, state());
    expect(state().players[second]!.disconnected).toBe(false);
    expect(state().players[second]!.left).toBe(false);
    expect(state().players[second]!.score).toBe(0);
    expect(state().players[first]!.score).toBe(1);

    // And they can throw normally in the next round.
    advanceAfterReveal(state(), context());
    openThrowWindow();
    expect(throwAction(second, 'paper').accepted).toBe(true);
    expect(state().players[second]!.choice).toBe('paper');
  });

  it('ends the match as abandoned when a player leaves for good', () => {
    openThrowWindow();
    // The real departure path: RoomManager -> GameManager -> playerLeft('leave').
    // The platform runs cleanup() at the finish line, so hold the reference the
    // module mutated and assert on the fields cleanup deliberately preserves.
    const before = state();
    platform.roomManager.leaveRoom(room, second, 'leave');

    // The module ended the match itself: no round is left hanging mid-throw.
    expect(before.phase).toBe('finished');
    expect(before.finishReason).toBe('abandoned');
    expect(before.countdownUntil).toBeNull();
    expect(before.chooseUntil).toBeNull();
    expect(before.players[second]).toBeUndefined(); // cleanup() emptied the seats

    // A 2-player match cannot continue with one seat, so the platform returns
    // the room to the lobby rather than offering a rematch.
    expect(room.players.size).toBe(1);
    expect(room.status).toBe('LOBBY');
    expect(room.gameResult).toBeNull();

    // Nothing is playable after the match is over.
    expect(throwAction(first, 'rock').accepted).toBe(false);
  });

  it('reset() clears the match for a rematch but keeps the seats', () => {
    openThrowWindow();
    throwAction(first, 'rock');
    throwAction(second, 'scissors');
    expect(state().players[first]!.score).toBe(1);
    expect(state().history).toHaveLength(1);

    const fresh = rockPaperScissorsGame.reset(state());
    expect(fresh.phase).toBe('idle');
    expect(fresh.round).toBe(0);
    expect(fresh.history).toHaveLength(0);
    expect(fresh.roundResult).toBeNull();
    expect(fresh.finishReason).toBeNull();
    expect(fresh.players[first]!.score).toBe(0);
    expect(fresh.players[second]!.score).toBe(0);
    expect(fresh.players[first]!.choice).toBeNull();
    // Same two seats, same order — a rematch is not a new lobby.
    expect(fresh.seatOrder).toEqual(state().seatOrder);
    expect(Object.keys(fresh.players).sort()).toEqual([first, second].sort());
    // Win target survives the reset.
    expect(fresh.winsNeeded).toBe(state().winsNeeded);
  });

  it('cleanup() empties the state', () => {
    const local = state();
    rockPaperScissorsGame.cleanup(local, context());
    expect(Object.keys(local.players)).toHaveLength(0);
    expect(local.history).toHaveLength(0);
    expect(local.roundResult).toBeNull();
    expect(local.phase).toBe('finished');
  });

  it('a full match plays out on the server clock alone', async () => {
    const { local, timed, a, b } = await timedMatch();
    try {
      const clocked = () => timed.gameState as RpsState;
      let guard = 0;

      // Rock versus scissors every round: `a` takes each one, so the match must
      // end after exactly three rounds with no manual phase nudging at all.
      while (clocked().phase !== 'finished' && guard < 40) {
        guard += 1;
        const phase = clocked().phase;
        if (phase === 'choose') {
          local.platform.gameManager.handleAction(timed, a, { type: 'throw', payload: { choice: 'rock' } });
          local.platform.gameManager.handleAction(timed, b, { type: 'throw', payload: { choice: 'scissors' } });
        }
        const step =
          phase === 'countdown' ? COUNTDOWN_MS + 10 : phase === 'reveal' ? REVEAL_MS + 10 : 250;
        await vi.advanceTimersByTimeAsync(step);
      }

      expect(clocked().phase).toBe('finished');
      expect(clocked().history).toHaveLength(DEFAULT_WINS_NEEDED);
      expect(clocked().finishReason).toBe('completed');
      expect(timed.status).toBe('REMATCH_WAITING');
      expect(timed.gameResult!.winners).toEqual([a]);
      expect(timed.gameResult!.isDraw).toBe(false);
      expect(timed.gameResult!.rankings[0]!.stats.roundsWon).toBe(DEFAULT_WINS_NEEDED);
    } finally {
      vi.useRealTimers();
      local.destroy();
    }
  });
});

describe('Rock Paper Scissors — module surface', () => {
  it('exposes a legal GameModule and declares no update loop', () => {
    expect(typeof rockPaperScissorsGame.validateAction).toBe('function');
    expect(typeof rockPaperScissorsGame.handlePlayerAction).toBe('function');
    expect(typeof rockPaperScissorsGame.getPublicState).toBe('function');
    expect(typeof rockPaperScissorsGame.getAIMove).toBe('function');
    expect(rockPaperScissorsGame.needsUpdateLoop?.()).toBeFalsy();
    expect(rockPaperScissorsGame.maxDurationMs).toBeGreaterThan(0);
  });

  it('the countdown is short and the throw window is bounded', () => {
    expect(COUNTDOWN_MS).toBeLessThanOrEqual(5_000);
    expect(CHOOSE_MS).toBeGreaterThan(2_000);
    expect(CHOOSE_MS).toBeLessThanOrEqual(15_000);
  });

  it('beginCountdown clears the previous round throws', () => {
    const state = rockPaperScissorsGame.createInitialState(
      [{ id: 'p1' }, { id: 'p2' }] as unknown as GamePlayerView[],
      {},
    );
    state.phase = 'reveal';
    state.players.p1!.choice = 'rock';
    state.players.p2!.choice = 'paper';
    state.roundResult = record(0, { p1: 'rock', p2: 'paper' });
    const timers: number[] = [];
    const ctx = {
      now: () => 1_000,
      random: () => 0.5,
      schedule: (delay: number) => {
        timers.push(delay);
        return `t${timers.length}`;
      },
      cancel: () => undefined,
      requestAI: () => undefined,
      markStateChanged: () => undefined,
      finish: () => undefined,
      players: [],
    } as unknown as GameContext;

    beginCountdown(state, ctx);
    expect(state.phase).toBe('countdown');
    expect(state.players.p1!.choice).toBeNull();
    expect(state.players.p2!.choice).toBeNull();
    expect(state.roundResult).toBeNull();
    expect(state.countdownUntil).toBe(1_000 + COUNTDOWN_MS);
    expect(timers).toEqual([COUNTDOWN_MS]);

    beginChoose(state, ctx);
    expect(state.phase).toBe('choose');
    expect(state.chooseUntil).toBe(1_000 + CHOOSE_MS);
    expect(timers).toEqual([COUNTDOWN_MS, CHOOSE_MS]);
  });

  it('beginChoose is a no-op once the window has passed', () => {
    const state = rockPaperScissorsGame.createInitialState(
      [{ id: 'p1' }, { id: 'p2' }] as unknown as GamePlayerView[],
      {},
    );
    state.phase = 'reveal';
    const ctx = {
      now: () => 0,
      schedule: () => 'never',
      markStateChanged: () => undefined,
      players: [],
    } as unknown as GameContext;
    beginChoose(state, ctx);
    expect(state.phase).toBe('reveal');
    expect(state.chooseUntil).toBeNull();
  });
});
