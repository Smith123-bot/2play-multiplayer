import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type PointerEvent,
} from 'react';
import { Eraser, Send, Trash2, Undo2 } from 'lucide-react';
import { DRAW_GUESS_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { cn } from '../../utils/cn';

export interface DrawPoint {
  x: number;
  y: number;
}

export interface DrawStroke {
  id: string;
  color: string;
  size: number;
  tool: 'brush' | 'eraser';
  points: DrawPoint[];
}

export interface DrawGuessPublicState {
  phase: 'idle' | 'prepare' | 'drawing' | 'reveal' | 'finished';
  round: number;
  totalRounds: number;
  drawerId: string | null;
  category: string | null;
  difficulty: 'easy' | 'medium' | 'hard';
  hint: string | null;
  word: string | null;
  endsAt: number | null;
  strokes: DrawStroke[];
  solved: string[];
  guesses: Array<{ playerId: string; text: string; correct: boolean }>;
  scores: Record<string, number>;
  history: Array<{ number: number; word: string; drawerId: string; solvers: string[] }>;
  palette: string[];
  lastEvent: string | null;
  eventSeq: number;
  serverTime: number;
}

function DrawGuessGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<DrawGuessPublicState>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const localPoints = useRef<DrawPoint[]>([]);
  const [color, setColor] = useState('#111827');
  const [size, setSize] = useState(8);
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush');
  const [guess, setGuess] = useState('');
  const previousSolved = useRef(0);
  const previousEvent = useRef<string | null>(null);

  const phase = state?.phase ?? 'idle';
  const iAmDrawer = Boolean(myPlayerId && state?.drawerId === myPlayerId);
  const iSolved = myPlayerId ? (state?.solved?.includes(myPlayerId) ?? false) : false;
  const canDraw = phase === 'drawing' && iAmDrawer;
  const canGuess = phase === 'drawing' && !iAmDrawer && !iSolved;
  const drawer = players.find((player) => player.id === state?.drawerId);

  // ---- Smooth canvas system -------------------------------------------------
  // Two layers: the base canvas replays the server's stroke list, the overlay
  // canvas shows the in-progress local stroke. All pointer input is handled
  // with refs only (no per-point React re-renders), pointer capture keeps the
  // stroke alive outside the canvas, and both repaints are coalesced into a
  // single requestAnimationFrame. Socket sync is throttled: a chunk is sent
  // every 100 ms or 32 points, overlapping by one point so chunked segments
  // join seamlessly on every screen.
  const strokesRef = useRef<DrawStroke[]>([]);
  const canDrawRef = useRef(canDraw);
  canDrawRef.current = canDraw;
  const styleRef = useRef({ color, size, tool });
  useEffect(() => {
    styleRef.current = { color, size, tool };
  }, [color, size, tool]);
  const frameQueued = useRef(false);
  const lastFlushAt = useRef(0);

  const paintBase = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, w, h);
    for (const stroke of strokesRef.current) {
      if (stroke.points.length === 0) continue;
      ctx.strokeStyle = stroke.tool === 'eraser' ? '#f8fafc' : stroke.color;
      ctx.fillStyle = stroke.tool === 'eraser' ? '#f8fafc' : stroke.color;
      ctx.lineWidth = Math.max(2, (stroke.size / 28) * 18);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (stroke.points.length === 1) {
        // A single tap is a dot, not an invisible moveTo.
        const only = stroke.points[0]!;
        ctx.beginPath();
        ctx.arc(only.x * w, only.y * h, Math.max(1, (stroke.size / 28) * 9), 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      stroke.points.forEach((point, index) => {
        const x = point.x * w;
        const y = point.y * h;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }, []);

  const paintPreview = useCallback(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    const points = localPoints.current;
    if (points.length === 0) return;
    const { color: liveColor, size: liveSize, tool: liveTool } = styleRef.current;
    const paint = liveTool === 'eraser' ? '#f8fafc' : liveColor;
    ctx.strokeStyle = paint;
    ctx.fillStyle = paint;
    ctx.lineWidth = Math.max(2, (liveSize / 28) * 18);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (points.length === 1) {
      const only = points[0]!;
      ctx.beginPath();
      ctx.arc(
        only.x * overlay.width,
        only.y * overlay.height,
        Math.max(1, (liveSize / 28) * 9),
        0,
        Math.PI * 2,
      );
      ctx.fill();
      return;
    }
    ctx.beginPath();
    points.forEach((point, index) => {
      const x = point.x * overlay.width;
      const y = point.y * overlay.height;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, []);

  const schedulePaint = useCallback(() => {
    if (frameQueued.current) return;
    frameQueued.current = true;
    requestAnimationFrame(() => {
      frameQueued.current = false;
      paintBase();
      paintPreview();
    });
  }, [paintBase, paintPreview]);

  useEffect(() => {
    strokesRef.current = state?.strokes ?? [];
    schedulePaint();
  }, [state?.strokes, schedulePaint]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.floor(rect.width * dpr));
      const height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.width = width;
      canvas.height = height;
      const overlay = overlayRef.current;
      if (overlay) {
        overlay.width = width;
        overlay.height = height;
      }
      schedulePaint();
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [schedulePaint]);

  const toNormPoint = useCallback((clientX: number, clientY: number): DrawPoint | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    };
  }, []);

  const flushStroke = useCallback(() => {
    const pending = localPoints.current;
    if (pending.length === 0) return;
    if (!canDrawRef.current) {
      localPoints.current = [];
      schedulePaint();
      return;
    }
    const { color: liveColor, size: liveSize, tool: liveTool } = styleRef.current;
    sendAction({
      type: 'stroke',
      payload: { color: liveColor, size: liveSize, tool: liveTool, points: pending },
    } satisfies GameAction);
    // Keep the last point so the next chunk joins seamlessly (the server
    // caps a chunk at 40 points, well above our 32-point flush size).
    const last = pending[pending.length - 1]!;
    localPoints.current = drawing.current ? [last] : [];
  }, [sendAction, schedulePaint]);

  const endStroke = useCallback(() => {
    if (!drawing.current) return;
    drawing.current = false;
    flushStroke();
    localPoints.current = [];
    schedulePaint();
  }, [flushStroke, schedulePaint]);

  // If drawing rights end mid-stroke (round over), finish cleanly.
  useEffect(() => {
    if (!canDraw && drawing.current) endStroke();
  }, [canDraw, endStroke]);

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!canDrawRef.current) return;
    event.preventDefault();
    drawing.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    lastFlushAt.current = performance.now();
    const point = toNormPoint(event.clientX, event.clientY);
    localPoints.current = point ? [point] : [];
    schedulePaint();
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !canDrawRef.current) return;
    event.preventDefault();
    // Coalesced events recover the in-between samples browsers batch,
    // which is what makes fast strokes look smooth instead of polygonal.
    const native = event.nativeEvent;
    const samples: Array<{ clientX: number; clientY: number }> =
      typeof native.getCoalescedEvents === 'function' && native.getCoalescedEvents().length > 0
        ? native.getCoalescedEvents()
        : [native];
    for (const sample of samples) {
      const point = toNormPoint(sample.clientX, sample.clientY);
      if (point) localPoints.current.push(point);
    }
    schedulePaint();
    const now = performance.now();
    if (localPoints.current.length >= 32 || now - lastFlushAt.current >= 100) {
      lastFlushAt.current = now;
      flushStroke();
    }
  };

  const solvedCount = state?.solved?.length ?? 0;
  useEffect(() => {
    if (solvedCount > previousSolved.current) {
      const last = state?.solved?.[solvedCount - 1];
      if (last === myPlayerId) {
        play('correct');
        vibrate('success');
      } else {
        play('score');
      }
    }
    previousSolved.current = solvedCount;
  }, [solvedCount, state?.solved, myPlayerId, play, vibrate]);

  useEffect(() => {
    if (state?.lastEvent === previousEvent.current) return;
    previousEvent.current = state?.lastEvent ?? null;
    if (state?.lastEvent === 'reveal') play('notification');
    else if (state?.lastEvent?.startsWith(`wrong:${myPlayerId}:`)) {
      play('wrong');
      vibrate('error');
    }
  }, [state?.lastEvent, myPlayerId, play, vibrate]);

  const submitGuess = () => {
    const text = guess.trim();
    if (!text || !canGuess) return;
    sendAction({ type: 'guess', payload: { text } } satisfies GameAction);
    setGuess('');
    play('click');
    vibrate('buttonPress');
  };

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({
          ...player,
          score: state?.scores?.[player.id] ?? player.score,
        }))}
        myPlayerId={myPlayerId}
        deadline={state?.endsAt ?? null}
        label={phase === 'prepare' ? 'Get ready' : 'Draw time'}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary">
          Round {Math.max(1, state?.round ?? 0)} / {state?.totalRounds ?? 6}
        </Badge>
        {drawer ? <Badge tone="accent">Drawer: {drawer.nickname}</Badge> : null}
        {state?.category ? <Badge tone="default">{state.category}</Badge> : null}
        {state?.difficulty ? (
          <Badge tone={state.difficulty === 'hard' ? 'warning' : 'default'}>
            {state.difficulty}
          </Badge>
        ) : null}
        {iSolved ? <Badge tone="success">You got it!</Badge> : null}
      </div>

      <div className="card space-y-2 p-3 text-center">
        {phase === 'idle' ? (
          <p className="animate-pulse text-sm text-slate-400">Picking a word…</p>
        ) : null}
        {phase === 'prepare' && iAmDrawer ? (
          <p className="text-lg font-bold text-white">
            Draw: <span className="text-primary-300">{state?.word}</span>
          </p>
        ) : null}
        {phase === 'prepare' && !iAmDrawer ? (
          <p className="text-sm text-slate-300">
            {drawer?.nickname ?? 'Someone'} is getting the secret word…
          </p>
        ) : null}
        {phase === 'drawing' && iAmDrawer ? (
          <p className="text-sm text-slate-300">
            Sketch <span className="font-semibold text-white">{state?.word}</span>
          </p>
        ) : null}
        {phase === 'drawing' && !iAmDrawer ? (
          <div>
            <p className="text-sm text-slate-300">
              Guess quickly — placement and time remaining both score.
            </p>
            {state?.hint ? (
              <p className="mt-1 font-mono text-lg tracking-[0.25em] text-cyan-200">{state.hint}</p>
            ) : null}
          </div>
        ) : null}
        {phase === 'reveal' ? (
          <p className="text-lg font-bold text-success">It was {state?.word}</p>
        ) : null}
      </div>

      <div className="relative mx-auto w-full max-w-lg">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Shared drawing canvas"
          className={cn(
            'touch-none block h-64 w-full rounded-2xl border border-white/10 bg-slate-50 sm:h-80',
            canDraw ? 'cursor-crosshair' : 'cursor-default',
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
        />
        <canvas
          ref={overlayRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 block h-full w-full rounded-2xl"
        />
      </div>

      {canDraw ? (
        <div className="flex flex-wrap items-center gap-2">
          {(state?.palette ?? []).map((swatch) => (
            <button
              key={swatch}
              type="button"
              aria-label={`Colour ${swatch}`}
              onClick={() => {
                setColor(swatch);
                setTool('brush');
              }}
              className={cn(
                'h-11 w-11 rounded-full border-2',
                color === swatch && tool === 'brush' ? 'border-white scale-110' : 'border-white/20',
              )}
              style={{ backgroundColor: swatch }}
            />
          ))}
          <button
            type="button"
            aria-label="Eraser"
            onClick={() => setTool('eraser')}
            className={cn(
              'grid h-11 w-11 place-items-center rounded-xl border border-white/10',
              tool === 'eraser' && 'border-primary-400 bg-primary-500/20',
            )}
          >
            <Eraser className="h-5 w-5" />
          </button>
          <label className="flex items-center gap-2 text-xs text-slate-400">
            Size{' '}
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/10">
              <i
                className="rounded-full bg-white"
                style={{ width: Math.max(4, size / 2), height: Math.max(4, size / 2) }}
              />
            </span>
            <input
              type="range"
              min={4}
              max={24}
              value={size}
              onChange={(event) => setSize(Number(event.target.value))}
              className="w-24"
            />
          </label>
          <Button
            variant="ghost"
            size="sm"
            icon={<Undo2 className="h-4 w-4" />}
            disabled={(state?.strokes.length ?? 0) === 0}
            onClick={() => sendAction({ type: 'undo' })}
          >
            Undo
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 className="h-4 w-4" />}
            onClick={() => sendAction({ type: 'clear' })}
          >
            Clear
          </Button>
        </div>
      ) : null}

      {canGuess || phase === 'drawing' ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submitGuess();
          }}
        >
          <label className="sr-only" htmlFor="draw-guess">
            Your guess
          </label>
          <input
            id="draw-guess"
            value={guess}
            disabled={!canGuess}
            maxLength={32}
            autoComplete="off"
            placeholder={iSolved ? 'You got it!' : canGuess ? 'Type your guess…' : 'Waiting…'}
            onChange={(event) => setGuess(event.target.value)}
            className="input flex-1"
          />
          <Button
            type="submit"
            disabled={!canGuess || guess.trim().length < 2}
            icon={<Send className="h-4 w-4" />}
          >
            Guess
          </Button>
        </form>
      ) : null}

      {state?.guesses && state.guesses.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Guesses">
          {state.guesses.slice(-8).map((entry, index) => (
            <li key={`${entry.playerId}-${index}`}>
              <Badge tone={entry.correct ? 'success' : 'default'}>
                {players.find((player) => player.id === entry.playerId)?.nickname ?? 'Player'}:{' '}
                {entry.text}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}

      {state?.history && state.history.length > 0 ? (
        <section className="card p-3">
          <h4 className="mb-2 text-sm font-semibold text-white">Previous words</h4>
          <ul className="flex flex-wrap gap-1.5">
            {state.history.map((entry) => (
              <li key={entry.number}>
                <Badge tone="default">{entry.word}</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export const drawGuessClient: ClientGameModule = {
  metadata: DRAW_GUESS_METADATA,
  Component: DrawGuessGame as unknown as ComponentType<GameComponentProps<never>>,
};
