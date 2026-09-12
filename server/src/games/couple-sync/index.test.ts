import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  beginRound,
  buildRound,
  coupleSyncGame,
  DEFAULT_ROUNDS,
  evaluate,
  finishCoupleSync,
  MISTAKE_PENALTY,
  resolveRound,
  ROUND_SCORE,
  roundTypeFor,
  type CoupleSyncState,
  TOGETHER_TOLERANCE_MS,
  type SyncRoundType,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Couple Sync', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'couple-sync');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as CoupleSyncState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const act = (playerId: string, choice?: string) =>
    platform.gameManager.handleAction(
      room,
      playerId,
      choice === undefined ? { type: 'act' } : { type: 'act', payload: { choice } },
    );

  /** Opens the round for input (start() begins in the brief phase). */
  const open = () => {
    state().phase = 'active';
  };

  /** Forces a specific round type so each mechanic can be tested directly. */
  const startRound = (type: SyncRoundType) => {
    const index = [...Array(5).keys()].find((i) => roundTypeFor(i) === type) ?? 0;
    state().round = index;
    beginRound(state(), context());
    open();
    return state().current!;
  };

  /* ---------------- setup ---------------- */

  it('starts a ten round match on the first round type', () => {
    expect(state().totalRounds).toBe(DEFAULT_ROUNDS);
    expect(state().round).toBe(0);
    expect(state().phase).toBe('brief');
    expect(state().current).not.toBeNull();
    expect(state().current!.type).toBe('together');
    expect(state().current!.endsAt).toBeGreaterThan(context().now());
  });

  it('rotates through five genuinely different round types', () => {
    const types = [0, 1, 2, 3, 4].map(roundTypeFor);
    expect(new Set(types).size).toBe(5);
    expect(types).toEqual(['together', 'relay', 'match', 'order', 'signal']);
    // The cycle repeats across the ten round match.
    expect(roundTypeFor(5)).toBe('together');
  });

  it('builds each round type with the data that round needs', () => {
    const match = startRound('match');
    expect(match.options).toHaveLength(4);
    expect(new Set(match.options).size).toBe(4);

    const relay = startRound('relay');
    expect(relay.code).toMatch(/^[A-Z2-9]{4}$/);
    expect(relay.codeHolderId).toBeTruthy();

    const order = startRound('order');
    expect(order.requiredOrder).toHaveLength(2);
    expect(new Set(order.requiredOrder).size).toBe(2);

    const signal = startRound('signal');
    expect(signal.signalAt).toBeGreaterThan(context().now());
  });

  it('the tap window tightens as the match progresses', () => {
    state().round = 0;
    const early = buildRound(state(), context()).toleranceMs;
    state().round = 9;
    const late = buildRound(state(), context()).toleranceMs;
    expect(late).toBeLessThan(early);
  });

  /* ---------------- round: together ---------------- */

  it('together: taps inside the window succeed, one partner alone waits', () => {
    const round = startRound('together');
    const [aId, bId] = players.map((player) => player.id);

    expect(act(aId).accepted).toBe(true);
    // One partner is not enough — the round is still open.
    expect(round.succeeded).toBeNull();
    expect(act(bId).accepted).toBe(true);
    expect(round.succeeded).toBe(true);
    expect(state().roundsWon).toBe(1);
    expect(state().teamScore).toBeGreaterThanOrEqual(ROUND_SCORE);
  });

  it('together: taps too far apart fail the round', () => {
    const round = startRound('together');
    const [aId, bId] = players.map((player) => player.id);
    state().players[aId]!.actedAt = context().now() - 5_000; // long ago
    state().players[bId]!.actedAt = context().now();
    const verdict = evaluate(state(), context());
    expect(verdict?.success).toBe(false);
    expect(round.toleranceMs).toBeGreaterThan(0);
  });

  /* ---------------- round: relay (hidden information) ---------------- */

  it('relay: only the holder can see the code, and only the partner submits', () => {
    const round = startRound('relay');
    const holderId = round.codeHolderId!;
    const partnerId = players.map((player) => player.id).find((id) => id !== holderId)!;

    // Privacy: the code reaches the holder and nobody else.
    const holderView = platform.gameManager.getPublicState(room, holderId) as {
      current: { code: string | null; isCodeHolder: boolean };
    };
    const partnerView = platform.gameManager.getPublicState(room, partnerId) as {
      current: { code: string | null; isCodeHolder: boolean };
    };
    expect(holderView.current.code).toBe(round.code);
    expect(holderView.current.isCodeHolder).toBe(true);
    expect(partnerView.current.code).toBeNull();
    expect(partnerView.current.isCodeHolder).toBe(false);
    expect(JSON.stringify(partnerView)).not.toContain(round.code!);

    // The holder cannot submit; the partner can.
    expect(
      coupleSyncGame.validateAction(
        holderId,
        { type: 'act', payload: { choice: round.code } },
        state(),
        context(),
      ).valid,
    ).toBe(false);
    expect(act(partnerId, round.code!).accepted).toBe(true);
    expect(round.succeeded).toBe(true);
  });

  it('relay: a wrong code fails the round and costs points', () => {
    const round = startRound('relay');
    const holderId = round.codeHolderId!;
    const partnerId = players.map((player) => player.id).find((id) => id !== holderId)!;
    state().teamScore = 200;
    expect(act(partnerId, 'WRNG').accepted).toBe(true);
    expect(round.succeeded).toBe(false);
    expect(state().teamScore).toBe(200 - MISTAKE_PENALTY);
    expect(state().streak).toBe(0);
  });

  /* ---------------- round: match ---------------- */

  it('match: identical picks succeed, different picks fail', () => {
    const round = startRound('match');
    const [aId, bId] = players.map((player) => player.id);
    const symbol = round.options[0]!;
    expect(act(aId, symbol).accepted).toBe(true);
    expect(round.succeeded).toBeNull();
    expect(act(bId, symbol).accepted).toBe(true);
    expect(round.succeeded).toBe(true);

    const second = startRound('match');
    expect(act(aId, second.options[0]!).accepted).toBe(true);
    expect(act(bId, second.options[1]!).accepted).toBe(true);
    expect(second.succeeded).toBe(false);
  });

  it('match: rejects a symbol that is not on offer', () => {
    startRound('match');
    const [aId] = players.map((player) => player.id);
    expect(
      coupleSyncGame.validateAction(
        aId,
        { type: 'act', payload: { choice: '💀' } },
        state(),
        context(),
      ).valid,
    ).toBe(false);
    expect(act(aId, '💀').accepted).toBe(false);
  });

  /* ---------------- round: order ---------------- */

  it('order: acting in the required sequence succeeds', () => {
    const round = startRound('order');
    const [first, second] = round.requiredOrder;
    expect(act(first!).accepted).toBe(true);
    expect(act(second!).accepted).toBe(true);
    expect(round.succeeded).toBe(true);
  });

  it('order: acting out of sequence fails', () => {
    const round = startRound('order');
    const [first, second] = round.requiredOrder;
    // The wrong partner acts first.
    expect(act(second!).accepted).toBe(true);
    expect(act(first!).accepted).toBe(true);
    expect(round.succeeded).toBe(false);
    expect(round.detail).toMatch(/order/i);
  });

  /* ---------------- round: signal ---------------- */

  it('signal: tapping before the go cue fails the round immediately', () => {
    const round = startRound('signal');
    const [aId] = players.map((player) => player.id);
    expect(round.signalAt).toBeGreaterThan(context().now());
    // The signal time is hidden until it actually fires.
    const view = platform.gameManager.getPublicState(room, aId) as {
      current: { signalFired: boolean; signalAt: number | null };
    };
    expect(view.current.signalFired).toBe(false);
    expect(view.current.signalAt).toBeNull();

    expect(act(aId).accepted).toBe(true);
    expect(round.succeeded).toBe(false);
    expect(round.detail).toMatch(/signal/i);
  });

  it('signal: reacting after the cue succeeds', () => {
    const round = startRound('signal');
    const [aId, bId] = players.map((player) => player.id);
    round.signalAt = context().now() - 100; // the cue has fired
    expect(act(aId).accepted).toBe(true);
    expect(act(bId).accepted).toBe(true);
    expect(round.succeeded).toBe(true);
  });

  /* ---------------- anti-cheat ---------------- */

  it('rejects outcome-asserting actions and double acting', () => {
    const round = startRound('together');
    const [aId] = players.map((player) => player.id);
    const ctx = context();
    for (const type of ['score', 'win', 'complete', 'finish', 'reveal']) {
      expect(
        coupleSyncGame.validateAction(aId, { type, payload: { score: 999 } }, state(), ctx).valid,
      ).toBe(false);
      expect(coupleSyncGame.handlePlayerAction(aId, { type }, state(), ctx).accepted).toBe(false);
    }
    expect(act(aId).accepted).toBe(true);
    // One action per player per round.
    expect(act(aId).accepted).toBe(false);
    expect(round.index).toBe(state().current!.index);
  });

  it('rejects actions during the brief, after the deadline and after the match', () => {
    const [aId] = players.map((player) => player.id);
    // Brief phase.
    expect(state().phase).toBe('brief');
    expect(act(aId).accepted).toBe(false);

    // Past the deadline.
    startRound('together');
    state().current!.endsAt = context().now() - 1;
    expect(act(aId).accepted).toBe(false);

    // After the match.
    finishCoupleSync(state(), context(), 'completed');
    expect(act(aId).accepted).toBe(false);
  });

  it('a scored round refuses further actions', () => {
    const round = startRound('together');
    const [aId, bId] = players.map((player) => player.id);
    act(aId);
    act(bId);
    expect(round.succeeded).toBe(true);
    expect(act(aId).accepted).toBe(false);
  });

  /* ---------------- progression & scoring ---------------- */

  it('a streak of wins pays a growing bonus', () => {
    resolveRound(state(), context(), true, 'ok');
    const first = state().teamScore;
    state().phase = 'active';
    state().current!.succeeded = null;
    resolveRound(state(), context(), true, 'ok');
    const second = state().teamScore - first;
    expect(state().streak).toBe(2);
    expect(state().bestStreak).toBe(2);
    expect(second).toBeGreaterThan(0);
  });

  it('records history and finishes after the final round', () => {
    state().round = state().totalRounds - 1;
    state().phase = 'active';
    beginRound(state(), context());
    state().phase = 'active';
    resolveRound(state(), context(), true, 'ok');
    expect(state().history.length).toBeGreaterThan(0);
    expect(state().history.at(-1)!.success).toBe(true);
  });

  it('the team clears the challenge by winning at least half the rounds', () => {
    state().roundsWon = state().totalRounds / 2;
    finishCoupleSync(state(), context(), 'completed');
    expect(coupleSyncGame.checkWinCondition(state())).toHaveLength(2);

    state().phase = 'finished';
    state().roundsWon = 1;
    expect(coupleSyncGame.checkWinCondition(state())).toEqual([]);
    expect(coupleSyncGame.checkDrawCondition(state())).toBe(true);
  });

  it('shares the score and result across both partners', () => {
    state().teamScore = 900;
    state().roundsWon = 8;
    finishCoupleSync(state(), context(), 'completed');
    const result = coupleSyncGame.getResult(state(), context());
    expect(result.winners).toHaveLength(2);
    expect(result.rankings.every((entry) => entry.rank === 1 && entry.score === 900)).toBe(true);
    expect(result.rankings[0]!.stats).toHaveProperty('accuracy');
  });

  /* ---------------- lifecycle ---------------- */

  it('handles disconnect, reconnect and leave', () => {
    const [aId] = players.map((player) => player.id);
    coupleSyncGame.playerLeft(aId, state(), context(), 'disconnect');
    expect(state().players[aId]!.disconnected).toBe(true);
    open();
    expect(act(aId).accepted).toBe(false);

    coupleSyncGame.playerJoined({ ...players[0]! }, state(), context());
    expect(state().players[aId]!.disconnected).toBe(false);

    coupleSyncGame.playerLeft(aId, state(), context(), 'leave');
    expect(state().phase).toBe('finished');
    expect(state().finishReason).toBe('abandoned');
  });

  it('reset and cleanup prepare a rematch', () => {
    state().teamScore = 600;
    state().roundsWon = 5;
    finishCoupleSync(state(), context(), 'completed');
    const next = coupleSyncGame.reset(state());
    expect(next.phase).toBe('idle');
    expect(next.round).toBe(0);
    expect(next.teamScore).toBe(0);
    expect(next.roundsWon).toBe(0);
    expect(next.history).toHaveLength(0);

    coupleSyncGame.cleanup(next);
    expect(Object.keys(next.players)).toHaveLength(0);
    expect(next.current).toBeNull();
  });

  /* ---------------- AI ---------------- */

  it('the AI plays every round type legally', () => {
    for (const type of ['together', 'relay', 'match', 'order', 'signal'] as SyncRoundType[]) {
      const round = startRound(type);
      for (const difficulty of ['easy', 'medium', 'hard'] as const) {
        for (const player of players) {
          const action = coupleSyncGame.getAIMove?.(player.id, difficulty, state(), context());
          if (!action) continue;
          expect(action.type).toBe('act');
          // Whatever the AI proposes must pass the same validation as a human.
          const verdict = coupleSyncGame.validateAction(player.id, action, state(), context());
          if (type === 'relay' && player.id === round.codeHolderId) {
            expect(verdict.valid).toBe(false); // holder is correctly barred
          } else {
            expect(verdict.valid).toBe(true);
          }
        }
      }
    }
  });

  it('the AI never taps before the go signal', () => {
    const round = startRound('signal');
    const [aId] = players.map((player) => player.id);
    expect(round.signalAt).toBeGreaterThan(context().now());
    // No move offered while the cue is pending — the AI does not cheat.
    expect(coupleSyncGame.getAIMove?.(aId, 'hard', state(), context())).toBeNull();
    round.signalAt = context().now() - 10;
    expect(coupleSyncGame.getAIMove?.(aId, 'hard', state(), context())).not.toBeNull();
  });

  it('two AI partners can win a together round', () => {
    const round = startRound('together');
    const [aId, bId] = players.map((player) => player.id);
    // One leads, the other follows — exactly the cooperative pattern.
    act(aId);
    const follow = coupleSyncGame.getAIMove?.(bId, 'hard', state(), context());
    expect(follow).not.toBeNull();
    platform.gameManager.handleAction(room, bId, follow!);
    expect(round.succeeded).toBe(true);
  });

  it('publishes progressive difficulty and live coordination metrics without leaking the future signal', () => {
    state().round = 4;
    const round = startRound('signal');
    const before = platform.gameManager.getPublicState(room, players[0]!.id) as any;
    expect(before.difficultyTier).toBe(2);
    expect(before.current.signalFired).toBe(false);
    expect(before.current.signalAt).toBeNull();
    round.signalAt = context().now() - 1;
    const live = platform.gameManager.getPublicState(room, players[0]!.id) as any;
    expect(live.current.signalFired).toBe(true);
    expect(live.current.signalAt).toBe(round.signalAt);

    const together = startRound('together');
    const [a, b] = players.map((player) => player.id);
    state().players[a]!.actedAt = 1000;
    state().players[b]!.actedAt = 1250;
    const coordinated = platform.gameManager.getPublicState(room, a) as any;
    expect(coordinated.current.syncSpreadMs).toBe(250);
    expect(together.toleranceMs).toBeLessThanOrEqual(TOGETHER_TOLERANCE_MS);
  });
});
