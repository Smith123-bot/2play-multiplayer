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
  latestInputSeq: number;
  ball: { x: number; y: number; vx: number; vy: number };
  launchAt: number | null;
  bricks: boolean[];
  brickHp: number[];
  brickMaxHp: number[];
  levelBrickCount: number;
  lastImpact: {
    id: number;
    brickIndex: number;
    kind: 'crack' | 'destroy';
    remainingHp: number;
    at: number;
  } | null;
  destroyed: number;
  chain: number;
  level: number;
  levelsCleared: number;
  paddleScale: number;
  powerUp: 'wide' | 'slow' | 'life' | null;
  powerUpUntil: number;
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
  maxLevels: number;
  startedAt: number | null;
  endsAt: number | null;
  finishReason: string | null;
  lastEvent: string | null;
  serverTime: number;
  arenas: Record<string, BrickArenaPublic | null>;
}

const PADDLE_SPEED = 55; // units/s — mirrors the server

const BRICK_WIDTH = 13;
const BRICK_HEIGHT = 4;
const BRICK_GAP = 1;
const BRICK_OFFSET_X = 1.5;
const BRICK_OFFSET_Y = 6;

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
  const activeIntent = useRef<'left' | 'right' | 'stop' | null>(null);
  const inputSequence = useRef(0);
  const previousEvent = useRef<string | null>(null);
  const [, setFrame] = useState(0);

  const phase = state?.phase ?? 'idle';
  const me = myPlayerId ? state?.arenas?.[myPlayerId] : undefined;
  const rival = players.find((player) => player.id !== myPlayerId);
  const rivalArena = rival ? state?.arenas?.[rival.id] : undefined;
  const canPlay = phase === 'playing' && !!me && !me.done;

  useEffect(() => {
    if (state) clockOffset.current = state.serverTime - Date.now();
    if (me) inputSequence.current = Math.max(inputSequence.current, me.latestInputSeq);
  }, [state, me]);

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
      if (!canPlay || activeIntent.current === direction) return;
      activeIntent.current = direction;
      inputSequence.current += 1;
      sendAction({
        type: 'move',
        payload: { direction, sequence: inputSequence.current },
      } satisfies GameAction);
      vibrate('buttonPress');
    },
    [canPlay, sendAction, vibrate],
  );

  useEffect(() => {
    activeIntent.current = null;
  }, [me?.level, phase]);

  // Keyboard: A/D + arrows (never while typing in chat/inputs).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const map: Record<string, 'left' | 'right' | 'stop'> = {
        ArrowLeft: 'left',
        ArrowRight: 'right',
        a: 'left',
        d: 'right',
        A: 'left',
        D: 'right',
      };
      const direction = map[event.key];
      if (!direction) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      sendMove(direction);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (['ArrowLeft', 'ArrowRight', 'a', 'd', 'A', 'D'].includes(event.key)) sendMove('stop');
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [sendMove]);

  // Event feedback.
  const lastEvent = state?.lastEvent ?? null;
  const eventIdentity = lastEvent
    ? `${lastEvent}:${me?.lastImpact?.id ?? 0}:${rivalArena?.lastImpact?.id ?? 0}`
    : null;
  useEffect(() => {
    if (eventIdentity === previousEvent.current) return;
    previousEvent.current = eventIdentity;
    if (!lastEvent) return;
    const [kind, actor] = lastEvent.split(':');
    const mine = actor === myPlayerId;
    if (kind === 'brick') play('click');
    else if (kind === 'crack') play('notification');
    else if (kind === 'power') {
      play('correct');
      if (mine) vibrate('success');
    } else if (kind === 'level') {
      play('gameStart');
      if (mine) vibrate('victory');
    } else if (kind === 'save') play('notification');
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
  }, [eventIdentity, lastEvent]);

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
    width,
    height,
    paddleWidth: pw,
    paddleHeight: phh,
    paddleY,
    ballRadius: br,
    brickCols,
  } = state;
  const elapsedS = state
    ? Math.max(0, (Date.now() + clockOffset.current - state.serverTime) / 1000)
    : 0;
  const pct = (value: number, max: number) => `${(value / max) * 100}%`;

  const renderArena = (
    label: string,
    arenaView: BrickArenaPublic | null | undefined,
    isMine: boolean,
    highlight: boolean,
  ) => {
    if (!arenaView) return null;
    const livePw = pw * arenaView.paddleScale;
    const clampX = (x: number) => Math.min(width - livePw / 2, Math.max(livePw / 2, x));
    const paddleX = clampX(arenaView.paddleX + arenaView.paddleDir * PADDLE_SPEED * elapsedS);
    const parked = arenaView.launchAt !== null;
    const bx = parked
      ? paddleX
      : Math.min(width, Math.max(0, arenaView.ball.x + arenaView.ball.vx * elapsedS));
    const by = parked
      ? paddleY - br - 0.5
      : Math.min(height, Math.max(0, arenaView.ball.y + arenaView.ball.vy * elapsedS));
    const trail = parked
      ? []
      : Array.from({ length: 5 }, (_item, index) => {
          const age = (index + 1) * 0.02;
          return {
            x: bx - arenaView.ball.vx * age,
            y: by - arenaView.ball.vy * age,
            opacity: (5 - index) / 18,
          };
        });
    const impactVisible =
      arenaView.lastImpact && Date.now() + clockOffset.current - arenaView.lastImpact.at < 520;

    return (
      <div key={label} className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center justify-between gap-2 px-1">
          <span
            className={cn(
              'truncate text-xs font-semibold',
              isMine ? 'text-indigo-300' : 'text-emerald-300',
            )}
          >
            {label}
          </span>
          <span className="flex items-center gap-2 text-xs text-slate-400">
            <span className="font-semibold text-cyan-300">
              Lv {arenaView.level}/{state.maxLevels}
            </span>
            {arenaView.powerUp ? (
              <span className="text-amber-300">
                {arenaView.powerUp === 'wide'
                  ? '↔ Wide'
                  : arenaView.powerUp === 'slow'
                    ? '◌ Slow'
                    : '♥ Life'}
              </span>
            ) : null}
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
            highlight
              ? 'border-indigo-400/60 shadow-[0_0_12px_rgba(129,140,248,0.25)]'
              : 'border-white/10',
          )}
          style={{ aspectRatio: `${width} / ${height}` }}
          onPointerDown={
            isMine && canPlay
              ? (event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  const rect = event.currentTarget.getBoundingClientRect();
                  const touchX = ((event.clientX - rect.left) / rect.width) * width;
                  sendMove(touchX < arenaView.paddleX ? 'left' : 'right');
                }
              : undefined
          }
          onPointerMove={
            isMine && canPlay
              ? (event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  if (event.buttons === 0 && event.pointerType !== 'touch') return;
                  const touchX = ((event.clientX - rect.left) / rect.width) * width;
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
          onPointerUp={isMine && canPlay ? () => sendMove('stop') : undefined}
          onPointerCancel={isMine && canPlay ? () => sendMove('stop') : undefined}
        >
          {/* Bricks use the same world-space rectangles as server collision geometry. */}
          {arenaView.bricks.map((alive, index) => {
            if (!alive) return null;
            const row = Math.floor(index / brickCols);
            const col = index % brickCols;
            const hp = arenaView.brickHp[index] ?? 1;
            const maxHp = arenaView.brickMaxHp[index] ?? 1;
            return (
              <div
                key={`${arenaView.level}-${index}`}
                className="absolute overflow-hidden rounded-[2px] border border-black/20 transition-opacity"
                aria-label={`Brick ${index + 1}, ${hp} hit${hp === 1 ? '' : 's'} remaining`}
                style={{
                  width: pct(BRICK_WIDTH, width),
                  height: pct(BRICK_HEIGHT, height),
                  left: pct(BRICK_OFFSET_X + col * (BRICK_WIDTH + BRICK_GAP), width),
                  top: pct(BRICK_OFFSET_Y + row * (BRICK_HEIGHT + BRICK_GAP), height),
                  backgroundColor: ROW_COLORS[(row + arenaView.level - 1) % ROW_COLORS.length],
                  boxShadow:
                    maxHp > 1
                      ? 'inset 0 0 0 1px rgba(255,255,255,.65), 0 0 5px currentColor'
                      : '0 0 3px currentColor',
                  opacity: hp / maxHp > 0.5 ? 0.95 : 0.55,
                }}
              >
                {maxHp > 1 ? (
                  <span className="absolute inset-y-0 left-1/2 w-px bg-white/60" />
                ) : null}
              </div>
            );
          })}
          {impactVisible && arenaView.lastImpact
            ? (() => {
                const row = Math.floor(arenaView.lastImpact.brickIndex / brickCols);
                const col = arenaView.lastImpact.brickIndex % brickCols;
                const cx = BRICK_OFFSET_X + col * (BRICK_WIDTH + BRICK_GAP) + BRICK_WIDTH / 2;
                const cy = BRICK_OFFSET_Y + row * (BRICK_HEIGHT + BRICK_GAP) + BRICK_HEIGHT / 2;
                return Array.from(
                  { length: arenaView.lastImpact.kind === 'destroy' ? 7 : 3 },
                  (_entry, spark) => (
                    <span
                      key={`${arenaView.lastImpact?.id}-${spark}`}
                      className="pointer-events-none absolute h-1 w-1 animate-ping rounded-full bg-amber-200"
                      style={{
                        left: pct(
                          cx + Math.cos((spark * Math.PI * 2) / 7) * (2 + (spark % 3)),
                          width,
                        ),
                        top: pct(
                          cy + Math.sin((spark * Math.PI * 2) / 7) * (1 + (spark % 2)),
                          height,
                        ),
                        animationDelay: `${spark * 25}ms`,
                      }}
                    />
                  ),
                );
              })()
            : null}
          {/* paddle */}
          <div
            className={cn('absolute rounded-full', isMine ? 'bg-indigo-400' : 'bg-emerald-400')}
            style={{
              width: pct(livePw, width),
              height: pct(phh, height),
              left: `calc(${pct(paddleX - livePw / 2, width)})`,
              top: `calc(${pct(paddleY - phh / 2, height)})`,
            }}
            aria-label={`${label} paddle`}
          />
          {/* visual-only trail between authoritative snapshots */}
          {trail.map((dot, index) => (
            <div
              key={index}
              className="pointer-events-none absolute rounded-full bg-cyan-200"
              style={{
                width: pct(br * 1.4, width),
                height: pct(br * 1.4, height),
                left: pct(dot.x - br * 0.7, width),
                top: pct(dot.y - br * 0.7, height),
                opacity: dot.opacity,
              }}
              aria-hidden
            />
          ))}
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
                {arenaView.levelsCleared >= state.maxLevels ? 'Cleared! 🧱' : 'Out of lives'}
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
        <Badge tone="primary">
          Level {me?.level ?? 1}/{state.maxLevels} · {me?.destroyed ?? 0}/{me?.levelBrickCount ?? 0}{' '}
          wall · {me?.bricksBroken ?? 0} total · {me?.score ?? 0} pts
        </Badge>
        {me?.powerUp ? <Badge tone="success">Power-up: {me.powerUp}</Badge> : null}
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
        A/D, arrows, drag or hold. Conquer a classic wall, reinforced diamond and gated fortress.
        Bright split bricks take two hits; every ninth destruction grants a balanced server-owned
        power-up.
      </p>
    </div>
  );
}

export const brickBreakerClient: ClientGameModule = {
  metadata: BRICK_BREAKER_METADATA,
  Component: BrickBreakerGame as unknown as ComponentType<GameComponentProps<never>>,
};
