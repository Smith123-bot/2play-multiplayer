import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { HelpCircle, RotateCw, Trash2 } from 'lucide-react';
import { BUILD_TOGETHER_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { HowToPlayModal, useHowToPlay } from '../../components/game/HowToPlayModal';
import { Badge } from '../../components/ui/Badge';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { cn } from '../../utils/cn';

type PieceKind = 'a' | 'b' | 'shared';

interface PlacedPiece {
  x: number;
  y: number;
  kind: PieceKind;
  rotation: number;
  placedBy: string;
}

export interface BuildPublicState {
  phase: 'idle' | 'playing' | 'level-clear' | 'finished';
  level: number;
  totalLevels: number;
  levelName: string;
  hint: string;
  cols: number;
  rows: number;
  blueprint: Array<Array<PieceKind | null>>;
  requiredRotation: number[][];
  rotationRequired: boolean;
  placed: PlacedPiece[];
  inventory: Record<PieceKind, number>;
  cellsRequired: number;
  cellsCorrect: number;
  teamScore: number;
  levelsCleared: number;
  mistakes: number;
  levelEndsAt: number | null;
  lastEvent: string | null;
  finishReason: string | null;
  serverTime: number;
  myRole: 'a' | 'b' | null;
  players: Record<
    string,
    { role: 'a' | 'b'; placed: number; removed: number; misplacements: number; disconnected: boolean }
  >;
}

const KIND_COLOR: Record<PieceKind, string> = {
  a: 'bg-sky-500/70 border-sky-300/60',
  b: 'bg-emerald-500/70 border-emerald-300/60',
  shared: 'bg-slate-400/60 border-slate-200/50',
};

const KIND_GHOST: Record<PieceKind, string> = {
  a: 'border-sky-400/40 bg-sky-500/10',
  b: 'border-emerald-400/40 bg-emerald-500/10',
  shared: 'border-slate-300/30 bg-slate-400/10',
};

const KIND_LABEL: Record<PieceKind, string> = { a: 'Blue (A)', b: 'Green (B)', shared: 'Shared' };

function BuildTogetherGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<BuildPublicState>) {
  const previousEvent = useRef<string | null>(null);
  const rules = useHowToPlay(BUILD_TOGETHER_METADATA.id);
  const [selected, setSelected] = useState<PieceKind | null>(null);
  const [mode, setMode] = useState<'place' | 'rotate' | 'remove'>('place');

  const phase = state?.phase ?? 'idle';
  const playing = phase === 'playing';
  const myRole = state?.myRole ?? null;

  // Default the selection to a piece this partner is actually allowed to place.
  useEffect(() => {
    if (selected || !myRole) return;
    setSelected(myRole);
  }, [selected, myRole]);

  const place = useCallback(
    (x: number, y: number) => {
      if (!playing || !state) return;
      const existing = state.placed.find((piece) => piece.x === x && piece.y === y);

      if (mode === 'remove' || (existing && mode === 'place')) {
        if (!existing) return;
        sendAction({ type: 'remove', payload: { x, y } } satisfies GameAction);
        vibrate('buttonPress');
        return;
      }
      if (mode === 'rotate') {
        if (!existing) return;
        sendAction({ type: 'rotate', payload: { x, y } } satisfies GameAction);
        vibrate('buttonPress');
        return;
      }
      if (!selected) return;
      const rotation = state.rotationRequired ? state.requiredRotation[y]?.[x] ?? 0 : 0;
      sendAction({ type: 'place', payload: { x, y, kind: selected, rotation } } satisfies GameAction);
      vibrate('buttonPress');
    },
    [playing, state, mode, selected, sendAction, vibrate],
  );

  useEffect(() => {
    const event = state?.lastEvent ?? null;
    if (event === previousEvent.current) return;
    previousEvent.current = event;
    if (!event) return;
    const mine = myPlayerId ? event.endsWith(`:${myPlayerId}`) : false;
    if (event.startsWith('place:')) {
      play('correct');
      if (mine) vibrate('success');
    } else if (event.startsWith('misplace:')) {
      if (mine) {
        play('wrong');
        vibrate('error');
      }
    } else if (event.startsWith('remove:') || event.startsWith('rotate:')) {
      play('click');
    } else if (event.startsWith('level-clear:')) {
      play('victory');
      vibrate('victory');
    } else if (event.startsWith('level:')) {
      play('gameStart');
    } else if (event === 'timeout' || event === 'finished') {
      play('gameOver');
    }
  }, [state?.lastEvent, myPlayerId, play, vibrate]);

  if (phase === 'idle' || !state?.blueprint?.length) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Drawing up the blueprint…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <HowToPlayModal game={BUILD_TOGETHER_METADATA} open={rules.open} onClose={rules.close} />

      <GameHUD
        players={players.map((player) => ({ ...player, score: state.teamScore }))}
        myPlayerId={myPlayerId}
        deadline={state.levelEndsAt ?? null}
        label={phase === 'level-clear' ? 'Next blueprint' : 'Build clock'}
      />

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Badge tone="primary">
          Blueprint {Math.min(state.level + 1, state.totalLevels)}/{state.totalLevels}
        </Badge>
        <Badge tone="default">{state.levelName}</Badge>
        <Badge tone="success">Team {state.teamScore}</Badge>
        {state.rotationRequired ? <Badge tone="warning">Rotation matters</Badge> : null}
        <button
          type="button"
          onClick={rules.show}
          aria-label="How to play"
          className="rounded-full border border-white/10 p-1.5 text-slate-400 transition hover:text-white"
        >
          <HelpCircle className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="card space-y-2 p-3">
        <p className="text-sm text-slate-300">{state.hint}</p>
        <ProgressBar
          value={state.cellsCorrect}
          max={Math.max(1, state.cellsRequired)}
          label={`Structure ${state.cellsCorrect}/${state.cellsRequired}`}
        />
        <p className="text-xs text-slate-500">
          You are partner <span className="font-semibold text-white">{myRole?.toUpperCase() ?? '?'}</span> — you can
          place {myRole === 'a' ? 'blue' : 'green'} and shared pieces only.
        </p>
      </div>

      {phase === 'level-clear' ? (
        <p className="text-center text-sm text-emerald-300">Structure complete! Next blueprint loading…</p>
      ) : null}

      {/* Build grid — the blueprint shows through as a ghost. */}
      <div
        className="mx-auto grid w-full max-w-[min(94vw,26rem)] gap-1"
        style={{ gridTemplateColumns: `repeat(${state.cols}, minmax(0, 1fr))` }}
        role="grid"
        aria-label="Build grid"
      >
        {Array.from({ length: state.cols * state.rows }, (_unused, index) => {
          const x = index % state.cols;
          const y = Math.floor(index / state.cols);
          const required = state.blueprint[y]?.[x] ?? null;
          const piece = state.placed.find((entry) => entry.x === x && entry.y === y);
          const wanted = state.rotationRequired ? state.requiredRotation[y]?.[x] ?? 0 : 0;
          const correct = Boolean(piece && piece.kind === required && (!state.rotationRequired || piece.rotation === wanted));

          return (
            <button
              key={`${x}:${y}`}
              type="button"
              disabled={!playing}
              onClick={() => place(x, y)}
              aria-label={
                piece
                  ? `Cell ${x + 1},${y + 1} holds a ${KIND_LABEL[piece.kind]} piece`
                  : required
                    ? `Cell ${x + 1},${y + 1} needs a ${KIND_LABEL[required]} piece`
                    : `Cell ${x + 1},${y + 1} is empty in the blueprint`
              }
              className={cn(
                'relative grid aspect-square place-items-center rounded-md border-2 transition active:scale-95 disabled:opacity-60',
                piece
                  ? cn(KIND_COLOR[piece.kind], !correct && 'ring-2 ring-rose-400')
                  : required
                    ? cn('border-dashed', KIND_GHOST[required])
                    : 'border-transparent bg-black/20',
              )}
            >
              {piece && state.rotationRequired ? (
                <span
                  className="text-[10px] font-bold text-white/80"
                  style={{ transform: `rotate(${piece.rotation}deg)` }}
                  aria-hidden
                >
                  ▲
                </span>
              ) : null}
              {!piece && required && state.rotationRequired ? (
                <span className="text-[9px] text-white/40" style={{ transform: `rotate(${wanted}deg)` }} aria-hidden>
                  ▲
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Piece supply */}
      <div className="card space-y-3 p-3">
        <p className="text-xs uppercase tracking-wide text-slate-400">Your supply</p>
        <div className="flex flex-wrap justify-center gap-2">
          {(['a', 'b', 'shared'] as PieceKind[]).map((kind) => {
            const allowed = kind === 'shared' || kind === myRole;
            const count = state.inventory[kind] ?? 0;
            return (
              <button
                key={kind}
                type="button"
                disabled={!allowed || count <= 0 || !playing}
                onClick={() => {
                  setSelected(kind);
                  setMode('place');
                }}
                className={cn(
                  'flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition disabled:opacity-35',
                  selected === kind && mode === 'place'
                    ? 'border-white/60 bg-white/15 text-white'
                    : 'border-white/10 bg-white/5 text-slate-300',
                )}
              >
                <span className={cn('h-4 w-4 rounded border-2', KIND_COLOR[kind])} aria-hidden />
                {KIND_LABEL[kind]} × {count}
                {!allowed ? ' (partner)' : ''}
              </button>
            );
          })}
        </div>
        <div className="flex justify-center gap-2">
          <button
            type="button"
            disabled={!playing || !state.rotationRequired}
            onClick={() => setMode(mode === 'rotate' ? 'place' : 'rotate')}
            className={cn(
              'flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs transition disabled:opacity-35',
              mode === 'rotate' ? 'border-amber-400 bg-amber-500/20 text-amber-100' : 'border-white/10 bg-white/5 text-slate-300',
            )}
          >
            <RotateCw className="h-4 w-4" aria-hidden /> Rotate
          </button>
          <button
            type="button"
            disabled={!playing}
            onClick={() => setMode(mode === 'remove' ? 'place' : 'remove')}
            className={cn(
              'flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs transition disabled:opacity-35',
              mode === 'remove' ? 'border-rose-400 bg-rose-500/20 text-rose-100' : 'border-white/10 bg-white/5 text-slate-300',
            )}
          >
            <Trash2 className="h-4 w-4" aria-hidden /> Remove
          </button>
        </div>
      </div>

      <div className="flex flex-wrap justify-center gap-3 text-xs text-slate-400">
        {players.map((player) => {
          const slot = state.players?.[player.id];
          if (!slot) return null;
          return (
            <span key={player.id}>
              {player.nickname} ({slot.role.toUpperCase()}): {slot.placed} placed
              {slot.disconnected ? ' (offline)' : ''}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export const buildTogetherClient: ClientGameModule = {
  metadata: BUILD_TOGETHER_METADATA,
  Component: BuildTogetherGame as unknown as ComponentType<GameComponentProps<never>>,
};
