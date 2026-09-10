import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { motion } from 'framer-motion';
import { HelpCircle } from 'lucide-react';
import { UNO_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { HowToPlayModal, useHowToPlay } from '../../components/game/HowToPlayModal';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { cn } from '../../utils/cn';

type UnoColor = 'red' | 'yellow' | 'green' | 'blue';
type UnoCardColor = UnoColor | 'wild';

interface UnoCard {
  id: string;
  color: UnoCardColor;
  value: string;
}

export interface UnoPublicState {
  phase: 'idle' | 'playing' | 'round-over' | 'finished';
  round: number;
  totalRounds: number;
  targetScore: number;
  topCard: UnoCard | null;
  activeColor: UnoColor;
  direction: 1 | -1;
  drawPileCount: number;
  discardPileCount: number;
  pendingDraw: number;
  currentPlayerId: string | null;
  isMyTurn: boolean;
  mustPlayDrawnCard: string | null;
  turnEndsAt: number | null;
  roundWinnerId: string | null;
  matchWinnerId: string | null;
  lastEvent: string | null;
  lastPlayed: { cardId: string; playerId: string } | null;
  finishReason: string | null;
  serverTime: number;
  myHand: UnoCard[];
  playableIds: string[];
  players: Record<
    string,
    {
      cardCount: number;
      score: number;
      roundsWon: number;
      cardsPlayed: number;
      uno: boolean;
      disconnected: boolean;
    }
  >;
}

/** Original CSS card styling — no proprietary artwork. */
const COLOR_CLASS: Record<UnoCardColor, string> = {
  red: 'bg-gradient-to-br from-rose-500 to-rose-700 border-rose-300',
  yellow: 'bg-gradient-to-br from-amber-400 to-amber-600 border-amber-200',
  green: 'bg-gradient-to-br from-emerald-500 to-emerald-700 border-emerald-300',
  blue: 'bg-gradient-to-br from-sky-500 to-sky-700 border-sky-300',
  wild: 'bg-gradient-to-br from-slate-700 to-slate-900 border-slate-400',
};

const SWATCH: Record<UnoColor, string> = {
  red: 'bg-rose-500',
  yellow: 'bg-amber-400',
  green: 'bg-emerald-500',
  blue: 'bg-sky-500',
};

const LABEL: Record<string, string> = {
  skip: '⊘',
  reverse: '⇄',
  'draw-two': '+2',
  wild: '★',
  'wild-draw-four': '+4',
};

const COLORS: UnoColor[] = ['red', 'yellow', 'green', 'blue'];

function CardFace({ card, small = false }: { card: UnoCard; small?: boolean }) {
  return (
    <div
      className={cn(
        'grid place-items-center rounded-lg border-2 font-black text-white shadow',
        COLOR_CLASS[card.color],
        small ? 'h-14 w-10 text-base' : 'h-20 w-14 text-xl',
      )}
    >
      {LABEL[card.value] ?? card.value}
    </div>
  );
}

function UnoGame({ state, players, myPlayerId, sendAction, play, vibrate }: GameComponentProps<UnoPublicState>) {
  const previousEvent = useRef<string | null>(null);
  const rules = useHowToPlay(UNO_METADATA.id);
  const [wildCardId, setWildCardId] = useState<string | null>(null);

  const phase = state?.phase ?? 'idle';
  const canAct = phase === 'playing' && Boolean(state?.isMyTurn);
  // Memoised so the play callback keeps a stable identity between renders.
  const playable = useMemo(() => new Set(state?.playableIds ?? []), [state?.playableIds]);

  const playCard = useCallback(
    (card: UnoCard) => {
      if (!canAct || !playable.has(card.id)) {
        if (canAct) {
          play('wrong');
          vibrate('error');
        }
        return;
      }
      // A wild needs a colour choice first.
      if (card.color === 'wild') {
        setWildCardId(card.id);
        return;
      }
      sendAction({ type: 'play', payload: { cardId: card.id } } satisfies GameAction);
      vibrate('buttonPress');
    },
    [canAct, playable, sendAction, play, vibrate],
  );

  const chooseColor = useCallback(
    (color: UnoColor) => {
      if (!wildCardId) return;
      sendAction({ type: 'play', payload: { cardId: wildCardId, color } } satisfies GameAction);
      setWildCardId(null);
      vibrate('success');
    },
    [wildCardId, sendAction, vibrate],
  );

  const draw = useCallback(() => {
    if (!canAct) return;
    sendAction({ type: 'draw' } satisfies GameAction);
    vibrate('buttonPress');
  }, [canAct, sendAction, vibrate]);

  const pass = useCallback(() => {
    if (!canAct) return;
    sendAction({ type: 'pass' } satisfies GameAction);
  }, [canAct, sendAction]);

  useEffect(() => {
    const event = state?.lastEvent ?? null;
    if (event === previousEvent.current) return;
    previousEvent.current = event;
    if (!event) return;
    const mine = myPlayerId ? event.includes(myPlayerId) : false;
    if (event.startsWith('play:')) play('click');
    else if (event.startsWith('draw:')) play('click');
    else if (event.startsWith('forced-draw:')) {
      play('wrong');
      if (mine) vibrate('error');
    } else if (event.startsWith('uno:')) {
      play('correct');
      if (mine) vibrate('success');
    } else if (event.startsWith('round-win:')) {
      play(mine ? 'victory' : 'notification');
      if (mine) vibrate('victory');
    } else if (event.startsWith('deal:')) play('gameStart');
    else if (event === 'finished') play('gameOver');
  }, [state?.lastEvent, myPlayerId, play, vibrate]);

  if (phase === 'idle' || !state) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Shuffling the deck…</p>
        </div>
      </div>
    );
  }

  const currentPlayer = players.find((player) => player.id === state.currentPlayerId);
  const mustPlayDrawn = Boolean(state.mustPlayDrawnCard);

  return (
    <div className="space-y-4">
      <HowToPlayModal game={UNO_METADATA} open={rules.open} onClose={rules.close} />

      {/* Wild colour picker — the server validates the choice regardless. */}
      <Modal
        open={wildCardId !== null}
        onClose={() => setWildCardId(null)}
        title="Choose a colour"
        description="Your wild card sets the next colour."
        size="sm"
      >
        <div className="grid grid-cols-2 gap-3">
          {COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => chooseColor(color)}
              aria-label={`Choose ${color}`}
              className={cn(
                'h-20 rounded-xl border-2 border-white/30 text-lg font-bold capitalize text-white transition active:scale-95',
                SWATCH[color],
              )}
            >
              {color}
            </button>
          ))}
        </div>
      </Modal>

      <GameHUD
        players={players.map((player) => ({
          ...player,
          score: state.players?.[player.id]?.score ?? 0,
        }))}
        myPlayerId={myPlayerId}
        deadline={state.turnEndsAt ?? null}
        label="Turn"
      />

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Badge tone={state.isMyTurn ? 'success' : 'default'}>
          {state.isMyTurn ? 'Your turn' : currentPlayer ? `${currentPlayer.nickname}'s turn` : 'Waiting'}
        </Badge>
        <Badge tone="primary">
          Round {Math.min(state.round + 1, state.totalRounds)}/{state.totalRounds}
        </Badge>
        <Badge tone="default">{state.direction === 1 ? 'Order ↻' : 'Order ↺'}</Badge>
        {state.pendingDraw > 0 ? <Badge tone="danger">+{state.pendingDraw} pending</Badge> : null}
        <button
          type="button"
          onClick={rules.show}
          aria-label="How to play"
          className="rounded-full border border-white/10 p-1.5 text-slate-400 transition hover:text-white"
        >
          <HelpCircle className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {/* Opponents — card COUNTS only, never faces. */}
      <div className="flex flex-wrap justify-center gap-3">
        {players
          .filter((player) => player.id !== myPlayerId)
          .map((player) => {
            const slot = state.players?.[player.id];
            if (!slot) return null;
            return (
              <div
                key={player.id}
                className={cn(
                  'rounded-xl border px-3 py-2 text-center text-xs',
                  state.currentPlayerId === player.id
                    ? 'border-emerald-400/60 bg-emerald-500/10'
                    : 'border-white/10 bg-white/5',
                )}
              >
                <p className="font-medium text-slate-200">{player.nickname}</p>
                <div className="mt-1 flex items-center justify-center gap-1">
                  {Array.from({ length: Math.min(slot.cardCount, 7) }, (_unused, index) => (
                    <span key={index} className="h-6 w-4 rounded-sm border border-slate-500 bg-slate-700" />
                  ))}
                </div>
                <p className="mt-1 text-slate-400">
                  {slot.cardCount} cards{slot.uno ? ' · UNO!' : ''}
                  {slot.disconnected ? ' · offline' : ''}
                </p>
              </div>
            );
          })}
      </div>

      {/* Table: draw pile, discard, active colour */}
      <div className="flex items-center justify-center gap-6">
        <button
          type="button"
          onClick={draw}
          disabled={!canAct || mustPlayDrawn}
          aria-label="Draw a card"
          className="grid h-20 w-14 place-items-center rounded-lg border-2 border-slate-400 bg-slate-700 text-xs font-bold text-slate-200 transition active:scale-95 disabled:opacity-40"
        >
          {state.drawPileCount}
        </button>

        <div className="text-center">
          {state.topCard ? <CardFace card={state.topCard} /> : null}
          <div className="mt-2 flex items-center justify-center gap-1.5">
            <span className={cn('h-3 w-3 rounded-full', SWATCH[state.activeColor])} aria-hidden />
            <span className="text-xs capitalize text-slate-400">{state.activeColor}</span>
          </div>
        </div>
      </div>

      {mustPlayDrawn ? (
        <div className="flex justify-center gap-2">
          <p className="self-center text-xs text-amber-300">You drew a playable card.</p>
          <Button variant="ghost" onClick={pass}>
            Keep it &amp; pass
          </Button>
        </div>
      ) : null}

      {/* Your hand */}
      <div className="card p-3">
        <p className="mb-2 text-xs uppercase tracking-wide text-slate-400">
          Your hand ({state.myHand.length})
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {state.myHand.map((card) => {
            const legal = playable.has(card.id);
            return (
              <motion.button
                key={card.id}
                type="button"
                layout
                whileTap={legal && canAct ? { scale: 0.92 } : undefined}
                whileHover={legal && canAct ? { y: -8 } : undefined}
                disabled={!canAct}
                onClick={() => playCard(card)}
                aria-label={`${card.color} ${card.value}${legal ? ', playable' : ''}`}
                className={cn(
                  'rounded-lg transition',
                  legal && canAct
                    ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900'
                    : canAct
                      ? 'opacity-45'
                      : '',
                )}
              >
                <CardFace card={card} />
              </motion.button>
            );
          })}
        </div>
      </div>

      {phase === 'round-over' || phase === 'finished' ? (
        <div className="card space-y-1 p-4 text-center">
          <p className="text-lg font-semibold text-white">
            {phase === 'finished'
              ? state.matchWinnerId === myPlayerId
                ? 'You win the match!'
                : `${players.find((p) => p.id === state.matchWinnerId)?.nickname ?? 'Nobody'} wins the match`
              : `${players.find((p) => p.id === state.roundWinnerId)?.nickname ?? 'Someone'} won the round`}
          </p>
          <p className="text-xs text-slate-400">
            {players
              .map((player) => `${player.nickname}: ${state.players?.[player.id]?.score ?? 0}`)
              .join(' · ')}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export const unoClient: ClientGameModule = {
  metadata: UNO_METADATA,
  Component: UnoGame as unknown as ComponentType<GameComponentProps<never>>,
};
