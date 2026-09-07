import { useCallback, useEffect, useRef, type ComponentType } from 'react';
import { CHAIN_REACTION_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

export interface ChainNodeView {
  id: string;
  x: number;
  y: number;
  color: number;
  kind: 'normal' | 'bonus' | 'multiplier' | 'blocker' | 'arrow';
  arrow?: 'up' | 'down' | 'left' | 'right';
  alive: boolean;
}

export interface ChainReactionPublicState {
  phase: 'idle' | 'playing' | 'between' | 'finished';
  round: number;
  totalRounds: number;
  cols: number;
  rows: number;
  nodes: ChainNodeView[];
  lastChain: { playerId: string; length: number; score: number } | null;
  endsAt: number | null;
  finishReason: string | null;
  lastEvent: string | null;
  serverTime: number;
  players: Record<
    string,
    { score: number; roundScore: number; triggersLeft: number; lastChain: number; disconnected: boolean }
  >;
}

const PALETTE = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b'];
const ARROW = { up: '↑', down: '↓', left: '←', right: '→' };

function ChainReactionGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<ChainReactionPublicState>) {
  const previousEvent = useRef<string | null>(null);
  const phase = state?.phase ?? 'idle';
  const me = myPlayerId ? state?.players?.[myPlayerId] : undefined;
  const canTrigger = phase === 'playing' && Boolean(me) && (me?.triggersLeft ?? 0) > 0 && !me?.disconnected;

  const trigger = useCallback(
    (nodeId: string) => {
      if (!canTrigger) return;
      sendAction({ type: 'TRIGGER_NODE', payload: { nodeId } } satisfies GameAction);
      play('click');
      vibrate('buttonPress');
    },
    [canTrigger, sendAction, play, vibrate],
  );

  useEffect(() => {
    const lastEvent = state?.lastEvent ?? null;
    if (lastEvent === previousEvent.current) return;
    previousEvent.current = lastEvent;
    if (!lastEvent) return;
    if (lastEvent.startsWith('chain:') && lastEvent.includes(myPlayerId ?? '')) {
      play('score');
      vibrate('success');
    } else if (lastEvent === 'round-start' || lastEvent === 'round-end') {
      play('notification');
    }
  }, [state?.lastEvent, myPlayerId, play, vibrate]);

  if (phase === 'idle' || !state?.nodes?.length) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Charging the cascade…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({ ...player, score: state.players?.[player.id]?.score ?? player.score }))}
        myPlayerId={myPlayerId}
        deadline={state.endsAt ?? null}
        label="Round clock"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary">
          Round {state.round + 1}/{state.totalRounds}
        </Badge>
        <Badge tone="accent">Triggers {me?.triggersLeft ?? 0}</Badge>
        {state.lastChain ? (
          <Badge tone="success">
            Chain {state.lastChain.length} · +{state.lastChain.score}
          </Badge>
        ) : null}
      </div>
      <div
        role="grid"
        aria-label="Chain reaction board"
        className="mx-auto grid w-full max-w-md gap-1.5"
        style={{ gridTemplateColumns: `repeat(${state.cols}, minmax(0, 1fr))` }}
      >
        {state.nodes.map((node) => {
          const label =
            node.kind === 'blocker'
              ? 'Blocker'
              : node.kind === 'bonus'
                ? 'Bonus'
                : node.kind === 'multiplier'
                  ? 'Multiplier'
                  : node.kind === 'arrow'
                    ? `Arrow ${node.arrow ?? ''}`
                    : `Colour ${node.color + 1}`;
          return (
            <button
              key={node.id}
              type="button"
              disabled={!canTrigger || !node.alive || node.kind === 'blocker'}
              aria-label={label}
              onClick={() => trigger(node.id)}
              className={cn(
                'flex aspect-square min-h-[48px] items-center justify-center rounded-xl border text-sm font-bold text-white transition active:scale-95 disabled:opacity-35',
                !node.alive && 'bg-slate-900 border-white/5',
                node.alive && node.kind === 'blocker' && 'border-slate-500 bg-slate-800',
                node.alive && node.kind !== 'blocker' && 'border-white/15',
              )}
              style={
                node.alive && node.kind !== 'blocker'
                  ? { backgroundColor: PALETTE[node.color % PALETTE.length] }
                  : undefined
              }
            >
              {node.kind === 'bonus' ? '+' : null}
              {node.kind === 'multiplier' ? '×' : null}
              {node.kind === 'blocker' ? '■' : null}
              {node.kind === 'arrow' ? ARROW[node.arrow ?? 'right'] : null}
            </button>
          );
        })}
      </div>
      <p className="text-center text-xs text-slate-500">
        Tap a node. The server owns the cascade, the length and the score — you never send a chain.
      </p>
    </div>
  );
}

export const chainReactionClient: ClientGameModule = {
  metadata: CHAIN_REACTION_METADATA,
  Component: ChainReactionGame as unknown as ComponentType<GameComponentProps<never>>,
};
