import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPlayer, createTestPlatform, waitFor, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  assignRoles,
  beginNextSecretRound,
  completeSecretRound,
  finishSecretMatch,
  openCluePhase,
  openGuessPhase,
  openVoting,
  secretRoleGame,
  type SecretRoleState,
} from './index';
import type { Room } from '../../rooms/Room';

async function threePlayerFixture(platform: Platform): Promise<{ room: Room; players: GamePlayerView[] }> {
  const host = await createPlayer(platform, 'AgentHost');
  const g1 = await createPlayer(platform, 'CitizenOne');
  const g2 = await createPlayer(platform, 'CitizenTwo');
  const room = platform.roomManager.createRoom({
    gameId: 'secret-role',
    maxPlayers: 3,
    isPrivate: false,
    host,
    settings: { rounds: 2 },
  });
  platform.roomManager.joinRoom({ roomId: room.id, player: g1 });
  platform.roomManager.joinRoom({ roomId: room.id, player: g2 });
  room.status = 'PLAYING';
  room.gameStartedAt = Date.now();
  platform.gameManager.createState(room);
  platform.gameManager.start(room);
  return { room, players: platform.gameManager.playerViews(room) };
}

describe('Secret Role', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await threePlayerFixture(platform);
    room = fixture.room;
    players = fixture.players;
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as SecretRoleState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const publicState = (viewerId?: string) =>
    platform.gameManager.getPublicState(room, viewerId) as {
      phase: string;
      myRole: string | null;
      myTopic: string | null;
      agentId: string | null;
      topics: Array<{ id: string }>;
      currentPlayerId: string | null;
    };

  it('assigns exactly one agent', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const { agentId, roles } = assignRoles(ids, () => 0.1);
    expect(Object.values(roles).filter((role) => role === 'agent')).toHaveLength(1);
    expect(roles[agentId]).toBe('agent');
  });

  it('never leaks the agent identity or topic to the agent client', async () => {
    await waitFor(() => state().current !== null, { timeoutMs: 5000 });
    const agentId = state().current!.agentId;
    const citizenId = players.find((player) => player.id !== agentId)!.id;
    const agentView = publicState(agentId);
    expect(agentView.agentId).toBeNull();
    expect(agentView.myRole).toBe('agent');
    expect(agentView.myTopic).toBeNull();
    const citizenView = publicState(citizenId);
    expect(citizenView.myRole).toBe('citizen');
    expect(citizenView.myTopic).toBe(state().current!.topic.name);
    expect(citizenView.agentId).toBeNull();
  });

  it('rejects out-of-turn clues and duplicate clues', async () => {
    await waitFor(() => state().current !== null, { timeoutMs: 5000 });
    openCluePhase(state(), context());
    const current = state().current!.turnOrder[state().current!.turnIndex]!;
    const other = state().current!.turnOrder.find((id) => id !== current)!;
    expect(
      secretRoleGame.validateAction(other, { type: 'clue', payload: { text: 'hello' } }, state(), context()).valid,
    ).toBe(false);
    const result = platform.gameManager.handleAction(room, current, {
      type: 'clue',
      payload: { text: 'busy halls' },
    });
    expect(result.accepted).toBe(true);
    expect(
      secretRoleGame.validateAction(current, { type: 'clue', payload: { text: 'again' } }, state(), context()).valid,
    ).toBe(false);
  });

  it('rejects self-votes and duplicate votes', async () => {
    await waitFor(() => state().current !== null, { timeoutMs: 5000 });
    openVoting(state(), context());
    const voter = players[0]!.id;
    expect(
      secretRoleGame.validateAction(voter, { type: 'vote', payload: { targetId: voter } }, state(), context()).valid,
    ).toBe(false);
    const target = players[1]!.id;
    expect(platform.gameManager.handleAction(room, voter, { type: 'vote', payload: { targetId: target } }).accepted).toBe(
      true,
    );
    expect(
      secretRoleGame.validateAction(voter, { type: 'vote', payload: { targetId: target } }, state(), context()).valid,
    ).toBe(false);
  });

  it('citizens win when the majority names the agent', async () => {
    await waitFor(() => state().current !== null, { timeoutMs: 5000 });
    const round = state().current!;
    const agentId = round.agentId;
    const citizens = players.filter((player) => player.id !== agentId);
    openVoting(state(), context());
    for (const citizen of citizens) {
      platform.gameManager.handleAction(room, citizen.id, { type: 'vote', payload: { targetId: agentId } });
    }
    platform.gameManager.handleAction(room, agentId, {
      type: 'vote',
      payload: { targetId: citizens[0]!.id },
    });
    if (state().phase === 'guess') {
      completeSecretRound(state(), context());
    }
    expect(state().phase).toBe('reveal');
    expect(state().current!.citizensWon).toBe(true);
    expect(state().scores[citizens[0]!.id]).toBe(100);
  });

  it('agent wins by guessing the topic', async () => {
    await waitFor(() => state().current !== null, { timeoutMs: 5000 });
    openGuessPhase(state(), context());
    const agentId = state().current!.agentId;
    const result = platform.gameManager.handleAction(room, agentId, {
      type: 'guess-topic',
      payload: { topic: state().current!.topic.id },
    });
    expect(result.accepted).toBe(true);
    expect(state().current!.topicGuessCorrect).toBe(true);
    expect(state().current!.citizensWon).toBe(false);
    expect(state().scores[agentId]).toBe(200);
  });

  it('non-agents cannot guess the topic', async () => {
    await waitFor(() => state().current !== null, { timeoutMs: 5000 });
    openGuessPhase(state(), context());
    const citizen = players.find((player) => player.id !== state().current!.agentId)!;
    expect(
      secretRoleGame.validateAction(
        citizen.id,
        { type: 'guess-topic', payload: { topic: 'school' } },
        state(),
        context(),
      ).valid,
    ).toBe(false);
  });

  it('progresses rounds and finishes with rankings', async () => {
    await waitFor(() => state().current !== null, { timeoutMs: 5000 });
    const forceComplete = () => {
      if (state().phase !== 'guess' && state().phase !== 'voting' && state().phase !== 'clue') {
        state().phase = 'guess';
      }
      completeSecretRound(state(), context());
      beginNextSecretRound(state(), context());
    };
    forceComplete();
    expect(state().round).toBe(2);
    forceComplete();
    expect(state().phase).toBe('finished');
    state().scores[players[0]!.id] = 999;
    const draft = secretRoleGame.getResult(state(), context());
    expect(draft.rankings).toHaveLength(3);
    expect(draft.winners).toContain(players[0]!.id);
  });

  it('timeout finishes the match', async () => {
    await waitFor(() => state().current !== null, { timeoutMs: 5000 });
    finishSecretMatch(state(), context(), 'timeout');
    expect(state().phase).toBe('finished');
    expect(secretRoleGame.isGameFinished(state())).toBe(true);
  });

  it('reset keeps three seats', async () => {
    await waitFor(() => state().current !== null, { timeoutMs: 5000 });
    const seats = Object.keys(state().scores);
    expect(seats).toHaveLength(3);
    const next = secretRoleGame.reset(state());
    expect(Object.keys(next.scores)).toEqual(seats);
    expect(next.phase).toBe('idle');
    expect(next.current).toBeNull();
  });

  it('AI clues and votes are legal', async () => {
    await waitFor(() => state().current !== null, { timeoutMs: 5000 });
    openCluePhase(state(), context());
    const current = state().current!.turnOrder[0]!;
    const move = secretRoleGame.getAIMove?.(current, 'medium', state(), context());
    expect(move?.type).toBe('clue');
    openVoting(state(), context());
    const vote = secretRoleGame.getAIMove?.(current, 'easy', state(), context());
    expect(vote?.type).toBe('vote');
    expect(vote?.payload?.targetId).not.toBe(current);
  });
});
