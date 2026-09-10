import { useCallback, useEffect, useRef, type ComponentType } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Zap } from 'lucide-react';
import { BLACK_BLAST_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

type Direction = 'up' | 'down' | 'left' | 'right';

interface ArenaNodeView {
  id: string;
  x: number;
  y: number;
  kind: 'energy' | 'rich' | 'obstacle';
}

interface PulseView {
  id: string;
  x: number;
  y: number;
  ownerId: string;
  detonateAt: number;
  radius: number;
  depth: number;
}

interface EffectView {
  id: string;
  x: number;
  y: number;
  radius: number;
  ownerId: string;
  depth: number;
  at: number;
}

export interface BlastPublicState {
  phase: 'idle' | 'playing' | 'finished';
  cols: number;
  rows: number;
  endsAt: number | null;
  serverTime: number;
  lastEvent: string | null;
  finishReason: string | null;
  nodes: ArenaNodeView[];
  pulses: PulseView[];
  effects: EffectView[];
  me: { cooldownUntil: number; combo: number; comboUntil: number; score: number } | null;
  players: Record<
    string,
    {
      x: number;
      y: number;
      score: number;
      combo: number;
      bestCombo: number;
      hits: number;
      chains: number;
      disconnected: boolean;
    }
  >;
}

const SEAT = ['#818cf8', '#34d399', '#f472b6', '#fbbf24'];

const DPAD: Array<{ direction: Direction; icon: typeof ArrowUp; label: string; area: string }> = [
  { direction: 'up', icon: ArrowUp, label: 'Move up', area: 'col-start-2 row-start-1' },
  { direction: 'left', icon: ArrowLeft, label: 'Move left', area: 'col-start-1 row-start-2' },
  { direction: 'down', icon: ArrowDown, label: 'Move down', area: 'col-start-2 row-start-2' },
  { direction: 'right', icon: ArrowRight, label: 'Move right', area: 'col-start-3 row-start-2' },
];

const KEY_MAP: Record<string, Direction> = {
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

function BlackBlastGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<BlastPublicState>) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<BlastPublicState | null>(null);
  const playersRef = useRef(players);
  const previousEvent = useRef<string | null>(null);
  const frameRef = useRef<number | null>(null);
  /** Server/client clock offset so animations line up with server timestamps. */
  const offsetRef = useRef(0);

  stateRef.current = state ?? null;
  playersRef.current = players;
  if (state?.serverTime) offsetRef.current = state.serverTime - Date.now();

  const phase = state?.phase ?? 'idle';
  const playing = phase === 'playing';

  const move = useCallback(
    (direction: Direction) => {
      if (!playing) return;
      sendAction({ type: 'move', payload: { direction } } satisfies GameAction);
    },
    [playing, sendAction],
  );

  const pulse = useCallback(() => {
    if (!playing) return;
    const now = Date.now() + offsetRef.current;
    if (state?.me && now < state.me.cooldownUntil) return;
    sendAction({ type: 'pulse' } satisfies GameAction);
    play('click');
    vibrate('buttonPress');
  }, [playing, sendAction, play, vibrate, state?.me]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) || target.isContentEditable)) {
        return;
      }
      if (event.key === ' ') {
        event.preventDefault();
        pulse();
        return;
      }
      const direction = KEY_MAP[event.key];
      if (!direction) return;
      event.preventDefault();
      move(direction);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [move, pulse]);

  // Audio/haptics from server events only.
  useEffect(() => {
    const event = state?.lastEvent ?? null;
    if (event === previousEvent.current) return;
    previousEvent.current = event;
    if (!event) return;
    const mine = myPlayerId ? event.includes(myPlayerId) : false;
    if (event.startsWith('blast:')) {
      play(mine ? 'score' : 'notification');
      if (mine) vibrate('success');
    } else if (event.startsWith('chain:')) {
      play('correct');
      if (mine) vibrate('victory');
    } else if (event.startsWith('miss:')) {
      if (mine) play('wrong');
    } else if (event === 'start') play('gameStart');
    else if (event === 'timeout' || event === 'finished') play('gameOver');
  }, [state?.lastEvent, myPlayerId, play, vibrate]);

  /**
   * Canvas render loop. Reads from refs so it never re-subscribes, and is
   * cancelled on unmount to avoid leaks.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const render = () => {
      const current = stateRef.current;
      frameRef.current = requestAnimationFrame(render);
      if (!current || !current.cols) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.clientWidth;
      const height = (width * current.rows) / current.cols;
      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
        canvas.style.height = `${height}px`;
      }
      const cell = width / current.cols;
      const now = Date.now() + offsetRef.current;

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      // Backdrop + grid
      context.fillStyle = '#0b0b16';
      context.fillRect(0, 0, width, height);
      context.strokeStyle = 'rgba(255,255,255,0.04)';
      context.lineWidth = 1;
      for (let x = 0; x <= current.cols; x += 1) {
        context.beginPath();
        context.moveTo(x * cell, 0);
        context.lineTo(x * cell, height);
        context.stroke();
      }
      for (let y = 0; y <= current.rows; y += 1) {
        context.beginPath();
        context.moveTo(0, y * cell);
        context.lineTo(width, y * cell);
        context.stroke();
      }

      // Nodes
      for (const node of current.nodes) {
        const cx = (node.x + 0.5) * cell;
        const cy = (node.y + 0.5) * cell;
        if (node.kind === 'obstacle') {
          context.fillStyle = 'rgba(148,163,184,0.28)';
          context.fillRect(node.x * cell + 2, node.y * cell + 2, cell - 4, cell - 4);
        } else if (node.kind === 'rich') {
          context.beginPath();
          context.arc(cx, cy, cell * 0.3, 0, Math.PI * 2);
          context.fillStyle = '#f59e0b';
          context.fill();
          context.beginPath();
          context.arc(cx, cy, cell * 0.16, 0, Math.PI * 2);
          context.fillStyle = '#fde68a';
          context.fill();
        } else {
          context.beginPath();
          context.arc(cx, cy, cell * 0.19, 0, Math.PI * 2);
          context.fillStyle = '#38bdf8';
          context.fill();
        }
      }

      // Charging pulses — a shrinking ring counting down to detonation.
      for (const entry of current.pulses) {
        const remaining = Math.max(0, entry.detonateAt - now);
        const total = entry.depth > 0 ? 260 : 900;
        const progress = 1 - Math.min(1, remaining / total);
        const cx = (entry.x + 0.5) * cell;
        const cy = (entry.y + 0.5) * cell;
        context.beginPath();
        context.arc(cx, cy, cell * (0.25 + progress * 0.35), 0, Math.PI * 2);
        context.fillStyle = `rgba(15,15,26,${0.5 + progress * 0.45})`;
        context.fill();
        context.strokeStyle = `rgba(167,139,250,${0.45 + progress * 0.55})`;
        context.lineWidth = 2;
        context.stroke();
      }

      // Detonation shockwaves.
      for (const effect of current.effects) {
        const age = now - effect.at;
        if (age < 0 || age > 1200) continue;
        const t = age / 1200;
        const radius = effect.radius * cell * (0.35 + t * 0.85);
        context.beginPath();
        context.arc((effect.x + 0.5) * cell, (effect.y + 0.5) * cell, radius, 0, Math.PI * 2);
        const fade = 1 - t;
        context.strokeStyle = `rgba(196,181,253,${fade * 0.9})`;
        context.lineWidth = 3 * fade + 0.5;
        context.stroke();
        context.beginPath();
        context.arc((effect.x + 0.5) * cell, (effect.y + 0.5) * cell, radius * 0.6, 0, Math.PI * 2);
        context.fillStyle = `rgba(30,27,75,${fade * 0.45})`;
        context.fill();
      }

      // Players
      const order = playersRef.current;
      for (const [id, body] of Object.entries(current.players)) {
        const index = order.findIndex((entry) => entry.id === id);
        const color = SEAT[(index < 0 ? 0 : index) % SEAT.length] as string;
        const cx = (body.x + 0.5) * cell;
        const cy = (body.y + 0.5) * cell;
        context.globalAlpha = body.disconnected ? 0.35 : 1;
        context.beginPath();
        context.arc(cx, cy, cell * 0.32, 0, Math.PI * 2);
        context.fillStyle = color;
        context.fill();
        if (id === myPlayerId) {
          context.strokeStyle = '#ffffff';
          context.lineWidth = 2;
          context.stroke();
        }
        context.globalAlpha = 1;
      }
    };

    frameRef.current = requestAnimationFrame(render);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [myPlayerId]);

  const now = Date.now() + offsetRef.current;
  const cooling = state?.me ? now < state.me.cooldownUntil : false;
  const combo = state?.me?.combo ?? 0;

  if (phase === 'idle') {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Charging the arena…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({
          ...player,
          score: state?.players?.[player.id]?.score ?? player.score,
        }))}
        myPlayerId={myPlayerId}
        deadline={state?.endsAt ?? null}
        label="Match clock"
      />

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Badge tone={combo > 1 ? 'success' : 'default'}>Combo x{Math.max(1, combo)}</Badge>
        <Badge tone={cooling ? 'warning' : 'primary'}>{cooling ? 'Recharging' : 'Pulse ready'}</Badge>
      </div>

      <canvas
        ref={canvasRef}
        className="mx-auto w-full max-w-[min(94vw,34rem)] touch-none rounded-2xl border border-white/10"
        aria-label="Black Blast arena"
      />

      <div className="flex items-center justify-center gap-6">
        <div className="grid w-44 grid-cols-3 grid-rows-2 gap-2">
          {DPAD.map(({ direction, icon: Icon, label, area }) => (
            <button
              key={direction}
              type="button"
              aria-label={label}
              disabled={!playing}
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
          aria-label="Drop energy pulse"
          disabled={!playing || cooling}
          onClick={pulse}
          className={cn(
            'grid h-24 w-24 place-items-center rounded-full border-2 transition active:scale-95 disabled:opacity-40',
            cooling
              ? 'border-white/10 bg-white/5 text-slate-500'
              : 'border-violet-400/60 bg-violet-500/25 text-violet-100 shadow-[0_0_24px_rgba(139,92,246,0.45)]',
          )}
        >
          <Zap className="h-9 w-9" aria-hidden />
        </button>
      </div>

      <div className="flex flex-wrap justify-center gap-3 text-xs text-slate-400">
        {players.map((player) => {
          const slot = state?.players?.[player.id];
          if (!slot) return null;
          return (
            <span key={player.id}>
              {player.nickname}: {slot.score} · {slot.chains} chains
              {slot.disconnected ? ' (offline)' : ''}
            </span>
          );
        })}
      </div>

      <p className="text-center text-xs text-slate-500">
        Gold nodes chain into new pulses. Land pulses back to back to build your multiplier.
      </p>
    </div>
  );
}

export const blackBlastClient: ClientGameModule = {
  metadata: BLACK_BLAST_METADATA,
  Component: BlackBlastGame as unknown as ComponentType<GameComponentProps<never>>,
};
