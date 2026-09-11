import { useCallback, useEffect, useRef, type ComponentType } from 'react';
import { ArrowLeft, ArrowRight, ArrowUp, HelpCircle } from 'lucide-react';
import { SYNC_JUMP_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { HowToPlayModal, useHowToPlay } from '../../components/game/HowToPlayModal';
import { Badge } from '../../components/ui/Badge';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { cn } from '../../utils/cn';

type SyncCell = 'empty' | 'ground' | 'gap' | 'obstacle' | 'checkpoint' | 'finish';

export interface SyncPublicState {
  phase: 'idle' | 'playing' | 'level-clear' | 'finished';
  level: number;
  totalLevels: number;
  levelName: string;
  hint: string;
  length: number;
  course: SyncCell[];
  syncMeter: number;
  averageSync: number;
  multiplier: number;
  teamScore: number;
  levelsCleared: number;
  mistakes: number;
  levelEndsAt: number | null;
  lastEvent: string | null;
  finishReason: string | null;
  serverTime: number;
  me: string | null;
  players: Record<
    string,
    {
      x: number;
      height: number;
      airborne: boolean;
      checkpoint: number;
      falls: number;
      jumps: number;
      perfectJumps: number;
      finished: boolean;
      disconnected: boolean;
    }
  >;
}

const CELL_CLASS: Record<SyncCell, string> = {
  empty: 'bg-transparent',
  ground: 'bg-slate-500/50',
  gap: 'bg-transparent border-b-2 border-dashed border-rose-400/50',
  obstacle: 'bg-rose-500/60',
  checkpoint: 'bg-teal-400/60',
  finish: 'bg-emerald-400/70',
};

const SEAT = ['#818cf8', '#34d399'];

function SyncJumpGame({ state, players, myPlayerId, sendAction, play, vibrate }: GameComponentProps<SyncPublicState>) {
  const previousEvent = useRef<string | null>(null);
  const rules = useHowToPlay(SYNC_JUMP_METADATA.id);

  const phase = state?.phase ?? 'idle';
  const me = myPlayerId ? state?.players?.[myPlayerId] : undefined;
  const playing = phase === 'playing' && Boolean(me) && !me?.finished;

  const move = useCallback(
    (direction: 'left' | 'right') => {
      if (!playing) return;
      sendAction({ type: 'move', payload: { direction } } satisfies GameAction);
    },
    [playing, sendAction],
  );

  const jump = useCallback(() => {
    if (!playing) return;
    sendAction({ type: 'jump' } satisfies GameAction);
    vibrate('buttonPress');
  }, [playing, sendAction, vibrate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) || target.isContentEditable)) {
        return;
      }
      if (event.key === ' ' || event.key === 'ArrowUp' || event.key === 'w' || event.key === 'W') {
        event.preventDefault();
        jump();
        return;
      }
      if (event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D') {
        event.preventDefault();
        move('right');
      }
      if (event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A') {
        event.preventDefault();
        move('left');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [move, jump]);

  useEffect(() => {
    const event = state?.lastEvent ?? null;
    if (event === previousEvent.current) return;
    previousEvent.current = event;
    if (!event) return;
    const mine = myPlayerId ? event.endsWith(`:${myPlayerId}`) : false;
    if (event.startsWith('fall:')) {
      if (mine) {
        play('wrong');
        vibrate('error');
      }
    } else if (event.startsWith('checkpoint:')) {
      play('score');
      if (mine) vibrate('success');
    } else if (event.startsWith('finish:')) {
      play('correct');
      if (mine) vibrate('success');
    } else if (event.startsWith('level-clear:')) {
      play('victory');
      vibrate('victory');
    } else if (event.startsWith('level:')) {
      play('gameStart');
    } else if (event === 'timeout' || event === 'finished') {
      play('gameOver');
    }
  }, [state?.lastEvent, myPlayerId, play, vibrate]);

  if (phase === 'idle' || !state?.course?.length) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Laying out the course…</p>
        </div>
      </div>
    );
  }

  const syncTone = state.syncMeter >= 90 ? 'success' : state.syncMeter >= 60 ? 'primary' : state.syncMeter >= 30 ? 'warning' : 'danger';

  return (
    <div className="space-y-4">
      <HowToPlayModal game={SYNC_JUMP_METADATA} open={rules.open} onClose={rules.close} />

      <GameHUD
        players={players.map((player) => ({ ...player, score: state.teamScore }))}
        myPlayerId={myPlayerId}
        deadline={state.levelEndsAt ?? null}
        label={phase === 'level-clear' ? 'Next course' : 'Course clock'}
      />

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Badge tone="primary">
          Course {Math.min(state.level + 1, state.totalLevels)}/{state.totalLevels}
        </Badge>
        <Badge tone="default">{state.levelName}</Badge>
        <Badge tone="success">Team {state.teamScore}</Badge>
        <Badge tone={syncTone}>Sync {state.syncMeter}% · {state.multiplier}x</Badge>
        <button
          type="button"
          onClick={rules.show}
          aria-label="How to play"
          className="rounded-full border border-white/10 p-1.5 text-slate-400 transition hover:text-white"
        >
          <HelpCircle className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="card space-y-2 p-3">
        <p className="text-sm text-slate-300">{state.hint}</p>
        <ProgressBar
          value={state.syncMeter}
          max={100}
          tone={state.syncMeter >= 60 ? 'success' : state.syncMeter >= 30 ? 'warning' : 'danger'}
          label={`Sync meter — stay close for a ${state.multiplier}x multiplier`}
        />
      </div>

      {phase === 'level-clear' ? (
        <p className="text-center text-sm text-emerald-300">Course clear! Next one loading…</p>
      ) : null}

      {/* Two lanes: one per partner, sharing the same course. */}
      <div className="space-y-3 overflow-x-auto rounded-2xl border border-white/10 bg-black/40 p-3">
        {players.map((player, seat) => {
          const runner = state.players?.[player.id];
          if (!runner) return null;
          return (
            <div key={player.id} className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: SEAT[seat % SEAT.length] }} aria-hidden />
                {player.nickname}
                {player.id === myPlayerId ? ' (you)' : ''}
                {runner.finished ? ' ✅' : ''}
                {runner.disconnected ? ' (offline)' : ''}
                <span className="ml-auto">{runner.falls} falls</span>
              </div>
              <div className="flex gap-[2px]" role="row" aria-label={`${player.nickname} lane`}>
                {state.course.map((cell, index) => {
                  const onCell = runner.x === index;
                  return (
                    <div
                      key={index}
                      className={cn(
                        'relative h-8 min-w-[14px] flex-1 rounded-sm',
                        CELL_CLASS[cell],
                      )}
                    >
                      {cell === 'checkpoint' ? (
                        <span className="absolute inset-0 grid place-items-center text-[8px]" aria-hidden>⚑</span>
                      ) : null}
                      {cell === 'finish' ? (
                        <span className="absolute inset-0 grid place-items-center text-[8px]" aria-hidden>★</span>
                      ) : null}
                      {onCell ? (
                        <span
                          className="absolute left-1/2 h-3.5 w-3.5 -translate-x-1/2 rounded-full border border-black/50 transition-all"
                          style={{
                            backgroundColor: SEAT[seat % SEAT.length],
                            bottom: runner.airborne ? '18px' : '3px',
                            opacity: runner.disconnected ? 0.4 : 1,
                            boxShadow: player.id === myPlayerId ? '0 0 0 2px #fff' : undefined,
                          }}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-center gap-4">
        <button
          type="button"
          aria-label="Move left"
          disabled={!playing}
          onClick={() => move('left')}
          className="grid h-16 w-16 place-items-center rounded-2xl border border-white/10 bg-white/5 text-white transition active:scale-95 disabled:opacity-40"
        >
          <ArrowLeft className="h-7 w-7" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Jump"
          disabled={!playing}
          onClick={jump}
          className="grid h-20 w-20 place-items-center rounded-full border-2 border-indigo-400/60 bg-indigo-500/25 text-indigo-100 transition active:scale-95 disabled:opacity-40"
        >
          <ArrowUp className="h-8 w-8" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Move right"
          disabled={!playing}
          onClick={() => move('right')}
          className="grid h-16 w-16 place-items-center rounded-2xl border border-white/10 bg-white/5 text-white transition active:scale-95 disabled:opacity-40"
        >
          <ArrowRight className="h-7 w-7" aria-hidden />
        </button>
      </div>

      <p className="text-center text-xs text-slate-500">
        Jump before a gap or bar. Both of you must reach the ★ finish to clear the course.
      </p>
    </div>
  );
}

export const syncJumpClient: ClientGameModule = {
  metadata: SYNC_JUMP_METADATA,
  Component: SyncJumpGame as unknown as ComponentType<GameComponentProps<never>>,
};
