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

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, w, h);
    for (const stroke of state?.strokes ?? []) {
      if (stroke.points.length === 0) continue;
      ctx.strokeStyle = stroke.tool === 'eraser' ? '#f8fafc' : stroke.color;
      ctx.lineWidth = Math.max(2, (stroke.size / 28) * 18);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      stroke.points.forEach((point, index) => {
        const x = point.x * w;
        const y = point.y * h;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }, [state?.strokes]);

  useEffect(() => {
    paint();
  }, [paint]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      paint();
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [paint]);

  const toNorm = (event: PointerEvent<HTMLCanvasElement>): DrawPoint | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  const flushStroke = () => {
    if (!canDraw || localPoints.current.length === 0) {
      localPoints.current = [];
      return;
    }
    sendAction({
      type: 'stroke',
      payload: { color, size, tool, points: localPoints.current },
    } satisfies GameAction);
    localPoints.current = [];
  };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!canDraw) return;
    event.preventDefault();
    drawing.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toNorm(event);
    if (point) localPoints.current = [point];
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !canDraw) return;
    event.preventDefault();
    const point = toNorm(event);
    if (!point) return;
    const previous = localPoints.current.at(-1);
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (previous && canvas && ctx) {
      ctx.strokeStyle = tool === 'eraser' ? '#f8fafc' : color;
      ctx.lineWidth = Math.max(2, (size / 28) * 18);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(previous.x * canvas.width, previous.y * canvas.height);
      ctx.lineTo(point.x * canvas.width, point.y * canvas.height);
      ctx.stroke();
    }
    localPoints.current.push(point);
    if (localPoints.current.length >= 16) flushStroke();
  };

  const onPointerUp = () => {
    if (!drawing.current) return;
    drawing.current = false;
    flushStroke();
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

      <div className="mx-auto w-full max-w-lg">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Shared drawing canvas"
          className={cn(
            'touch-none h-64 w-full rounded-2xl border border-white/10 bg-slate-50 sm:h-80',
            canDraw ? 'cursor-crosshair' : 'cursor-default',
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
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
