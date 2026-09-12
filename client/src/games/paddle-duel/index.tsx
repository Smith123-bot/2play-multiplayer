import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { PADDLE_DUEL_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

export interface PaddlePublic {
  side: 'left' | 'right';
  y: number;
  dir: number;
  score: number;
  rallies: number;
  disconnected: boolean;
  left: boolean;
}

export interface PaddleDuelPublicState {
  phase: 'idle' | 'playing' | 'finished';
  width: number;
  height: number;
  paddleWidth: number;
  paddleHeight: number;
  paddleSpeed: number;
  ballRadius: number;
  ball: { x: number; y: number; vx: number; vy: number };
  serveAt: number | null;
  servingTo: 'left' | 'right' | null;
  rallyHits: number;
  scoreLimit: number;
  startedAt: number | null;
  endsAt: number | null;
  finishReason: string | null;
  lastEvent: string | null;
  serverTime: number;
  paddles: Record<string, PaddlePublic | null>;
}

const PADDLE_SPEED_FALLBACK = 42; // units/s — mirrors the server base constant

interface Burst {
  x: number;
  y: number;
  at: number;
  color: string;
  kind: 'hit' | 'wall' | 'point';
}

function PaddleDuelGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<PaddleDuelPublicState>) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<PaddleDuelPublicState | null>(null);
  const clockOffset = useRef(0); // serverTime - Date.now()
  const lastIntent = useRef(0);
  const previousEvent = useRef<string | null>(null);
  const trail = useRef<Array<{ x: number; y: number; speed: number }>>([]);
  const bursts = useRef<Burst[]>([]);
  const frameRef = useRef<number | null>(null);
  const [shake, setShake] = useState(0);

  stateRef.current = state ?? null;
  if (state?.serverTime) clockOffset.current = state.serverTime - Date.now();

  const phase = state?.phase ?? 'idle';
  const me = myPlayerId ? state?.paddles?.[myPlayerId] : undefined;
  const rival = players.find((player) => player.id !== myPlayerId);
  const rivalPaddle = rival ? state?.paddles?.[rival.id] : undefined;
  const canPlay = phase === 'playing' && !!me;

  const sendMove = useCallback(
    (direction: 'up' | 'down' | 'stop') => {
      if (!canPlay) return;
      sendAction({ type: 'move', payload: { direction } } satisfies GameAction);
      vibrate('buttonPress');
    },
    [canPlay, sendAction, vibrate],
  );

  // Keyboard: W/S + arrows (never while typing in chat/inputs).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const map: Record<string, 'up' | 'down' | 'stop'> = {
        ArrowUp: 'up', ArrowDown: 'down',
        w: 'up', s: 'down', W: 'up', S: 'down',
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

  // Event feedback + canvas bursts.
  const lastEvent = state?.lastEvent ?? null;
  useEffect(() => {
    if (lastEvent === previousEvent.current) return;
    previousEvent.current = lastEvent;
    if (!lastEvent) return;
    const current = stateRef.current;
    const ball = current?.ball;
    if (lastEvent === 'paddle') {
      play('click');
      if (ball) {
        bursts.current.push({ x: ball.x, y: ball.y, at: Date.now(), color: '#a5b4fc', kind: 'hit' });
      }
    } else if (lastEvent === 'wall') {
      play('notification');
      if (ball) {
        bursts.current.push({ x: ball.x, y: ball.y, at: Date.now(), color: '#e2e8f0', kind: 'wall' });
      }
    } else if (lastEvent === 'serve') play('click');
    else if (lastEvent.startsWith('point:')) {
      const scorer = lastEvent.slice(6);
      if (scorer === myPlayerId) {
        play('score');
        vibrate('success');
      } else {
        play('wrong');
        vibrate('error');
      }
      if (ball) {
        bursts.current.push({ x: ball.x, y: ball.y, at: Date.now(), color: '#f87171', kind: 'point' });
      }
      setShake((value) => value + 1);
    } else if (lastEvent === 'won') {
      const iWon = (me?.score ?? 0) > (rivalPaddle?.score ?? 0);
      play(iWon ? 'victory' : 'defeat');
      vibrate(iWon ? 'victory' : 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEvent]);

  /** Canvas render loop — extrapolated ball/paddles + trail + bursts. */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const render = () => {
      frameRef.current = requestAnimationFrame(render);
      const current = stateRef.current;
      if (!current || !current.width) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.clientWidth;
      const height = (width * current.height) / current.width;
      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
        canvas.style.height = `${height}px`;
      }
      const scale = width / current.width;
      const now = Date.now() + clockOffset.current;
      const elapsedS = Math.max(0, (now - current.serverTime) / 1000);
      const paddleSpeed = current.paddleSpeed ?? PADDLE_SPEED_FALLBACK;

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      // Court backdrop.
      const bg = context.createLinearGradient(0, 0, 0, height);
      bg.addColorStop(0, '#0d1024');
      bg.addColorStop(0.5, '#0b0b16');
      bg.addColorStop(1, '#0d1024');
      context.fillStyle = bg;
      context.fillRect(0, 0, width, height);

      // Goal zones tinted per side.
      context.fillStyle = 'rgba(129,140,248,0.10)';
      context.fillRect(0, 0, 6 * scale, height);
      context.fillStyle = 'rgba(52,211,153,0.10)';
      context.fillRect(width - 6 * scale, 0, 6 * scale, height);

      // Dashed centre line + centre circle.
      context.strokeStyle = 'rgba(255,255,255,0.14)';
      context.lineWidth = Math.max(1, width * 0.004);
      context.setLineDash([width * 0.025, width * 0.02]);
      context.beginPath();
      context.moveTo(width / 2, 0);
      context.lineTo(width / 2, height);
      context.stroke();
      context.setLineDash([]);
      context.beginPath();
      context.arc(width / 2, height / 2, height * 0.16, 0, Math.PI * 2);
      context.stroke();

      // Extrapolated positions.
      const clampY = (y: number) => Math.min(current.height - current.paddleHeight / 2, Math.max(current.paddleHeight / 2, y));
      const frozen = current.serveAt !== null;
      const bx = frozen
        ? current.width / 2
        : Math.min(current.width + 4, Math.max(-4, current.ball.x + current.ball.vx * elapsedS));
      const by = frozen
        ? current.height / 2
        : Math.min(current.height, Math.max(0, current.ball.y + current.ball.vy * elapsedS));

      const drawPaddle = (side: 'left' | 'right', y: number, color: string, dim: boolean) => {
        const px = side === 'left' ? 3 * scale : (current.width - 3 - current.paddleWidth) * scale;
        context.globalAlpha = dim ? 0.45 : 1;
        // Glow.
        context.shadowColor = color;
        context.shadowBlur = 14;
        context.fillStyle = color;
        const drawY = (y - current.paddleHeight / 2) * scale;
        context.beginPath();
        context.roundRect(px, drawY, current.paddleWidth * scale, current.paddleHeight * scale, current.paddleWidth * scale * 0.5);
        context.fill();
        context.shadowBlur = 0;
        // Highlight edge.
        context.fillStyle = 'rgba(255,255,255,0.35)';
        context.fillRect(px, drawY, current.paddleWidth * scale, Math.max(1, current.paddleHeight * scale * 0.08));
        context.globalAlpha = 1;
      };

      // Paddles.
      for (const [id, paddle] of Object.entries(current.paddles)) {
        if (!paddle) continue;
        const y = clampY(paddle.y + paddle.dir * paddleSpeed * elapsedS);
        const mineSide = id === myPlayerId;
        drawPaddle(paddle.side, y, mineSide ? '#818cf8' : '#34d399', paddle.disconnected);
      }

      // Ball trail — longer and brighter as the rally speeds up.
      const speed = frozen ? 0 : Math.hypot(current.ball.vx, current.ball.vy);
      if (!frozen) {
        trail.current.push({ x: bx, y: by, speed });
        if (trail.current.length > 14) trail.current.shift();
      } else if (trail.current.length > 0) {
        trail.current.shift();
      }
      const heat = Math.max(0, Math.min(1, (speed - 40) / 38));
      trail.current.forEach((point, index) => {
        const t = (index + 1) / trail.current.length;
        const radius = current.ballRadius * scale * (0.35 + t * 0.75);
        context.beginPath();
        context.arc(point.x * scale, point.y * scale, radius, 0, Math.PI * 2);
        context.fillStyle = `rgba(${Math.round(165 + heat * 90)},${Math.round(180 - heat * 60)},${Math.round(
          252 - heat * 60,
        )},${t * (0.12 + heat * 0.35)})`;
        context.fill();
      });

      // Bursts (paddle hits, wall bounces, points).
      if (bursts.current.length > 0) {
        bursts.current = bursts.current.filter((burst) => now - burst.at < 650);
        for (const burst of bursts.current) {
          const t = (now - burst.at) / 650;
          const fade = 1 - t;
          const count = burst.kind === 'point' ? 14 : 8;
          for (let index = 0; index < count; index += 1) {
            const angle = (index / count) * Math.PI * 2 + (burst.kind === 'point' ? t * 3 : 0);
            const distance = (burst.kind === 'point' ? 2.6 : 1.4) * t * scale;
            context.beginPath();
            context.arc(
              burst.x * scale + Math.cos(angle) * distance,
              burst.y * scale + Math.sin(angle) * distance,
              Math.max(0.4, (burst.kind === 'point' ? 0.35 : 0.22) * scale * fade),
              0,
              Math.PI * 2,
            );
            context.fillStyle = burst.color;
            context.globalAlpha = fade;
            context.fill();
            context.globalAlpha = 1;
          }
        }
      }

      // The ball — pulsing while waiting for the serve.
      const ballR = current.ballRadius * scale * (frozen ? 1 + 0.12 * Math.sin(now / 130) : 1);
      context.shadowColor = '#ffffff';
      context.shadowBlur = 12;
      context.beginPath();
      context.arc(bx * scale, by * scale, ballR, 0, Math.PI * 2);
      context.fillStyle = '#ffffff';
      context.fill();
      context.shadowBlur = 0;

      // Serve indicator: countdown + direction arrow.
      if (frozen && current.serveAt !== null) {
        const remainMs = Math.max(0, current.serveAt - now);
        const text = remainMs > 350 ? String(Math.ceil(remainMs / 1000)) : 'GO';
        context.font = `bold ${Math.floor(height * 0.22)}px system-ui, sans-serif`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillStyle = 'rgba(255,255,255,0.85)';
        context.fillText(text, width / 2, height * 0.5 - height * 0.28);
        // Arrow toward the receiving side.
        const dir = current.servingTo === 'left' ? -1 : 1;
        context.strokeStyle = 'rgba(255,255,255,0.6)';
        context.lineWidth = Math.max(2, width * 0.006);
        context.beginPath();
        context.moveTo(width / 2 - dir * width * 0.04, height * 0.5);
        context.lineTo(width / 2 + dir * width * 0.04, height * 0.5);
        context.lineTo(width / 2 + dir * width * 0.015, height * 0.5 - height * 0.035);
        context.moveTo(width / 2 + dir * width * 0.04, height * 0.5);
        context.lineTo(width / 2 + dir * width * 0.015, height * 0.5 + height * 0.035);
        context.stroke();
      }
    };

    frameRef.current = requestAnimationFrame(render);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [myPlayerId]);

  if (phase === 'idle' || !state) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Warming up the arena…</p>
        </div>
      </div>
    );
  }

  const iWon = phase === 'finished' && (me?.score ?? 0) > (rivalPaddle?.score ?? 0);
  const isDraw = phase === 'finished' && me?.score === rivalPaddle?.score;

  // Pointer drag (touch AND mouse): track the pointer and stream up/down/stop.
  const onDrag = (clientY: number, arena: HTMLElement) => {
    if (!canPlay || !me) return;
    const rect = arena.getBoundingClientRect();
    const pointerY = ((clientY - rect.top) / rect.height) * state.height;
    if (Date.now() - lastIntent.current < 90) return;
    const offset = pointerY - me.y;
    if (Math.abs(offset) < state.paddleHeight * 0.2) {
      if (me.dir !== 0) {
        lastIntent.current = Date.now();
        sendMove('stop');
      }
      return;
    }
    lastIntent.current = Date.now();
    sendMove(offset < 0 ? 'up' : 'down');
  };

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({
          ...player,
          score: state.paddles?.[player.id]?.score ?? player.score,
        }))}
        myPlayerId={myPlayerId}
        deadline={state.endsAt ?? null}
        label="Match time"
      />

      {/* Scoreboard */}
      <div className="card flex items-center justify-center gap-6 p-3">
        <div className="text-right">
          <div className="text-xs uppercase tracking-wider text-indigo-300">You</div>
          <motion.div
            key={`me-${me?.score ?? 0}`}
            initial={{ scale: 1.35 }}
            animate={{ scale: 1 }}
            className="text-4xl font-bold tabular-nums text-indigo-300"
          >
            {me?.score ?? 0}
          </motion.div>
        </div>
        <div className="text-xs uppercase tracking-wider text-slate-500">first to {state.scoreLimit}</div>
        <div className="text-left">
          <div className="text-xs uppercase tracking-wider text-emerald-300">{rival?.nickname ?? 'Rival'}</div>
          <motion.div
            key={`rival-${rivalPaddle?.score ?? 0}`}
            initial={{ scale: 1.35 }}
            animate={{ scale: 1 }}
            className="text-4xl font-bold tabular-nums text-emerald-300"
          >
            {rivalPaddle?.score ?? 0}
          </motion.div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary">{me?.side === 'left' ? '◀ Left side' : 'Right side ▶'}</Badge>
        <Badge tone={state.rallyHits >= 4 ? 'warning' : 'default'}>Rally {state.rallyHits}</Badge>
        {phase === 'finished' ? (
          <Badge tone={isDraw ? 'accent' : iWon ? 'success' : 'danger'}>
            {isDraw ? 'Draw' : iWon ? 'You win!' : 'Rival wins'}
          </Badge>
        ) : null}
      </div>

      {/* Arena */}
      <motion.div
        className="mx-auto w-full max-w-[min(94vw,36rem)]"
        animate={{ x: [0, 0] }}
        key={shake}
        transition={{ duration: 0.3 }}
      >
        <div
          className={cn(
            'relative w-full touch-none overflow-hidden rounded-2xl border border-white/10 select-none',
            shake > 0 && 'animate-[arena-shake_0.3s_ease-out]',
          )}
        >
          <canvas
            ref={canvasRef}
            className="block w-full"
            style={{ aspectRatio: `${state.width} / ${state.height}` }}
            aria-label="Paddle duel arena"
            onPointerMove={(event) => {
              if (event.pointerType === 'mouse' && event.buttons === 0) return;
              onDrag(event.clientY, event.currentTarget);
            }}
            onPointerDown={(event) => onDrag(event.clientY, event.currentTarget)}
            onPointerUp={() => canPlay && sendMove('stop')}
            onPointerLeave={() => canPlay && sendMove('stop')}
          />
          {phase === 'finished' ? (
            <div className="absolute inset-0 grid place-items-center bg-black/60">
              <span className="text-xl font-bold text-white">
                {isDraw ? 'Draw' : iWon ? 'You win! 🏓' : 'Rival wins'}
              </span>
            </div>
          ) : null}
        </div>
      </motion.div>

      {/* Virtual controls */}
      <div className="mx-auto flex w-44 flex-col gap-2">
        <button
          type="button"
          aria-label="Move paddle up"
          disabled={!canPlay}
          onPointerDown={() => sendMove('up')}
          onPointerUp={() => sendMove('stop')}
          onPointerLeave={() => canPlay && sendMove('stop')}
          className="grid h-14 place-items-center rounded-xl border border-white/10 bg-white/5 text-white transition active:scale-95 active:bg-white/15 disabled:opacity-40"
        >
          <ChevronUp className="h-6 w-6" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Move paddle down"
          disabled={!canPlay}
          onPointerDown={() => sendMove('down')}
          onPointerUp={() => sendMove('stop')}
          onPointerLeave={() => canPlay && sendMove('stop')}
          className="grid h-14 place-items-center rounded-xl border border-white/10 bg-white/5 text-white transition active:scale-95 active:bg-white/15 disabled:opacity-40"
        >
          <ChevronDown className="h-6 w-6" aria-hidden />
        </button>
      </div>
      <p className="text-center text-xs text-slate-500">
        W/S, arrows, drag on the arena or hold the buttons — the server simulates every bounce.
      </p>
      <style>{`@keyframes arena-shake { 0% { transform: translate(0,0); } 25% { transform: translate(-3px,2px); } 50% { transform: translate(3px,-2px); } 75% { transform: translate(-2px,-1px); } 100% { transform: translate(0,0); } }`}</style>
    </div>
  );
}

export const paddleDuelClient: ClientGameModule = {
  metadata: PADDLE_DUEL_METADATA,
  Component: PaddleDuelGame as unknown as ComponentType<GameComponentProps<never>>,
};
