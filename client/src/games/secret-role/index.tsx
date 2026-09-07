import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Send } from 'lucide-react';
import { SECRET_ROLE_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { cn } from '../../utils/cn';

export interface SecretRolePublicState {
  phase: 'idle' | 'intro' | 'clue' | 'voting' | 'guess' | 'reveal' | 'finished';
  round: number;
  totalRounds: number;
  endsAt: number | null;
  currentPlayerId: string | null;
  turnOrder: string[];
  clues: Array<{ playerId: string; text: string }>;
  voted: string[];
  myVote: string | null;
  myRole: 'citizen' | 'agent' | null;
  myTopic: string | null;
  topics: Array<{ id: string; name: string }>;
  agentId: string | null;
  accusedId: string | null;
  topicGuessCorrect: boolean;
  citizensWon: boolean | null;
  scores: Record<string, number>;
  history: Array<{
    number: number;
    topicName: string;
    agentId: string;
    accusedId: string | null;
    citizensWon: boolean;
    topicGuessCorrect: boolean;
  }>;
  lastEvent: string | null;
  isAgent: boolean;
}

function SecretRoleGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<SecretRolePublicState>) {
  const [clue, setClue] = useState('');
  const previousPhase = useRef(state?.phase);
  const inputRef = useRef<HTMLInputElement>(null);

  const phase = state?.phase ?? 'idle';
  const myTurn = phase === 'clue' && state?.currentPlayerId === myPlayerId;
  const iVoted = Boolean(state?.myVote);
  const iAmAgent = state?.myRole === 'agent';

  useEffect(() => {
    if (myTurn) inputRef.current?.focus();
  }, [myTurn, state?.round]);

  useEffect(() => {
    if (state?.phase === previousPhase.current) return;
    previousPhase.current = state?.phase;
    if (state?.phase === 'voting') play('notification');
    if (state?.phase === 'reveal') {
      if (state.citizensWon) play('correct');
      else play('wrong');
    }
  }, [state?.phase, state?.citizensWon, play]);

  const submitClue = () => {
    const text = clue.trim();
    if (!text || !myTurn) return;
    sendAction({ type: 'clue', payload: { text } } satisfies GameAction);
    setClue('');
    play('click');
    vibrate('buttonPress');
  };

  const voteFor = (targetId: string) => {
    if (phase !== 'voting' || iVoted || targetId === myPlayerId) return;
    sendAction({ type: 'vote', payload: { targetId } } satisfies GameAction);
    play('click');
    vibrate('buttonPress');
  };

  const guessTopic = (topic: string) => {
    if (phase !== 'guess' || !iAmAgent) return;
    sendAction({ type: 'guess-topic', payload: { topic } } satisfies GameAction);
    play('click');
    vibrate('buttonPress');
  };

  const current = players.find((player) => player.id === state?.currentPlayerId);

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({
          ...player,
          score: state?.scores?.[player.id] ?? player.score,
        }))}
        myPlayerId={myPlayerId}
        currentTurnPlayerId={state?.currentPlayerId ?? null}
        deadline={state?.endsAt ?? null}
        label={phase === 'voting' ? 'Vote' : phase === 'guess' ? 'Agent guess' : 'Turn'}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary">
          Round {Math.max(1, state?.round ?? 0)} / {state?.totalRounds ?? 4}
        </Badge>
        {state?.myRole ? (
          <Badge tone={iAmAgent ? 'danger' : 'success'}>
            You are {iAmAgent ? 'the Secret Agent' : 'a Citizen'}
          </Badge>
        ) : null}
        {state?.myTopic ? <Badge tone="accent">Location: {state.myTopic}</Badge> : null}
        {iAmAgent && phase !== 'reveal' && phase !== 'finished' ? (
          <Badge tone="warning">You do not know the location</Badge>
        ) : null}
      </div>

      <div className="card space-y-2 p-4">
        {phase === 'idle' ? <p className="animate-pulse text-sm text-slate-400">Dealing roles…</p> : null}
        {phase === 'intro' ? (
          <p className="text-sm text-slate-200">
            {iAmAgent
              ? 'Blend in. You are the Secret Agent — you do not know the location.'
              : `You are a Citizen. The location is ${state?.myTopic ?? 'hidden'}. Do not say it outright.`}
          </p>
        ) : null}
        {phase === 'clue' ? (
          <p className="text-sm text-slate-300">
            {myTurn ? 'Your turn — give a short clue.' : `Waiting for ${current?.nickname ?? 'a player'}…`}
          </p>
        ) : null}
        {phase === 'voting' ? (
          <p className="text-sm text-slate-300">Vote for who you think is the Secret Agent. You cannot vote for yourself.</p>
        ) : null}
        {phase === 'guess' ? (
          <p className="text-sm text-slate-300">
            {iAmAgent
              ? 'Last chance: guess the location. A hit wins the round for you.'
              : 'The Secret Agent may try to guess the location…'}
          </p>
        ) : null}
        {phase === 'reveal' ? (
          <div className="space-y-1">
            <p className="text-lg font-bold text-white">
              {state?.citizensWon ? 'Citizens win the round' : 'The Secret Agent wins the round'}
            </p>
            <p className="text-sm text-slate-300">
              Location: {state?.myTopic ?? state?.history?.[state.history.length - 1]?.topicName}. Agent:{' '}
              {players.find((player) => player.id === state?.agentId)?.nickname ?? 'unknown'}
            </p>
          </div>
        ) : null}
      </div>

      {state?.clues && state.clues.length > 0 ? (
        <ul className="space-y-1.5" aria-label="Clues">
          {state.clues.map((entry) => (
            <li key={entry.playerId} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm">
              <span className="font-medium text-primary-300">
                {players.find((player) => player.id === entry.playerId)?.nickname ?? 'Player'}:
              </span>{' '}
              <span className="text-slate-200">{entry.text}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {myTurn ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submitClue();
          }}
        >
          <label className="sr-only" htmlFor="secret-clue">
            Clue
          </label>
          <input
            id="secret-clue"
            ref={inputRef}
            value={clue}
            maxLength={48}
            onChange={(event) => setClue(event.target.value)}
            placeholder="Short clue — do not name the location"
            className="input flex-1"
          />
          <Button type="submit" disabled={clue.trim().length < 1} icon={<Send className="h-4 w-4" />}>
            Send
          </Button>
        </form>
      ) : null}

      {phase === 'voting' ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {players.map((player) => {
            const disabled = player.id === myPlayerId || iVoted;
            const selected = state?.myVote === player.id;
            return (
              <button
                key={player.id}
                type="button"
                disabled={disabled}
                onClick={() => voteFor(player.id)}
                className={cn(
                  'min-h-touch rounded-2xl border px-4 py-3 text-left text-sm font-medium transition active:scale-[0.99]',
                  selected ? 'border-success bg-success/15 text-white' : 'border-white/10 bg-white/5 text-slate-200',
                  disabled && !selected && 'opacity-40',
                )}
              >
                {player.avatar} {player.nickname}
                {player.id === myPlayerId ? ' (you)' : ''}
                {state?.voted?.includes(player.id) ? ' · voted' : ''}
              </button>
            );
          })}
        </div>
      ) : null}

      {phase === 'guess' && iAmAgent ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {(state?.topics ?? []).map((topic) => (
            <button
              key={topic.id}
              type="button"
              onClick={() => guessTopic(topic.id)}
              className="min-h-touch rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 active:scale-95"
            >
              {topic.name}
            </button>
          ))}
        </div>
      ) : null}

      {state?.history && state.history.length > 0 ? (
        <section className="card p-3">
          <h4 className="mb-2 text-sm font-semibold text-white">Past rounds</h4>
          <ul className="space-y-1 text-xs text-slate-400">
            {state.history.map((entry) => (
              <li key={entry.number}>
                R{entry.number}: {entry.topicName} · {entry.citizensWon ? 'citizens' : 'agent'}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export const secretRoleClient: ClientGameModule = {
  metadata: SECRET_ROLE_METADATA,
  Component: SecretRoleGame as unknown as ComponentType<GameComponentProps<never>>,
};
