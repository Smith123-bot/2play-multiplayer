import { useCallback, useEffect, useRef, type ComponentType } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react';
import { SHADOW_COPY_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

export type ShadowTile = 'wall' | 'floor' | 'plate' | 'gate' | 'hazard' | 'exit';

export interface ShadowPublicState {
  phase: 'idle' | 'playing' | 'between' | 'finished';
  round: number;
  totalRounds: number;
  roundTick: number;
  maxTicks: number;
  arenaId: string;
  arenaName: string;
  cols: number;
  rows: number;
  tiles: ShadowTile[];
  plates: Array<{ x: number; y: number }>;
  pickups: Array<{ x: number; y: number; kind: 'crystal' | 'shadow' }>;
  gatesOpen: boolean;
  startedAt: number | null;
  endsAt: number | null;
  durationMs: number;
  finishReason: string | null;
  lastEvent: string | null;
  serverTime: number;
  runners: Record<
    string,
    {
      x: number;
      y: number;
      score: number;
      crystals: number;
      shadowCrystals: number;
      exits: number;
      frozen: boolean;
      disconnected: boolean;
    }
  >;
  shadows: Array<{ ownerId: string; x: number; y: number; skipped: number }>;
}

const DPAD = [
  { direction: 'up' as const, icon: ArrowUp, label: 'Move up', area: 'col-start-2 row-start-1' },
  { direction: 'left' as const, icon: ArrowLeft, label: 'Move left', area: 'col-start-1 row-start-2' },
  { direction: 'down' as const, icon: ArrowDown, label: 'Move down', area: 'col-start-2 row-start-2' },
  { direction: 'right' as const, icon: ArrowRight, label: 'Move right', area: 'col-start-3 row-start-2' },
];
const SEAT = ['#818cf8', '#34d399', '#f472b6', '#fbbf24'];

function tileClass(tile: ShadowTile, gatesOpen: boolean): string {
  if (tile === 'wall') return 'bg-slate-800';
  if (tile === 'plate') return 'bg-amber-400/40';
  if (tile === 'gate') return gatesOpen ? 'bg-emerald-400/30' : 'bg-fuchsia-700/80';
  if (tile === 'hazard') return 'bg-orange-500/80';
  if (tile === 'exit') return 'bg-emerald-400/70';
  return 'bg-slate-200/10';
}

function ShadowCopyGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<ShadowPublicState>) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const previousEvent = useRef<string | null>(null);
  const phase = state?.phase ?? 'idle';
  const me = myPlayerId ? state?.runners?.[myPlayerId] : undefined;
  const playing = phase === 'playing' && Boolean(me) && !me?.disconnected;
  const myShadow = state?.shadows?.find((ghost) => ghost.ownerId === myPlayerId);

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
    if (lastEvent.startsWith('crystal:') || lastEvent.startsWith('exit:')) {
      play(lastEvent.includes(myPlayerId ?? '') ? 'score' : 'notification');
    } else if (lastEvent.startsWith('shadow:')) {
      play(lastEvent.includes(myPlayerId ?? '') ? 'correct' : 'notification');
    } else if (lastEvent.startsWith('hazard:') && lastEvent.includes(myPlayerId ?? '')) {
      play('wrong');
      vibrate('error');
    } else if (lastEvent === 'shadow-born' || lastEvent === 'round-end') {
      play('notification');
    }
  }, [state?.lastEvent, myPlayerId, play, vibrate]);

  if (phase === 'idle' || !state?.tiles?.length) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Tracing shadow paths…</p>
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
        label={phase === 'between' ? 'Next round' : 'Round clock'}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary">
          Round {state.round + 1}/{state.totalRounds}
        </Badge>
        <Badge tone="default">{state.arenaName}</Badge>
        {state.gatesOpen ? <Badge tone="success">Gates open</Badge> : <Badge tone="warning">Hold every plate</Badge>}
        {myShadow ? <Badge tone="accent">Your shadow is live</Badge> : null}
        {me?.frozen ? <Badge tone="danger">Frozen</Badge> : null}
        {phase === 'between' ? <Badge tone="accent">Shadow copies incoming</Badge> : null}
      </div>
      <div
        role="grid"
        aria-label={`${state.arenaName} arena`}
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
          const pickup = state.pickups.find((entry) => entry.x === x && entry.y === y);
          const occupants = players.filter((player) => {
            const runner = state.runners[player.id];
            return runner && runner.x === x && runner.y === y;
          });
          const ghosts = state.shadows.filter((ghost) => ghost.x === x && ghost.y === y);
          return (
            <div key={index} className={cn('relative aspect-square', tileClass(tile, state.gatesOpen))}>
              {pickup?.kind === 'crystal' ? (
                <span className="absolute inset-[30%] rounded-sm bg-amber-300" aria-hidden />
              ) : null}
              {pickup?.kind === 'shadow' ? (
                <span className="absolute inset-[30%] rounded-sm bg-violet-400/90" aria-hidden />
              ) : null}
              {ghosts.map((ghost, position) => {
                const ownerIndex = players.findIndex((player) => player.id === ghost.ownerId);
                return (
                  <span
                    key={`shadow-${ghost.ownerId}-${position}`}
                    className="absolute inset-[12%] rounded-full border-2 border-dashed opacity-50"
                    style={{
                      borderColor: SEAT[(ownerIndex >= 0 ? ownerIndex : 0) % SEAT.length],
                      backgroundColor: `${SEAT[(ownerIndex >= 0 ? ownerIndex : 0) % SEAT.length]}55`,
                    }}
                    aria-hidden
                  />
                );
              })}
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
            disabled={!playing || me?.frozen}
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
        Gold crystals are yours. Violet crystals belong to your shadow. Stand on plates to open gates. The server
        records your path — you cannot submit a ghost.
      </p>
    </div>
  );
}

export const shadowCopyClient: ClientGameModule = {
  metadata: SHADOW_COPY_METADATA,
  Component: ShadowCopyGame as unknown as ComponentType<GameComponentProps<never>>,
};
