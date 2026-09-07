import { useCallback, useEffect, useRef, type ComponentType } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react';
import { ECHO_MAZE_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

export type EchoTile = 'floor' | 'wall' | 'fog';

export interface EchoMazePublicState {
  phase: 'idle' | 'preview' | 'playing' | 'between' | 'finished';
  round: number;
  totalRounds: number;
  cols: number;
  rows: number;
  layoutId: number;
  goal: { x: number; y: number };
  checkpoints: Array<{ x: number; y: number }>;
  tiles: EchoTile[];
  startedAt: number | null;
  endsAt: number | null;
  finishReason: string | null;
  lastEvent: string | null;
  serverTime: number;
  runners: Record<
    string,
    {
      x: number;
      y: number;
      score: number;
      checkpoints: number;
      finished: boolean;
      trail: Array<{ x: number; y: number }>;
      disconnected: boolean;
    }
  >;
}

const DPAD = [
  { direction: 'up' as const, icon: ArrowUp, label: 'Move up', area: 'col-start-2 row-start-1' },
  { direction: 'left' as const, icon: ArrowLeft, label: 'Move left', area: 'col-start-1 row-start-2' },
  { direction: 'down' as const, icon: ArrowDown, label: 'Move down', area: 'col-start-2 row-start-2' },
  { direction: 'right' as const, icon: ArrowRight, label: 'Move right', area: 'col-start-3 row-start-2' },
];
const SEAT = ['#818cf8', '#34d399', '#f472b6', '#fbbf24'];

function EchoMazeGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<EchoMazePublicState>) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const previousEvent = useRef<string | null>(null);
  const phase = state?.phase ?? 'idle';
  const me = myPlayerId ? state?.runners?.[myPlayerId] : undefined;
  const playing = phase === 'playing' && Boolean(me) && !me?.finished && !me?.disconnected;

  const move = useCallback(
    (direction: 'up' | 'down' | 'left' | 'right') => {
      if (!playing) return;
      sendAction({ type: 'move', payload: { direction } } satisfies GameAction);
      vibrate('buttonPress');
    },
    [playing, sendAction, vibrate],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const map: Record<string, 'up' | 'down' | 'left' | 'right'> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
        w: 'up',
        s: 'down',
        a: 'left',
        d: 'right',
        W: 'up',
        S: 'down',
        A: 'left',
        D: 'right',
      };
      const target = event.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) || target.isContentEditable)) {
        return;
      }
      const direction = map[event.key];
      if (!direction) return;
      event.preventDefault();
      move(direction);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [move]);

  useEffect(() => {
    const lastEvent = state?.lastEvent ?? null;
    if (lastEvent === previousEvent.current) return;
    previousEvent.current = lastEvent;
    if (!lastEvent) return;
    if (lastEvent.startsWith('checkpoint:') && lastEvent.includes(myPlayerId ?? '')) {
      play('score');
      vibrate('success');
    } else if (lastEvent.startsWith('finish:') && lastEvent.includes(myPlayerId ?? '')) {
      play('victory');
      vibrate('victory');
    } else if (lastEvent === 'preview' || lastEvent === 'round-start') {
      play('notification');
    }
  }, [state?.lastEvent, myPlayerId, play, vibrate]);

  if (phase === 'idle' || !state?.tiles?.length) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Carving the echo maze…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({ ...player, score: state.runners?.[player.id]?.score ?? player.score }))}
        myPlayerId={myPlayerId}
        deadline={state.endsAt ?? null}
        label={phase === 'preview' ? 'Memorise the maze' : 'Race clock'}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary">
          Round {state.round + 1}/{state.totalRounds}
        </Badge>
        {phase === 'preview' ? <Badge tone="warning">Walls visible — remember them</Badge> : null}
        {phase === 'playing' ? <Badge tone="accent">Fog is up</Badge> : null}
        {me?.finished ? <Badge tone="success">You finished</Badge> : null}
      </div>
      <div
        role="grid"
        aria-label="Echo maze"
        className="touch-none mx-auto grid w-full max-w-md gap-px overflow-hidden rounded-2xl border border-white/10 bg-black/50 p-1 select-none"
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
          if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 'right' : 'left');
          else move(dy > 0 ? 'down' : 'up');
        }}
      >
        {state.tiles.map((tile, index) => {
          const x = index % state.cols;
          const y = Math.floor(index / state.cols);
          const isGoal = x === state.goal.x && y === state.goal.y;
          const isCheck = state.checkpoints.some((entry) => entry.x === x && entry.y === y);
          const trailHere = Object.values(state.runners).some((runner) =>
            runner.trail.some((cell) => cell.x === x && cell.y === y),
          );
          const occupants = players.filter((player) => {
            const runner = state.runners[player.id];
            return runner && runner.x === x && runner.y === y;
          });
          return (
            <div
              key={index}
              className={cn(
                'relative aspect-square',
                tile === 'wall' && 'bg-slate-700/90',
                tile === 'fog' && 'bg-slate-950',
                tile === 'floor' && 'bg-slate-200/10',
                trailHere && tile === 'floor' && 'bg-indigo-400/25',
                isGoal && 'bg-emerald-400/50',
                isCheck && 'bg-amber-400/40',
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
            </div>
          );
        })}
      </div>
      <div className="mx-auto grid w-44 grid-cols-3 grid-rows-2 gap-2">
        {DPAD.map(({ direction, icon: Icon, label, area }) => (
          <button
            key={direction}
            type="button"
            aria-label={label}
            disabled={!playing}
            onClick={() => move(direction)}
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
        Preview, then race. Hidden walls still block you. The server owns the finish — you only send a step.
      </p>
    </div>
  );
}

export const echoMazeClient: ClientGameModule = {
  metadata: ECHO_MAZE_METADATA,
  Component: EchoMazeGame as unknown as ComponentType<GameComponentProps<never>>,
};
