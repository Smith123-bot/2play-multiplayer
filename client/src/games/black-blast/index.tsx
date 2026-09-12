import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
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
  gained: number;
  hits: number;
}

export interface BlastPublicState {
  phase: 'idle' | 'playing' | 'finished';
  cols: number;
  rows: number;
  endsAt: number | null;
  serverTime: number;
  escalation: number;
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

/** Colour ramp for chain depth: violet → fuchsia → amber. */
const DEPTH_COLORS = ['167,139,250', '244,114,182', '251,191,36'];

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

/** Deterministic 0..1 hash for particles (no Math.random in the render loop). */
function hash01(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10_000) / 10_000;
}

interface ScorePopup {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
  at: number;
}

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
  /** Smoothed render positions for every player marker. */
  const renderPos = useRef<Map<string, { x: number; y: number }>>(new Map());
  /** Score popups currently rising. */
  const popups = useRef<ScorePopup[]>([]);
  /** Effect ids already turned into popups. */
  const seenEffects = useRef<Set<string>>(new Set());
  /** Ring progress (0..1) for the cooldown/combo button. */
  const ringRef = useRef<HTMLDivElement | null>(null);
  const [waveBanner, setWaveBanner] = useState<number | null>(null);
  const previousWave = useRef(0);

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
    } else if (event.startsWith('wave:')) {
      play('notification');
    } else if (event === 'start') play('gameStart');
    else if (event === 'timeout' || event === 'finished') play('gameOver');
  }, [state?.lastEvent, myPlayerId, play, vibrate]);

  // Wave banner.
  useEffect(() => {
    const wave = state?.escalation ?? 0;
    if (wave > previousWave.current) {
      setWaveBanner(wave);
      const timer = window.setTimeout(() => setWaveBanner(null), 2200);
      previousWave.current = wave;
      return () => window.clearTimeout(timer);
    }
    previousWave.current = wave;
  }, [state?.escalation]);

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

      // Backdrop + grid + vignette
      context.fillStyle = '#0b0b16';
      context.fillRect(0, 0, width, height);
      context.strokeStyle = 'rgba(255,255,255,0.045)';
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
      const vignette = context.createRadialGradient(width / 2, height / 2, height * 0.2, width / 2, height / 2, height * 0.85);
      vignette.addColorStop(0, 'rgba(0,0,0,0)');
      vignette.addColorStop(1, 'rgba(0,0,0,0.45)');
      context.fillStyle = vignette;
      context.fillRect(0, 0, width, height);

      // Nodes — energy pulses gently, rich nodes shimmer, obstacles are hatched.
      for (const node of current.nodes) {
        const cx = (node.x + 0.5) * cell;
        const cy = (node.y + 0.5) * cell;
        if (node.kind === 'obstacle') {
          context.fillStyle = 'rgba(148,163,184,0.30)';
          context.fillRect(node.x * cell + 2, node.y * cell + 2, cell - 4, cell - 4);
          context.strokeStyle = 'rgba(148,163,184,0.35)';
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(node.x * cell + 3, node.y * cell + cell - 3);
          context.lineTo(node.x * cell + cell - 3, node.y * cell + 3);
          context.stroke();
        } else if (node.kind === 'rich') {
          const breathe = 0.5 + 0.5 * Math.sin(now / 260 + hash01(node.id) * 6.28);
          context.beginPath();
          context.arc(cx, cy, cell * (0.28 + breathe * 0.05), 0, Math.PI * 2);
          context.fillStyle = '#f59e0b';
          context.fill();
          context.beginPath();
          context.arc(cx, cy, cell * 0.15, 0, Math.PI * 2);
          context.fillStyle = `rgba(253,230,138,${0.7 + breathe * 0.3})`;
          context.fill();
          context.strokeStyle = `rgba(253,230,138,${0.35 + breathe * 0.4})`;
          context.lineWidth = 1.5;
          context.beginPath();
          context.arc(cx, cy, cell * 0.42, 0, Math.PI * 2);
          context.stroke();
        } else {
          const breathe = 0.5 + 0.5 * Math.sin(now / 420 + hash01(node.id) * 6.28);
          context.beginPath();
          context.arc(cx, cy, cell * (0.17 + breathe * 0.04), 0, Math.PI * 2);
          context.fillStyle = `rgba(56,189,248,${0.75 + breathe * 0.25})`;
          context.fill();
        }
      }

      // Charging pulses — a filling core + countdown ring, colour by depth.
      for (const entry of current.pulses) {
        const remaining = Math.max(0, entry.detonateAt - now);
        const total = entry.depth > 0 ? 260 : 900;
        const progress = 1 - Math.min(1, remaining / total);
        const cx = (entry.x + 0.5) * cell;
        const cy = (entry.y + 0.5) * cell;
        const color = DEPTH_COLORS[Math.min(DEPTH_COLORS.length - 1, entry.depth)] ?? DEPTH_COLORS[0]!;
        context.beginPath();
        context.arc(cx, cy, cell * (0.22 + progress * 0.3), 0, Math.PI * 2);
        context.fillStyle = `rgba(15,15,26,${0.5 + progress * 0.45})`;
        context.fill();
        context.strokeStyle = `rgba(${color},${0.45 + progress * 0.55})`;
        context.lineWidth = 2 + progress * 1.5;
        context.stroke();
        // Rotating spark while charging.
        const spin = (now / 220) % (Math.PI * 2);
        context.beginPath();
        context.arc(cx + Math.cos(spin) * cell * 0.5, cy + Math.sin(spin) * cell * 0.5, cell * 0.06, 0, Math.PI * 2);
        context.fillStyle = `rgba(${color},${0.3 + progress * 0.6})`;
        context.fill();
      }

      // Detonation shockwaves + spark particles.
      for (const effect of current.effects) {
        const age = now - effect.at;
        if (age < 0 || age > 1100) continue;
        const t = age / 1100;
        const fade = 1 - t;
        const color = DEPTH_COLORS[Math.min(DEPTH_COLORS.length - 1, effect.depth)] ?? DEPTH_COLORS[0]!;
        const ex = (effect.x + 0.5) * cell;
        const ey = (effect.y + 0.5) * cell;

        // Three staggered rings.
        for (let ring = 0; ring < 3; ring += 1) {
          const rt = Math.max(0, Math.min(1, t - ring * 0.12));
          if (rt <= 0) continue;
          const radius = effect.radius * cell * (0.3 + rt * 0.95);
          const ringFade = (1 - rt) * fade;
          context.beginPath();
          context.arc(ex, ey, radius, 0, Math.PI * 2);
          context.strokeStyle = `rgba(${color},${ringFade * 0.85})`;
          context.lineWidth = (3.5 - ring) * ringFade + 0.5;
          context.stroke();
        }
        // Filled flash core.
        context.beginPath();
        context.arc(ex, ey, effect.radius * cell * 0.5 * fade, 0, Math.PI * 2);
        context.fillStyle = `rgba(${color},${fade * 0.28})`;
        context.fill();

        // Deterministic sparks.
        const sparkCount = 8 + Math.min(8, effect.hits * 2);
        for (let index = 0; index < sparkCount; index += 1) {
          const angle = hash01(`${effect.id}:s${index}`) * Math.PI * 2;
          const distance = (0.4 + hash01(`${effect.id}:d${index}`) * 1.4) * effect.radius * cell * (0.3 + t);
          const sx = ex + Math.cos(angle) * distance;
          const sy = ey + Math.sin(angle) * distance;
          context.beginPath();
          context.arc(sx, sy, Math.max(0.5, cell * 0.07 * fade), 0, Math.PI * 2);
          context.fillStyle = `rgba(${color},${fade})`;
          context.fill();
        }
      }

      // Players — smoothly chased positions with a motion trail.
      const order = playersRef.current;
      for (const [id, body] of Object.entries(current.players)) {
        const index = order.findIndex((entry) => entry.id === id);
        const color = SEAT[(index < 0 ? 0 : index) % SEAT.length] as string;
        const smooth = renderPos.current.get(id) ?? { x: body.x, y: body.y };
        smooth.x += (body.x - smooth.x) * 0.22;
        smooth.y += (body.y - smooth.y) * 0.22;
        renderPos.current.set(id, smooth);

        // Trail.
        const speed = Math.hypot(body.x - smooth.x, body.y - smooth.y);
        if (speed > 0.05) {
          context.beginPath();
          context.moveTo((smooth.x + 0.5) * cell, (smooth.y + 0.5) * cell);
          context.lineTo((body.x + 0.5) * cell, (body.y + 0.5) * cell);
          context.strokeStyle = `${color}55`;
          context.lineWidth = cell * 0.3;
          context.lineCap = 'round';
          context.stroke();
        }

        const cx = (smooth.x + 0.5) * cell;
        const cy = (smooth.y + 0.5) * cell;
        context.globalAlpha = body.disconnected ? 0.35 : 1;
        // Glow.
        context.beginPath();
        context.arc(cx, cy, cell * 0.5, 0, Math.PI * 2);
        context.fillStyle = `${color}33`;
        context.fill();
        // Body.
        context.beginPath();
        context.arc(cx, cy, cell * 0.3, 0, Math.PI * 2);
        context.fillStyle = color;
        context.fill();
        // Combo ring.
        if (body.combo > 1) {
          context.beginPath();
          context.arc(cx, cy, cell * 0.44, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, body.combo / 8));
          context.strokeStyle = '#fde68a';
          context.lineWidth = 2;
          context.stroke();
        }
        if (id === myPlayerId) {
          context.strokeStyle = '#ffffff';
          context.lineWidth = 2;
          context.beginPath();
          context.arc(cx, cy, cell * 0.34, 0, Math.PI * 2);
          context.stroke();
        }
        // Initial for identification.
        context.fillStyle = '#0b0b16';
        context.font = `bold ${Math.floor(cell * 0.34)}px system-ui, sans-serif`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText((order[index]?.nickname ?? '?').slice(0, 1).toUpperCase(), cx, cy);
        context.globalAlpha = 1;
      }

      // Score popups rise and fade.
      if (popups.current.length > 0) {
        popups.current = popups.current.filter((popup) => now - popup.at < 900);
        for (const popup of popups.current) {
          const t = (now - popup.at) / 900;
          const rise = t * cell * 1.4;
          context.font = `bold ${Math.floor(cell * 0.55)}px system-ui, sans-serif`;
          context.textAlign = 'center';
          context.textBaseline = 'middle';
          context.fillStyle = `rgba(253,230,138,${1 - t})`;
          context.fillText(popup.text, (popup.x + 0.5) * cell, (popup.y + 0.5) * cell - rise - cell * 0.6);
        }
      }

      // Feed new detonations into the popup list.
      for (const effect of current.effects) {
        if (effect.gained > 0 && !seenEffects.current.has(effect.id)) {
          seenEffects.current.add(effect.id);
          const color = DEPTH_COLORS[Math.min(DEPTH_COLORS.length - 1, effect.depth)] ?? DEPTH_COLORS[0]!;
          popups.current.push({
            id: effect.id,
            x: effect.x,
            y: effect.y,
            text: `+${effect.gained}`,
            color,
            at: now,
          });
        }
      }
      if (seenEffects.current.size > 200) seenEffects.current.clear();
    };

    frameRef.current = requestAnimationFrame(render);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [myPlayerId]);

  // Cooldown / combo ring around the pulse button (direct DOM, no re-renders).
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const ring = ringRef.current;
      const me = stateRef.current?.me;
      if (!ring) return;
      const now = Date.now() + offsetRef.current;
      let progress = 1;
      if (me && now < me.cooldownUntil) {
        const total = 1400;
        progress = 1 - Math.min(1, (me.cooldownUntil - now) / total);
      }
      const combo = stateRef.current?.me?.combo ?? 0;
      ring.style.setProperty('--ring-progress', String(progress));
      ring.style.setProperty('--ring-combo', combo > 1 ? '1' : '0');
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const now = Date.now() + offsetRef.current;
  const cooling = state?.me ? now < state.me.cooldownUntil : false;
  const combo = state?.me?.combo ?? 0;
  const wave = state?.escalation ?? 0;

  // Swipe navigation on the arena itself.
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

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
        <Badge tone={combo > 1 ? 'success' : 'default'}>
          <motion.span
            key={combo}
            initial={{ scale: 1.5 }}
            animate={{ scale: 1 }}
            className="inline-block"
          >
            Combo x{Math.max(1, combo)}
          </motion.span>
        </Badge>
        <Badge tone={wave > 0 ? 'warning' : 'default'}>Wave {wave + 1}</Badge>
        <Badge tone={cooling ? 'warning' : 'primary'}>{cooling ? 'Recharging' : 'Pulse ready'}</Badge>
      </div>

      <div className="relative">
        <canvas
          ref={canvasRef}
          className="mx-auto w-full max-w-[min(94vw,36rem)] touch-none rounded-2xl border border-white/10"
          aria-label="Black Blast arena"
          onPointerDown={(event) => {
            swipeStart.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerUp={(event) => {
            const start = swipeStart.current;
            swipeStart.current = null;
            if (!start || !playing) return;
            const dx = event.clientX - start.x;
            const dy = event.clientY - start.y;
            if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
            if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 'right' : 'left');
            else move(dy > 0 ? 'down' : 'up');
          }}
        />
        {/* Wave escalation banner */}
        <AnimatePresence>
          {waveBanner !== null ? (
            <motion.div
              key={waveBanner}
              initial={{ opacity: 0, y: -14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="pointer-events-none absolute inset-x-0 top-3 mx-auto w-fit rounded-xl bg-amber-500/90 px-4 py-2 text-sm font-black tracking-wide text-amber-950 shadow-2xl"
            >
              WAVE {waveBanner + 1} — THE ARENA TIGHTENS
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-center gap-6">
        {/* Hold-to-repeat D-pad */}
        <div className="grid w-44 grid-cols-3 grid-rows-2 gap-2">
          {DPAD.map(({ direction, icon: Icon, label, area }) => (
            <HoldButton key={direction} label={label} area={area} disabled={!playing} onMove={move} direction={direction}>
              <Icon className="h-6 w-6" aria-hidden />
            </HoldButton>
          ))}
        </div>

        {/* Pulse button with cooldown / combo ring */}
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
          <span
            ref={ringRef}
            className="grid h-full w-full place-items-center rounded-full"
            style={{
              background:
                'conic-gradient(rgba(253,230,138,calc(var(--ring-combo, 0) * 0.85)) calc(var(--ring-progress, 1) * 360deg), transparent 0deg)',
            }}
          >
            <Zap className="h-9 w-9" aria-hidden />
          </span>
        </button>
      </div>

      <div className="flex flex-wrap justify-center gap-3 text-xs text-slate-400">
        {players.map((player) => {
          const slot = state?.players?.[player.id];
          if (!slot) return null;
          return (
            <span key={player.id}>
              {player.nickname}: {slot.score} · {slot.chains} chains · best x{Math.max(1, slot.bestCombo)}
              {slot.disconnected ? ' (offline)' : ''}
            </span>
          );
        })}
      </div>

      <p className="text-center text-xs text-slate-500">
        Swipe the arena or hold the D-pad to move. Gold nodes chain; back-to-back blasts grow your
        combo — and your blast radius.
      </p>
    </div>
  );
}

/** A D-pad key that repeats its direction while held (with a small delay). */
function HoldButton({
  label,
  area,
  disabled,
  onMove,
  direction,
  children,
}: {
  label: string;
  area: string;
  disabled: boolean;
  onMove: (direction: Direction) => void;
  direction: Direction;
  children: React.ReactNode;
}) {
  const timer = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(() => {
    if (disabled) return;
    onMove(direction);
    stop();
    timer.current = window.setInterval(() => onMove(direction), 150);
  }, [disabled, onMove, direction, stop]);

  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      className={cn(
        'grid h-14 place-items-center rounded-xl border border-white/10 bg-white/5 text-white transition active:scale-95 active:bg-white/15 disabled:opacity-40',
        area,
      )}
    >
      {children}
    </button>
  );
}

export const blackBlastClient: ClientGameModule = {
  metadata: BLACK_BLAST_METADATA,
  Component: BlackBlastGame as unknown as ComponentType<GameComponentProps<never>>,
};
