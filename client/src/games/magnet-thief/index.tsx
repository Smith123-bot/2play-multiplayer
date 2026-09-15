import {
  useCallback,
  useEffect,
  useRef,
  type ComponentType,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react';
import { MAGNET_THIEF_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

export interface MagnetThiefPublicState {
  phase: 'idle' | 'playing' | 'finished';
  gems: Array<{ id: string; x: number; y: number; ownerId: string | null; value: number }>;
  endsAt: number | null;
  finishReason: string | null;
  lastEvent: string | null;
  serverTime: number;
  width: number;
  height: number;
  range: number;
  cooldown: number;
  safeCorners: Array<{ x: number; y: number }>;
  stage: number;
  nextStageAt: number | null;
  obstacles: Array<{ x: number; y: number; radius: number }>;
  lastEffect: {
    id: number;
    mode: 'pull' | 'repel';
    playerId: string;
    gemIds: string[];
    at: number;
  } | null;
  players: Record<
    string,
    {
      x: number;
      y: number;
      facing: { dx: number; dy: number };
      score: number;
      stolen: number;
      carrying: number;
      cooldownLeft: number;
      inSafe: boolean;
      disconnected: boolean;
      latestInputSeq: number;
    }
  >;
  myCarrying: string[];
}

const DPAD = [
  { dx: 0, dy: -1, icon: ArrowUp, label: 'Move up', area: 'col-start-2 row-start-1' },
  { dx: -1, dy: 0, icon: ArrowLeft, label: 'Move left', area: 'col-start-1 row-start-2' },
  { dx: 0, dy: 1, icon: ArrowDown, label: 'Move down', area: 'col-start-2 row-start-2' },
  { dx: 1, dy: 0, icon: ArrowRight, label: 'Move right', area: 'col-start-3 row-start-2' },
];
const SEAT = ['#818cf8', '#34d399', '#f472b6', '#fbbf24'];
/** Held-movement cadence: one server step per interval while held. */
const MOVE_REPEAT_MS = 130;
/** Minimum drag length before the arena steers the magnet. */
const DRAG_MIN_PX = 24;
/** Diagonals are scaled so hypot(dx, dy) stays inside the server's 1.1 cap. */
const DIAGONAL = 0.75;

const KEY_DIRS: Record<string, { dx: number; dy: number }> = {
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  w: { dx: 0, dy: -1 },
  s: { dx: 0, dy: 1 },
  a: { dx: -1, dy: 0 },
  d: { dx: 1, dy: 0 },
  W: { dx: 0, dy: -1 },
  S: { dx: 0, dy: 1 },
  A: { dx: -1, dy: 0 },
  D: { dx: 1, dy: 0 },
};

/** Quantizes a drag vector to one of the 8 server-legal step directions. */
function quantizeDrag(dx: number, dy: number): { dx: number; dy: number } {
  const angle = Math.atan2(dy, dx);
  const octant = Math.round(angle / (Math.PI / 4));
  switch (((octant % 8) + 8) % 8) {
    case 0:
      return { dx: 1, dy: 0 };
    case 1:
      return { dx: DIAGONAL, dy: DIAGONAL };
    case 2:
      return { dx: 0, dy: 1 };
    case 3:
      return { dx: -DIAGONAL, dy: DIAGONAL };
    case 4:
      return { dx: -1, dy: 0 };
    case 5:
      return { dx: -DIAGONAL, dy: -DIAGONAL };
    case 6:
      return { dx: 0, dy: -1 };
    default:
      return { dx: DIAGONAL, dy: -DIAGONAL };
  }
}

function MagnetThiefGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<MagnetThiefPublicState>) {
  const previousEvent = useRef<string | null>(null);
  const inputSequence = useRef(0);
  const phase = state?.phase ?? 'idle';
  const me = myPlayerId ? state?.players?.[myPlayerId] : undefined;
  const playing = phase === 'playing' && Boolean(me) && !me?.disconnected;

  // ---- Smooth movement ------------------------------------------------------
  // Steps stay server-authoritative discrete intents, but holding a key, a
  // D-pad button or an arena drag now streams them at a fixed 130 ms cadence
  // (refs + interval only — no per-frame React re-renders) instead of one
  // irregular OS key-repeat / one step per tap.
  const playState = useRef({ playing: false, latestSeq: -1 });
  playState.current = { playing, latestSeq: me?.latestInputSeq ?? -1 };
  const heldDir = useRef<{ dx: number; dy: number } | null>(null);
  const heldKey = useRef<string | null>(null);
  const repeatTimer = useRef<number | null>(null);
  const dragAnchor = useRef<{ x: number; y: number } | null>(null);
  const dragPointerId = useRef<number | null>(null);
  const lastDragSend = useRef(0);
  const sendActionRef = useRef(sendAction);
  sendActionRef.current = sendAction;

  const sendStep = useCallback((dx: number, dy: number) => {
    if (!playState.current.playing) return;
    inputSequence.current = Math.max(inputSequence.current, playState.current.latestSeq) + 1;
    sendActionRef.current({
      type: 'move',
      payload: { dx, dy, sequence: inputSequence.current },
    } satisfies GameAction);
  }, []);

  const stopRepeat = useCallback(() => {
    heldDir.current = null;
    heldKey.current = null;
    if (repeatTimer.current !== null) {
      window.clearInterval(repeatTimer.current);
      repeatTimer.current = null;
    }
  }, []);

  const startRepeat = useCallback(() => {
    if (repeatTimer.current !== null) return;
    repeatTimer.current = window.setInterval(() => {
      const dir = heldDir.current;
      if (dir) sendStep(dir.dx, dir.dy);
    }, MOVE_REPEAT_MS);
  }, [sendStep]);

  /** Discrete press: one step now + haptic. Held sources call startRepeat too. */
  const move = useCallback(
    (dx: number, dy: number) => {
      if (!playing) return;
      sendStep(dx, dy);
      vibrate('buttonPress');
    },
    [playing, sendStep, vibrate],
  );

  const pressAndHold = useCallback(
    (dx: number, dy: number) => {
      move(dx, dy);
      heldDir.current = { dx, dy };
      startRepeat();
    },
    [move, startRepeat],
  );

  useEffect(() => stopRepeat, [stopRepeat]);

  const activateField = useCallback(
    (mode: 'pull' | 'repel') => {
      if (!playing) return;
      sendAction({ type: mode, payload: {} } satisfies GameAction);
      play('click');
      vibrate('buttonPress');
    },
    [playing, sendAction, play, vibrate],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) ||
          target.isContentEditable)
      ) {
        return;
      }
      if ((event.key === 'q' || event.key === 'Q') && !event.repeat) {
        event.preventDefault();
        activateField('repel');
        return;
      }
      if ((event.key === 'e' || event.key === 'E' || event.key === ' ') && !event.repeat) {
        event.preventDefault();
        activateField('pull');
        return;
      }
      const delta = KEY_DIRS[event.key];
      if (!delta) return;
      event.preventDefault();
      // OS key-repeat is irregular — our interval owns held movement.
      if (event.repeat) return;
      move(delta.dx, delta.dy);
      heldDir.current = { ...delta };
      heldKey.current = event.key;
      startRepeat();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (heldKey.current !== null && event.key === heldKey.current) stopRepeat();
    };
    const onBlur = () => stopRepeat();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [move, activateField, startRepeat, stopRepeat]);

  useEffect(() => {
    const lastEvent = state?.lastEvent ?? null;
    if (lastEvent === previousEvent.current) return;
    previousEvent.current = lastEvent;
    if (!lastEvent) return;
    if (lastEvent.startsWith('steal:') && lastEvent.includes(myPlayerId ?? '')) {
      play('score');
      vibrate('success');
    } else if (
      (lastEvent.startsWith('pull:') || lastEvent.startsWith('repel:')) &&
      lastEvent.includes(myPlayerId ?? '')
    ) {
      play('correct');
    } else if (lastEvent.startsWith('stage:')) {
      play('countdown');
    }
  }, [state?.lastEvent, myPlayerId, play, vibrate]);

  // ---- Arena drag steering (mouse, pen and touch unified) ---------------------
  // Pointer Events cover touch too, so these replace the old touch-only swipe:
  // drag in a direction to stream steps, re-anchoring as you go.
  const onArenaPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!playing) return;
    event.preventDefault();
    dragPointerId.current = event.pointerId;
    dragAnchor.current = { x: event.clientX, y: event.clientY };
    // Optional-chained: jsdom and very old browsers lack pointer capture.
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onArenaPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!playing || dragPointerId.current !== event.pointerId) return;
    const anchor = dragAnchor.current;
    if (!anchor) return;
    event.preventDefault();
    const dx = event.clientX - anchor.x;
    const dy = event.clientY - anchor.y;
    if (Math.hypot(dx, dy) < DRAG_MIN_PX) return;
    const now = Date.now();
    if (now - lastDragSend.current < MOVE_REPEAT_MS) return;
    lastDragSend.current = now;
    const step = quantizeDrag(dx, dy);
    sendStep(step.dx, step.dy);
    // Re-anchor so a long drag keeps steering instead of firing once.
    dragAnchor.current = { x: event.clientX, y: event.clientY };
  };

  const onArenaPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragPointerId.current !== event.pointerId) return;
    dragPointerId.current = null;
    dragAnchor.current = null;
  };

  if (phase === 'idle' || !state) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Charging the magnets…</p>
        </div>
      </div>
    );
  }

  const width = state.width || 18;
  const height = state.height || 12;
  const cooling = (me?.cooldownLeft ?? 0) > 0;

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({
          ...player,
          score: state.players?.[player.id]?.score ?? player.score,
        }))}
        myPlayerId={myPlayerId}
        deadline={state.endsAt ?? null}
        label="Arena clock"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary">Carrying {me?.carrying ?? 0}</Badge>
        <Badge tone="accent">Stolen {me?.stolen ?? 0}</Badge>
        <Badge tone="primary">Stage {state.stage ?? 1}/3</Badge>
        {me?.inSafe ? <Badge tone="success">Safe corner</Badge> : null}
        {cooling ? (
          <Badge tone="warning">Cooldown {Math.ceil((me?.cooldownLeft ?? 0) / 100) / 10}s</Badge>
        ) : null}
      </div>
      <div
        role="img"
        aria-label="Magnet arena"
        className="touch-none relative mx-auto w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-slate-950 select-none"
        style={{ aspectRatio: `${width} / ${height}` }}
        onPointerDown={onArenaPointerDown}
        onPointerMove={onArenaPointerMove}
        onPointerUp={onArenaPointerEnd}
        onPointerCancel={onArenaPointerEnd}
      >
        {(state.safeCorners ?? []).map((corner, index) => (
          <span
            key={`safe-${index}`}
            className="absolute rounded-full bg-emerald-400/25"
            style={{
              left: `${(corner.x / width) * 100}%`,
              top: `${(corner.y / height) * 100}%`,
              width: '14%',
              height: '20%',
              transform: 'translate(-50%, -50%)',
            }}
          />
        ))}
        {(state.obstacles ?? []).map((obstacle, index) => (
          <span
            key={`obstacle-${index}`}
            aria-hidden
            className="absolute rounded-full border border-slate-500 bg-slate-700 shadow-inner"
            style={{
              left: `${(obstacle.x / width) * 100}%`,
              top: `${(obstacle.y / height) * 100}%`,
              width: `${((obstacle.radius * 2) / width) * 100}%`,
              aspectRatio: '1',
              transform: 'translate(-50%, -50%)',
            }}
          />
        ))}
        {(state.gems ?? []).map((gem) => {
          // The server names the gems each pull/repel touched — flash them so
          // attraction and collection are visible the moment they happen.
          const touched = state.lastEffect?.gemIds.includes(gem.id) ?? false;
          return (
            <span
              // Remounts on each new effect so the flash retriggers per pull.
              key={touched && state.lastEffect ? `${gem.id}:fx${state.lastEffect.id}` : gem.id}
              className={cn(
                'absolute rounded-sm bg-cyan-300',
                touched && 'animate-ping [animation-iteration-count:2]',
              )}
              style={{
                left: `${(gem.x / width) * 100}%`,
                top: `${(gem.y / height) * 100}%`,
                width: '3%',
                height: '4.5%',
                transform: 'translate(-50%, -50%)',
                opacity: gem.ownerId ? 0.85 : 1,
                boxShadow: touched ? '0 0 8px 2px rgba(103,232,249,.9)' : undefined,
              }}
            />
          );
        })}
        {players.map((player, seat) => {
          const runner = state.players[player.id];
          if (!runner) return null;
          const activeEffect = state.lastEffect?.playerId === player.id ? state.lastEffect : null;
          const facing = runner.facing ?? { dx: 0, dy: 0 };
          const hasFacing = facing.dx !== 0 || facing.dy !== 0;
          return (
            <span
              key={player.id}
              className="absolute rounded-full"
              style={{
                left: `${(runner.x / width) * 100}%`,
                top: `${(runner.y / height) * 100}%`,
                width: '4.5%',
                height: '6.5%',
                backgroundColor: SEAT[seat % SEAT.length],
                transform: 'translate(-50%, -50%)',
                boxShadow: player.id === myPlayerId ? '0 0 0 2px #fff' : undefined,
              }}
            >
              {hasFacing ? (
                <span
                  aria-hidden
                  className="absolute h-[26%] w-[26%] rounded-full bg-white/90"
                  style={{
                    left: `${50 + facing.dx * 30}%`,
                    top: `${50 + facing.dy * 30}%`,
                    transform: 'translate(-50%, -50%)',
                  }}
                />
              ) : null}
              {activeEffect ? (
                <span
                  key={activeEffect.id}
                  aria-hidden
                  className={cn(
                    'pointer-events-none absolute left-1/2 top-1/2 animate-ping rounded-full border',
                    activeEffect.mode === 'repel' ? 'border-rose-300' : 'border-cyan-300',
                  )}
                  style={{
                    width: `${((state.range * 2) / width / 0.045) * 100}%`,
                    aspectRatio: '1',
                    transform: 'translate(-50%, -50%)',
                  }}
                />
              ) : null}
            </span>
          );
        })}
      </div>
      <div className="mx-auto flex flex-col items-center gap-3">
        <div className="grid w-44 grid-cols-3 grid-rows-2 gap-2">
          {DPAD.map(({ dx, dy, icon: Icon, label, area }) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              disabled={!playing}
              onPointerDown={(event) => {
                event.preventDefault();
                pressAndHold(dx, dy);
              }}
              onPointerUp={stopRepeat}
              onPointerCancel={stopRepeat}
              onPointerLeave={stopRepeat}
              onKeyDown={(event) => {
                // Keyboard activation (Enter/Space) without the global handler.
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  move(dx, dy);
                }
              }}
              className={cn(
                'grid h-14 touch-none place-items-center rounded-xl border border-white/10 bg-white/5 text-white transition active:scale-95 disabled:opacity-40',
                area,
              )}
            >
              <Icon className="h-6 w-6" aria-hidden />
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!playing || cooling}
            onClick={() => activateField('pull')}
            className="min-h-11 rounded-xl border border-cyan-400/40 bg-cyan-500/15 px-4 text-sm font-semibold text-cyan-200 transition active:scale-95 disabled:opacity-40"
          >
            Pull · E / Space
          </button>
          <button
            type="button"
            disabled={!playing || cooling}
            onClick={() => activateField('repel')}
            className="min-h-11 rounded-xl border border-rose-400/40 bg-rose-500/15 px-4 text-sm font-semibold text-rose-200 transition active:scale-95 disabled:opacity-40"
          >
            Repel · Q
          </button>
        </div>
      </div>
      <p className="text-center text-xs text-slate-500">
        Hold WASD / arrows, hold the D-pad, or drag on the arena to move. Pull loose gems into
        collection range, or repel an exposed rival’s haul. Obstacles block movement; safe corners
        protect carried gems.
      </p>
    </div>
  );
}

export const magnetThiefClient: ClientGameModule = {
  metadata: MAGNET_THIEF_METADATA,
  Component: MagnetThiefGame as unknown as ComponentType<GameComponentProps<never>>,
};
