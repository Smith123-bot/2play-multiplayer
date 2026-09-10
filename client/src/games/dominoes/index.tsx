import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { motion } from 'framer-motion';
import { HelpCircle } from 'lucide-react';
import { DOMINOES_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { HowToPlayModal, useHowToPlay } from '../../components/game/HowToPlayModal';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { cn } from '../../utils/cn';

type ChainEnd = 'left' | 'right';

interface DominoTile {
  id: string;
  a: number;
  b: number;
}

interface PlacedTile {
  id: string;
  left: number;
  right: number;
  playedBy: string;
  flipped: boolean;
}

export interface DominoPublicState {
  phase: 'idle' | 'playing' | 'finished';
  chain: PlacedTile[];
  openEnds: { left: number; right: number } | null;
  boneyardCount: number;
  currentPlayerId: string | null;
  isMyTurn: boolean;
  canDraw: boolean;
  canPass: boolean;
  moves: number;
  lastMove: { tileId: string; playerId: string; end: ChainEnd } | null;
  winnerId: string | null;
  isDraw: boolean;
  blocked: boolean;
  turnEndsAt: number | null;
  finishReason: string | null;
  lastEvent: string | null;
  serverTime: number;
  myHand: DominoTile[];
  playable: Array<{ tileId: string; left: boolean; right: boolean }>;
  players: Record<
    string,
    { tileCount: number; score: number; tilesPlayed: number; handsWon: number; disconnected: boolean }
  >;
}

/** Pip layout for one half of a tile (3x3 grid positions). */
const PIPS: Record<number, Array<[number, number]>> = {
  0: [],
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

function Half({ value, size = 22 }: { value: number; size?: number }) {
  return (
    <div className="grid grid-cols-3 grid-rows-3 gap-[1px] p-[3px]" style={{ width: size, height: size }}>
      {Array.from({ length: 9 }, (_unused, index) => {
        const col = index % 3;
        const row = Math.floor(index / 3);
        const on = (PIPS[value] ?? []).some(([px, py]) => px === col && py === row);
        return <span key={index} className={cn('rounded-full', on ? 'bg-slate-900' : 'bg-transparent')} />;
      })}
    </div>
  );
}

/** A tile rendered horizontally (chain) or vertically (hand). */
function Tile({
  a,
  b,
  vertical = false,
  size = 22,
}: {
  a: number;
  b: number;
  vertical?: boolean;
  size?: number;
}) {
  return (
    <div
      className={cn(
        'flex items-center rounded-md border-2 border-slate-400 bg-slate-100 shadow-sm',
        vertical ? 'flex-col divide-y-2' : 'flex-row divide-x-2',
        'divide-slate-400',
      )}
    >
      <Half value={a} size={size} />
      <Half value={b} size={size} />
    </div>
  );
}

function DominoesGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<DominoPublicState>) {
  const previousEvent = useRef<string | null>(null);
  const rules = useHowToPlay(DOMINOES_METADATA.id);
  const [selected, setSelected] = useState<string | null>(null);

  const phase = state?.phase ?? 'idle';
  const canAct = phase === 'playing' && Boolean(state?.isMyTurn);

  const legality = useMemo(() => {
    const map = new Map<string, { left: boolean; right: boolean }>();
    for (const entry of state?.playable ?? []) map.set(entry.tileId, { left: entry.left, right: entry.right });
    return map;
  }, [state?.playable]);

  const selectTile = useCallback(
    (tileId: string) => {
      if (!canAct) return;
      const legal = legality.get(tileId);
      if (!legal) {
        play('wrong');
        vibrate('error');
        return;
      }
      // Only one legal end? Place it straight away.
      if (legal.left !== legal.right) {
        const end: ChainEnd = legal.left ? 'left' : 'right';
        sendAction({ type: 'place', payload: { tileId, end } } satisfies GameAction);
        setSelected(null);
        vibrate('buttonPress');
        return;
      }
      setSelected(tileId === selected ? null : tileId);
      play('click');
    },
    [canAct, legality, selected, sendAction, play, vibrate],
  );

  const placeOn = useCallback(
    (end: ChainEnd) => {
      if (!canAct || !selected) return;
      const legal = legality.get(selected);
      if (!legal || !legal[end]) {
        play('wrong');
        vibrate('error');
        return;
      }
      sendAction({ type: 'place', payload: { tileId: selected, end } } satisfies GameAction);
      setSelected(null);
      vibrate('buttonPress');
    },
    [canAct, selected, legality, sendAction, play, vibrate],
  );

  const draw = useCallback(() => {
    if (!state?.canDraw) return;
    sendAction({ type: 'draw' } satisfies GameAction);
    vibrate('buttonPress');
  }, [state?.canDraw, sendAction, vibrate]);

  const pass = useCallback(() => {
    if (!state?.canPass) return;
    sendAction({ type: 'pass' } satisfies GameAction);
  }, [state?.canPass, sendAction]);

  useEffect(() => {
    const event = state?.lastEvent ?? null;
    if (event === previousEvent.current) return;
    previousEvent.current = event;
    if (!event) return;
    const mine = myPlayerId ? event.includes(myPlayerId) : false;
    if (event.startsWith('place:')) play('click');
    else if (event.startsWith('draw:')) play('click');
    else if (event.startsWith('pass:') || event.startsWith('timeout-pass:')) play('notification');
    else if (event.startsWith('domino:')) {
      play(mine ? 'victory' : 'defeat');
      vibrate(mine ? 'victory' : 'defeat');
    } else if (event.startsWith('blocked-win:')) {
      play(mine ? 'victory' : 'gameOver');
    } else if (event === 'blocked-draw') play('draw');
    else if (event === 'deal') play('gameStart');
  }, [state?.lastEvent, myPlayerId, play, vibrate]);

  if (phase === 'idle' || !state) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Shuffling the tiles…</p>
        </div>
      </div>
    );
  }

  const currentPlayer = players.find((player) => player.id === state.currentPlayerId);
  const selectedLegal = selected ? legality.get(selected) : undefined;

  return (
    <div className="space-y-4">
      <HowToPlayModal game={DOMINOES_METADATA} open={rules.open} onClose={rules.close} />

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
          {phase === 'finished'
            ? state.isDraw
              ? 'Draw'
              : state.winnerId === myPlayerId
                ? 'You win!'
                : 'You lost'
            : state.isMyTurn
              ? 'Your turn'
              : currentPlayer
                ? `${currentPlayer.nickname}'s turn`
                : 'Waiting'}
        </Badge>
        <Badge tone="default">Boneyard {state.boneyardCount}</Badge>
        {state.openEnds ? (
          <Badge tone="primary">
            Ends {state.openEnds.left} / {state.openEnds.right}
          </Badge>
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

      {/* Opponents — tile COUNTS only, never faces. */}
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
                <div className="mt-1 flex items-center justify-center gap-0.5">
                  {Array.from({ length: Math.min(slot.tileCount, 8) }, (_unused, index) => (
                    <span key={index} className="h-6 w-3 rounded-sm border border-slate-500 bg-slate-700" />
                  ))}
                </div>
                <p className="mt-1 text-slate-400">
                  {slot.tileCount} tiles{slot.disconnected ? ' · offline' : ''}
                </p>
              </div>
            );
          })}
      </div>

      {/* The chain */}
      <div className="rounded-2xl border border-white/10 bg-emerald-950/40 p-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {selectedLegal?.left ? (
            <button
              type="button"
              onClick={() => placeOn('left')}
              aria-label="Place on the left end"
              className="shrink-0 rounded-lg border-2 border-dashed border-emerald-400 px-2 py-4 text-xs font-bold text-emerald-300"
            >
              ◀ place
            </button>
          ) : null}

          {state.chain.length === 0 ? (
            <p className="w-full py-6 text-center text-xs text-slate-500">
              The chain is empty — the opening tile starts it.
            </p>
          ) : (
            state.chain.map((tile) => (
              <motion.div
                key={tile.id}
                layout
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 320, damping: 24 }}
                className={cn('shrink-0', state.lastMove?.tileId === tile.id && 'ring-2 ring-amber-300 rounded-md')}
              >
                <Tile a={tile.left} b={tile.right} size={20} />
              </motion.div>
            ))
          )}

          {selectedLegal?.right ? (
            <button
              type="button"
              onClick={() => placeOn('right')}
              aria-label="Place on the right end"
              className="shrink-0 rounded-lg border-2 border-dashed border-emerald-400 px-2 py-4 text-xs font-bold text-emerald-300"
            >
              place ▶
            </button>
          ) : null}
        </div>
      </div>

      {selected && selectedLegal?.left && selectedLegal?.right ? (
        <p className="text-center text-xs text-amber-300">That tile fits both ends — choose one.</p>
      ) : null}

      {/* Your hand */}
      <div className="card p-3">
        <p className="mb-2 text-xs uppercase tracking-wide text-slate-400">
          Your tiles ({state.myHand.length})
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {state.myHand.map((tile) => {
            const legal = legality.has(tile.id);
            return (
              <motion.button
                key={tile.id}
                type="button"
                layout
                whileTap={canAct && legal ? { scale: 0.92 } : undefined}
                disabled={!canAct}
                onClick={() => selectTile(tile.id)}
                aria-label={`Tile ${tile.a} ${tile.b}${legal ? ', playable' : ''}`}
                className={cn(
                  'rounded-md transition',
                  selected === tile.id && 'ring-2 ring-white ring-offset-2 ring-offset-slate-900',
                  canAct && legal && selected !== tile.id && 'ring-2 ring-emerald-400',
                  canAct && !legal && 'opacity-40',
                )}
              >
                <Tile a={tile.a} b={tile.b} vertical size={22} />
              </motion.button>
            );
          })}
        </div>
      </div>

      {state.canDraw || state.canPass ? (
        <div className="flex justify-center gap-2">
          {state.canDraw ? <Button onClick={draw}>Draw from boneyard</Button> : null}
          {state.canPass ? (
            <Button variant="ghost" onClick={pass}>
              Pass (no legal tile)
            </Button>
          ) : null}
        </div>
      ) : null}

      {phase === 'finished' ? (
        <div className="card space-y-1 p-4 text-center">
          <p className="text-lg font-semibold text-white">
            {state.isDraw
              ? 'Blocked — equal pips, it is a draw'
              : `${players.find((p) => p.id === state.winnerId)?.nickname ?? 'Someone'} wins${state.blocked ? ' the blocked hand' : ''}`}
          </p>
          <p className="text-xs text-slate-400">
            {state.moves} tiles played ·{' '}
            {players.map((p) => `${p.nickname}: ${state.players?.[p.id]?.score ?? 0}`).join(' · ')}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export const dominoesClient: ClientGameModule = {
  metadata: DOMINOES_METADATA,
  Component: DominoesGame as unknown as ComponentType<GameComponentProps<never>>,
};
