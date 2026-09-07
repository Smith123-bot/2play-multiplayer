import { useCallback, useEffect, useRef, type ComponentType } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react';
import { COLOR_TRAILS_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

export type TrailHue = 'red' | 'blue' | 'green' | 'yellow';

export interface TrailRunnerPublic {
  x: number;
  y: number;
  direction: string;
  trail: Array<{ x: number; y: number }>;
  score: number;
  combo: number;
  hue: TrailHue | null;
  pickups: number;
  zones: number;
  frozenUntil: number;
  disconnected: boolean;
}

export interface ColorTrailsPublicState {
  phase: 'idle' | 'playing' | 'finished';
  cols: number;
  rows: number;
  stepMs: number;
  stepIndex: number;
  startedAt: number | null;
  endsAt: number | null;
  durationMs: number;
  finishReason: string | null;
  lastEvent: string | null;
  serverTime: number;
  tokens: Array<{ id: string; x: number; y: number; hue: TrailHue; kind: 'pickup' | 'zone' }>;
  runners: Record<string, TrailRunnerPublic>;
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

const HUE: Record<TrailHue, string> = {
  red: '#f87171',
  blue: '#60a5fa',
  green: '#34d399',
  yellow: '#fbbf24',
};
const SEAT = ['#818cf8', '#34d399', '#f472b6', '#fbbf24'];

function ColorTrailsGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<ColorTrailsPublicState>) {
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
    if (lastEvent.startsWith('pickup:') || lastEvent.startsWith('zone:')) {
      play(lastEvent.includes(myPlayerId ?? '') ? 'score' : 'notification');
      if (lastEvent.includes(myPlayerId ?? '')) vibrate('success');
    } else if (lastEvent.startsWith('hit:')) {
      play(lastEvent.includes(myPlayerId ?? '') ? 'wrong' : 'notification');
      if (lastEvent.includes(myPlayerId ?? '')) vibrate('error');
    }
  }, [state?.lastEvent, myPlayerId, play, vibrate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !state) return;
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
    for (const token of state.tokens ?? []) {
      const x = token.x * cell + cell / 2;
      const y = token.y * cell + cell / 2;
      ctx.fillStyle = HUE[token.hue];
      if (token.kind === 'zone') {
        ctx.globalAlpha = 0.28;
        ctx.fillRect(token.x * cell, token.y * cell, cell, cell);
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = HUE[token.hue];
        ctx.lineWidth = 2;
        ctx.strokeRect(token.x * cell + 2, token.y * cell + 2, cell - 4, cell - 4);
      } else {
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(x, y, cell * 0.28, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    players.forEach((player, seat) => {
      const runner = state.runners?.[player.id];
      if (!runner) return;
      ctx.strokeStyle = runner.hue ? HUE[runner.hue] : SEAT[seat % SEAT.length]!;
      ctx.lineWidth = Math.max(2, cell * 0.28);
      ctx.lineCap = 'round';
      ctx.beginPath();
      runner.trail.forEach((segment, index) => {
        const x = segment.x * cell + cell / 2;
        const y = segment.y * cell + cell / 2;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      const cx = runner.x * cell + cell / 2;
      const cy = runner.y * cell + cell / 2;
      ctx.beginPath();
      ctx.fillStyle = SEAT[seat % SEAT.length]!;
      ctx.arc(cx, cy, cell * 0.38, 0, Math.PI * 2);
      ctx.fill();
      if (player.id === myPlayerId) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });
  }, [state, players, myPlayerId]);

  if (phase === 'idle' || !state) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Mixing the colour tokens…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({
          ...player,
          score: state.runners?.[player.id]?.score ?? player.score,
        }))}
        myPlayerId={myPlayerId}
        deadline={state.endsAt ?? null}
        label="Match time"
      />

      <div className="flex flex-wrap items-center gap-2">
        {me ? (
          <Badge tone="primary">
            Combo ×{me.combo}
            {me.hue ? ` · ${me.hue}` : ''}
          </Badge>
        ) : null}
        {phase === 'finished' ? <Badge tone="accent">Match over</Badge> : null}
      </div>

      <div className="mx-auto w-full max-w-lg">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Color Trails arena"
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
      <p className="text-center text-xs text-slate-500">
        Scoop matching colours, hit matching zones, dodge rival trails. Trails fade — they are not territory.
      </p>
    </div>
  );
}

export const colorTrailsClient: ClientGameModule = {
  metadata: COLOR_TRAILS_METADATA,
  Component: ColorTrailsGame as unknown as ComponentType<GameComponentProps<never>>,
};
