import { useCallback, useEffect, useRef, type ComponentType } from 'react';
import { ArrowLeft, ArrowRight, ChevronUp } from 'lucide-react';
import { PLATFORM_DASH_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

export interface DashRunnerPublic {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  grounded: boolean;
  finished: boolean;
  finishMs: number | null;
  falls: number;
  checkpointIndex: number;
  frozenUntil: number;
  disconnected: boolean;
}

export interface DashPlatformPublic {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: string;
  gone?: boolean;
}

export interface PlatformDashPublicState {
  phase: 'idle' | 'playing' | 'finished';
  courseId: string;
  courseName: string;
  width: number;
  height: number;
  platforms: DashPlatformPublic[];
  finishOrder: string[];
  endsAt: number | null;
  lastEvent: string | null;
  serverTime: number;
  runners: Record<string, DashRunnerPublic | null>;
}

const COLORS = ['#818cf8', '#34d399', '#f472b6', '#fbbf24'];
const KIND_FILL: Record<string, string> = {
  solid: '#475569',
  moving: '#38bdf8',
  crumble: '#fb923c',
  pad: '#a3e635',
  spike: '#f43f5e',
  checkpoint: '#c084fc',
  finish: '#facc15',
};

function PlatformDashGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<PlatformDashPublicState>) {
  const cameraX = useRef(0);
  const held = useRef({ left: false, right: false, jump: false });
  const previousEvent = useRef<string | null>(null);
  const previousFinish = useRef(0);

  const phase = state?.phase ?? 'idle';
  const me = myPlayerId ? state?.runners?.[myPlayerId] : undefined;
  const playing = phase === 'playing' && !me?.finished;

  const emit = useCallback(
    (patch: Partial<{ left: boolean; right: boolean; jump: boolean }>) => {
      if (!playing) return;
      held.current = { ...held.current, ...patch };
      sendAction({ type: 'input', payload: { ...held.current } } satisfies GameAction);
    },
    [playing, sendAction],
  );

  useEffect(() => {
    const isTyping = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      return Boolean(
        target &&
          (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable),
      );
    };
    const down = (event: KeyboardEvent) => {
      if (isTyping(event)) return;
      if (event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A') {
        event.preventDefault();
        emit({ left: true });
      } else if (event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D') {
        event.preventDefault();
        emit({ right: true });
      } else if (event.key === ' ' || event.key === 'ArrowUp' || event.key === 'w' || event.key === 'W') {
        event.preventDefault();
        emit({ jump: true });
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A') emit({ left: false });
      else if (event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D') emit({ right: false });
      else if (event.key === ' ' || event.key === 'ArrowUp' || event.key === 'w' || event.key === 'W') emit({ jump: false });
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [emit]);

  useEffect(() => {
    if (!playing) emit({ left: false, right: false, jump: false });
  }, [playing, emit]);

  const finishers = state?.finishOrder?.length ?? 0;
  useEffect(() => {
    if (finishers > previousFinish.current) {
      const last = state?.finishOrder?.[finishers - 1];
      if (last === myPlayerId) {
        play('victory');
        vibrate('victory');
      } else play('notification');
    }
    previousFinish.current = finishers;
  }, [finishers, state?.finishOrder, myPlayerId, play, vibrate]);

  useEffect(() => {
    if (state?.lastEvent === previousEvent.current) return;
    previousEvent.current = state?.lastEvent ?? null;
    if (state?.lastEvent?.startsWith('fall:')) {
      if (state.lastEvent === `fall:${myPlayerId}`) {
        play('wrong');
        vibrate('error');
      }
    }
  }, [state?.lastEvent, myPlayerId, play, vibrate]);

  if (phase === 'idle' || !state) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Laying out the course…</p>
        </div>
      </div>
    );
  }

  const { width, height, platforms } = state;
  const follow = me?.x ?? 0;
  cameraX.current += (follow - 140 - cameraX.current) * 0.18;
  const cam = Math.max(0, Math.min(width - 400, cameraX.current));
  const viewW = 400;
  const px = (value: number) => `${((value - cam) / viewW) * 100}%`;
  const pw = (value: number) => `${(value / viewW) * 100}%`;
  const ph = (value: number) => `${(value / height) * 100}%`;
  const pBottom = (value: number) => `${(value / height) * 100}%`;

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({
          ...player,
          score: state.finishOrder.includes(player.id)
            ? [100, 75, 50, 25][Math.min(3, state.finishOrder.indexOf(player.id))]!
            : 0,
        }))}
        myPlayerId={myPlayerId}
        deadline={state.endsAt ?? null}
        label="Race clock"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary">{state.courseName}</Badge>
        {me?.finished ? (
          <Badge tone="success">Finished · {((me.finishMs ?? 0) / 1000).toFixed(1)}s</Badge>
        ) : (
          <Badge tone="default">Falls {me?.falls ?? 0}</Badge>
        )}
        {phase === 'finished' ? <Badge tone="accent">Race over</Badge> : null}
      </div>

      <div
        role="img"
        aria-label={`${state.courseName} course`}
        className="relative mx-auto h-52 w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-sky-950/80 sm:h-64"
      >
        <div className="absolute inset-0 bg-gradient-to-b from-sky-800/40 to-slate-900/80" />
        {platforms
          .filter((platform) => !platform.gone)
          .map((platform) => (
            <div
              key={platform.id}
              className="absolute rounded-sm"
              style={{
                left: px(platform.x),
                bottom: pBottom(platform.y),
                width: pw(platform.w),
                height: ph(platform.h),
                backgroundColor: KIND_FILL[platform.kind] ?? '#64748b',
              }}
              title={platform.kind}
            />
          ))}
        {players.map((player, index) => {
          const runner = state.runners[player.id];
          if (!runner) return null;
          return (
            <div
              key={player.id}
              className={cn(
                'absolute rounded-sm',
                player.id === myPlayerId && 'ring-2 ring-white',
                runner.disconnected && 'opacity-40',
              )}
              style={{
                left: px(runner.x),
                bottom: pBottom(runner.y),
                width: pw(runner.w),
                height: ph(runner.h),
                backgroundColor: COLORS[index % COLORS.length],
              }}
              title={player.nickname}
            />
          );
        })}
      </div>

      <div className="mx-auto grid w-full max-w-sm grid-cols-3 gap-2">
        <button
          type="button"
          aria-label="Move left"
          disabled={!playing}
          onPointerDown={() => emit({ left: true })}
          onPointerUp={() => emit({ left: false })}
          onPointerLeave={() => playing && emit({ left: false })}
          className="grid h-16 place-items-center rounded-2xl border border-white/10 bg-white/5 active:scale-95 disabled:opacity-40"
        >
          <ArrowLeft className="h-7 w-7" />
        </button>
        <button
          type="button"
          aria-label="Jump"
          disabled={!playing}
          onPointerDown={() => emit({ jump: true })}
          onPointerUp={() => emit({ jump: false })}
          onPointerLeave={() => playing && emit({ jump: false })}
          className="grid h-16 place-items-center rounded-2xl border border-white/10 bg-primary-500/20 active:scale-95 disabled:opacity-40"
        >
          <ChevronUp className="h-8 w-8" />
        </button>
        <button
          type="button"
          aria-label="Move right"
          disabled={!playing}
          onPointerDown={() => emit({ right: true })}
          onPointerUp={() => emit({ right: false })}
          onPointerLeave={() => playing && emit({ right: false })}
          className="grid h-16 place-items-center rounded-2xl border border-white/10 bg-white/5 active:scale-95 disabled:opacity-40"
        >
          <ArrowRight className="h-7 w-7" />
        </button>
      </div>

      {state.finishOrder.length > 0 ? (
        <ol className="card space-y-1 p-3 text-sm text-slate-300">
          {state.finishOrder.map((id, index) => (
            <li key={id}>
              {index + 1}. {players.find((player) => player.id === id)?.nickname ?? 'Player'}
              {id === myPlayerId ? ' (you)' : ''}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-center text-xs text-slate-500">
          A/D or arrows to run, Space to jump. Falls send you to the last checkpoint.
        </p>
      )}
    </div>
  );
}

export const platformDashClient: ClientGameModule = {
  metadata: PLATFORM_DASH_METADATA,
  Component: PlatformDashGame as unknown as ComponentType<GameComponentProps<never>>,
};
