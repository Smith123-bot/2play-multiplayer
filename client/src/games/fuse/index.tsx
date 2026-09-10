import { useCallback, useEffect, useRef, type ComponentType } from 'react';
import { motion } from 'framer-motion';
import { HelpCircle } from 'lucide-react';
import { FUSE_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { HowToPlayModal, useHowToPlay } from '../../components/game/HowToPlayModal';
import { Badge } from '../../components/ui/Badge';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { cn } from '../../utils/cn';

type TileKind = 'empty' | 'straight' | 'corner' | 'tee' | 'cross' | 'source' | 'bulb' | 'blocker';

interface TileView {
  id: string;
  x: number;
  y: number;
  kind: TileKind;
  mask: number;
  rotation: number;
  circuit: number | null;
  fixed: boolean;
  lit: boolean;
}

export interface FusePublicState {
  phase: 'idle' | 'playing' | 'level-clear' | 'finished';
  level: number;
  totalLevels: number;
  cols: number;
  rows: number;
  circuits: number;
  levelEndsAt: number | null;
  levelMs: number;
  finishOrder: string[];
  lastEvent: string | null;
  finishReason: string | null;
  serverTime: number;
  board: TileView[];
  me: {
    score: number;
    rotations: number;
    mistakes: number;
    solved: boolean;
    finishRank: number;
    levelsCleared: number;
    progress: number;
  } | null;
  players: Record<
    string,
    {
      progress: number;
      score: number;
      rotations: number;
      solved: boolean;
      finishRank: number;
      levelsCleared: number;
      disconnected: boolean;
    }
  >;
}

const N = 1;
const E = 2;
const S = 4;
const W = 8;

/** Circuit colours, cycled per circuit index. */
const CIRCUIT_COLOR = ['#f59e0b', '#38bdf8', '#a78bfa', '#34d399'];

function colorFor(circuit: number | null): string {
  if (circuit === null) return '#94a3b8';
  return CIRCUIT_COLOR[circuit % CIRCUIT_COLOR.length] as string;
}

/**
 * Draws a tile's wire arms from its connection mask. Purely 2D SVG — the mask
 * already encodes the current rotation, so the arms are always accurate.
 */
function TileArt({ tile }: { tile: TileView }) {
  const stroke = tile.lit ? colorFor(tile.circuit) : '#64748b';
  const width = tile.lit ? 6 : 5;
  const arms = [
    { bit: N, x2: 16, y2: 0 },
    { bit: E, x2: 32, y2: 16 },
    { bit: S, x2: 16, y2: 32 },
    { bit: W, x2: 0, y2: 16 },
  ];

  return (
    <svg viewBox="0 0 32 32" className="h-full w-full" aria-hidden focusable="false">
      {tile.kind === 'blocker' ? (
        <rect x="4" y="4" width="24" height="24" rx="4" fill="#475569" />
      ) : null}

      {tile.kind !== 'empty' && tile.kind !== 'blocker'
        ? arms
            .filter((arm) => (tile.mask & arm.bit) !== 0)
            .map((arm) => (
              <line
                key={arm.bit}
                x1={16}
                y1={16}
                x2={arm.x2}
                y2={arm.y2}
                stroke={stroke}
                strokeWidth={width}
                strokeLinecap="round"
              />
            ))
        : null}

      {tile.kind === 'source' ? (
        <>
          <circle cx="16" cy="16" r="9" fill={colorFor(tile.circuit)} />
          <rect x="12" y="11" width="8" height="10" rx="1.5" fill="#0f172a" />
        </>
      ) : null}

      {tile.kind === 'bulb' ? (
        <>
          <circle
            cx="16"
            cy="16"
            r="9"
            fill={tile.lit ? colorFor(tile.circuit) : 'transparent'}
            stroke={colorFor(tile.circuit)}
            strokeWidth="2.5"
          />
          {tile.lit ? <circle cx="16" cy="16" r="13" fill={colorFor(tile.circuit)} opacity="0.25" /> : null}
        </>
      ) : null}

      {tile.kind !== 'empty' && tile.kind !== 'blocker' && tile.kind !== 'source' && tile.kind !== 'bulb' ? (
        <circle cx="16" cy="16" r="3.5" fill={stroke} />
      ) : null}
    </svg>
  );
}

function FuseGame({ state, players, myPlayerId, sendAction, play, vibrate }: GameComponentProps<FusePublicState>) {
  const previousEvent = useRef<string | null>(null);
  const rules = useHowToPlay(FUSE_METADATA.id);

  const phase = state?.phase ?? 'idle';
  const solved = state?.me?.solved ?? false;
  const canRotate = phase === 'playing' && !solved;

  const rotate = useCallback(
    (tile: TileView) => {
      if (!canRotate) return;
      if (tile.fixed || tile.kind === 'empty' || tile.kind === 'blocker') {
        play('wrong');
        vibrate('error');
        return;
      }
      sendAction({ type: 'rotate', payload: { tileId: tile.id } } satisfies GameAction);
      vibrate('buttonPress');
    },
    [canRotate, sendAction, play, vibrate],
  );

  useEffect(() => {
    const event = state?.lastEvent ?? null;
    if (event === previousEvent.current) return;
    previousEvent.current = event;
    if (!event) return;
    const mine = myPlayerId ? event.endsWith(`:${myPlayerId}`) : false;
    if (event.startsWith('rotate:')) {
      if (mine) play('click');
    } else if (event.startsWith('solved:')) {
      play(mine ? 'victory' : 'notification');
      if (mine) vibrate('victory');
    } else if (event.startsWith('level:')) {
      play('gameStart');
    } else if (event === 'timeout' || event === 'finished') {
      play('gameOver');
    }
  }, [state?.lastEvent, myPlayerId, play, vibrate]);

  if (phase === 'idle' || !state?.board?.length) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Wiring the board…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <HowToPlayModal game={FUSE_METADATA} open={rules.open} onClose={rules.close} />

      <GameHUD
        players={players.map((player) => ({
          ...player,
          score: state.players?.[player.id]?.score ?? 0,
        }))}
        myPlayerId={myPlayerId}
        deadline={state.levelEndsAt ?? null}
        label={phase === 'level-clear' ? 'Next board' : 'Board clock'}
      />

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Badge tone="primary">
          Board {Math.min(state.level + 1, state.totalLevels)}/{state.totalLevels}
        </Badge>
        <Badge tone="default">
          {state.circuits} circuit{state.circuits === 1 ? '' : 's'}
        </Badge>
        <Badge tone="default">{state.me?.rotations ?? 0} rotations</Badge>
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

      <div className="card p-3">
        <ProgressBar
          value={state.me?.progress ?? 0}
          max={100}
          tone={solved ? 'success' : 'primary'}
          label={`Circuits connected: ${state.me?.progress ?? 0}%`}
        />
      </div>

      <div
        className="mx-auto grid w-full max-w-[min(94vw,28rem)] gap-0.5 rounded-2xl border border-white/10 bg-slate-950/70 p-2"
        style={{ gridTemplateColumns: `repeat(${state.cols}, minmax(0, 1fr))` }}
        role="grid"
        aria-label="Circuit board"
      >
        {state.board.map((tile) => {
          const interactive = canRotate && !tile.fixed && tile.kind !== 'empty' && tile.kind !== 'blocker';
          return (
            <motion.button
              key={tile.id}
              type="button"
              disabled={!canRotate}
              onClick={() => rotate(tile)}
              // The mask already reflects the rotation; animate for feel only.
              animate={{ rotate: 0 }}
              whileTap={interactive ? { scale: 0.88 } : undefined}
              aria-label={
                tile.kind === 'source'
                  ? `Power source, circuit ${(tile.circuit ?? 0) + 1}`
                  : tile.kind === 'bulb'
                    ? `Bulb, circuit ${(tile.circuit ?? 0) + 1}${tile.lit ? ', lit' : ', unlit'}`
                    : tile.kind === 'blocker'
                      ? 'Blocked cell'
                      : interactive
                        ? `Rotate wire at ${tile.x + 1},${tile.y + 1}`
                        : 'Empty cell'
              }
              className={cn(
                'relative grid aspect-square place-items-center rounded transition',
                tile.kind === 'empty' ? 'bg-transparent' : 'bg-white/[0.04]',
                interactive && 'hover:bg-white/10 active:scale-95',
                tile.lit && 'bg-white/10',
              )}
            >
              <TileArt tile={tile} />
            </motion.button>
          );
        })}
      </div>

      {solved ? (
        <p className="text-center text-sm text-emerald-300">
          All circuits connected — waiting for the other players…
        </p>
      ) : null}

      {/* Opponent progress — percentage only, never their board. */}
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

      <p className="text-center text-xs text-slate-500">
        Two tiles only connect when both open toward each other. Sources and bulbs cannot be rotated.
      </p>
    </div>
  );
}

export const fuseClient: ClientGameModule = {
  metadata: FUSE_METADATA,
  Component: FuseGame as unknown as ComponentType<GameComponentProps<never>>,
};
