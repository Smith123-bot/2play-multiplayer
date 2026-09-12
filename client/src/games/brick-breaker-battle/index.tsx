import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { BRICK_BREAKER_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { useServerDeadline } from '../../hooks/useCountdown';
import { cn } from '../../utils/cn';

export interface BrickArenaPublic {
  paddleX: number;
  paddleDir: number;
  paddleW: number;
  ball: { x: number; y: number; vx: number; vy: number };
  launchAt: number | null;
  bricks: boolean[];
  rows: number;
  level: number;
  levelsCleared: number;
  slowUntil: number;
  wideUntil: number;
  powerUps: Array<{ id: number; kind: 'wide' | 'slow' | 'life' | 'points'; x: number; y: number }>;
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
  maxLevel: number;
  powerUpPoints: number;
  startedAt: number | null;
  endsAt: number | null;
  finishReason: string | null;
  lastEvent: string | null;
  serverTime: number;
  arenas: Record<string, BrickArenaPublic | null>;
}

const PADDLE_SPEED = 55; // units/s — mirrors the server
const POWERUP_FALL_SPEED = 14; // units/s — mirrors the server
const SLOW_MULT = 0.75; // mirrors the server

const ROW_COLORS = ['#f87171', '#fb923c', '#fbbf24', '#34d399', '#38bdf8', '#818cf8'];

const POWERUP_STYLE: Record<string, { color: string; label: string; name: string }> = {
  wide: { color: '#38bdf8', label: 'W', name: 'Wide paddle' },
  slow: { color: '#a78bfa', label: 'S', name: 'Slow ball' },
  life: { color: '#f472b6', label: '♥', name: 'Extra life' },
  points: { color: '#fbbf24', label: '★', name: 'Bonus points' },
};

/** Deterministic 0..1 hash for particles (no Math.random in the render loop). */
function hash01(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10_000) / 10_000;
}

function BrickBreakerGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<BrickBreakerPublicState>) {
  const myCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rivalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<BrickBreakerPublicState | null>(null);
  const clockOffset = useRef(0);
  const lastIntent = useRef(0);
  const previousEvent = useRef<string | null>(null);
  const frameRef = useRef<number | null>(null);
  /** Ball trails per arena. */
  const trails = useRef<Map<string, Array<{ x: number; y: number }>>>(new Map());
  /** Brick death timestamps for pop-out ghosts: `${arenaId}:${index}` → ms. */
  const deaths = useRef<Map<string, number>>(new Map());
  /** Previous bricks snapshot per arena for death detection. */
  const prevBricks = useRef<Map<string, boolean[]>>(new Map());
  /** Particle bursts. */
  const bursts = useRef<Array<{ x: number; y: number; at: number; color: string; seed: string }>>([]);
  const [levelBanner, setLevelBanner] = useState<number | null>(null);
  const [powerToast, setPowerToast] = useState<string | null>(null);
  const previousLevel = useRef(1);

  stateRef.current = state ?? null;
  if (state?.serverTime) clockOffset.current = state.serverTime - Date.now();

  const phase = state?.phase ?? 'idle';
  const me = myPlayerId ? state?.arenas?.[myPlayerId] : undefined;
  const rival = players.find((player) => player.id !== myPlayerId);
  const rivalArena = rival ? state?.arenas?.[rival.id] : undefined;
  const canPlay = phase === 'playing' && !!me && !me.done;

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
    const [kind, actor, detail] = lastEvent.split(':');
    const mine = actor === myPlayerId;
    if (kind === 'brick') {
      play('click');
      const arena = stateRef.current?.arenas?.[actor ?? ''];
      if (arena) {
        const row = Math.floor((detail ? Number(detail) : 0) / (stateRef.current?.brickCols ?? 7));
        bursts.current.push({
          x: arena.ball.x,
          y: arena.ball.y,
          at: Date.now(),
          color: ROW_COLORS[row % ROW_COLORS.length] ?? '#fbbf24',
          seed: `${lastEvent}:${Date.now()}`,
        });
      }
    } else if (kind === 'save') play('notification');
    else if (kind === 'launch') play('click');
    else if (kind === 'power' && mine) {
      const style = POWERUP_STYLE[detail ?? ''] ?? POWERUP_STYLE.points!;
      play('score');
      vibrate('success');
      setPowerToast(style.name);
      window.setTimeout(() => setPowerToast(null), 1500);
    } else if (kind === 'level' && mine) {
      play('victory');
      vibrate('victory');
      setLevelBanner(Number(detail ?? 2));
      window.setTimeout(() => setLevelBanner(null), 2200);
    } else if (kind === 'miss' && mine) {
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

  /** Shared canvas render loop for both arenas. */
  useEffect(() => {
    const renderArenaCanvas = (
      canvas: HTMLCanvasElement,
      arenaView: BrickArenaPublic | null | undefined,
      arenaId: string,
      accent: string,
      now: number,
    ) => {
      const context = canvas.getContext('2d');
      const current = stateRef.current;
      if (!context || !current || !arenaView) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.clientWidth;
      const height = (width * current.height) / current.width;
      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
        canvas.style.height = `${height}px`;
      }
      const scale = width / current.width;
      const elapsedS = Math.max(0, (now - current.serverTime) / 1000);

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      // Backdrop.
      const bg = context.createLinearGradient(0, 0, 0, height);
      bg.addColorStop(0, '#0d1024');
      bg.addColorStop(1, '#0b0b16');
      context.fillStyle = bg;
      context.fillRect(0, 0, width, height);

      // Brick cell geometry (mirrors the server layout).
      const cols = current.brickCols;
      const brickW = 13;
      const brickH = 4;
      const gap = 1;
      const offsetX = (current.width - (cols * brickW + (cols - 1) * gap)) / 2;
      const offsetY = 6;
      const rowH = brickH + gap;

      // Detect fresh brick deaths for the pop-out ghosts.
      const prev = prevBricks.current.get(arenaId);
      if (!prev || prev.length !== arenaView.bricks.length) {
        prevBricks.current.set(arenaId, [...arenaView.bricks]);
      } else {
        for (let index = 0; index < arenaView.bricks.length; index += 1) {
          if (prev[index] && !arenaView.bricks[index]) {
            deaths.current.set(`${arenaId}:${index}`, now);
          }
        }
        prevBricks.current.set(arenaId, [...arenaView.bricks]);
      }

      // Live bricks with a subtle top highlight.
      for (let index = 0; index < arenaView.bricks.length; index += 1) {
        if (!arenaView.bricks[index]) continue;
        const row = Math.floor(index / cols);
        const col = index % cols;
        const x = (offsetX + col * (brickW + gap)) * scale;
        const y = (offsetY + row * rowH) * scale;
        const w = brickW * scale;
        const h = brickH * scale;
        const color = ROW_COLORS[row % ROW_COLORS.length] ?? '#fbbf24';
        context.fillStyle = color;
        context.beginPath();
        context.roundRect(x, y, w, h, Math.max(1, scale * 0.4));
        context.fill();
        context.fillStyle = 'rgba(255,255,255,0.28)';
        context.fillRect(x, y, w, Math.max(1, h * 0.18));
      }

      // Brick death ghosts: shrink + fade + sparks.
      for (const [key, deathAt] of deaths.current) {
        if (!key.startsWith(`${arenaId}:`)) continue;
        const age = now - deathAt;
        if (age > 320) {
          deaths.current.delete(key);
          continue;
        }
        const t = age / 320;
        const index = Number(key.split(':')[1]);
        const row = Math.floor(index / cols);
        const col = index % cols;
        const x = (offsetX + col * (brickW + gap)) * scale;
        const y = (offsetY + row * rowH) * scale;
        const w = brickW * scale * (1 - t);
        const h = brickH * scale * (1 - t);
        const color = ROW_COLORS[row % ROW_COLORS.length] ?? '#fbbf24';
        context.globalAlpha = 1 - t;
        context.fillStyle = color;
        context.fillRect(x + (brickW * scale - w) / 2, y + (brickH * scale - h) / 2, w, h);
        for (let spark = 0; spark < 6; spark += 1) {
          const angle = hash01(`${key}:${spark}`) * Math.PI * 2;
          const distance = t * scale * 3.5;
          context.beginPath();
          context.arc(
            x + brickW * scale / 2 + Math.cos(angle) * distance,
            y + brickH * scale / 2 + Math.sin(angle) * distance,
            Math.max(0.4, scale * 0.16 * (1 - t)),
            0,
            Math.PI * 2,
          );
          context.fillStyle = color;
          context.fill();
        }
        context.globalAlpha = 1;
      }

      // Paddle (uses the server's effective width, wide power-up included).
      const clampX = (x: number, w: number) => Math.min(current.width - w / 2, Math.max(w / 2, x));
      const paddleW = arenaView.paddleW ?? current.paddleWidth;
      const paddleX = clampX(arenaView.paddleX + arenaView.paddleDir * PADDLE_SPEED * elapsedS, paddleW);
      const py = current.paddleY;
      context.shadowColor = accent;
      context.shadowBlur = 12;
      context.fillStyle = accent;
      context.beginPath();
      context.roundRect(
        (paddleX - paddleW / 2) * scale,
        (py - current.paddleHeight / 2) * scale,
        paddleW * scale,
        current.paddleHeight * scale,
        current.paddleHeight * scale * 0.5,
      );
      context.fill();
      context.shadowBlur = 0;

      // Ball (extrapolated, slow power-up honoured) + trail.
      const slow = arenaView.slowUntil > now ? SLOW_MULT : 1;
      const parked = arenaView.launchAt !== null;
      const bx = parked ? paddleX : Math.min(current.width, Math.max(0, arenaView.ball.x + arenaView.ball.vx * slow * elapsedS));
      const by = parked
        ? py - current.ballRadius - 0.5
        : Math.min(current.height, Math.max(0, arenaView.ball.y + arenaView.ball.vy * slow * elapsedS));

      const trail = trails.current.get(arenaId) ?? [];
      if (!parked) {
        trail.push({ x: bx, y: by });
        if (trail.length > 10) trail.shift();
      } else if (trail.length > 0) {
        trail.shift();
      }
      trails.current.set(arenaId, trail);
      trail.forEach((point, index) => {
        const t = (index + 1) / trail.length;
        context.beginPath();
        context.arc(point.x * scale, point.y * scale, current.ballRadius * scale * (0.3 + t * 0.7), 0, Math.PI * 2);
        context.fillStyle = `rgba(255,255,255,${t * 0.22})`;
        context.fill();
      });

      // Parked ball: launch countdown ring.
      if (parked && arenaView.launchAt !== null) {
        const remainMs = Math.max(0, arenaView.launchAt - now);
        const t = 1 - Math.min(1, remainMs / 1100);
        context.beginPath();
        context.arc(bx * scale, by * scale, current.ballRadius * scale * (2.2 - t * 1.0), -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t);
        context.strokeStyle = 'rgba(255,255,255,0.75)';
        context.lineWidth = 2;
        context.stroke();
      }

      context.shadowColor = '#ffffff';
      context.shadowBlur = 10;
      context.beginPath();
      context.arc(bx * scale, by * scale, current.ballRadius * scale, 0, Math.PI * 2);
      context.fillStyle = '#ffffff';
      context.fill();
      context.shadowBlur = 0;

      // Falling power-up capsules (extrapolated at their constant speed).
      for (const capsule of arenaView.powerUps) {
        const style = POWERUP_STYLE[capsule.kind] ?? POWERUP_STYLE.points!;
        const cy = capsule.y + POWERUP_FALL_SPEED * elapsedS;
        const cx = capsule.x * scale;
        const w = 3.6 * scale;
        const h = 2.4 * scale;
        context.shadowColor = style.color;
        context.shadowBlur = 10;
        context.fillStyle = style.color;
        context.beginPath();
        context.roundRect(cx - w / 2, cy * scale - h / 2, w, h, h * 0.35);
        context.fill();
        context.shadowBlur = 0;
        context.fillStyle = '#0b0b16';
        context.font = `bold ${Math.floor(h * 0.7)}px system-ui, sans-serif`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(style.label, cx, cy * scale);
      }

      // Event bursts.
      if (bursts.current.length > 0) {
        bursts.current = bursts.current.filter((burst) => now - burst.at < 500);
        for (const burst of bursts.current) {
          const t = (now - burst.at) / 500;
          for (let index = 0; index < 10; index += 1) {
            const angle = hash01(`${burst.seed}:${index}`) * Math.PI * 2;
            const distance = t * scale * 3;
            context.beginPath();
            context.arc(
              burst.x * scale + Math.cos(angle) * distance,
              burst.y * scale + Math.sin(angle) * distance,
              Math.max(0.4, scale * 0.2 * (1 - t)),
              0,
              Math.PI * 2,
            );
            context.fillStyle = burst.color;
            context.globalAlpha = 1 - t;
            context.fill();
            context.globalAlpha = 1;
          }
        }
      }

      if (arenaView.done) {
        context.fillStyle = 'rgba(0,0,0,0.62)';
        context.fillRect(0, 0, width, height);
        context.font = `bold ${Math.floor(height * 0.09)}px system-ui, sans-serif`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillStyle = '#ffffff';
        context.fillText(
          arenaView.levelsCleared >= (stateRef.current?.maxLevel ?? 3) ? 'All walls cleared! 🧱' : 'Out of lives',
          width / 2,
          height / 2,
        );
      }
    };

    const render = () => {
      frameRef.current = requestAnimationFrame(render);
      const current = stateRef.current;
      if (!current) return;
      const now = Date.now() + clockOffset.current;
      const order = [myPlayerId ?? 'me', ...players.map((player) => player.id).filter((id) => id !== myPlayerId)];
      const mine = current.arenas[order[0] ?? ''];
      const other = current.arenas[order[1] ?? ''];
      if (myCanvasRef.current) renderArenaCanvas(myCanvasRef.current, mine, order[0] ?? 'me', '#818cf8', now);
      if (rivalCanvasRef.current) {
        renderArenaCanvas(rivalCanvasRef.current, other, order[1] ?? 'rival', '#34d399', now);
      }
    };

    frameRef.current = requestAnimationFrame(render);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myPlayerId]);

  // Smooth countdowns for the active power-up effects.
  const wideRemaining = useServerDeadline(me && me.wideUntil > 0 ? me.wideUntil : null);
  const slowRemaining = useServerDeadline(me && me.slowUntil > 0 ? me.slowUntil : null);

  // Track level changes for the banner (also covered by the level event).
  useEffect(() => {
    const level = me?.level ?? 1;
    if (level > previousLevel.current) {
      previousLevel.current = level;
    }
  }, [me?.level]);

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

  const iWon = phase === 'finished' && (me?.score ?? 0) > (rivalArena?.score ?? 0);
  const isDraw = phase === 'finished' && me?.score === rivalArena?.score;

  const renderArenaFrame = (
    label: string,
    arenaView: BrickArenaPublic | null | undefined,
    isMine: boolean,
    highlight: boolean,
    canvasRef: typeof myCanvasRef,
  ) => {
    if (!arenaView) return null;
    const total = arenaView.bricks.length;
    const progress = total > 0 ? arenaView.destroyed / total : 0;
    return (
      <div key={label} className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center justify-between gap-2 px-1">
          <span className={cn('flex items-center gap-1.5 truncate text-xs font-semibold', isMine ? 'text-indigo-300' : 'text-emerald-300')}>
            {label}
            <span className="rounded bg-white/10 px-1 py-px text-[10px] font-bold text-slate-200">
              LV {arenaView.level}/{state.maxLevel}
            </span>
          </span>
          <span className="flex items-center gap-2 text-xs text-slate-400">
            {arenaView.chain > 1 ? (
              <motion.span
                key={arenaView.chain}
                initial={{ scale: 1.4 }}
                animate={{ scale: 1 }}
                className="font-bold text-amber-300"
              >
                x{Math.min(4, arenaView.chain)}
              </motion.span>
            ) : null}
            <span aria-label="lives">{'❤️'.repeat(arenaView.lives)}</span>
            <span className="font-bold tabular-nums text-slate-200">{arenaView.score}</span>
          </span>
        </div>
        {/* Wall progress */}
        <div
          className="h-1 overflow-hidden rounded-full bg-white/10"
          role="progressbar"
          aria-label={`${label} wall progress`}
          aria-valuenow={arenaView.destroyed}
          aria-valuemin={0}
          aria-valuemax={total}
        >
          <motion.div
            className={cn('h-full rounded-full', isMine ? 'bg-indigo-400' : 'bg-emerald-400')}
            initial={{ width: 0 }}
            animate={{ width: `${progress * 100}%` }}
            transition={{ type: 'spring', stiffness: 120, damping: 20 }}
          />
        </div>
        <div
          className={cn(
            'relative w-full touch-none overflow-hidden rounded-xl border bg-black/60 select-none',
            highlight ? 'border-indigo-400/60 shadow-[0_0_12px_rgba(129,140,248,0.25)]' : 'border-white/10',
          )}
        >
          <canvas
            ref={canvasRef}
            className="block w-full"
            style={{ aspectRatio: `${state.width} / ${state.height}` }}
            aria-label={`${label} brick breaker arena`}
            onPointerMove={
              isMine && canPlay
                ? (event) => {
                    if (event.pointerType === 'mouse' && event.buttons === 0) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    const pointerX = ((event.clientX - rect.left) / rect.width) * state.width;
                    if (Date.now() - lastIntent.current < 90) return;
                    lastIntent.current = Date.now();
                    const offset = pointerX - arenaView.paddleX;
                    if (Math.abs(offset) < state.paddleWidth * 0.2) {
                      if (arenaView.paddleDir !== 0) sendMove('stop');
                    } else {
                      sendMove(offset < 0 ? 'left' : 'right');
                    }
                  }
                : undefined
            }
            onPointerDown={
              isMine && canPlay
                ? (event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    const pointerX = ((event.clientX - rect.left) / rect.width) * state.width;
                    if (Date.now() - lastIntent.current < 90) return;
                    lastIntent.current = Date.now();
                    const offset = pointerX - arenaView.paddleX;
                    if (Math.abs(offset) >= state.paddleWidth * 0.2) {
                      sendMove(offset < 0 ? 'left' : 'right');
                    }
                  }
                : undefined
            }
            onPointerUp={isMine && canPlay ? () => sendMove('stop') : undefined}
            onPointerLeave={isMine && canPlay ? () => sendMove('stop') : undefined}
          />
          {/* Power-up / level toasts sit over MY arena. */}
          {isMine ? (
            <AnimatePresence>
              {powerToast ? (
                <motion.div
                  key={powerToast}
                  initial={{ opacity: 0, y: 12, scale: 0.85 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="pointer-events-none absolute inset-x-0 bottom-3 mx-auto w-fit rounded-lg bg-amber-400/95 px-3 py-1.5 text-xs font-black tracking-wide text-amber-950 shadow-xl"
                >
                  {powerToast.toUpperCase()}!
                </motion.div>
              ) : null}
              {levelBanner !== null ? (
                <motion.div
                  key={levelBanner}
                  initial={{ opacity: 0, y: -12, scale: 0.85 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="pointer-events-none absolute inset-x-0 top-3 mx-auto w-fit rounded-xl bg-indigo-500/95 px-4 py-2 text-sm font-black tracking-wide text-white shadow-2xl"
                >
                  LEVEL {levelBanner} — BIGGER WALL, +1 LIFE
                </motion.div>
              ) : null}
            </AnimatePresence>
          ) : null}
        </div>
      </div>
    );
  };

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
        <Badge tone="primary">
          {me?.bricksBroken ?? 0} bricks · {me?.score ?? 0} pts
        </Badge>
        {me && me.chain > 1 ? <Badge tone="warning">Combo x{Math.min(4, me.chain)}</Badge> : null}
        {wideRemaining > 0 ? <Badge tone="default">Wide paddle {Math.ceil(wideRemaining / 1000)}s</Badge> : null}
        {slowRemaining > 0 ? <Badge tone="default">Slow ball {Math.ceil(slowRemaining / 1000)}s</Badge> : null}
        {phase === 'finished' ? (
          <Badge tone={isDraw ? 'accent' : iWon ? 'success' : 'danger'}>
            {isDraw ? 'Draw' : iWon ? 'You win!' : 'Rival wins'}
          </Badge>
        ) : null}
      </div>

      {/* Both arenas side by side (stack on narrow screens). */}
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 sm:flex-row">
        {renderArenaFrame('You', me, true, true, myCanvasRef)}
        {renderArenaFrame(rival?.nickname ?? 'Rival', rivalArena, false, false, rivalCanvasRef)}
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
          className="grid h-14 flex-1 place-items-center rounded-xl border border-white/10 bg-white/5 text-white transition active:scale-95 active:bg-white/15 disabled:opacity-40"
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
          className="grid h-14 flex-1 place-items-center rounded-xl border border-white/10 bg-white/5 text-white transition active:scale-95 active:bg-white/15 disabled:opacity-40"
        >
          <ChevronRight className="h-6 w-6" aria-hidden />
        </button>
      </div>
      <p className="text-center text-xs text-slate-500">
        A/D, arrows, drag on your arena or hold the buttons. Catch capsules: W wide paddle · S slow
        ball · ♥ extra life · ★ bonus points. Clear a wall to level up — three walls win the run.
      </p>
    </div>
  );
}

export const brickBreakerClient: ClientGameModule = {
  metadata: BRICK_BREAKER_METADATA,
  Component: BrickBreakerGame as unknown as ComponentType<GameComponentProps<never>>,
};
