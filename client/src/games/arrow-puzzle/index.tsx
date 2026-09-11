import { useCallback, useEffect, useRef, type ComponentType } from 'react';
import { motion } from 'framer-motion';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Lightbulb } from 'lucide-react';
import { ARROW_PUZZLE_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { cn } from '../../utils/cn';

type Direction = 'up' | 'down' | 'left' | 'right';

interface BoardTile {
  id: string;
  x: number;
  y: number;
  direction: Direction;
  cleared: boolean;
  firable: boolean;
}

export interface ArrowPublicState {
  phase: 'idle' | 'playing' | 'finished';
  round: number;
  totalRounds: number;
  difficulty: 'easy' | 'medium' | 'hard' | 'expert';
  cols: number;
  rows: number;
  totalTiles: number;
  endsAt: number | null;
  roundMs: number;
  finishOrder: string[];
  lastEvent: string | null;
  finishReason: string | null;
  serverTime: number;
  board: BoardTile[];
  me: {
    cleared: number;
    mistakes: number;
    score: number;
    solved: boolean;
    hintsUsed: number;
    finishRank: number;
  } | null;
  players: Record<
    string,
    {
      cleared: number;
      total: number;
      score: number;
      solved: boolean;
      finishRank: number;
      mistakes: number;
      disconnected: boolean;
    }
  >;
}

const ICON: Record<Direction, typeof ArrowUp> = {
  up: ArrowUp,
  down: ArrowDown,
  left: ArrowLeft,
  right: ArrowRight,
};

const DIFFICULTY_TONE: Record<string, 'success' | 'primary' | 'warning' | 'danger'> = {
  easy: 'success',
  medium: 'primary',
  hard: 'warning',
  expert: 'danger',
};

function ArrowPuzzleGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<ArrowPublicState>) {
  const previousEvent = useRef<string | null>(null);
  const hintRef = useRef<string | null>(null);

  const phase = state?.phase ?? 'idle';
  const me = state?.me ?? null;
  const playing = phase === 'playing' && Boolean(me) && !me?.solved;

  const fire = useCallback(
    (tileId: string) => {
      if (!playing) return;
      sendAction({ type: 'fire', payload: { tileId } } satisfies GameAction);
      vibrate('buttonPress');
    },
    [playing, sendAction, vibrate],
  );

  const askHint = useCallback(() => {
    if (!playing) return;
    sendAction({ type: 'hint' } satisfies GameAction);
    play('click');
  }, [playing, sendAction, play]);

  useEffect(() => {
    const event = state?.lastEvent ?? null;
    if (event === previousEvent.current) return;
    previousEvent.current = event;
    if (!event) return;
    const mine = myPlayerId ? event.includes(myPlayerId) : false;
    if (event.startsWith('clear:')) {
      if (mine) {
        play('correct');
        vibrate('success');
      }
    } else if (event.startsWith('blocked:')) {
      if (mine) {
        play('wrong');
        vibrate('error');
      }
    } else if (event.startsWith('solved:')) {
      play(mine ? 'victory' : 'notification');
      if (mine) vibrate('victory');
    } else if (event.startsWith('hint:')) {
      const parts = event.split(':');
      hintRef.current = parts[2] ?? null;
      play('notification');
    } else if (event.startsWith('round:')) {
      hintRef.current = null;
      play('gameStart');
    }
  }, [state?.lastEvent, myPlayerId, play, vibrate]);

  if (phase === 'idle' || !state?.board?.length) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Generating the board…</p>
        </div>
      </div>
    );
  }

  const cleared = me?.cleared ?? 0;
  const total = state.totalTiles;

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({
          ...player,
          score: state.players?.[player.id]?.score ?? player.score,
        }))}
        myPlayerId={myPlayerId}
        deadline={state.endsAt ?? null}
        label="Round clock"
      />

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Badge tone="primary">
          Round {Math.min(state.round + 1, state.totalRounds)}/{state.totalRounds}
        </Badge>
        <Badge tone={DIFFICULTY_TONE[state.difficulty] ?? 'default'}>{state.difficulty}</Badge>
        {me?.solved ? <Badge tone="success">Solved! #{me.finishRank}</Badge> : null}
        {me && me.mistakes > 0 ? <Badge tone="danger">{me.mistakes} blocked</Badge> : null}
      </div>

      <div className="card space-y-2 p-3">
        <ProgressBar value={cleared} max={Math.max(1, total)} label={`Cleared ${cleared}/${total}`} />
      </div>

      <div
        className="mx-auto grid w-full max-w-[min(92vw,26rem)] gap-1.5"
        style={{ gridTemplateColumns: `repeat(${state.cols}, minmax(0, 1fr))` }}
        role="grid"
        aria-label="Arrow puzzle board"
      >
        {Array.from({ length: state.cols * state.rows }, (_unused, index) => {
          const x = index % state.cols;
          const y = Math.floor(index / state.cols);
          const tile = state.board.find((entry) => entry.x === x && entry.y === y && !entry.cleared);
          if (!tile) {
            return <div key={`${x}:${y}`} className="aspect-square rounded-lg bg-white/[0.03]" />;
          }
          const Icon = ICON[tile.direction];
          const hinted = hintRef.current === tile.id;
          return (
            <motion.button
              key={tile.id}
              type="button"
              layout
              initial={{ scale: 1 }}
              whileTap={{ scale: 0.88 }}
              disabled={!playing}
              onClick={() => fire(tile.id)}
              aria-label={`Arrow pointing ${tile.direction}${tile.firable ? ', clear path' : ', blocked'}`}
              className={cn(
                'grid aspect-square place-items-center rounded-lg border transition',
                tile.firable
                  ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200'
                  : 'border-white/10 bg-white/5 text-slate-400',
                hinted && 'ring-2 ring-amber-300',
                playing && 'active:scale-95',
              )}
            >
              <Icon className="h-5 w-5" aria-hidden />
            </motion.button>
          );
        })}
      </div>

      <div className="flex justify-center">
        <Button variant="ghost" onClick={askHint} disabled={!playing} icon={<Lightbulb className="h-4 w-4" />}>
          Hint (−25)
        </Button>
      </div>

      <div className="flex flex-wrap justify-center gap-3 text-xs text-slate-400">
        {players.map((player) => {
          const slot = state.players?.[player.id];
          if (!slot) return null;
          return (
            <span key={player.id} className="flex items-center gap-1">
              {player.nickname}: {slot.cleared}/{slot.total}
              {slot.solved ? ' ✅' : ''}
              {slot.disconnected ? ' (offline)' : ''}
            </span>
          );
        })}
      </div>

      <p className="text-center text-xs text-slate-500">
        Green arrows have a clear path to the edge. Fire them to open the way for the rest.
      </p>
    </div>
  );
}

export const arrowPuzzleClient: ClientGameModule = {
  metadata: ARROW_PUZZLE_METADATA,
  Component: ArrowPuzzleGame as unknown as ComponentType<GameComponentProps<never>>,
};
