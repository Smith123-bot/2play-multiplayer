import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
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
  const lastIntent = useRef(0);
  const previousEvent = useRef<string | null>(null);
  const previousScore = useRef(0);
  const [, setFrame] = useState(0);

  const phase = state?.phase ?? 'idle';
  const me = myPlayerId ? state?.paddles?.[myPlayerId] : undefined;
  const rival = players.find((player) => player.id !== myPlayerId);
  const rivalPaddle = rival ? state?.paddles?.[rival.id] : undefined;
  const canPlay = phase === 'playing' && !!me;

  // Smooth motion: extrapolate ball + paddles from the last authoritative
  // snapshot using the server clock. Visual only — the server stays the truth.
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

  // Event feedback.
  const lastEvent = state?.lastEvent ?? null;
  useEffect(() => {
    if (lastEvent === previousEvent.current) return;
    previousEvent.current = lastEvent;
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
  const totalScore = Object.values(state?.paddles ?? {}).reduce((sum, paddle) => sum + (paddle?.score ?? 0), 0);
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

  const { width, height, paddleWidth: pw, paddleHeight: ph, ballRadius: br, ball, scoreLimit } = state;
  const pct = (value: number, max: number) => `${(value / max) * 100}%`;

  // Extrapolated positions (clamped to the arena).
  const elapsedS = state ? Math.max(0, (Date.now() + clockOffset.current - state.serverTime) / 1000) : 0;
  const clampY = (y: number) => Math.min(height - ph / 2, Math.max(ph / 2, y));
  const myY = me ? clampY(me.y + me.dir * PADDLE_SPEED * elapsedS) : height / 2;
  const rivalY = rivalPaddle
    ? clampY(rivalPaddle.y + rivalPaddle.dir * PADDLE_SPEED * elapsedS)
    : height / 2;
  const frozen = state.serveAt !== null;
  const bx = frozen ? width / 2 : Math.min(width + 4, Math.max(-4, ball.x + ball.vx * elapsedS));
  const by = frozen ? height / 2 : Math.min(height, Math.max(0, ball.y + ball.vy * elapsedS));

  const serveCountdown =
    frozen && state.serveAt !== null
      ? Math.max(0, (state.serveAt - (Date.now() + clockOffset.current)) / 1000)
      : null;
  const iWon = phase === 'finished' && (me?.score ?? 0) > (rivalPaddle?.score ?? 0);
  const isDraw = phase === 'finished' && me?.score === rivalPaddle?.score;

  // Touch drag: track finger vs paddle and stream up/down/stop intents.
  const onTouch = (clientY: number, arena: HTMLElement) => {
    if (!canPlay || !me) return;
    const rect = arena.getBoundingClientRect();
    const touchY = ((clientY - rect.top) / rect.height) * height;
    const deadline = Date.now() - lastIntent.current;
    if (deadline < 90) return;
    const offset = touchY - me.y;
    if (Math.abs(offset) < ph * 0.2) {
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
          <div className="text-4xl font-bold tabular-nums text-indigo-300">{me?.score ?? 0}</div>
        </div>
        <div className="text-xs uppercase tracking-wider text-slate-500">first to {scoreLimit}</div>
        <div className="text-left">
          <div className="text-xs uppercase tracking-wider text-emerald-300">{rival?.nickname ?? 'Rival'}</div>
          <div className="text-4xl font-bold tabular-nums text-emerald-300">{rivalPaddle?.score ?? 0}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary">{me?.side === 'left' ? '◀ Left side' : 'Right side ▶'}</Badge>
        <Badge tone="default">Rally {state.rallyHits}</Badge>
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
          onTouchMove={(event) => onTouch(event.touches[0]!.clientY, event.currentTarget)}
          onTouchEnd={() => canPlay && sendMove('stop')}
        >
          {/* centre line */}
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/10" aria-hidden />
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
          onPointerDown={() => sendMove('up')}
          onPointerUp={() => sendMove('stop')}
          onPointerLeave={() => canPlay && sendMove('stop')}
          className="grid h-14 place-items-center rounded-xl border border-white/10 bg-white/5 text-white transition active:scale-95 disabled:opacity-40"
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
          className="grid h-14 place-items-center rounded-xl border border-white/10 bg-white/5 text-white transition active:scale-95 disabled:opacity-40"
        >
          <ChevronDown className="h-6 w-6" aria-hidden />
        </button>
      </div>
      <p className="text-center text-xs text-slate-500">
        W/S, arrows, drag on the arena or hold the buttons — the server simulates every bounce.
      </p>
    </div>
  );
}

export const paddleDuelClient: ClientGameModule = {
  metadata: PADDLE_DUEL_METADATA,
  Component: PaddleDuelGame as unknown as ComponentType<GameComponentProps<never>>,
};
