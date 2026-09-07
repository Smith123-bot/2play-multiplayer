import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { motion } from 'framer-motion';
import { Check, Send } from 'lucide-react';
import { WORD_SCRAMBLE_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { cn } from '../../utils/cn';

export interface WordScramblePublicState {
  phase: 'idle' | 'round' | 'reveal' | 'finished';
  round: number;
  totalRounds: number;
  roundMs: number;
  scrambled: string | null;
  endsAt: number | null;
  solved: string[];
  solvedAtMs: Record<string, number>;
  attempts: Record<string, number>;
  scores: Record<string, number>;
  solvedCount: Record<string, number>;
  history: Array<{ number: number; word: string; scrambled: string; solvedOrder: string[] }>;
  answer: string | null;
  finishReason: string | null;
  serverTime: number;
}

function WordScrambleGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<WordScramblePublicState>) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const previousRound = useRef(0);
  const previousSolved = useRef(0);

  const phase = state?.phase ?? 'idle';
  const typing = phase === 'round';
  const iSolved = myPlayerId ? (state?.solved?.includes(myPlayerId) ?? false) : false;
  const attempts = myPlayerId ? (state?.attempts?.[myPlayerId] ?? 0) : 0;

  useEffect(() => {
    if (typing) inputRef.current?.focus();
  }, [typing, state?.round]);

  // New round → clear the input.
  useEffect(() => {
    if ((state?.round ?? 0) !== previousRound.current) {
      previousRound.current = state?.round ?? 0;
      setValue('');
    }
  }, [state?.round]);

  // Someone solved the word.
  const solvedCount = state?.solved?.length ?? 0;
  useEffect(() => {
    if (solvedCount > previousSolved.current) {
      const lastSolver = state?.solved?.[solvedCount - 1];
      if (lastSolver === myPlayerId) {
        play('correct');
        vibrate('success');
      } else {
        play('notification');
      }
    }
    previousSolved.current = solvedCount;
  }, [solvedCount, state?.solved, myPlayerId, play, vibrate]);

  const lastFeedback = useMemo(() => {
    if (!typing || attempts === 0 || iSolved) return null;
    return { wrong: true };
  }, [typing, attempts, iSolved]);

  const submit = () => {
    const answer = value.trim();
    if (!answer || !typing || iSolved) return;
    sendAction({ type: 'submit', payload: { answer } } satisfies GameAction);
    setValue('');
    play('click');
    vibrate('buttonPress');
  };

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({
          ...player,
          score: state?.scores?.[player.id] ?? player.score,
        }))}
        myPlayerId={myPlayerId}
        deadline={state?.endsAt ?? null}
        label="Round time"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge tone="primary">
          Round {Math.max(1, state?.round ?? 0)} / {state?.totalRounds ?? 5}
        </Badge>
        {iSolved ? (
          <Badge tone="success" icon={<Check className="h-3 w-3" aria-hidden />}>
            Solved — wait for the others
          </Badge>
        ) : null}
        {phase === 'reveal' ? <Badge tone="accent">Reveal</Badge> : null}
        {phase === 'finished' ? <Badge tone="success">Match complete</Badge> : null}
      </div>

      <div className="card space-y-3 p-4 text-center">
        {phase === 'idle' ? (
          <p className="animate-pulse text-sm text-slate-400">Choosing the first word…</p>
        ) : null}

        {typing || phase === 'reveal' ? (
          <>
            <p className="text-xs uppercase tracking-wider text-slate-400">Unscramble the word</p>
            <div className="flex flex-wrap justify-center gap-1.5" aria-live="polite">
              {[...(state?.scrambled ?? '')].map((letter, index) => (
                <motion.span
                  key={`${state?.round}-${index}`}
                  initial={{ opacity: 0, y: 8, rotate: -6 }}
                  animate={{ opacity: 1, y: 0, rotate: 0 }}
                  transition={{ delay: index * 0.04 }}
                  className={cn(
                    'grid h-11 w-9 place-items-center rounded-lg border border-white/10 bg-white/5 text-xl font-black text-white sm:h-14 sm:w-12 sm:text-2xl',
                    phase === 'reveal' && 'border-success/40 bg-success/10',
                  )}
                >
                  {letter}
                </motion.span>
              ))}
            </div>

            {phase === 'reveal' ? (
              <div className="space-y-1">
                <p className="text-sm text-slate-400">The word was</p>
                <p className="text-2xl font-black text-success">{state?.answer}</p>
                <p className="text-xs text-slate-500">
                  {state?.solved?.length
                    ? `Solved by ${state.solved
                        .map((id) => players.find((player) => player.id === id)?.nickname ?? 'Someone')
                        .join(', ')}`
                    : 'Nobody solved it — no points.'}
                </p>
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                1 point per solve · solve in the first half for +1 bonus
              </p>
            )}
          </>
        ) : null}

        {phase === 'finished' ? <p className="text-sm text-slate-400">Match complete — check the results.</p> : null}
      </div>

      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="sr-only" htmlFor="scramble-input">
          Your answer
        </label>
        <input
          id="scramble-input"
          ref={inputRef}
          value={value}
          disabled={!typing || iSolved}
          maxLength={24}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder={iSolved ? 'You solved it!' : typing ? 'Type the original word…' : 'Waiting…'}
          onChange={(event) => setValue(event.target.value)}
          className="input flex-1 uppercase tracking-widest"
        />
        <Button
          type="submit"
          disabled={!typing || iSolved || value.trim().length < 2}
          icon={<Send className="h-4 w-4" />}
        >
          Submit
        </Button>
      </form>

      {lastFeedback ? (
        <p className="text-center text-sm text-danger" aria-live="polite">
          Not quite — try again ({attempts} attempt{attempts === 1 ? '' : 's'}).
        </p>
      ) : null}

      {state?.history && state.history.length > 0 ? (
        <section className="card p-3">
          <h4 className="mb-2 text-sm font-semibold text-white">Previous words</h4>
          <ul className="flex flex-wrap gap-1.5">
            {state.history.map((entry) => (
              <li key={entry.number}>
                <Badge tone="default">
                  {entry.scrambled} → <span className="font-bold text-success">{entry.word}</span>
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-center text-xs text-slate-500">
        The server picks the word and checks every answer — no client-side dictionary.
      </p>
    </div>
  );
}

export const wordScrambleClient: ClientGameModule = {
  metadata: WORD_SCRAMBLE_METADATA,
  Component: WordScrambleGame as unknown as ComponentType<GameComponentProps<never>>,
};
