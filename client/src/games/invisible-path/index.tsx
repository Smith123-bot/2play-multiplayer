import { useCallback, useEffect, useRef, type ComponentType } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react';
import { INVISIBLE_PATH_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

export interface InvisiblePathPublicState {
  phase: 'idle' | 'preview' | 'playing' | 'finished';
  round: number;
  totalRounds: number;
  cols: number;
  rows: number;
  start: { x: number; y: number };
  goal: { x: number; y: number };
  safe: string[];
  endsAt: number | null;
  previewUntil: number | null;
  finishReason: string | null;
  lastEvent: string | null;
  serverTime: number;
  players: Record<
    string,
    {
      x: number;
      y: number;
      score: number;
      wrongs: number;
      stunned: boolean;
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

function InvisiblePathGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<InvisiblePathPublicState>) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const previousEvent = useRef<string | null>(null);
  const phase = state?.phase ?? 'idle';
  const me = myPlayerId ? state?.players?.[myPlayerId] : undefined;
  const playing = phase === 'playing' && Boolean(me) && !me?.finished && !me?.stunned && !me?.disconnected;

  const step = useCallback(
    (dx: number, dy: number) => {
      if (!playing || !me) return;
      sendAction({ type: 'move', payload: { x: me.x + dx, y: me.y + dy } } satisfies GameAction);
      vibrate('buttonPress');
    },
    [playing, me, sendAction, vibrate],
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
      step(delta.dx, delta.dy);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [step]);

  useEffect(() => {
    const lastEvent = state?.lastEvent ?? null;
    if (lastEvent === previousEvent.current) return;
    previousEvent.current = lastEvent;
    if (!lastEvent) return;
    if (lastEvent.startsWith('wrong:') && lastEvent.includes(myPlayerId ?? '')) {
      play('wrong');
      vibrate('error');
    } else if (lastEvent.startsWith('finish:') && lastEvent.includes(myPlayerId ?? '')) {
      play('victory');
      vibrate('victory');
    } else if (lastEvent === 'preview' || lastEvent === 'hidden') {
      play('notification');
    }
  }, [state?.lastEvent, myPlayerId, play, vibrate]);

  if (phase === 'idle' || !state?.cols) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Painting the invisible path…</p>
        </div>
      </div>
    );
  }

  const safe = new Set(state.safe ?? []);

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({ ...player, score: state.players?.[player.id]?.score ?? player.score }))}
        myPlayerId={myPlayerId}
        deadline={state.endsAt ?? null}
        label={phase === 'preview' ? 'Memorise the path' : 'Crossing clock'}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary">
          Round {state.round + 1}/{state.totalRounds}
        </Badge>
        {phase === 'preview' ? <Badge tone="warning">Path is visible</Badge> : <Badge tone="accent">Path hidden</Badge>}
        {me?.stunned ? <Badge tone="danger">Stunned</Badge> : null}
        {me?.finished ? <Badge tone="success">Finished</Badge> : null}
      </div>
      <div
        role="grid"
        aria-label="Invisible path grid"
        className="touch-none mx-auto grid w-full max-w-md gap-1 overflow-hidden rounded-2xl border border-white/10 bg-black/50 p-2 select-none"
        style={{ gridTemplateColumns: `repeat(${state.cols}, minmax(0, 1fr))` }}
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
          if (Math.abs(dx) > Math.abs(dy)) step(dx > 0 ? 1 : -1, 0);
          else step(0, dy > 0 ? 1 : -1);
        }}
      >
        {Array.from({ length: state.cols * state.rows }, (_, index) => {
          const x = index % state.cols;
          const y = Math.floor(index / state.cols);
          const id = `${x},${y}`;
          const isGoal = x === state.goal.x && y === state.goal.y;
          const isStart = x === state.start.x && y === state.start.y;
          const occupants = players.filter((player) => {
            const runner = state.players[player.id];
            return runner && runner.x === x && runner.y === y;
          });
          return (
            <button
              key={id}
              type="button"
              aria-label={`Tile ${x},${y}`}
              disabled={!playing}
              onClick={() => {
                if (!me) return;
                if (Math.abs(x - me.x) + Math.abs(y - me.y) === 1) {
                  sendAction({ type: 'move', payload: { x, y } } satisfies GameAction);
                  vibrate('buttonPress');
                }
              }}
              className={cn(
                'relative aspect-square rounded-md border border-white/5',
                safe.has(id) ? 'bg-violet-400/50' : 'bg-slate-800/80',
                isGoal && 'ring-2 ring-emerald-300',
                isStart && 'ring-2 ring-sky-300',
              )}
            >
              {occupants.map((player, position) => (
                <span
                  key={player.id}
                  className="absolute inset-[22%] rounded-full"
                  style={{
                    backgroundColor: SEAT[players.indexOf(player) % SEAT.length],
                    marginLeft: position * 2,
                    boxShadow: player.id === myPlayerId ? '0 0 0 2px #fff' : undefined,
                  }}
                />
              ))}
            </button>
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
            onClick={() => step(dx, dy)}
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
        Memorise the glow, then step. Wrong tiles stun you. The safe set never leaves the server during play.
      </p>
    </div>
  );
}

export const invisiblePathClient: ClientGameModule = {
  metadata: INVISIBLE_PATH_METADATA,
  Component: InvisiblePathGame as unknown as ComponentType<GameComponentProps<never>>,
};
