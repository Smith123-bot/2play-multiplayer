import { useMemo, type ComponentType } from 'react';
import { motion } from 'framer-motion';
import { Brain } from 'lucide-react';
import { MEMORY_MATCH_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

export interface MemoryCardView {
  id: number;
  symbol: string | null;
  matchedBy: string | null;
  revealed: boolean;
}

export interface MemoryMatchPublicState {
  cols: number;
  rows: number;
  phase: 'idle' | 'playing' | 'resolving' | 'finished';
  currentPlayerId: string | null;
  turnOrder: string[];
  pairs: Record<string, number>;
  attempts: Record<string, number>;
  totalPairs: number;
  matchedPairs: number;
  selection: number[];
  lastEvent: string | null;
  serverTime: number;
  cards: MemoryCardView[];
}

function MemoryMatchGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<MemoryMatchPublicState>) {
  const cards = state?.cards ?? [];
  const isMyTurn = state?.currentPlayerId === myPlayerId;
  const resolving = state?.phase === 'resolving';
  const currentPlayer = players.find((player) => player.id === state?.currentPlayerId);

  const gridStyle = useMemo(
    () => ({ gridTemplateColumns: `repeat(${state?.cols ?? 4}, minmax(0, 1fr))` }),
    [state?.cols],
  );

  const flip = (cardId: number) => {
    if (!isMyTurn || resolving) return;
    sendAction({ type: 'flip', payload: { cardId } } satisfies GameAction);
    play('click');
    vibrate('buttonPress');
  };

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({
          ...player,
          score: state?.pairs?.[player.id] ?? player.score,
        }))}
        myPlayerId={myPlayerId}
        currentTurnPlayerId={state?.currentPlayerId ?? null}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge tone="primary">
          Pairs found {state?.matchedPairs ?? 0}/{state?.totalPairs ?? 0}
        </Badge>
        <Badge tone={isMyTurn ? 'success' : 'default'}>
          {isMyTurn ? 'Your turn' : currentPlayer ? `${currentPlayer.nickname}'s turn` : 'Waiting'}
        </Badge>
      </div>

      <div className="grid gap-2 sm:gap-3" style={gridStyle}>
        {cards.map((card) => {
          const matched = card.matchedBy !== null;
          const owner = players.find((player) => player.id === card.matchedBy);
          return (
            <motion.button
              key={card.id}
              type="button"
              onClick={() => flip(card.id)}
              disabled={matched || !isMyTurn || resolving}
              whileTap={matched || !isMyTurn ? undefined : { scale: 0.94 }}
              aria-label={card.revealed ? `Card ${card.symbol ?? ''}` : 'Hidden card'}
              className={cn(
                'relative grid aspect-square min-h-touch place-items-center rounded-xl border text-2xl transition-colors sm:text-3xl',
                matched
                  ? 'border-success/40 bg-success/10'
                  : card.revealed
                    ? 'border-primary-400 bg-primary-500/20'
                    : 'border-white/10 bg-white/[0.05] hover:border-primary-300/60 hover:bg-white/10',
                !isMyTurn && !matched && 'cursor-not-allowed opacity-90',
              )}
            >
              <motion.span
                initial={false}
                animate={{ rotateY: card.revealed ? 0 : 180, opacity: card.revealed ? 1 : 0.35 }}
                transition={{ duration: 0.25 }}
                aria-hidden
              >
                {card.revealed ? card.symbol : <Brain className="h-5 w-5 text-slate-500" />}
              </motion.span>
              {matched && owner ? (
                <span
                  className="absolute bottom-1 right-1 rounded bg-black/40 px-1 text-[10px] text-slate-200"
                  title={owner.nickname}
                >
                  {owner.avatar}
                </span>
              ) : null}
            </motion.button>
          );
        })}
      </div>

      <p className="text-center text-xs text-slate-500">
        Hidden cards are never sent to your browser — the server only reveals what you flipped.
      </p>
    </div>
  );
}

export const memoryMatchClient: ClientGameModule = {
  metadata: MEMORY_MATCH_METADATA,
  Component: MemoryMatchGame as unknown as ComponentType<GameComponentProps<never>>,
};
