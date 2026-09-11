import { useCallback, useEffect, useMemo, useRef, type ComponentType } from 'react';
import { motion } from 'framer-motion';
import { HelpCircle } from 'lucide-react';
import { SIM_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { HowToPlayModal, useHowToPlay } from '../../components/game/HowToPlayModal';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

interface SimEdgeView {
  id: string;
  a: number;
  b: number;
  owner: string | null;
}

export interface SimPublicState {
  phase: 'idle' | 'playing' | 'finished';
  nodes: number;
  edges: SimEdgeView[];
  currentPlayerId: string | null;
  isMyTurn: boolean;
  mySeat: number | null;
  moves: number;
  lastMove: { edgeId: string; playerId: string } | null;
  losingTriangle: string[];
  loserId: string | null;
  winnerId: string | null;
  isDraw: boolean;
  turnEndsAt: number | null;
  finishReason: string | null;
  lastEvent: string | null;
  serverTime: number;
  players: Record<string, { seat: number; edges: number; disconnected: boolean }>;
}

const SEAT_COLOR = ['#f43f5e', '#3b82f6'];
const VIEW = 320;
const RADIUS = 128;
const CENTER = VIEW / 2;

/** Six nodes evenly spaced on a circle, starting at the top. */
function nodePoint(index: number, total: number): { x: number; y: number } {
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
  return { x: CENTER + RADIUS * Math.cos(angle), y: CENTER + RADIUS * Math.sin(angle) };
}

function SimGame({ state, players, myPlayerId, sendAction, play, vibrate }: GameComponentProps<SimPublicState>) {
  const previousEvent = useRef<string | null>(null);
  const rules = useHowToPlay(SIM_METADATA.id);

  const phase = state?.phase ?? 'idle';
  const canPlay = phase === 'playing' && Boolean(state?.isMyTurn);

  const claim = useCallback(
    (edge: SimEdgeView) => {
      if (!canPlay) return;
      if (edge.owner !== null) {
        play('wrong');
        vibrate('error');
        return;
      }
      sendAction({ type: 'claim', payload: { edgeId: edge.id } } satisfies GameAction);
      vibrate('buttonPress');
    },
    [canPlay, sendAction, play, vibrate],
  );

  useEffect(() => {
    const event = state?.lastEvent ?? null;
    if (event === previousEvent.current) return;
    previousEvent.current = event;
    if (!event) return;
    const mine = myPlayerId ? event.includes(myPlayerId) : false;
    if (event.startsWith('claim:')) play('click');
    else if (event.startsWith('triangle:')) {
      // Whoever built the triangle just lost.
      play(mine ? 'defeat' : 'victory');
      vibrate(mine ? 'defeat' : 'victory');
    } else if (event === 'draw') play('draw');
    else if (event === 'start') play('gameStart');
  }, [state?.lastEvent, myPlayerId, play, vibrate]);

  /** Seat colour for an owner id. */
  const colorOf = useCallback(
    (owner: string | null): string => {
      if (!owner) return 'rgba(148,163,184,0.28)';
      const seat = state?.players?.[owner]?.seat ?? 0;
      return SEAT_COLOR[seat % SEAT_COLOR.length] as string;
    },
    [state?.players],
  );

  const points = useMemo(
    () => Array.from({ length: state?.nodes ?? 6 }, (_unused, index) => nodePoint(index, state?.nodes ?? 6)),
    [state?.nodes],
  );

  if (phase === 'idle' || !state?.edges?.length) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Drawing the board…</p>
        </div>
      </div>
    );
  }

  const currentPlayer = players.find((player) => player.id === state.currentPlayerId);
  const losing = new Set(state.losingTriangle);

  return (
    <div className="space-y-4">
      <HowToPlayModal game={SIM_METADATA} open={rules.open} onClose={rules.close} />

      <GameHUD
        players={players.map((player) => ({
          ...player,
          score: state.players?.[player.id]?.edges ?? 0,
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
        {state.mySeat !== null ? (
          <Badge tone="default">
            <span
              className="mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle"
              style={{ backgroundColor: SEAT_COLOR[state.mySeat % SEAT_COLOR.length] }}
              aria-hidden
            />
            Your colour
          </Badge>
        ) : null}
        <Badge tone="warning">Don&apos;t make a triangle!</Badge>
        <button
          type="button"
          onClick={rules.show}
          aria-label="How to play"
          className="rounded-full border border-white/10 p-1.5 text-slate-400 transition hover:text-white"
        >
          <HelpCircle className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="mx-auto w-full max-w-[min(92vw,26rem)]">
        <svg
          viewBox={`0 0 ${VIEW} ${VIEW}`}
          className="w-full touch-manipulation"
          role="grid"
          aria-label="Sim board: six nodes and fifteen edges"
        >
          {/* Edges first so nodes render on top. */}
          {state.edges.map((edge) => {
            const from = points[edge.a];
            const to = points[edge.b];
            if (!from || !to) return null;
            const free = edge.owner === null;
            const isLosing = losing.has(edge.id);
            const isLast = state.lastMove?.edgeId === edge.id;
            return (
              <g key={edge.id}>
                {/* Wide invisible hit area for comfortable tapping. */}
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke="transparent"
                  strokeWidth={22}
                  style={{ cursor: free && canPlay ? 'pointer' : 'default' }}
                  onClick={() => claim(edge)}
                  aria-label={
                    free ? `Claim line ${edge.a + 1} to ${edge.b + 1}` : `Line ${edge.a + 1} to ${edge.b + 1} taken`
                  }
                />
                <motion.line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={colorOf(edge.owner)}
                  strokeWidth={isLosing ? 8 : free ? 2 : 5}
                  strokeLinecap="round"
                  strokeDasharray={free ? '5 7' : undefined}
                  initial={isLast ? { pathLength: 0 } : false}
                  animate={{ pathLength: 1, opacity: isLosing ? 1 : 0.95 }}
                  transition={{ duration: 0.3 }}
                  className={cn(free && canPlay && 'hover:opacity-100', isLosing && 'animate-pulse')}
                  pointerEvents="none"
                />
              </g>
            );
          })}

          {points.map((point, index) => (
            <g key={index} pointerEvents="none">
              <circle cx={point.x} cy={point.y} r={13} fill="#0f172a" stroke="#94a3b8" strokeWidth={2.5} />
              <text
                x={point.x}
                y={point.y + 4}
                textAnchor="middle"
                fontSize={11}
                fontWeight="bold"
                fill="#cbd5e1"
              >
                {index + 1}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {phase === 'finished' ? (
        <div className="card space-y-1 p-4 text-center">
          <p className="text-lg font-semibold text-white">
            {state.isDraw
              ? 'Draw — every line claimed'
              : `${players.find((p) => p.id === state.loserId)?.nickname ?? 'A player'} made a triangle and lost`}
          </p>
          <p className="text-xs text-slate-400">
            {state.moves} lines claimed
            {state.losingTriangle.length > 0 ? ' · the losing triangle is highlighted' : ''}
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap justify-center gap-3 text-xs text-slate-400">
        {players.map((player) => {
          const slot = state.players?.[player.id];
          if (!slot) return null;
          return (
            <span key={player.id} className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: SEAT_COLOR[slot.seat % SEAT_COLOR.length] }}
                aria-hidden
              />
              {player.nickname}: {slot.edges} lines{slot.disconnected ? ' (offline)' : ''}
            </span>
          );
        })}
      </div>

      <p className="text-center text-xs text-slate-500">
        Three of <span className="font-semibold text-slate-300">your own</span> lines forming a triangle loses the
        game. Mixed-colour triangles are safe.
      </p>
    </div>
  );
}

export const simClient: ClientGameModule = {
  metadata: SIM_METADATA,
  Component: SimGame as unknown as ComponentType<GameComponentProps<never>>,
};
