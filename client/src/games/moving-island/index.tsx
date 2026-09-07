import { useCallback, useEffect, useRef, type ComponentType } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react';
import { MOVING_ISLAND_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

export interface IslandPlatformView {
  id: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
}

export interface MovingIslandPublicState {
  phase: 'idle' | 'playing' | 'finished';
  platforms: IslandPlatformView[];
  checkpoints: Array<{ x: number; y: number }>;
  finish: { x: number; y: number };
  endsAt: number | null;
  finishReason: string | null;
  lastEvent: string | null;
  serverTime: number;
  width: number;
  height: number;
  players: Record<
    string,
    {
      x: number;
      y: number;
      checkpoint: number;
      score: number;
      fallen: number;
      finished: boolean;
      disconnected: boolean;
    }
  >;
}

const DPAD = [
  { dx: 0, dy: -1, icon: ArrowUp, label: 'Move up', area: 'col-start-2 row-start-1' },
  { dx: -1, dy: 0, icon: ArrowLeft, label: 'Move left', area: 'col-start-1 row-start-2' },
  { dx: 0, dy: 1, icon: ArrowDown, label: 'Move down', area: 'col-start-2 row-start-2' },
  { dx: 1, dy: 0, icon: ArrowRight, label: 'Move right', area: 'col-start-3 row-start-2' },
];
const SEAT = ['#818cf8', '#34d399', '#f472b6', '#fbbf24'];
const KIND_FILL: Record<string, string> = {
  static: 'rgba(52, 211, 153, 0.55)',
  horiz: 'rgba(56, 189, 248, 0.7)',
  vert: 'rgba(167, 139, 250, 0.7)',
  blink: 'rgba(251, 191, 36, 0.7)',
  spin: 'rgba(244, 114, 182, 0.7)',
};

function MovingIslandGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<MovingIslandPublicState>) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const previousEvent = useRef<string | null>(null);
  const phase = state?.phase ?? 'idle';
  const me = myPlayerId ? state?.players?.[myPlayerId] : undefined;
  const playing = phase === 'playing' && Boolean(me) && !me?.finished && !me?.disconnected;

  const move = useCallback(
    (dx: number, dy: number) => {
      if (!playing) return;
      sendAction({ type: 'move', payload: { dx, dy } } satisfies GameAction);
      vibrate('buttonPress');
    },
    [playing, sendAction, vibrate],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const map: Record<string, { dx: number; dy: number }> = {
        ArrowUp: { dx: 0, dy: -1 },
        ArrowDown: { dx: 0, dy: 1 },
        ArrowLeft: { dx: -1, dy: 0 },
        ArrowRight: { dx: 1, dy: 0 },
        w: { dx: 0, dy: -1 },
        s: { dx: 0, dy: 1 },
        a: { dx: -1, dy: 0 },
        d: { dx: 1, dy: 0 },
        W: { dx: 0, dy: -1 },
        S: { dx: 0, dy: 1 },
        A: { dx: -1, dy: 0 },
        D: { dx: 1, dy: 0 },
      };
      const target = event.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) || target.isContentEditable)) {
        return;
      }
      const delta = map[event.key];
      if (!delta) return;
      event.preventDefault();
      move(delta.dx, delta.dy);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [move]);

  useEffect(() => {
    const lastEvent = state?.lastEvent ?? null;
    if (lastEvent === previousEvent.current) return;
    previousEvent.current = lastEvent;
    if (!lastEvent) return;
    if (lastEvent === 'fall') {
      play('wrong');
      vibrate('error');
    } else if (lastEvent.startsWith('checkpoint:') && lastEvent.includes(myPlayerId ?? '')) {
      play('score');
    } else if (lastEvent.startsWith('finish:') && lastEvent.includes(myPlayerId ?? '')) {
      play('victory');
      vibrate('victory');
    }
  }, [state?.lastEvent, myPlayerId, play, vibrate]);

  if (phase === 'idle' || !state?.platforms?.length) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Raising the islands…</p>
        </div>
      </div>
    );
  }

  const width = state.width || 32;
  const height = state.height || 22;

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({ ...player, score: state.players?.[player.id]?.score ?? player.score }))}
        myPlayerId={myPlayerId}
        deadline={state.endsAt ?? null}
        label="Island clock"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary">Checkpoint {me?.checkpoint ?? 0}/3</Badge>
        <Badge tone="warning">Falls {me?.fallen ?? 0}</Badge>
        {me?.finished ? <Badge tone="success">Finished</Badge> : null}
      </div>
      <div
        role="img"
        aria-label="Moving islands"
        className="touch-none relative mx-auto w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-sky-950 select-none"
        style={{ aspectRatio: `${width} / ${height}` }}
        onTouchStart={(event) => {
          const touch = event.changedTouches[0];
          touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
        }}
        onTouchMove={(event) => event.preventDefault()}
        onTouchEnd={(event) => {
          const start = touchStart.current;
          touchStart.current = null;
          const touch = event.changedTouches[0];
          if (!start || !touch) return;
          const dx = touch.clientX - start.x;
          const dy = touch.clientY - start.y;
          if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
          if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 1 : -1, 0);
          else move(0, dy > 0 ? 1 : -1);
        }}
      >
        {state.platforms.map((platform) =>
          platform.visible ? (
            <div
              key={platform.id}
              className="absolute rounded-md"
              style={{
                left: `${(platform.x / width) * 100}%`,
                top: `${(platform.y / height) * 100}%`,
                width: `${(platform.w / width) * 100}%`,
                height: `${(platform.h / height) * 100}%`,
                background: KIND_FILL[platform.kind] ?? 'rgba(148,163,184,0.6)',
              }}
            />
          ) : null,
        )}
        {state.checkpoints.map((point, index) => (
          <span
            key={`cp-${index}`}
            className="absolute rounded-full bg-amber-300"
            style={{
              left: `${(point.x / width) * 100}%`,
              top: `${(point.y / height) * 100}%`,
              width: '3%',
              height: '4%',
              transform: 'translate(-50%, -50%)',
            }}
          />
        ))}
        <span
          className="absolute rounded-sm bg-emerald-300"
          style={{
            left: `${(state.finish.x / width) * 100}%`,
            top: `${(state.finish.y / height) * 100}%`,
            width: '4%',
            height: '5%',
            transform: 'translate(-50%, -50%)',
          }}
        />
        {players.map((player, seat) => {
          const runner = state.players[player.id];
          if (!runner) return null;
          return (
            <span
              key={player.id}
              className="absolute rounded-full"
              style={{
                left: `${(runner.x / width) * 100}%`,
                top: `${(runner.y / height) * 100}%`,
                width: '3.2%',
                height: '4.4%',
                backgroundColor: SEAT[seat % SEAT.length],
                transform: 'translate(-50%, -50%)',
                boxShadow: player.id === myPlayerId ? '0 0 0 2px #fff' : undefined,
              }}
            />
          );
        })}
      </div>
      <div className="mx-auto grid w-44 grid-cols-3 grid-rows-2 gap-2">
        {DPAD.map(({ dx, dy, icon: Icon, label, area }) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            disabled={!playing}
            onClick={() => move(dx, dy)}
            className={cn(
              'grid h-14 place-items-center rounded-xl border border-white/10 bg-white/5 text-white transition active:scale-95 disabled:opacity-40',
              area,
            )}
          >
            <Icon className="h-6 w-6" aria-hidden />
          </button>
        ))}
      </div>
      <p className="text-center text-xs text-slate-500">
        Sliding, blinking and spinning platforms are simulated on the server. Falling sends you to your last checkpoint.
      </p>
    </div>
  );
}

export const movingIslandClient: ClientGameModule = {
  metadata: MOVING_ISLAND_METADATA,
  Component: MovingIslandGame as unknown as ComponentType<GameComponentProps<never>>,
};
