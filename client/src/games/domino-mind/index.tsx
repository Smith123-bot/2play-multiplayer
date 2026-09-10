import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { motion } from 'framer-motion';
import { HelpCircle, Play, RotateCw, Trash2 } from 'lucide-react';
import { DOMINO_MIND_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { HowToPlayModal, useHowToPlay } from '../../components/game/HowToPlayModal';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { cn } from '../../utils/cn';

type Facing = 'N' | 'E' | 'S' | 'W';
type PieceKind = 'domino' | 'start' | 'fixed' | 'blocker' | 'splitter' | 'target';

interface PieceView {
  id: string;
  x: number;
  y: number;
  facing: Facing;
  kind: PieceKind;
  fallen: boolean;
  fallOrder: number;
}

interface RunResult {
  fallen: string[];
  standing: string[];
  success: boolean;
  missingTargets: string[];
  hitForbidden: string[];
  triggered: number;
}

export interface DominoMindPublicState {
  phase: 'idle' | 'playing' | 'level-clear' | 'finished';
  level: number;
  totalLevels: number;
  levelName: string;
  hint: string;
  cols: number;
  rows: number;
  reach: number;
  budget: number;
  requiredTargets: string[];
  forbidden: string[];
  levelEndsAt: number | null;
  finishOrder: string[];
  lastEvent: string | null;
  finishReason: string | null;
  serverTime: number;
  pieces: PieceView[];
  placed: number;
  lastRun: RunResult | null;
  me: {
    score: number;
    moves: number;
    attempts: number;
    solved: boolean;
    finishRank: number;
    levelsCleared: number;
  } | null;
  players: Record<
    string,
    {
      progress: number;
      score: number;
      attempts: number;
      solved: boolean;
      finishRank: number;
      levelsCleared: number;
      disconnected: boolean;
    }
  >;
}

const FACINGS: Facing[] = ['N', 'E', 'S', 'W'];

const ARROW: Record<Facing, string> = { N: '▲', E: '▶', S: '▼', W: '◀' };

const KIND_STYLE: Record<PieceKind, string> = {
  start: 'bg-emerald-500/80 border-emerald-200 text-emerald-50',
  domino: 'bg-sky-500/80 border-sky-200 text-sky-50',
  fixed: 'bg-slate-400/70 border-slate-200 text-slate-900',
  blocker: 'bg-slate-700 border-slate-500 text-slate-300',
  splitter: 'bg-violet-500/80 border-violet-200 text-violet-50',
  target: 'bg-amber-500/85 border-amber-200 text-amber-950',
};

function DominoMindGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<DominoMindPublicState>) {
  const previousEvent = useRef<string | null>(null);
  const rules = useHowToPlay(DOMINO_MIND_METADATA.id);
  const [facing, setFacing] = useState<Facing>('E');
  const [selected, setSelected] = useState<string | null>(null);

  const phase = state?.phase ?? 'idle';
  const solved = state?.me?.solved ?? false;
  const canEdit = phase === 'playing' && !solved;

  const pieceMap = useMemo(() => {
    const map = new Map<string, PieceView>();
    for (const piece of state?.pieces ?? []) map.set(`${piece.x}:${piece.y}`, piece);
    return map;
  }, [state?.pieces]);

  const forbiddenSet = useMemo(() => new Set(state?.forbidden ?? []), [state?.forbidden]);

  const onCell = useCallback(
    (x: number, y: number) => {
      if (!canEdit) return;
      const existing = pieceMap.get(`${x}:${y}`);
      if (existing) {
        // Only dominoes the player placed (ids starting with "p") are editable.
        if (existing.id.startsWith('p')) setSelected(existing.id === selected ? null : existing.id);
        else {
          play('wrong');
          vibrate('error');
        }
        return;
      }
      if ((state?.placed ?? 0) >= (state?.budget ?? 0)) {
        play('wrong');
        vibrate('error');
        return;
      }
      sendAction({ type: 'place', payload: { x, y, facing } } satisfies GameAction);
      vibrate('buttonPress');
    },
    [canEdit, pieceMap, selected, state?.placed, state?.budget, facing, sendAction, play, vibrate],
  );

  const rotateSelected = useCallback(() => {
    if (!canEdit || !selected) return;
    sendAction({ type: 'rotate', payload: { pieceId: selected } } satisfies GameAction);
    vibrate('buttonPress');
  }, [canEdit, selected, sendAction, vibrate]);

  const removeSelected = useCallback(() => {
    if (!canEdit || !selected) return;
    sendAction({ type: 'remove', payload: { pieceId: selected } } satisfies GameAction);
    setSelected(null);
    vibrate('buttonPress');
  }, [canEdit, selected, sendAction, vibrate]);

  const push = useCallback(() => {
    if (!canEdit) return;
    sendAction({ type: 'push' } satisfies GameAction);
    play('click');
  }, [canEdit, sendAction, play]);

  useEffect(() => {
    const event = state?.lastEvent ?? null;
    if (event === previousEvent.current) return;
    previousEvent.current = event;
    if (!event) return;
    const mine = myPlayerId ? event.endsWith(`:${myPlayerId}`) : false;
    if (event.startsWith('place:') || event.startsWith('rotate:')) {
      if (mine) play('click');
    } else if (event.startsWith('failed:')) {
      if (mine) {
        play('wrong');
        vibrate('error');
      }
    } else if (event.startsWith('solved:')) {
      play(mine ? 'victory' : 'notification');
      if (mine) vibrate('victory');
    } else if (event.startsWith('level:')) {
      play('gameStart');
    } else if (event === 'timeout' || event === 'finished') {
      play('gameOver');
    }
  }, [state?.lastEvent, myPlayerId, play, vibrate]);

  if (phase === 'idle' || !state?.pieces) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Setting up the dominoes…</p>
        </div>
      </div>
    );
  }

  const run = state.lastRun;
  const fallenSet = new Set(run?.fallen ?? []);
  const remaining = (state.budget ?? 0) - (state.placed ?? 0);

  return (
    <div className="space-y-4">
      <HowToPlayModal game={DOMINO_MIND_METADATA} open={rules.open} onClose={rules.close} />

      <GameHUD
        players={players.map((player) => ({
          ...player,
          score: state.players?.[player.id]?.score ?? 0,
        }))}
        myPlayerId={myPlayerId}
        deadline={state.levelEndsAt ?? null}
        label={phase === 'level-clear' ? 'Next level' : 'Level clock'}
      />

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Badge tone="primary">
          Level {Math.min(state.level + 1, state.totalLevels)}/{state.totalLevels}
        </Badge>
        <Badge tone="default">{state.levelName}</Badge>
        <Badge tone={remaining > 0 ? 'success' : 'warning'}>{remaining} dominoes left</Badge>
        <Badge tone="default">{state.me?.attempts ?? 0} attempts</Badge>
        {solved ? <Badge tone="success">Solved #{state.me?.finishRank}</Badge> : null}
        <button
          type="button"
          onClick={rules.show}
          aria-label="How to play"
          className="rounded-full border border-white/10 p-1.5 text-slate-400 transition hover:text-white"
        >
          <HelpCircle className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="card space-y-1 p-3 text-center">
        <p className="text-sm text-slate-300">{state.hint}</p>
        <p className="text-xs text-slate-500">
          Green = start (the only one you can push) · Amber = target · Purple = splitter · Dark = blocker
        </p>
      </div>

      {/* Board */}
      <div
        className="mx-auto grid w-full max-w-[min(94vw,32rem)] gap-1 rounded-2xl border border-white/10 bg-emerald-950/40 p-2"
        style={{ gridTemplateColumns: `repeat(${state.cols}, minmax(0, 1fr))` }}
        role="grid"
        aria-label="Domino board"
      >
        {Array.from({ length: state.cols * state.rows }, (_unused, index) => {
          const x = index % state.cols;
          const y = Math.floor(index / state.cols);
          const piece = pieceMap.get(`${x}:${y}`);
          const fell = piece ? fallenSet.has(piece.id) : false;
          const isForbidden = piece ? forbiddenSet.has(piece.id) : false;

          return (
            <motion.button
              key={`${x}:${y}`}
              type="button"
              disabled={!canEdit}
              onClick={() => onCell(x, y)}
              whileTap={canEdit ? { scale: 0.9 } : undefined}
              aria-label={
                piece
                  ? `${piece.kind} at ${x + 1},${y + 1} facing ${piece.facing}${fell ? ', fallen' : ', standing'}`
                  : `Empty cell ${x + 1},${y + 1}`
              }
              className={cn(
                'relative grid aspect-square place-items-center rounded-md border text-sm font-bold transition',
                piece
                  ? cn(KIND_STYLE[piece.kind], isForbidden && 'ring-2 ring-rose-400')
                  : 'border-dashed border-white/10 bg-black/20',
                selected === piece?.id && 'ring-2 ring-white',
                canEdit && !piece && 'hover:border-white/30',
              )}
              style={
                fell
                  ? { transform: 'rotate(72deg) scale(0.82)', opacity: 0.55, transition: 'transform 240ms' }
                  : undefined
              }
            >
              {piece ? (
                <span aria-hidden>
                  {piece.kind === 'blocker' ? '■' : piece.kind === 'splitter' ? '✳' : ARROW[piece.facing]}
                </span>
              ) : null}
              {piece && state.requiredTargets.includes(piece.id) ? (
                <span className="absolute right-0.5 top-0.5 text-[8px]" aria-hidden>
                  ★
                </span>
              ) : null}
            </motion.button>
          );
        })}
      </div>

      {/* Facing picker + actions */}
      <div className="card space-y-3 p-3">
        <div className="flex items-center justify-center gap-2">
          <span className="text-xs text-slate-400">Place facing:</span>
          {FACINGS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setFacing(option)}
              aria-pressed={facing === option}
              aria-label={`Face ${option}`}
              className={cn(
                'grid h-10 w-10 place-items-center rounded-lg border text-base transition',
                facing === option
                  ? 'border-white bg-white/15 text-white'
                  : 'border-white/10 bg-white/5 text-slate-300',
              )}
            >
              {ARROW[option]}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          <Button
            variant="ghost"
            onClick={rotateSelected}
            disabled={!canEdit || !selected}
            icon={<RotateCw className="h-4 w-4" />}
          >
            Rotate
          </Button>
          <Button
            variant="ghost"
            onClick={removeSelected}
            disabled={!canEdit || !selected}
            icon={<Trash2 className="h-4 w-4" />}
          >
            Remove
          </Button>
          <Button onClick={push} disabled={!canEdit} icon={<Play className="h-4 w-4" />}>
            Push!
          </Button>
        </div>
      </div>

      {/* Attempt feedback */}
      {run ? (
        <div
          className={cn(
            'card space-y-1 p-3 text-center text-sm',
            run.success ? 'text-emerald-300' : 'text-amber-300',
          )}
        >
          {run.success ? (
            <p>Chain complete — {run.triggered} dominoes toppled!</p>
          ) : (
            <>
              <p>
                The chain stopped after {run.triggered} domino{run.triggered === 1 ? '' : 'es'}.
              </p>
              {run.missingTargets.length > 0 ? (
                <p className="text-xs text-slate-400">
                  {run.missingTargets.length} target{run.missingTargets.length === 1 ? '' : 's'} still standing.
                </p>
              ) : null}
              {run.hitForbidden.length > 0 ? (
                <p className="text-xs text-rose-300">You knocked over a forbidden domino.</p>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {/* Opponent progress — percentage only. */}
      <div className="flex flex-wrap justify-center gap-3 text-xs text-slate-400">
        {players.map((player) => {
          const slot = state.players?.[player.id];
          if (!slot) return null;
          return (
            <span key={player.id}>
              {player.nickname}: {slot.progress}%{slot.solved ? ' ✅' : ''}
              {slot.disconnected ? ' (offline)' : ''}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export const dominoMindClient: ClientGameModule = {
  metadata: DOMINO_MIND_METADATA,
  Component: DominoMindGame as unknown as ComponentType<GameComponentProps<never>>,
};
