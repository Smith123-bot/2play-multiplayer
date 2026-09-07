import { useCallback, useEffect, useRef, type ComponentType } from 'react';
import { ArrowLeft, ArrowRight, Flag } from 'lucide-react';
import { TRAFFIC_DODGE_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

export interface TrafficRacerPublic {
  lane: number;
  position: number;
  speed: number;
  stunUntil: number | null;
  crashes: number;
  finished: boolean;
  finishMs: number | null;
  disconnected: boolean;
}

export interface TrafficDodgePublicState {
  phase: 'idle' | 'playing' | 'finished';
  lanes: number;
  trackLength: number;
  startedAt: number | null;
  endsAt: number | null;
  serverTime: number;
  traffic: Array<{ id: string; lane: number; pos: number; length: number; speed: number }>;
  racers: Record<string, TrafficRacerPublic | null>;
  lastEvent: string | null;
}

/** Track units rendered ahead of the player. */
const VIEW_AHEAD = 130;
const VIEW_BEHIND = 25;
const MY_ANCHOR = 78; // percent from the top where my car sits

function relativeTop(delta: number): number | null {
  if (delta < -VIEW_BEHIND || delta > VIEW_AHEAD) return null;
  if (delta >= 0) return MY_ANCHOR - (delta / VIEW_AHEAD) * (MY_ANCHOR - 4);
  return MY_ANCHOR + (Math.abs(delta) / VIEW_BEHIND) * (96 - MY_ANCHOR);
}

function TrafficDodgeGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<TrafficDodgePublicState>) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const previousCrashes = useRef(0);
  const previousFinishers = useRef(0);

  const phase = state?.phase ?? 'idle';
  const me = myPlayerId ? state?.racers?.[myPlayerId] : undefined;
  const rival = players.find((player) => player.id !== myPlayerId);
  const rivalRacer = rival ? state?.racers?.[rival.id] : undefined;
  const stunned = me?.stunUntil != null && me.stunUntil > (state?.serverTime ?? 0);
  const canSteer = phase === 'playing' && !me?.finished && !stunned;

  const steer = useCallback(
    (direction: 'left' | 'right') => {
      if (!canSteer) return;
      sendAction({ type: 'move', payload: { direction } } satisfies GameAction);
      play('click');
      vibrate('buttonPress');
    },
    [canSteer, sendAction, play, vibrate],
  );

  // Keyboard: A/D + arrows.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const map: Record<string, 'left' | 'right'> = {
        ArrowLeft: 'left', ArrowRight: 'right', a: 'left', d: 'right', A: 'left', D: 'right',
      };
      const direction = map[event.key];
      if (!direction) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) || target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      steer(direction);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [steer]);

  const totalCrashes = Object.values(state?.racers ?? {}).reduce(
    (sum, racer) => sum + (racer?.crashes ?? 0),
    0,
  );
  useEffect(() => {
    if (totalCrashes > previousCrashes.current) {
      play('wrong');
      vibrate('error');
    }
    previousCrashes.current = totalCrashes;
  }, [totalCrashes, play, vibrate]);

  const finishers = Object.values(state?.racers ?? {}).filter((racer) => racer?.finished).length;
  useEffect(() => {
    if (finishers > previousFinishers.current) {
      play('gameOver');
    }
    previousFinishers.current = finishers;
  }, [finishers, play]);

  if (phase === 'idle' || !me) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Lining up on the start grid…</p>
        </div>
      </div>
    );
  }

  const myPos = me.position;
  const progress = Math.min(100, (myPos / state.trackLength) * 100);
  const laneLeft = (lane: number) => `${(lane + 0.5) * (100 / state.lanes)}%`;

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({
          ...player,
          score: Math.round(state.racers?.[player.id]?.position ?? player.score),
        }))}
        myPlayerId={myPlayerId}
        deadline={state.endsAt ?? null}
        label="Race clock"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary">{Math.round(me.speed * 10) / 10} u/s</Badge>
        <Badge tone={me.crashes > 0 ? 'warning' : 'default'}>{me.crashes} crashes</Badge>
        {me.finished ? (
          <Badge tone="success">Finished · {(me.finishMs ?? 0) / 1000 < 60 ? `${((me.finishMs ?? 0) / 1000).toFixed(1)}s` : ''}</Badge>
        ) : stunned ? (
          <Badge tone="danger">Recovering…</Badge>
        ) : null}
        {phase === 'finished' ? <Badge tone="accent">Race over</Badge> : null}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
          <span>Progress</span>
          <span className="tabular-nums">{Math.round(myPos)} / {state.trackLength}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary-500 to-accent transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="mx-auto w-full max-w-md">
        <div
          aria-label="Road"
          className="touch-none relative h-[420px] overflow-hidden rounded-2xl border border-white/10 bg-[#1e293b]/60 select-none"
          onTouchStart={(event) => {
            const touch = event.changedTouches[0];
            touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
          }}
          onTouchEnd={(event) => {
            const start = touchStart.current;
            touchStart.current = null;
            const touch = event.changedTouches[0];
            if (!start || !touch) return;
            const dx = touch.clientX - start.x;
            if (Math.abs(dx) < 24) return;
            steer(dx > 0 ? 'right' : 'left');
          }}
        >
          {/* Lane separators */}
          {Array.from({ length: state.lanes - 1 }, (_, index) => (
            <div
              key={index}
              className="absolute top-0 h-full w-px bg-white/10"
              style={{ left: `${((index + 1) * 100) / state.lanes}%` }}
            />
          ))}
          {/* Finish line */}
          <div
            className="absolute left-0 h-3 w-full bg-[repeating-linear-gradient(90deg,#f8fafc_0_10px,#334155_10px_20px)] transition-[top] duration-300"
            style={{ top: `${relativeTop(state.trackLength - myPos) ?? -10}%` }}
          />

          {/* Traffic (2D rectangles, smoothly interpolated between ticks). */}
          {state.traffic.map((car) => {
            const top = relativeTop(car.pos - myPos);
            if (top === null) return null;
            const height = (car.length / VIEW_AHEAD) * 74;
            return (
              <div
                key={car.id}
                className="absolute rounded bg-danger/80 shadow-[0_0_10px_rgba(239,68,68,0.5)] transition-[top] duration-300 ease-linear"
                style={{
                  left: laneLeft(car.lane),
                  top: `${top}%`,
                  width: '13%',
                  height: `${height}%`,
                  transform: 'translate(-50%, 0)',
                }}
                aria-label="traffic"
              />
            );
          })}

          {/* Rival */}
          {rival && rivalRacer ? (
            (() => {
              const top = relativeTop(rivalRacer.position - myPos);
              if (top === null) {
                return (
                  <Badge tone="default" className="absolute right-2 top-2">
                    {rival.nickname}: {rivalRacer.position > myPos ? 'ahead ↑' : 'behind ↓'}
                  </Badge>
                );
              }
              return (
                <div
                  className="absolute grid h-9 w-[13%] -translate-x-1/2 place-items-center rounded bg-warning text-[10px] font-black text-black transition-[top] duration-300 ease-linear"
                  style={{ left: laneLeft(rivalRacer.lane), top: `${top}%` }}
                  title={rival.nickname}
                >
                  RIVAL
                </div>
              );
            })()
          ) : null}

          {/* My car */}
          <div
            className={cn(
              'absolute grid h-9 w-[13%] -translate-x-1/2 place-items-center rounded bg-primary-500 text-[10px] font-black text-white transition-[left] duration-150',
              stunned && 'animate-pulse bg-danger',
            )}
            style={{ left: laneLeft(me.lane), top: `${MY_ANCHOR}%` }}
          >
            YOU
          </div>

          {stunned ? (
            <div className="absolute inset-x-0 top-1/2 text-center text-lg font-black text-danger">
              CRASH!
            </div>
          ) : null}
          <Flag
            className="absolute right-2 bottom-2 h-4 w-4 text-warning"
            aria-label="finish line ahead"
          />
        </div>
      </div>

      {/* Side controls below the road — never covering gameplay. */}
      <div className="mx-auto flex w-full max-w-md gap-3">
        <button
          type="button"
          aria-label="Steer left"
          disabled={!canSteer}
          onClick={() => steer('left')}
          className="grid h-14 flex-1 place-items-center rounded-xl border border-white/10 bg-white/5 text-white transition active:scale-95 disabled:opacity-40"
        >
          <ArrowLeft className="h-6 w-6" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Steer right"
          disabled={!canSteer}
          onClick={() => steer('right')}
          className="grid h-14 flex-1 place-items-center rounded-xl border border-white/10 bg-white/5 text-white transition active:scale-95 disabled:opacity-40"
        >
          <ArrowRight className="h-6 w-6" aria-hidden />
        </button>
      </div>
      <p className="text-center text-xs text-slate-500">
        A/D, arrow keys, swipe or the side buttons — the server owns speed, traffic and crashes.
      </p>
    </div>
  );
}

export const trafficDodgeClient: ClientGameModule = {
  metadata: TRAFFIC_DODGE_METADATA,
  Component: TrafficDodgeGame as unknown as ComponentType<GameComponentProps<never>>,
};
