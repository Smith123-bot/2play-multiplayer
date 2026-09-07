import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { motion } from 'framer-motion';
import { SHAPE_MATCH_METADATA, type GameAction, type ShapeDescriptor } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

export interface ShapeMatchPublicState {
  phase: 'idle' | 'round' | 'reveal' | 'finished';
  round: number;
  totalRounds: number;
  roundMs: number;
  target: ShapeDescriptor | null;
  options: Array<{ id: string; shape: ShapeDescriptor }>;
  endsAt: number | null;
  picked: Record<string, string>;
  mySelection: { optionId: string; correct: boolean; elapsedMs: number; points: number } | null;
  correctOptionId: string | null;
  scores: Record<string, number>;
  correctCount: Record<string, number>;
  history: Array<{ number: number; correctOptionId: string; picks: Record<string, string> }>;
  finishReason: string | null;
  serverTime: number;
}

const COLOR_HEX: Record<ShapeDescriptor['color'], string> = {
  red: '#ef4444',
  blue: '#3b82f6',
  green: '#22c55e',
  yellow: '#eab308',
  purple: '#8b5cf6',
  orange: '#f97316',
  teal: '#14b8a6',
  pink: '#ec4899',
};

const STAR_POINTS = Array.from({ length: 10 }, (_, index) => {
  const angle = (Math.PI / 5) * index - Math.PI / 2;
  const radius = index % 2 === 0 ? 44 : 18;
  return `${(50 + radius * Math.cos(angle)).toFixed(1)},${(50 + radius * Math.sin(angle)).toFixed(1)}`;
}).join(' ');

const HEXAGON_POINTS = Array.from({ length: 6 }, (_, index) => {
  const angle = (Math.PI / 3) * index - Math.PI / 2;
  return `${(50 + 42 * Math.cos(angle)).toFixed(1)},${(50 + 42 * Math.sin(angle)).toFixed(1)}`;
}).join(' ');

/** Pure 2D SVG shape renderer — the same descriptor renders everywhere. */
function ShapeSVG({ shape, size = 64 }: { shape: ShapeDescriptor; size?: number }) {
  const fill = COLOR_HEX[shape.color];
  const common = {
    fill,
    stroke: 'rgba(0,0,0,0.25)',
    strokeWidth: 2,
    'aria-hidden': true,
  } as const;

  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="presentation">
      {shape.form === 'circle' ? <circle cx={50} cy={50} r={40} {...common} /> : null}
      {shape.form === 'square' ? <rect x={12} y={12} width={76} height={76} rx={8} {...common} /> : null}
      {shape.form === 'triangle' ? <polygon points="50,10 90,86 10,86" {...common} /> : null}
      {shape.form === 'diamond' ? <polygon points="50,6 92,50 50,94 8,50" {...common} /> : null}
      {shape.form === 'star' ? <polygon points={STAR_POINTS} {...common} /> : null}
      {shape.form === 'hexagon' ? <polygon points={HEXAGON_POINTS} {...common} /> : null}
      {shape.form === 'cross' ? (
        <polygon points="35,10 65,10 65,35 90,35 90,65 65,65 65,90 35,90 35,65 10,65 10,35 35,35" {...common} />
      ) : null}
      {shape.form === 'ring' ? (
        <circle cx={50} cy={50} r={34} fill="none" stroke={fill} strokeWidth={20} />
      ) : null}
    </svg>
  );
}

function ShapeMatchGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<ShapeMatchPublicState>) {
  const previousRound = useRef(0);
  const [flash, setFlash] = useState<'none' | 'good' | 'bad'>('none');

  const phase = state?.phase ?? 'idle';
  const picking = phase === 'round' && !state?.mySelection;
  const reveal = phase === 'reveal';
  const myPick = state?.mySelection ?? null;

  // New round → clear feedback.
  useEffect(() => {
    if ((state?.round ?? 0) !== previousRound.current) {
      previousRound.current = state?.round ?? 0;
      setFlash('none');
    }
  }, [state?.round]);

  // Feedback when my pick lands.
  const previousPick = useRef<string | null>(null);
  useEffect(() => {
    const pickId = myPick?.optionId ?? null;
    if (pickId && pickId !== previousPick.current) {
      if (myPick?.correct) {
        setFlash('good');
        play('correct');
        vibrate('success');
      } else {
        setFlash('bad');
        play('wrong');
        vibrate('error');
      }
    }
    previousPick.current = pickId;
  }, [myPick?.optionId, myPick?.correct, play, vibrate]);

  const pick = (optionId: string) => {
    if (!picking) return;
    sendAction({ type: 'select', payload: { optionId } } satisfies GameAction);
    play('click');
    vibrate('buttonPress');
  };

  const optionState = useMemo(() => {
    return (optionId: string): 'idle' | 'mine' | 'correct' | 'wrong' | 'dimmed' => {
      if (reveal) {
        if (optionId === state?.correctOptionId) return 'correct';
        if (optionId === myPick?.optionId) return 'wrong';
        return 'dimmed';
      }
      if (optionId === myPick?.optionId) return 'mine';
      return 'idle';
    };
  }, [reveal, state?.correctOptionId, myPick?.optionId]);

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
          Round {Math.max(1, state?.round ?? 0)} / {state?.totalRounds ?? 10}
        </Badge>
        {myPick && !reveal ? (
          <Badge tone={myPick.correct ? 'success' : 'default'}>
            {myPick.correct ? `+${myPick.points} points!` : 'Picked — wait for the reveal'}
          </Badge>
        ) : null}
        {phase === 'finished' ? <Badge tone="success">Match complete</Badge> : null}
      </div>

      <div className="card flex flex-col items-center gap-3 p-4 text-center">
        {phase === 'idle' || !state?.target ? (
          <p className="animate-pulse text-sm text-slate-400">Preparing the first round…</p>
        ) : (
          <>
            <p className="text-xs uppercase tracking-wider text-slate-400">
              {reveal ? 'The matching shape was' : 'Find this shape'}
            </p>
            <motion.div
              key={`${state.round}-target`}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className={cn(
                'grid h-24 w-24 place-items-center rounded-2xl border border-white/10 bg-white/5',
                flash === 'good' && 'border-success/50 bg-success/10',
                flash === 'bad' && 'border-danger/50 bg-danger/10',
              )}
            >
              <ShapeSVG shape={state.target} size={72} />
            </motion.div>
            <p className="text-xs text-slate-500">
              1 point per match · pick within the first half for +1 bonus · one pick per round
            </p>
          </>
        )}
      </div>

      {state?.options && state.options.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {state.options.map((option) => {
            const status = optionState(option.id);
            return (
              <button
                key={option.id}
                type="button"
                aria-label={`Option ${option.id.replace('shape-', '')}`}
                disabled={!picking}
                onClick={() => pick(option.id)}
                className={cn(
                  'grid aspect-square place-items-center rounded-2xl border-2 transition active:scale-95',
                  status === 'idle' && 'border-white/10 bg-white/5 hover:border-primary-400/50',
                  status === 'mine' && 'border-primary-400/70 bg-primary-500/15',
                  status === 'correct' && 'border-success bg-success/20',
                  status === 'wrong' && 'border-danger bg-danger/20',
                  status === 'dimmed' && 'border-white/5 bg-white/[0.02] opacity-40',
                  !picking && status === 'idle' && 'opacity-60',
                )}
              >
                <ShapeSVG shape={option.shape} size={72} />
              </button>
            );
          })}
        </div>
      ) : null}

      {reveal ? (
        <p className="text-center text-xs text-slate-500">
          Next round starting…
          {state?.picked
            ? ` ${Object.keys(state.picked).length} of ${players.length} players picked`
            : ''}
        </p>
      ) : null}

      <p className="text-center text-xs text-slate-500">
        The server decides which option matches — the client only sends your pick.
      </p>
    </div>
  );
}

export const shapeMatchClient: ClientGameModule = {
  metadata: SHAPE_MATCH_METADATA,
  Component: ShapeMatchGame as unknown as ComponentType<GameComponentProps<never>>,
};
