import { useEffect, useRef, type ComponentType } from 'react';
import { motion } from 'framer-motion';
import { COLOR_CLASH_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

export interface ClashColor {
  id: string;
  label: string;
  hex: string;
}

export interface ColorClashPublicState {
  phase: 'idle' | 'preview' | 'round' | 'reveal' | 'finished';
  round: number;
  totalRounds: number;
  kind: 'name' | 'stroop' | 'memory' | 'race' | null;
  instruction: string | null;
  word: string | null;
  wordInk: string | null;
  previewColor: ClashColor | null;
  options: Array<{ id: string; color: ClashColor }>;
  endsAt: number | null;
  picked: Record<string, string>;
  myPick: { optionId: string; correct: boolean; points: number } | null;
  correctOptionId: string | null;
  scores: Record<string, number>;
  hits: Record<string, number>;
  lastEvent: string | null;
}

function ColorClashGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<ColorClashPublicState>) {
  const previousScore = useRef(0);
  const previousRound = useRef(0);

  const phase = state?.phase ?? 'idle';
  const myPick = state?.myPick ?? null;
  const canPick = phase === 'round' && !myPick;

  const myScore = myPlayerId ? (state?.scores?.[myPlayerId] ?? 0) : 0;
  const pickKey = myPick ? `${state?.round}:${myPick.optionId}:${myPick.correct}` : '';
  useEffect(() => {
    if (myScore > previousScore.current) {
      play('correct');
      vibrate('success');
    } else if (pickKey.endsWith(':false') && (state?.round ?? 0) === previousRound.current) {
      play('wrong');
      vibrate('error');
    }
    previousScore.current = myScore;
  }, [myScore, pickKey, play, vibrate, state?.round]);

  useEffect(() => {
    previousRound.current = state?.round ?? 0;
  }, [state?.round]);

  const pick = (optionId: string) => {
    if (!canPick) return;
    sendAction({ type: 'pick', payload: { optionId } } satisfies GameAction);
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

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary">
          Round {Math.max(1, state?.round ?? 0)} / {state?.totalRounds ?? 12}
        </Badge>
        {state?.kind ? <Badge tone="accent">{state.kind}</Badge> : null}
        {phase === 'reveal' && myPick ? (
          <Badge tone={myPick.correct ? 'success' : 'danger'}>
            {myPick.correct ? `+${myPick.points}` : 'Miss'}
          </Badge>
        ) : null}
      </div>

      <div className="card space-y-3 p-4 text-center">
        {phase === 'idle' ? <p className="animate-pulse text-sm text-slate-400">Shuffling colours…</p> : null}
        {phase === 'preview' && state?.previewColor ? (
          <>
            <p className="text-xs uppercase tracking-wider text-slate-400">Remember this colour</p>
            <div
              className="mx-auto h-24 w-24 rounded-3xl border-4 border-white/20"
              style={{ backgroundColor: state.previewColor.hex }}
              aria-label={state.previewColor.label}
            />
            <p className="text-lg font-bold text-white">{state.previewColor.label}</p>
          </>
        ) : null}
        {(phase === 'round' || phase === 'reveal') && (
          <>
            <p className="text-sm font-medium text-slate-200">{state?.instruction}</p>
            {state?.word ? (
              <motion.p
                key={`${state.round}-word`}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="text-4xl font-black"
                style={{ color: state.wordInk ?? '#fff' }}
              >
                {state.word}
              </motion.p>
            ) : null}
          </>
        )}
      </div>

      {state?.options && state.options.length > 0 ? (
        <div className={cn('grid gap-2', state.options.length > 4 ? 'grid-cols-3' : 'grid-cols-2')}>
          {state.options.map((option) => {
            const isCorrect = phase === 'reveal' && option.id === state.correctOptionId;
            const isMine = myPick?.optionId === option.id;
            return (
              <motion.button
                key={option.id}
                type="button"
                disabled={!canPick}
                onClick={() => pick(option.id)}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                aria-label={option.color.label}
                className={cn(
                  'min-h-[72px] rounded-2xl border-4 px-3 py-4 text-base font-bold text-white shadow-lg transition active:scale-95 disabled:opacity-80',
                  isCorrect && 'ring-4 ring-success',
                  isMine && !isCorrect && phase === 'reveal' && 'ring-4 ring-danger',
                )}
                style={{
                  backgroundColor: option.color.hex,
                  borderColor: isMine ? '#fff' : 'rgba(255,255,255,0.25)',
                  textShadow: '0 1px 2px rgba(0,0,0,0.6)',
                }}
              >
                {option.color.label}
              </motion.button>
            );
          })}
        </div>
      ) : null}

      <p className="text-center text-xs text-slate-500">
        Fastest correct tap 100, then 75 / 50 / 25. Labels are always shown — colour is never the only cue.
      </p>
    </div>
  );
}

export const colorClashClient: ClientGameModule = {
  metadata: COLOR_CLASH_METADATA,
  Component: ColorClashGame as unknown as ComponentType<GameComponentProps<never>>,
};
