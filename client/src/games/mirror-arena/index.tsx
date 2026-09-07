import { useCallback, useEffect, useRef, type ComponentType } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react';
import { MIRROR_ARENA_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

export type MirrorCell = 'wall' | 'floor' | 'plate' | 'gate' | 'crystal' | 'hazard' | 'exit';

export interface MirrorArenaPublicState {
  phase: 'idle' | 'playing' | 'finished';
  cols: number;
  rows: number;
  grid: MirrorCell[][];
  plates: Array<{ x: number; y: number; held: boolean }>;
  gatesOpen: boolean;
  endsAt: number | null;
  finishReason: string | null;
  lastEvent: string | null;
  serverTime: number;
  players: Record<
    string,
    {
      x: number;
      y: number;
      mx: number;
      my: number;
      score: number;
      crystals: number;
      frozen: boolean;
      exited: boolean;
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
const CELL: Record<MirrorCell, string> = {
  wall: 'bg-slate-700/90',
  floor: 'bg-slate-200/10',
  plate: 'bg-sky-400/50',
  gate: 'bg-fuchsia-500/40',
  crystal: 'bg-cyan-300/80',
  hazard: 'bg-red-500/50',
  exit: 'bg-emerald-400/50',
};

function MirrorArenaGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<MirrorArenaPublicState>) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const previousEvent = useRef<string | null>(null);
  const phase = state?.phase ?? 'idle';
  const me = myPlayerId ? state?.players?.[myPlayerId] : undefined;
  const playing = phase === 'playing' && Boolean(me) && !me?.disconnected && !me?.exited && !me?.frozen;

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
    if (lastEvent.startsWith('crystal:') && lastEvent.includes(myPlayerId ?? '')) {
      play('score');
      vibrate('success');
    } else if (lastEvent.startsWith('exit:') && lastEvent.includes(myPlayerId ?? '')) {
      play('victory');
      vibrate('victory');
    } else if (lastEvent.startsWith('hazard:') && lastEvent.includes(myPlayerId ?? '')) {
      play('wrong');
      vibrate('error');
    }
  }, [state?.lastEvent, myPlayerId, play, vibrate]);

  if (phase === 'idle' || !state?.grid?.length) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Polishing the mirrors…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({ ...player, score: state.players?.[player.id]?.score ?? player.score }))}
        myPlayerId={myPlayerId}
        deadline={state.endsAt ?? null}
        label="Arena clock"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={state.gatesOpen ? 'success' : 'warning'}>{state.gatesOpen ? 'Gates open' : 'Hold both plates'}</Badge>
        <Badge tone="accent">Crystals {me?.crystals ?? 0}</Badge>
        {me?.frozen ? <Badge tone="danger">Frozen</Badge> : null}
        {me?.exited ? <Badge tone="success">Exited</Badge> : null}
      </div>
      <div
        role="grid"
        aria-label="Mirror arena"
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
        {state.grid.flatMap((row, y) =>
          row.map((cell, x) => {
            const occupants = players.filter((player) => {
              const body = state.players[player.id];
              return body && ((body.x === x && body.y === y) || (body.mx === x && body.my === y));
            });
            const isMirror = occupants.some((player) => {
              const body = state.players[player.id];
              return body && body.mx === x && body.my === y && !(body.x === x && body.y === y);
            });
            return (
              <div
                key={`${x}:${y}`}
                className={cn('relative aspect-square', CELL[cell], cell === 'gate' && state.gatesOpen && 'bg-emerald-400/30')}
              >
                {occupants.map((player, position) => (
                  <span
                    key={`${player.id}-${x}-${y}`}
                    className={cn('absolute inset-[20%] rounded-full', isMirror && 'opacity-60')}
                    style={{
                      backgroundColor: SEAT[players.indexOf(player) % SEAT.length],
                      marginLeft: position * 2,
                      boxShadow: player.id === myPlayerId && !isMirror ? '0 0 0 2px #fff' : undefined,
                    }}
                  />
                ))}
              </div>
            );
          }),
        )}
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
        Your twin always moves opposite you. The server owns collisions, plates and the gate.
      </p>
    </div>
  );
}

export const mirrorArenaClient: ClientGameModule = {
  metadata: MIRROR_ARENA_METADATA,
  Component: MirrorArenaGame as unknown as ComponentType<GameComponentProps<never>>,
};
