import { useEffect, useRef, useState, type ComponentType } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { PADDLE_DUEL_METADATA } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { useServerPaddleInput } from '../../hooks/useServerPaddleInput';
import { cn } from '../../utils/cn';

export interface PaddlePublic {
  side: 'left' | 'right';
  y: number;
  dir: number;
  latestInputSeq: number;
  score: number;
  rallies: number;
  bestRally: number;
  pointStreak: number;
  disconnected: boolean;
  left: boolean;
}

export interface PaddleDuelPublicState {
  phase: 'idle' | 'playing' | 'finished';
  width: number;
  height: number;
  paddleWidth: number;
  paddleHeight: number;
  ballRadius: number;
  ball: { x: number; y: number; vx: number; vy: number };
  serveAt: number | null;
  servingTo: 'left' | 'right' | null;
  rallyHits: number;
  pointNumber: number;
  lastHit: { x: number; y: number; at: number } | null;
  lastImpact: {
    id: number;
    kind: 'paddle' | 'wall' | 'point';
    x: number;
    y: number;
    at: number;
  } | null;
  scoreLimit: number;
  startedAt: number | null;
  endsAt: number | null;
  finishReason: string | null;
  lastEvent: string | null;
  serverTime: number;
  paddles: Record<string, PaddlePublic | null>;
}

const PADDLE_SPEED = 42; // units/s — must mirror the server constant

function PaddleDuelGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<PaddleDuelPublicState>) {
  const clockOffset = useRef(0); // serverTime - Date.now()
  const previousEvent = useRef<string | null>(null);
  const previousScore = useRef(0);
  const [, setFrame] = useState(0);

  const phase = state?.phase ?? 'idle';
  const me = myPlayerId ? state?.paddles?.[myPlayerId] : undefined;
  const rival = players.find((player) => player.id !== myPlayerId);
  const rivalPaddle = rival ? state?.paddles?.[rival.id] : undefined;
  const canPlay = phase === 'playing' && !!me;

  // The hook sends only direction intents. It owns keyboard, pointer, touch,
  // hold, release, blur and reconnect-safe heartbeat handling; the server still
  // owns the paddle position and every collision.
  const paddleInput = useServerPaddleInput({
    canPlay,
    axis: 'y',
    paddlePosition: me?.y,
    paddleSize: state?.paddleHeight ?? 12,
    arenaSize: state?.height ?? 60,
    negativeDirection: 'negative',
    positiveDirection: 'positive',
    latestInputSeq: me?.latestInputSeq,
    sendAction,
    vibrate: (pattern) => vibrate(pattern),
  });

  // Smooth motion: extrapolate ball + paddles from the last authoritative
  // snapshot using the server clock. Visual only — the server stays the truth.
  useEffect(() => {
    if (state) clockOffset.current = state.serverTime - Date.now();
  }, [state]);

  // Re-render every animation frame while playing so the extrapolated
  // paddles/ball glide at the display refresh rate.
  const playing = phase === 'playing';
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      setFrame((frame) => frame + 1);
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
  }, [playing]);

  // Event feedback.
  const lastEvent = state?.lastEvent ?? null;
  const eventIdentity = lastEvent
    ? `${lastEvent}:${state?.lastImpact?.id ?? state?.pointNumber ?? 0}`
    : null;
  useEffect(() => {
    if (eventIdentity === previousEvent.current) return;
    previousEvent.current = eventIdentity;
    if (!lastEvent) return;
    if (lastEvent === 'paddle') play('click');
    else if (lastEvent === 'wall') play('notification');
    else if (lastEvent === 'serve') play('click');
    else if (lastEvent.startsWith('point:')) {
      const scorer = lastEvent.slice(6);
      if (scorer === myPlayerId) {
        play('score');
        vibrate('success');
      } else {
        play('wrong');
        vibrate('error');
      }
    } else if (lastEvent === 'won') {
      const iWon = (me?.score ?? 0) > (rivalPaddle?.score ?? 0);
      play(iWon ? 'victory' : 'defeat');
      vibrate(iWon ? 'victory' : 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEvent]);
  const totalScore = Object.values(state?.paddles ?? {}).reduce(
    (sum, paddle) => sum + (paddle?.score ?? 0),
    0,
  );
  useEffect(() => {
    if (totalScore > previousScore.current) play('score');
    previousScore.current = totalScore;
  }, [totalScore, play]);

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

  const {
    width,
    height,
    paddleWidth: pw,
    paddleHeight: ph,
    ballRadius: br,
    ball,
    scoreLimit,
  } = state;
  const pct = (value: number, max: number) => `${(value / max) * 100}%`;

  // Extrapolated positions (clamped to the arena).
  const elapsedS = state
    ? Math.max(0, (Date.now() + clockOffset.current - state.serverTime) / 1000)
    : 0;
  const clampY = (y: number) => Math.min(height - ph / 2, Math.max(ph / 2, y));
  const reflectY = (value: number) => {
    const low = br;
    const span = height - br - low;
    let folded = (((value - low) % (2 * span)) + 2 * span) % (2 * span);
    if (folded > span) folded = 2 * span - folded;
    return folded + low;
  };
  const myY = me ? clampY(me.y + me.dir * PADDLE_SPEED * elapsedS) : height / 2;
  const rivalY = rivalPaddle
    ? clampY(rivalPaddle.y + rivalPaddle.dir * PADDLE_SPEED * elapsedS)
    : height / 2;
  const frozen = state.serveAt !== null;
  const bx = frozen ? width / 2 : Math.min(width + 4, Math.max(-4, ball.x + ball.vx * elapsedS));
  const by = frozen ? height / 2 : reflectY(ball.y + ball.vy * elapsedS);
  const trail = frozen
    ? []
    : Array.from({ length: 6 }, (_entry, index) => {
        const age = (index + 1) * 0.018;
        return { x: bx - ball.vx * age, y: by - ball.vy * age, opacity: (6 - index) / 18 };
      });
  const prediction = frozen
    ? []
    : Array.from({ length: 9 }, (_entry, index) => {
        const future = (index + 1) * 0.075;
        return { x: bx + ball.vx * future, y: reflectY(by + ball.vy * future) };
      }).filter((point) => point.x >= 0 && point.x <= width);
  const impactVisible =
    state.lastImpact && Date.now() + clockOffset.current - state.lastImpact.at < 460;

  const serveCountdown =
    frozen && state.serveAt !== null
      ? Math.max(0, (state.serveAt - (Date.now() + clockOffset.current)) / 1000)
      : null;
  const iWon = phase === 'finished' && (me?.score ?? 0) > (rivalPaddle?.score ?? 0);
  const isDraw = phase === 'finished' && me?.score === rivalPaddle?.score;


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
          <div className="text-4xl font-bold tabular-nums text-indigo-300">{me?.score ?? 0}</div>
        </div>
        <div className="text-xs uppercase tracking-wider text-slate-500">first to {scoreLimit}</div>
        <div className="text-left">
          <div className="text-xs uppercase tracking-wider text-emerald-300">
            {rival?.nickname ?? 'Rival'}
          </div>
          <div className="text-4xl font-bold tabular-nums text-emerald-300">
            {rivalPaddle?.score ?? 0}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary">{me?.side === 'left' ? '◀ Left side' : 'Right side ▶'}</Badge>
        <Badge tone={state.rallyHits >= 6 ? 'warning' : 'default'}>Rally {state.rallyHits}</Badge>
        {me && me.pointStreak > 1 ? (
          <Badge tone="success">{me.pointStreak} point streak</Badge>
        ) : null}
        {phase === 'finished' ? (
          <Badge tone={isDraw ? 'accent' : iWon ? 'success' : 'danger'}>
            {isDraw ? 'Draw' : iWon ? 'You win!' : 'Rival wins'}
          </Badge>
        ) : null}
      </div>

      {/* Arena */}
      <div className="mx-auto w-full max-w-lg">
        <div
          role="img"
          aria-label="Paddle duel arena"
          className="relative w-full touch-none overflow-hidden rounded-2xl border border-white/10 bg-black/60 select-none"
          style={{ aspectRatio: `${width} / ${height}` }}
          onPointerDown={paddleInput.onArenaPointerDown}
          onPointerMove={paddleInput.onArenaPointerMove}
          onPointerUp={paddleInput.onArenaPointerUp}
          onPointerCancel={paddleInput.onArenaPointerCancel}
          onLostPointerCapture={paddleInput.onArenaLostPointerCapture}
          onPointerLeave={paddleInput.onArenaPointerLeave}
          onTouchStart={paddleInput.onArenaTouchStart}
          onTouchMove={paddleInput.onArenaTouchMove}
          onTouchEnd={paddleInput.onArenaTouchEnd}
          onTouchCancel={paddleInput.onArenaTouchCancel}
          onContextMenu={(event) => event.preventDefault()}
        >
          {/* centre line */}
          <div
            className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/10"
            aria-hidden
          />
          {/* my paddle */}
          {me ? (
            <div
              className="absolute rounded-full bg-indigo-400 shadow-[0_0_12px_rgba(129,140,248,0.7)]"
              style={{
                width: pct(pw, width),
                height: pct(ph, height),
                left: me.side === 'left' ? pct(3, width) : pct(width - 3 - pw, width),
                top: `calc(${pct(myY - ph / 2, height)} )`,
                transition: 'none',
              }}
              aria-label="Your paddle"
            />
          ) : null}
          {/* rival paddle */}
          {rivalPaddle ? (
            <div
              className={cn(
                'absolute rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.7)]',
                rivalPaddle.disconnected && 'opacity-40',
              )}
              style={{
                width: pct(pw, width),
                height: pct(ph, height),
                left: rivalPaddle.side === 'left' ? pct(3, width) : pct(width - 3 - pw, width),
                top: `calc(${pct(rivalY - ph / 2, height)})`,
              }}
              aria-label="Rival paddle"
            />
          ) : null}
          {/* A short reflected trajectory preview communicates the authoritative velocity
              without claiming future paddle collisions. */}
          {prediction.map((dot, index) => (
            <div
              key={`prediction-${index}`}
              className="pointer-events-none absolute rounded-full bg-cyan-300"
              style={{
                width: pct(br * 0.55, width),
                height: pct(br * 0.55, height),
                left: pct(dot.x - br * 0.275, width),
                top: pct(dot.y - br * 0.275, height),
                opacity: 0.32 - index * 0.025,
              }}
              aria-hidden
            />
          ))}
          {/* Ball trail uses visual extrapolation only; physics remains server-owned. */}
          {trail.map((dot, index) => (
            <div
              key={index}
              className="pointer-events-none absolute rounded-full bg-cyan-200"
              style={{
                width: pct(br * 1.45, width),
                height: pct(br * 1.45, height),
                left: pct(dot.x - br * 0.72, width),
                top: pct(dot.y - br * 0.72, height),
                opacity: dot.opacity,
              }}
              aria-hidden
            />
          ))}
          {impactVisible && state.lastImpact ? (
            <div
              key={state.lastImpact.id}
              className={cn(
                'pointer-events-none absolute animate-ping rounded-full border-2',
                state.lastImpact.kind === 'point'
                  ? 'border-rose-400'
                  : state.lastImpact.kind === 'wall'
                    ? 'border-cyan-300'
                    : 'border-amber-300',
              )}
              style={{
                width: pct(br * (state.lastImpact.kind === 'point' ? 9 : 5), width),
                height: pct(br * (state.lastImpact.kind === 'point' ? 9 : 5), height),
                left: pct(
                  state.lastImpact.x - br * (state.lastImpact.kind === 'point' ? 4.5 : 2.5),
                  width,
                ),
                top: pct(
                  state.lastImpact.y - br * (state.lastImpact.kind === 'point' ? 4.5 : 2.5),
                  height,
                ),
              }}
              aria-hidden
            />
          ) : null}
          {/* ball */}
          <div
            className="absolute rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.9)]"
            style={{
              width: pct(br * 2, width),
              height: pct(br * 2, height),
              left: `calc(${pct(bx - br, width)})`,
              top: `calc(${pct(by - br, height)})`,
            }}
            aria-label="Ball"
          />
          {/* serve countdown */}
          {serveCountdown !== null ? (
            <div className="absolute inset-0 grid place-items-center bg-black/40">
              <span className="text-3xl font-bold tabular-nums text-white">
                {serveCountdown > 0.35 ? Math.ceil(serveCountdown) : 'GO'}
              </span>
            </div>
          ) : null}
          {phase === 'finished' ? (
            <div className="absolute inset-0 grid place-items-center bg-black/60">
              <span className="text-xl font-bold text-white">
                {isDraw ? 'Draw' : iWon ? 'You win! 🏓' : 'Rival wins'}
                <small className="mt-1 block text-xs font-normal text-slate-300">
                  Best rally {me?.bestRally ?? 0} · {me?.rallies ?? 0} returns
                </small>
              </span>
            </div>
          ) : null}
        </div>
      </div>

      {/* Virtual controls */}
      <div className="mx-auto flex w-44 flex-col gap-2">
        <button
          type="button"
          aria-label="Move paddle up"
          disabled={!canPlay}
          onPointerDown={(event) => paddleInput.onControlPointerDown('negative', event)}
          onPointerUp={paddleInput.onControlPointerUp}
          onPointerCancel={paddleInput.onControlPointerCancel}
          onLostPointerCapture={paddleInput.onControlLostPointerCapture}
          onPointerLeave={paddleInput.onControlPointerLeave}
          onTouchStart={(event) => paddleInput.onControlTouchStart('negative', event)}
          onTouchEnd={paddleInput.onControlTouchEnd}
          onTouchCancel={paddleInput.onControlTouchCancel}
          onContextMenu={(event) => event.preventDefault()}
          className="grid h-14 touch-none place-items-center rounded-xl border border-white/10 bg-white/5 text-white transition select-none active:scale-95 disabled:opacity-40"
        >
          <ChevronUp className="h-6 w-6" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Move paddle down"
          disabled={!canPlay}
          onPointerDown={(event) => paddleInput.onControlPointerDown('positive', event)}
          onPointerUp={paddleInput.onControlPointerUp}
          onPointerCancel={paddleInput.onControlPointerCancel}
          onLostPointerCapture={paddleInput.onControlLostPointerCapture}
          onPointerLeave={paddleInput.onControlPointerLeave}
          onTouchStart={(event) => paddleInput.onControlTouchStart('positive', event)}
          onTouchEnd={paddleInput.onControlTouchEnd}
          onTouchCancel={paddleInput.onControlTouchCancel}
          onContextMenu={(event) => event.preventDefault()}
          className="grid h-14 touch-none place-items-center rounded-xl border border-white/10 bg-white/5 text-white transition select-none active:scale-95 disabled:opacity-40"
        >
          <ChevronDown className="h-6 w-6" aria-hidden />
        </button>
      </div>
      <p className="text-center text-xs text-slate-500">
        W/S, arrows, drag or hold. Move through contact to add controlled spin; dots preview
        wall-reflected flight. Every input and bounce is server validated.
      </p>
    </div>
  );
}

export const paddleDuelClient: ClientGameModule = {
  metadata: PADDLE_DUEL_METADATA,
  Component: PaddleDuelGame as unknown as ComponentType<GameComponentProps<never>>,
};
