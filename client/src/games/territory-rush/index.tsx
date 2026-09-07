import { useCallback, useEffect, useRef, type ComponentType } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react';
import { TERRITORY_RUSH_METADATA, type GameAction, type Player } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

export interface TerritoryRunnerPublic {
  x: number;
  y: number;
  direction: string;
  owner: number;
  trail: Array<{ x: number; y: number }>;
  cells: number;
  percent: number;
  captures: number;
  deaths: number;
  frozenUntil: number;
  disconnected: boolean;
}

export interface TerritoryRushPublicState {
  phase: 'idle' | 'playing' | 'finished';
  cols: number;
  rows: number;
  grid: string;
  stepMs: number;
  stepIndex: number;
  startedAt: number | null;
  endsAt: number | null;
  durationMs: number;
  finishReason: string | null;
  lastEvent: string | null;
  serverTime: number;
  totalCells: number;
  runners: Record<string, TerritoryRunnerPublic>;
}

const DPAD: Array<{
  direction: 'up' | 'down' | 'left' | 'right';
  icon: typeof ArrowUp;
  label: string;
  area: string;
}> = [
  { direction: 'up', icon: ArrowUp, label: 'Turn up', area: 'col-start-2 row-start-1' },
  { direction: 'left', icon: ArrowLeft, label: 'Turn left', area: 'col-start-1 row-start-2' },
  { direction: 'down', icon: ArrowDown, label: 'Turn down', area: 'col-start-2 row-start-2' },
  { direction: 'right', icon: ArrowRight, label: 'Turn right', area: 'col-start-3 row-start-2' },
];

const OWNER_FILL = ['#0f172a', '#6366f1', '#10b981', '#ec4899', '#f59e0b'];
const OWNER_TRAIL = ['#334155', '#a5b4fc', '#6ee7b7', '#f9a8d4', '#fcd34d'];

function ownerColor(players: Player[], playerId: string | null, runners: Record<string, TerritoryRunnerPublic>): string {
  const seat = players.findIndex((player) => player.id === playerId);
  const owner = playerId ? (runners[playerId]?.owner ?? seat + 1) : 0;
  return OWNER_FILL[owner] ?? OWNER_FILL[0]!;
}

function TerritoryRushGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<TerritoryRushPublicState>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const previousEvent = useRef<string | null>(null);

  const phase = state?.phase ?? 'idle';
  const me = myPlayerId ? state?.runners?.[myPlayerId] : undefined;
  const canSteer = phase === 'playing' && Boolean(me);

  const turn = useCallback(
    (direction: 'up' | 'down' | 'left' | 'right') => {
      if (!canSteer) return;
      sendAction({ type: 'turn', payload: { direction } } satisfies GameAction);
      play('click');
      vibrate('buttonPress');
    },
    [canSteer, sendAction, play, vibrate],
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
      const direction = map[event.key];
      if (!direction) return;
      const target = event.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) || target.isContentEditable)) {
        return;
      }
      event.preventDefault();
      turn(direction);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [turn]);

  useEffect(() => {
    const lastEvent = state?.lastEvent ?? null;
    if (lastEvent === previousEvent.current) return;
    previousEvent.current = lastEvent;
    if (!lastEvent) return;
    if (lastEvent.startsWith('capture:')) {
      play(lastEvent.includes(myPlayerId ?? '') ? 'score' : 'notification');
      if (lastEvent.includes(myPlayerId ?? '')) vibrate('success');
    } else if (lastEvent.startsWith('cut:')) {
      play(lastEvent.includes(myPlayerId ?? '') ? 'wrong' : 'notification');
      if (lastEvent.includes(myPlayerId ?? '')) vibrate('error');
    }
  }, [state?.lastEvent, myPlayerId, play, vibrate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !state?.grid) return;
    const cols = state.cols;
    const rows = state.rows;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssWidth = canvas.clientWidth || 360;
    const cell = cssWidth / cols;
    const cssHeight = cell * rows;
    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, cssWidth, cssHeight);
    for (let i = 0; i < state.grid.length; i += 1) {
      const owner = Number(state.grid[i] ?? '0') || 0;
      if (owner === 0) continue;
      const x = i % cols;
      const y = (i / cols) | 0;
      ctx.fillStyle = OWNER_FILL[owner] ?? '#334155';
      ctx.globalAlpha = 0.55;
      ctx.fillRect(x * cell, y * cell, cell + 0.5, cell + 0.5);
    }
    ctx.globalAlpha = 1;
    for (const runner of Object.values(state.runners ?? {})) {
      ctx.fillStyle = OWNER_TRAIL[runner.owner] ?? '#94a3b8';
      for (const segment of runner.trail) {
        ctx.globalAlpha = 0.85;
        ctx.fillRect(segment.x * cell + cell * 0.25, segment.y * cell + cell * 0.25, cell * 0.5, cell * 0.5);
      }
    }
    ctx.globalAlpha = 1;
    for (const [id, runner] of Object.entries(state.runners ?? {})) {
      const cx = runner.x * cell + cell / 2;
      const cy = runner.y * cell + cell / 2;
      ctx.beginPath();
      ctx.fillStyle = OWNER_FILL[runner.owner] ?? '#fff';
      ctx.arc(cx, cy, cell * 0.42, 0, Math.PI * 2);
      ctx.fill();
      if (id === myPlayerId) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(1.5, cell * 0.12);
        ctx.stroke();
      }
    }
  }, [state, myPlayerId]);

  if (phase === 'idle' || !state) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Painting the starting territories…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({
          ...player,
          score: state.runners?.[player.id]?.cells ?? player.score,
        }))}
        myPlayerId={myPlayerId}
        deadline={state.endsAt ?? null}
        label="Match time"
      />

      <div className="flex flex-wrap items-center gap-2">
        {me ? (
          <Badge tone="primary">
            You · {me.percent}% · {me.captures} loops
          </Badge>
        ) : null}
        {players
          .filter((player) => player.id !== myPlayerId)
          .map((player) => (
            <Badge key={player.id} tone="default">
              {player.nickname} · {state.runners?.[player.id]?.percent ?? 0}%
            </Badge>
          ))}
        {phase === 'finished' ? <Badge tone="accent">Match over</Badge> : null}
      </div>

      <div className="mx-auto w-full max-w-lg">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Territory Rush map"
          className="touch-none h-auto w-full overflow-hidden rounded-2xl border border-white/10 bg-slate-950 select-none"
          style={{ aspectRatio: `${state.cols} / ${state.rows}` }}
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
            if (Math.abs(dx) > Math.abs(dy)) turn(dx > 0 ? 'right' : 'left');
            else turn(dy > 0 ? 'down' : 'up');
          }}
        />
      </div>

      <div className="mx-auto grid w-44 grid-cols-3 grid-rows-2 gap-2">
        {DPAD.map(({ direction, icon: Icon, label, area }) => (
          <button
            key={direction}
            type="button"
            aria-label={label}
            disabled={!canSteer}
            onClick={() => turn(direction)}
            className={cn(
              'grid h-14 place-items-center rounded-xl border border-white/10 bg-white/5 text-white transition active:scale-95 disabled:opacity-40',
              area,
            )}
          >
            <Icon className="h-6 w-6" aria-hidden />
          </button>
        ))}
      </div>
      <ul className="flex flex-wrap justify-center gap-3 text-xs text-slate-300">
        {players.map((player) => (
          <li key={player.id} className="flex items-center gap-1.5">
            <span
              className="h-3 w-3 rounded-sm"
              style={{ backgroundColor: ownerColor(players, player.id, state.runners) }}
              aria-hidden
            />
            {player.nickname}
            {player.id === myPlayerId ? ' (you)' : ''}
          </li>
        ))}
      </ul>
      <p className="text-center text-xs text-slate-500">
        Leave home, loop back, paint the enclosed cells. The server owns every capture.
      </p>
    </div>
  );
}

export const territoryRushClient: ClientGameModule = {
  metadata: TERRITORY_RUSH_METADATA,
  Component: TerritoryRushGame as unknown as ComponentType<GameComponentProps<never>>,
};
