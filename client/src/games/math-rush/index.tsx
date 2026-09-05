import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { ArrowRight, Delete } from 'lucide-react';
import { MATH_RUSH_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { cn } from '../../utils/cn';

export interface MathRushPublicState {
  phase: 'idle' | 'question' | 'reveal' | 'finished';
  questionIndex: number;
  totalQuestions: number;
  difficulty: 'easy' | 'medium' | 'hard';
  serverTime: number;
  question: { id: string; text: string; endsAt: number; answer?: number } | null;
  answered: string[];
  scores: Record<string, number>;
  correctCounts: Record<string, number>;
  recentAnswers: Array<{ playerId: string; correct: boolean; points: number; timeMs: number }>;
  history: Array<{ questionId: string; text: string; answer: number; scorers: string[] }>;
  lastEvent: string | null;
}

const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '-', '0', '⌫'];

function MathRushGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<MathRushPublicState>) {
  const [value, setValue] = useState('');
  const question = state?.question ?? null;
  const inQuestion = state?.phase === 'question';
  const answered = myPlayerId ? state?.answered?.includes(myPlayerId) : false;

  useEffect(() => {
    // Reset the local keypad whenever a new question arrives.
    setValue('');
  }, [question?.id]);

  const lastResult = useMemo(() => {
    if (state?.phase !== 'reveal') return null;
    return state.history[state.history.length - 1] ?? null;
  }, [state?.phase, state?.history]);

  const submit = () => {
    if (!question || !inQuestion || answered) return;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    sendAction({
      type: 'answer',
      payload: { questionId: question.id, value: parsed },
    } satisfies GameAction);
    play('click');
    vibrate('buttonPress');
    setValue('');
  };

  const press = (key: string) => {
    if (key === '⌫') {
      setValue((current) => current.slice(0, -1));
      return;
    }
    if (key === '-') {
      setValue((current) => (current.startsWith('-') ? current.slice(1) : `-${current}`));
      return;
    }
    setValue((current) => (current.length >= 8 ? current : `${current}${key}`));
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      if (/^[0-9]$/.test(event.key)) press(event.key);
      else if (event.key === 'Backspace') press('⌫');
      else if (event.key === '-') press('-');
      else if (event.key === 'Enter') submit();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({ ...player, score: state?.scores?.[player.id] ?? player.score }))}
        myPlayerId={myPlayerId}
        deadline={question?.endsAt ?? null}
        label="Question time"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge tone="primary">
          Question {state?.questionIndex ?? 0} / {state?.totalQuestions ?? 10}
        </Badge>
        <Badge tone="accent">Difficulty: {state?.difficulty ?? 'medium'}</Badge>
      </div>

      <section className="card grid place-items-center gap-3 p-6 text-center">
        {inQuestion && question ? (
          <>
            <p className="text-4xl font-black tracking-tight text-white sm:text-5xl">{question.text} = ?</p>
            <p
              className={cn(
                'min-h-[2rem] text-2xl font-bold tabular-nums',
                value ? 'text-primary-200' : 'text-slate-600',
              )}
              aria-live="polite"
            >
              {value || '—'}
            </p>
          </>
        ) : null}

        {state?.phase === 'reveal' && lastResult ? (
          <>
            <p className="text-lg text-slate-400">The answer was</p>
            <p className="text-4xl font-black text-gradient">
              {lastResult.text} = {lastResult.answer}
            </p>
            <p className="text-sm text-slate-400">
              {lastResult.scorers.length > 0
                ? `${lastResult.scorers
                    .map((id) => players.find((player) => player.id === id)?.nickname ?? '?')
                    .join(', ')} scored`
                : 'Nobody scored'}
            </p>
          </>
        ) : null}

        {state?.phase === 'finished' ? <p className="text-2xl font-bold text-white">All done!</p> : null}
        {state?.phase === 'idle' ? <p className="text-slate-400">Starting…</p> : null}
      </section>

      {inQuestion ? (
        <>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {KEYPAD.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => press(key)}
                disabled={answered}
                className="inline-flex min-h-touch items-center justify-center rounded-xl border border-white/10 bg-white/5 text-lg font-semibold text-white transition hover:bg-white/10 active:scale-95 disabled:opacity-40"
                aria-label={key === '⌫' ? 'Backspace' : `Key ${key}`}
              >
                {key === '⌫' ? <Delete className="h-5 w-5" /> : key}
              </button>
            ))}
          </div>

          <Button
            fullWidth
            size="lg"
            onClick={submit}
            disabled={answered || value.length === 0 || value === '-'}
            icon={<ArrowRight className="h-4 w-4" />}
          >
            {answered ? 'Answer locked' : 'Submit answer'}
          </Button>
        </>
      ) : null}

      {answered && inQuestion ? (
        <p className="text-center text-sm text-slate-400" aria-live="polite">
          Answer submitted — waiting for the other players…
        </p>
      ) : null}

      <p className="text-center text-xs text-slate-500">
        Questions and answers live on the server; your browser only sends a guess.
      </p>
    </div>
  );
}

export const mathRushClient: ClientGameModule = {
  metadata: MATH_RUSH_METADATA,
  Component: MathRushGame as unknown as ComponentType<GameComponentProps<never>>,
};
