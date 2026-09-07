import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { BRICK_BREAKER_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

export interface BrickArenaPublic {
  paddleX: number;
  paddleDir: number;
  ball: { x: number; y: number; vx: number; vy: number };
  launchAt: number | null;
  bricks: boolean[];
  destroyed: number;
  chain: number;
  lives: number;
  score: number;
  bricksBroken: number;
  done: boolean;
  doneAt: number | null;
  disconnected: boolean;
  left: boolean;
}

export interface BrickBreakerPublicState {
  phase: 'idle' | 'playing' | 'finished';
  width: number;
  height: number;
  paddleWidth: number;
  paddleHeight: number;
  paddleY: number;
  ballRadius: number;
  brickCols: number;
  brickRows: number;
  brickValues: number[];
  clearBonus: number;
  startedAt: number | null;
  endsAt: number | null;
  finishReason: string | null;
  lastEvent: string | null;
  serverTime: number;
  arenas: Record<string, BrickArenaPublic | null>;
}

const PADDLE_SPEED = 55; // units/s — mirrors the server

const ROW_COLORS = ['#f87171', '#fbbf24', '#34d399', '#60a5fa'];

function BrickBreakerGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<BrickBreakerPublicState>) {
  const clockOffset = useRef(0);
  const lastIntent = useRef(0);
  const previousEvent = useRef<string | null>(null);
  const [, setFrame] = useState(0);

  const phase = state?.phase ?? 'idle';
  const me = myPlayerId ? state?.arenas?.[myPlayerId] : undefined;
  const rival = players.find((player) => player.id !== myPlayerId);
  const rivalArena = rival ? state?.arenas?.[rival.id] : undefined;
  const canPlay = phase === 'playing' && !!me && !me.done;

  useEffect(() => {
    if (state) clockOffset.current = state.serverTime - Date.now();
  }, [state]);

  const playing = phase === 'playing';
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = 0;
    const loop = (time: number) => {
      if (time - last > 33) {
        last = time;
        setFrame((frame) => frame + 1);
      }
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
  }, [playing]);

  const sendMove = useCallback(
    (direction: 'left' | 'right' | 'stop') => {
      if (!canPlay) return;
      sendAction({ type: 'move', payload: { direction } } satisfies GameAction);
      vibrate('buttonPress');
    },
    [canPlay, sendAction, vibrate],
  );

  // Keyboard: A/D + arrows (never while typing in chat/inputs).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const map: Record<string, 'left' | 'right' | 'stop'> = {
        ArrowLeft: 'left', ArrowRight: 'right',
        a: 'left', d: 'right', A: 'left', D: 'right',
      };
      const direction = map[event.key];
      if (!direction) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) || target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      sendMove(direction);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sendMove]);

  // Event feedback.
  const lastEvent = state?.lastEvent ?? null;
  useEffect(() => {
    if (lastEvent === previousEvent.current) return;
    previousEvent.current = lastEvent;
    if (!lastEvent) return;
    const [kind, actor] = lastEvent.split(':');
    const mine = actor === myPlayerId;
    if (kind === 'brick') play('click');
    else if (kind === 'save') play('notification');
    else if (kind === 'launch') play('click');
    else if (kind === 'miss' && mine) {
      play('wrong');
      vibrate('error');
    } else if (kind === 'out' && mine) {
      play('defeat');
      vibrate('error');
    } else if (kind === 'cleared' && mine) {
      play('victory');
      vibrate('victory');
    } else if (kind === 'won') {
      const iWon = (me?.score ?? 0) > (rivalArena?.score ?? 0);
      play(iWon ? 'victory' : 'defeat');
      vibrate(iWon ? 'victory' : 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEvent]);

  if (phase === 'idle' || !state) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Stacking the bricks…</p>
        </div>
      </div>
    );
  }

  const {
    width, height, paddleWidth: pw, paddleHeight: phh, paddleY, ballRadius: br,
    brickCols, brickRows,
  } = state;
  const elapsedS = state ? Math.max(0, (Date.now() + clockOffset.current - state.serverTime) / 1000) : 0;
  const pct = (value: number, max: number) => `${(value / max) * 100}%`;

  const renderArena = (
    label: string,
    arenaView: BrickArenaPublic | null | undefined,
    isMine: boolean,
    highlight: boolean,
  ) => {
    if (!arenaView) return null;
    const clampX = (x: number) => Math.min(width - pw / 2, Math.max(pw / 2, x));
    const paddleX = clampX(arenaView.paddleX + arenaView.paddleDir * PADDLE_SPEED * elapsedS);
    const parked = arenaView.launchAt !== null;
    const bx = parked ? paddleX : Math.min(width, Math.max(0, arenaView.ball.x + arenaView.ball.vx * elapsedS));
    const by = parked ? paddleY - br - 0.5 : Math.min(height, Math.max(0, arenaView.ball.y + arenaView.ball.vy * elapsedS));

    return (
      <div key={label} className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center justify-between gap-2 px-1">
          <span className={cn('truncate text-xs font-semibold', isMine ? 'text-indigo-300' : 'text-emerald-300')}>
            {label}
          </span>
          <span className="flex items-center gap-2 text-xs text-slate-400">
            {arenaView.chain > 1 ? (
              <span className="font-bold text-warning">x{Math.min(4, arenaView.chain)}</span>
            ) : null}
            <span aria-label="lives">{'❤️'.repeat(arenaView.lives)}</span>
            <span className="font-bold tabular-nums text-slate-200">{arenaView.score}</span>
          </span>
        </div>
        <div
          className={cn(
            'relative w-full touch-none overflow-hidden rounded-xl border bg-black/60 select-none',
            highlight ? 'border-indigo-400/60 shadow-[0_0_12px_rgba(129,140,248,0.25)]' : 'border-white/10',
          )}
          style={{ aspectRatio: `${width} / ${height}` }}
          onTouchMove={
            isMine && canPlay
              ? (event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  const touchX = ((event.touches[0]!.clientX - rect.left) / rect.width) * width;
                  if (Date.now() - lastIntent.current < 90) return;
                  lastIntent.current = Date.now();
                  const offset = touchX - arenaView.paddleX;
                  if (Math.abs(offset) < pw * 0.2) {
                    if (arenaView.paddleDir !== 0) sendMove('stop');
                  } else {
                    sendMove(offset < 0 ? 'left' : 'right');
                  }
                }
              : undefined
          }
          onTouchEnd={isMine && canPlay ? () => sendMove('stop') : undefined}
        >
          {/* bricks */}
          {arenaView.bricks.map((alive, index) =>
            alive ? (
              <div
                key={index}
                className="absolute rounded-[2px]"
                style={{
                  width: `${(100 / brickCols) * 0.94}%`,
                  height: `${(100 / (height / 4 * brickRows)) * 0.8}%`,
                  left: `${(index % brickCols) * (100 / brickCols) + (100 / brickCols) * 0.03}%`,
                  top: `${(Math.floor(index / brickCols) * 100) / brickRows + 1.2}%`,
                  backgroundColor: ROW_COLORS[Math.floor(index / brickCols) % ROW_COLORS.length],
                  opacity: 0.9,
                }}
              />
            ) : null,
          )}
          {/* paddle */}
          <div
            className={cn('absolute rounded-full', isMine ? 'bg-indigo-400' : 'bg-emerald-400')}
            style={{
              width: pct(pw, width),
              height: pct(phh, height),
              left: `calc(${pct(paddleX - pw / 2, width)})`,
              top: `calc(${pct(paddleY - phh / 2, height)})`,
            }}
            aria-label={`${label} paddle`}
          />
          {/* ball */}
          <div
            className="absolute rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.9)]"
            style={{
              width: pct(br * 2, width),
              height: pct(br * 2, height),
              left: `calc(${pct(bx - br, width)})`,
              top: `calc(${pct(by - br, height)})`,
            }}
            aria-label="Ball"
          />
          {arenaView.done ? (
            <div className="absolute inset-0 grid place-items-center bg-black/60">
              <span className="text-sm font-bold text-white">
                {arenaView.destroyed >= brickCols * brickRows ? 'Cleared! 🧱' : 'Out of lives'}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  const iWon = phase === 'finished' && (me?.score ?? 0) > (rivalArena?.score ?? 0);
  const isDraw = phase === 'finished' && me?.score === rivalArena?.score;

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({
          ...player,
          score: state.arenas?.[player.id]?.score ?? player.score,
        }))}
        myPlayerId={myPlayerId}
        deadline={state.endsAt ?? null}
        label="Match time"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary">{me?.bricksBroken ?? 0} bricks · {me?.score ?? 0} pts</Badge>
        {me && me.chain > 1 ? <Badge tone="warning">Combo x{Math.min(4, me.chain)}</Badge> : null}
        {phase === 'finished' ? (
          <Badge tone={isDraw ? 'accent' : iWon ? 'success' : 'danger'}>
            {isDraw ? 'Draw' : iWon ? 'You win!' : 'Rival wins'}
          </Badge>
        ) : null}
      </div>

      {/* Both arenas side by side (stack on narrow screens). */}
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 sm:flex-row">
        {renderArena('You', me, true, true)}
        {renderArena(rival?.nickname ?? 'Rival', rivalArena, false, false)}
      </div>

      {/* Virtual controls */}
      <div className="mx-auto flex w-52 items-center justify-between gap-2">
        <button
          type="button"
          aria-label="Move paddle left"
          disabled={!canPlay}
          onPointerDown={() => sendMove('left')}
          onPointerUp={() => sendMove('stop')}
          onPointerLeave={() => canPlay && sendMove('stop')}
          className="grid h-14 flex-1 place-items-center rounded-xl border border-white/10 bg-white/5 text-white transition active:scale-95 disabled:opacity-40"
        >
          <ChevronLeft className="h-6 w-6" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Move paddle right"
          disabled={!canPlay}
          onPointerDown={() => sendMove('right')}
          onPointerUp={() => sendMove('stop')}
          onPointerLeave={() => canPlay && sendMove('stop')}
          className="grid h-14 flex-1 place-items-center rounded-xl border border-white/10 bg-white/5 text-white transition active:scale-95 disabled:opacity-40"
        >
          <ChevronRight className="h-6 w-6" aria-hidden />
        </button>
      </div>
      <p className="text-center text-xs text-slate-500">
        A/D, arrows, drag on your arena or hold the buttons — clear your wall, chain combos, keep three lives.
      </p>
    </div>
  );
}

export const brickBreakerClient: ClientGameModule = {
  metadata: BRICK_BREAKER_METADATA,
  Component: BrickBreakerGame as unknown as ComponentType<GameComponentProps<never>>,
};
