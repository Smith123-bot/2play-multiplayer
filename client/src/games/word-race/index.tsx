import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { Send, Type } from 'lucide-react';
import { WORD_RACE_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { cn } from '../../utils/cn';

export interface WordRacePublicState {
  phase: 'idle' | 'intro' | 'typing' | 'roundResult' | 'finished';
  round: number;
  totalRounds: number;
  category: string | null;
  roundEndsAt: number | null;
  serverTime: number;
  usedWords: string[];
  scores: Record<string, number>;
  submissions: Array<{
    playerId: string;
    word: string;
    valid: boolean;
    reason: 'ok' | 'invalid' | 'duplicate';
    points: number;
    at: number;
  }>;
  roundResults: Array<{ round: number; category: string | null; scores: Record<string, number> }>;
  lastEvent: string | null;
}

function WordRaceGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<WordRacePublicState>) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const typing = state?.phase === 'typing';

  useEffect(() => {
    if (typing) inputRef.current?.focus();
  }, [typing, state?.round]);

  const mySubmissions = useMemo(
    () => (state?.submissions ?? []).filter((entry) => entry.playerId === myPlayerId),
    [state?.submissions, myPlayerId],
  );

  const submit = () => {
    const word = value.trim();
    if (!word || !typing) return;
    sendAction({ type: 'submit', payload: { word } } satisfies GameAction);
    setValue('');
    play('click');
    vibrate('buttonPress');
  };

  const lastMine = mySubmissions[mySubmissions.length - 1];

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({ ...player, score: state?.scores?.[player.id] ?? player.score }))}
        myPlayerId={myPlayerId}
        deadline={state?.roundEndsAt ?? null}
        label="Round time"
      />

      <div className="card space-y-3 p-4 text-center">
        <p className="text-xs uppercase tracking-wider text-slate-400">
          Round {state?.round ?? 0} of {state?.totalRounds ?? 3}
        </p>
        <h3 className="text-3xl font-black text-gradient">
          {state?.category ?? 'Get ready'}
        </h3>
        <p className="text-sm text-slate-400">
          {state?.phase === 'intro'
            ? 'Starting in a moment…'
            : state?.phase === 'typing'
              ? 'Type as many words as you can!'
              : state?.phase === 'roundResult'
                ? 'Round over'
                : 'Match complete'}
        </p>
      </div>

      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="sr-only" htmlFor="word-input">
          Word
        </label>
        <div className="relative flex-1">
          <Type className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            id="word-input"
            ref={inputRef}
            value={value}
            disabled={!typing}
            maxLength={24}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={typing ? `A ${state?.category ?? 'word'}…` : 'Waiting for the round'}
            onChange={(event) => setValue(event.target.value)}
            className="input pl-10"
          />
        </div>
        <Button type="submit" disabled={!typing || value.trim().length < 2} icon={<Send className="h-4 w-4" />}>
          Send
        </Button>
      </form>

      {lastMine ? (
        <p
          className={cn(
            'text-center text-sm font-medium',
            lastMine.valid ? 'text-success' : 'text-danger',
          )}
          aria-live="polite"
        >
          {lastMine.valid
            ? `+1 point for "${lastMine.word}"`
            : lastMine.reason === 'duplicate'
              ? `"${lastMine.word}" was already used`
              : `"${lastMine.word}" is not in the ${state?.category ?? ''} list`}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <section className="card p-3">
          <h4 className="mb-2 text-sm font-semibold text-white">Your words ({mySubmissions.filter((entry) => entry.valid).length})</h4>
          {mySubmissions.length === 0 ? (
            <p className="text-xs text-slate-500">No submissions yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {mySubmissions.map((entry, index) => (
                <li key={`${entry.word}-${index}`}>
                  <Badge tone={entry.valid ? 'success' : 'danger'}>{entry.word}</Badge>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-3">
          <h4 className="mb-2 text-sm font-semibold text-white">Words on the table</h4>
          {(state?.usedWords ?? []).length === 0 ? (
            <p className="text-xs text-slate-500">Nothing yet.</p>
          ) : (
            <ul className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
              {state?.usedWords?.map((word) => <li key={word}><Badge>{word}</Badge></li>)}
            </ul>
          )}
        </section>
      </div>

      <p className="text-center text-xs text-slate-500">
        The server dictionary decides what counts — your browser never validates words.
      </p>
    </div>
  );
}

export const wordRaceClient: ClientGameModule = {
  metadata: WORD_RACE_METADATA,
  Component: WordRaceGame as unknown as ComponentType<GameComponentProps<never>>,
};
