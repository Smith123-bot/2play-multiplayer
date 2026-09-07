import { useCallback, useEffect, useRef, type ComponentType } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react';
import { COIN_HUNTERS_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

export type CoinKind = 'normal' | 'gold' | 'rare' | 'multi';

export interface CoinHuntersPublicState {
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
  bonus: { x: number; y: number; w: number; h: number };
  slow: number[];
  blocker: { x: number; y: number; direction: string };
  coins: Array<{ id: string; x: number; y: number; kind: CoinKind; value: number; expiresAt: number }>;
  hunters: Record<
    string,
    {
      x: number;
      y: number;
      direction: string;
      score: number;
      coins: number;
      multiplier: boolean;
      disconnected: boolean;
    }
  >;
}

const DPAD: Array<{
  direction: 'up' | 'down' | 'left' | 'right';
  icon: typeof ArrowUp;
  label: string;
  area: string;
}> = [
  { direction: 'up', icon: ArrowUp, label: 'Move up', area: 'col-start-2 row-start-1' },
  { direction: 'left', icon: ArrowLeft, label: 'Move left', area: 'col-start-1 row-start-2' },
  { direction: 'down', icon: ArrowDown, label: 'Move down', area: 'col-start-2 row-start-2' },
  { direction: 'right', icon: ArrowRight, label: 'Move right', area: 'col-start-3 row-start-2' },
];

const SEAT = ['#818cf8', '#34d399', '#f472b6', '#fbbf24'];
const COIN_FILL: Record<CoinKind, string> = {
  normal: '#fbbf24',
  gold: '#f59e0b',
  rare: '#c084fc',
  multi: '#22d3ee',
};

function CoinHuntersGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<CoinHuntersPublicState>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const previousEvent = useRef<string | null>(null);

  const phase = state?.phase ?? 'idle';
  const me = myPlayerId ? state?.hunters?.[myPlayerId] : undefined;
  const canMove = phase === 'playing' && Boolean(me);

  const move = useCallback(
    (direction: 'up' | 'down' | 'left' | 'right') => {
      if (!canMove) return;
      sendAction({ type: 'move', payload: { direction } } satisfies GameAction);
      vibrate('buttonPress');
    },
    [canMove, sendAction, vibrate],
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
    if (lastEvent.startsWith('collect:') || lastEvent.startsWith('multi:')) {
      play(lastEvent.includes(myPlayerId ?? '') ? 'score' : 'notification');
      if (lastEvent.includes(myPlayerId ?? '')) vibrate('success');
    } else if (lastEvent.startsWith('block:') && lastEvent.includes(myPlayerId ?? '')) {
      play('wrong');
      vibrate('error');
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
    ctx.fillStyle = 'rgba(52, 211, 153, 0.18)';
    ctx.fillRect(state.bonus.x * cell, state.bonus.y * cell, state.bonus.w * cell, state.bonus.h * cell);
    ctx.fillStyle = 'rgba(148, 163, 184, 0.22)';
    for (const index of state.slow ?? []) {
      const x = index % cols;
      const y = (index / cols) | 0;
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
    for (const coin of state.coins ?? []) {
      ctx.fillStyle = COIN_FILL[coin.kind];
      ctx.beginPath();
      ctx.arc(coin.x * cell + cell / 2, coin.y * cell + cell / 2, cell * (coin.kind === 'rare' ? 0.36 : 0.28), 0, Math.PI * 2);
      ctx.fill();
      if (coin.kind === 'multi') {
        ctx.fillStyle = '#0f172a';
        ctx.font = `${Math.max(8, cell * 0.45)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('2×', coin.x * cell + cell / 2, coin.y * cell + cell / 2 + 0.5);
      }
    }
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(state.blocker.x * cell + cell * 0.15, state.blocker.y * cell + cell * 0.15, cell * 0.7, cell * 0.7);
    players.forEach((player, seat) => {
      const hunter = state.hunters?.[player.id];
      if (!hunter) return;
      ctx.beginPath();
      ctx.fillStyle = SEAT[seat % SEAT.length]!;
      ctx.arc(hunter.x * cell + cell / 2, hunter.y * cell + cell / 2, cell * 0.38, 0, Math.PI * 2);
      ctx.fill();
      if (player.id === myPlayerId) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });
  }, [state, players, myPlayerId]);

  const collectNearby = () => {
    if (!canMove || !me || !state) return;
    const nearby = state.coins.find((coin) => Math.abs(coin.x - me.x) + Math.abs(coin.y - me.y) <= 1);
    if (!nearby) return;
    sendAction({ type: 'collect', payload: { coinId: nearby.id } } satisfies GameAction);
    play('click');
    vibrate('buttonPress');
  };

  if (phase === 'idle' || !state) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Minting coins for the arena…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({
          ...player,
          score: state.hunters?.[player.id]?.score ?? player.score,
        }))}
        myPlayerId={myPlayerId}
        deadline={state.endsAt ?? null}
        label="Match time"
      />

      <div className="flex flex-wrap items-center gap-2">
        {me ? <Badge tone="primary">{me.coins} coins</Badge> : null}
        {me?.multiplier ? <Badge tone="accent">2× multiplier</Badge> : null}
        {phase === 'finished' ? <Badge tone="accent">Match over</Badge> : null}
      </div>

      <div className="mx-auto w-full max-w-lg">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Coin Hunters arena"
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
            if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 'right' : 'left');
            else move(dy > 0 ? 'down' : 'up');
          }}
        />
      </div>

      <div className="mx-auto flex flex-col items-center gap-3">
        <div className="grid w-44 grid-cols-3 grid-rows-2 gap-2">
          {DPAD.map(({ direction, icon: Icon, label, area }) => (
            <button
              key={direction}
              type="button"
              aria-label={label}
              disabled={!canMove}
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
          disabled={!canMove}
          onClick={collectNearby}
          className="min-h-11 rounded-xl border border-warning/40 bg-warning/10 px-4 text-sm font-semibold text-warning transition active:scale-95 disabled:opacity-40"
        >
          Collect nearby
        </button>
      </div>
      <p className="text-center text-xs text-slate-500">
        Gold and rare coins pay more. Green is 2×. Grey tiles slow you. Red is a blocker. The server confirms every collect.
      </p>
    </div>
  );
}

export const coinHuntersClient: ClientGameModule = {
  metadata: COIN_HUNTERS_METADATA,
  Component: CoinHuntersGame as unknown as ComponentType<GameComponentProps<never>>,
};
