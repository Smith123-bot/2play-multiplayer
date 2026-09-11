import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { motion } from 'framer-motion';
import { HelpCircle } from 'lucide-react';
import { MIRROR_GRID_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { HowToPlayModal, useHowToPlay } from '../../components/game/HowToPlayModal';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { cn } from '../../utils/cn';

type SymbolName = 'circle' | 'square' | 'triangle' | 'diamond' | 'star' | 'arrow';
type ColorName = 'red' | 'blue' | 'green' | 'yellow';

interface Cell {
  symbol: SymbolName;
  color: ColorName;
}

export interface MirrorPublicState {
  phase: 'idle' | 'playing' | 'level-clear' | 'finished';
  level: number;
  totalLevels: number;
  size: number;
  mirror: string;
  source: Array<Cell | null>;
  levelEndsAt: number | null;
  levelMs: number;
  finishOrder: string[];
  lastEvent: string | null;
  finishReason: string | null;
  serverTime: number;
  myAnswer: Array<Cell | null>;
  me: {
    score: number;
    moves: number;
    mistakes: number;
    solved: boolean;
    finishRank: number;
    levelsCleared: number;
  } | null;
  players: Record<
    string,
    {
      progress: number;
      score: number;
      solved: boolean;
      finishRank: number;
      levelsCleared: number;
      mistakes: number;
      disconnected: boolean;
    }
  >;
}

const SYMBOLS: SymbolName[] = ['circle', 'square', 'triangle', 'diamond', 'star', 'arrow'];
const COLORS: ColorName[] = ['red', 'blue', 'green', 'yellow'];

const COLOR_HEX: Record<ColorName, string> = {
  red: '#f43f5e',
  blue: '#3b82f6',
  green: '#22c55e',
  yellow: '#f59e0b',
};

/** Original SVG glyphs — no external artwork. */
function Glyph({ cell, size = 26 }: { cell: Cell; size?: number }) {
  const fill = COLOR_HEX[cell.color];
  const half = size / 2;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false">
      {cell.symbol === 'circle' ? <circle cx="16" cy="16" r="11" fill={fill} /> : null}
      {cell.symbol === 'square' ? <rect x="5" y="5" width="22" height="22" rx="3" fill={fill} /> : null}
      {cell.symbol === 'triangle' ? <polygon points="16,4 28,27 4,27" fill={fill} /> : null}
      {cell.symbol === 'diamond' ? <polygon points="16,3 29,16 16,29 3,16" fill={fill} /> : null}
      {cell.symbol === 'star' ? (
        <polygon points="16,3 20,12 30,13 22,20 25,30 16,24 7,30 10,20 2,13 12,12" fill={fill} />
      ) : null}
      {cell.symbol === 'arrow' ? (
        <polygon points="16,3 27,16 20,16 20,29 12,29 12,16 5,16" fill={fill} />
      ) : null}
      <title>{`${cell.color} ${cell.symbol}`}</title>
      <desc>{half}</desc>
    </svg>
  );
}

/** Human-readable mirror description, always explicit about the axis. */
const MIRROR_TEXT: Record<string, string> = {
  'left-right': 'Vertical mirror — LEFT ↔ RIGHT (columns swap)',
  vertical: 'Vertical mirror — LEFT ↔ RIGHT (columns swap)',
  'top-bottom': 'Horizontal mirror — TOP ↕ BOTTOM (rows swap)',
  horizontal: 'Horizontal mirror — TOP ↕ BOTTOM (rows swap)',
};

function MirrorGridGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<MirrorPublicState>) {
  const previousEvent = useRef<string | null>(null);
  const rules = useHowToPlay(MIRROR_GRID_METADATA.id);
  const [symbol, setSymbol] = useState<SymbolName>('circle');
  const [color, setColor] = useState<ColorName>('red');

  const phase = state?.phase ?? 'idle';
  const solved = state?.me?.solved ?? false;
  const canEdit = phase === 'playing' && !solved;

  const setCell = useCallback(
    (index: number) => {
      if (!canEdit) return;
      const existing = state?.myAnswer?.[index] ?? null;
      // Tapping a cell that already holds this exact symbol clears it.
      const clearing = existing && existing.symbol === symbol && existing.color === color;
      sendAction(
        (clearing
          ? { type: 'set', payload: { index, symbol: null } }
          : { type: 'set', payload: { index, symbol, color } }) satisfies GameAction,
      );
      vibrate('buttonPress');
    },
    [canEdit, state?.myAnswer, symbol, color, sendAction, vibrate],
  );

  const submit = useCallback(() => {
    if (!canEdit) return;
    sendAction({ type: 'submit' } satisfies GameAction);
  }, [canEdit, sendAction]);

  useEffect(() => {
    const event = state?.lastEvent ?? null;
    if (event === previousEvent.current) return;
    previousEvent.current = event;
    if (!event) return;
    const mine = myPlayerId ? event.endsWith(`:${myPlayerId}`) : false;
    if (event.startsWith('solved:')) {
      play(mine ? 'victory' : 'notification');
      if (mine) vibrate('victory');
    } else if (event.startsWith('wrong:')) {
      if (mine) {
        play('wrong');
        vibrate('error');
      }
    } else if (event.startsWith('level:')) {
      play('gameStart');
    } else if (event === 'timeout' || event === 'finished') {
      play('gameOver');
    }
  }, [state?.lastEvent, myPlayerId, play, vibrate]);

  const filled = useMemo(
    () => (state?.myAnswer ?? []).filter(Boolean).length,
    [state?.myAnswer],
  );

  if (phase === 'idle' || !state?.source?.length) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Building the puzzle…</p>
        </div>
      </div>
    );
  }

  const size = state.size;
  const vertical = state.mirror === 'left-right' || state.mirror === 'vertical';

  return (
    <div className="space-y-4">
      <HowToPlayModal game={MIRROR_GRID_METADATA} open={rules.open} onClose={rules.close} />

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
        <Badge tone="default">
          {size}×{size}
        </Badge>
        {solved ? <Badge tone="success">Solved #{state.me?.finishRank}</Badge> : null}
        {state.me && state.me.mistakes > 0 ? (
          <Badge tone="danger">{state.me.mistakes} wrong submits</Badge>
        ) : null}
        <button
          type="button"
          onClick={rules.show}
          aria-label="How to play"
          className="rounded-full border border-white/10 p-1.5 text-slate-400 transition hover:text-white"
        >
          <HelpCircle className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="card p-3 text-center">
        <p className="text-sm font-medium text-amber-300">{MIRROR_TEXT[state.mirror] ?? state.mirror}</p>
        <p className="mt-1 text-xs text-slate-400">
          Build the pattern as it appears AFTER the reflection — not a copy.
        </p>
      </div>

      {/* Source (left/top) — mirror line — your answer */}
      <div
        className={cn(
          'mx-auto flex w-full max-w-[min(94vw,34rem)] items-center justify-center gap-3',
          vertical ? 'flex-row' : 'flex-col',
        )}
      >
        {/* Source pattern */}
        <div className="flex-1">
          <p className="mb-1 text-center text-[10px] uppercase tracking-wide text-slate-500">Source</p>
          <div
            className="grid gap-1 rounded-xl border border-white/10 bg-black/40 p-1.5"
            style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
            role="grid"
            aria-label="Source pattern"
          >
            {state.source.map((cell, index) => (
              <div
                key={index}
                className="grid aspect-square place-items-center rounded bg-white/[0.04]"
              >
                {cell ? <Glyph cell={cell} size={20} /> : null}
              </div>
            ))}
          </div>
        </div>

        {/* The mirror line */}
        <div
          className={cn(
            'shrink-0 rounded-full bg-gradient-to-b from-sky-300 via-white to-sky-300 shadow-[0_0_14px_rgba(125,211,252,0.9)]',
            vertical ? 'h-full min-h-[8rem] w-1' : 'h-1 w-full min-w-[8rem]',
          )}
          aria-hidden
        />

        {/* Your answer */}
        <div className="flex-1">
          <p className="mb-1 text-center text-[10px] uppercase tracking-wide text-slate-500">
            Your reflection
          </p>
          <div
            className="grid gap-1 rounded-xl border border-white/10 bg-black/40 p-1.5"
            style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
            role="grid"
            aria-label="Your answer grid"
          >
            {state.myAnswer.map((cell, index) => (
              <motion.button
                key={index}
                type="button"
                whileTap={canEdit ? { scale: 0.88 } : undefined}
                disabled={!canEdit}
                onClick={() => setCell(index)}
                aria-label={
                  cell ? `Cell ${index + 1}: ${cell.color} ${cell.symbol}` : `Cell ${index + 1}: empty`
                }
                className={cn(
                  'grid aspect-square place-items-center rounded border transition',
                  cell ? 'border-white/20 bg-white/10' : 'border-dashed border-white/15 bg-white/[0.03]',
                  canEdit && 'active:scale-95 hover:border-white/40',
                )}
              >
                {cell ? <Glyph cell={cell} size={20} /> : null}
              </motion.button>
            ))}
          </div>
        </div>
      </div>

      {/* Palette */}
      <div className="card space-y-3 p-3">
        <div className="flex flex-wrap justify-center gap-1.5">
          {SYMBOLS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setSymbol(option)}
              aria-pressed={symbol === option}
              aria-label={`Select ${option}`}
              className={cn(
                'grid h-11 w-11 place-items-center rounded-lg border transition',
                symbol === option
                  ? 'border-white bg-white/15'
                  : 'border-white/10 bg-white/5 hover:border-white/30',
              )}
            >
              <Glyph cell={{ symbol: option, color }} size={22} />
            </button>
          ))}
        </div>
        <div className="flex justify-center gap-2">
          {COLORS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setColor(option)}
              aria-pressed={color === option}
              aria-label={`Select ${option}`}
              className={cn(
                'h-9 w-9 rounded-full border-2 transition',
                color === option ? 'border-white scale-110' : 'border-white/20',
              )}
              style={{ backgroundColor: COLOR_HEX[option] }}
            />
          ))}
        </div>
        <p className="text-center text-[11px] text-slate-500">
          Tap a filled cell with the same symbol to clear it.
        </p>
      </div>

      <div className="flex flex-col items-center gap-2">
        <ProgressBar
          value={filled}
          max={Math.max(1, size * size)}
          label={`${filled}/${size * size} cells placed`}
          className="max-w-sm"
        />
        <Button onClick={submit} disabled={!canEdit} className="min-w-44">
          {solved ? 'Solved!' : 'Submit reflection'}
        </Button>
      </div>

      {/* Opponent progress — percentage only, never their grid. */}
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

export const mirrorGridClient: ClientGameModule = {
  metadata: MIRROR_GRID_METADATA,
  Component: MirrorGridGame as unknown as ComponentType<GameComponentProps<never>>,
};
