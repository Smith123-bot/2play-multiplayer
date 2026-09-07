import { useCallback, useEffect, useRef, type ComponentType } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react';
import { MAGNET_MAZE_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

export type MagnetTile = 'floor' | 'wall' | 'magnetN' | 'magnetS' | 'spike' | 'crystal' | 'finish';

export interface MagnetPublicState {
  phase: 'idle' | 'playing' | 'finished';
  cols: number;
  rows: number;
  tiles: MagnetTile[];
  collected: string[];
  startedAt: number | null;
  endsAt: number | null;
  durationMs: number;
  finishReason: string | null;
  lastEvent: string | null;
  serverTime: number;
  finishCell: { x: number; y: number };
  runners: Record<
    string,
    {
      x: number;
      y: number;
      polarity: 'north' | 'south';
      crystals: number;
      frozen: boolean;
      finished: boolean;
      disconnected: boolean;
      score: number;
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
const TILE_CLASS: Record<MagnetTile, string> = {
  wall: 'bg-slate-700',
  floor: 'bg-slate-200/10',
  magnetN: 'bg-rose-500/70',
  magnetS: 'bg-sky-500/70',
  spike: 'bg-orange-500/80',
  crystal: 'bg-fuchsia-400/80',
  finish: 'bg-emerald-400/80',
};

function MagnetMazeGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<MagnetPublicState>) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const previousEvent = useRef<string | null>(null);
  const phase = state?.phase ?? 'idle';
  const me = myPlayerId ? state?.runners?.[myPlayerId] : undefined;
  const playing = phase === 'playing' && Boolean(me) && !me?.finished;

  const move = useCallback(
    (direction: 'up' | 'down' | 'left' | 'right') => {
      if (!playing) return;
      sendAction({ type: 'move', payload: { direction } } satisfies GameAction);
      vibrate('buttonPress');
    },
    [playing, sendAction, vibrate],
  );

  const flip = useCallback(() => {
    if (!playing) return;
    sendAction({ type: 'flip' } satisfies GameAction);
    play('click');
    vibrate('buttonPress');
  }, [playing, sendAction, play, vibrate]);

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
      if (target && (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) || target.isContentEditable)) return;
      if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        flip();
        return;
      }
      const direction = map[event.key];
      if (!direction) return;
      event.preventDefault();
      move(direction);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [move, flip]);

  useEffect(() => {
    const lastEvent = state?.lastEvent ?? null;
    if (lastEvent === previousEvent.current) return;
    previousEvent.current = lastEvent;
    if (!lastEvent) return;
    if (lastEvent.startsWith('crystal:') || lastEvent.startsWith('finish:')) {
      play(lastEvent.includes(myPlayerId ?? '') ? 'score' : 'notification');
    } else if (lastEvent.startsWith('spike:') && lastEvent.includes(myPlayerId ?? '')) {
      play('wrong');
      vibrate('error');
    }
  }, [state?.lastEvent, myPlayerId, play, vibrate]);

  if (phase === 'idle' || !state?.tiles?.length) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Charging the magnets…</p>
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
        label="Maze clock"
      />
      <div className="flex flex-wrap items-center gap-2">
        {me ? <Badge tone="primary">{me.polarity === 'north' ? 'N polarity' : 'S polarity'}</Badge> : null}
        {me ? <Badge tone="default">{me.crystals} crystals</Badge> : null}
        {me?.frozen ? <Badge tone="accent">Stunned</Badge> : null}
        {me?.finished ? <Badge tone="success">Finished</Badge> : null}
      </div>
      <div
        role="grid"
        aria-label="Magnet maze"
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
          const occupants = players.filter((player) => {
            const runner = state.runners[player.id];
            return runner && runner.x === x && runner.y === y;
          });
          return (
            <div key={index} className={cn('relative aspect-square', TILE_CLASS[tile] ?? 'bg-slate-800')}>
              {occupants.map((player, position) => (
                <span
                  key={player.id}
                  className="absolute inset-[18%] rounded-full"
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
      <div className="mx-auto flex flex-col items-center gap-3">
        <div className="grid w-44 grid-cols-3 grid-rows-2 gap-2">
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
        <button
          type="button"
          disabled={!playing}
          onClick={flip}
          className="min-h-11 rounded-xl border border-rose-400/40 bg-rose-400/10 px-4 text-sm font-semibold text-rose-100 transition active:scale-95 disabled:opacity-40"
        >
          Flip polarity
        </button>
      </div>
      <p className="text-center text-xs text-slate-500">
        Pink pulls north, blue south. Crystals score. The server decides when you finish.
      </p>
    </div>
  );
}

export const magnetMazeClient: ClientGameModule = {
  metadata: MAGNET_MAZE_METADATA,
  Component: MagnetMazeGame as unknown as ComponentType<GameComponentProps<never>>,
};
