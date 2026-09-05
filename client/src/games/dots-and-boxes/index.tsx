import { useMemo, type ComponentType } from 'react';
import { DOTS_AND_BOXES_METADATA, type GameAction, type Player } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

export interface DotsAndBoxesPublicState {
  cols: number;
  rows: number;
  hLines: boolean[];
  vLines: boolean[];
  boxes: (string | null)[];
  scores: Record<string, number>;
  currentPlayerId: string | null;
  turnOrder: string[];
  phase: 'idle' | 'playing' | 'finished';
  moves: number;
  totalBoxes: number;
  claimedBoxes: number;
  lastMove: { orientation: 'h' | 'v'; row: number; col: number; playerId: string } | null;
  lastEvent: string | null;
  serverTime: number;
}

const PLAYER_COLORS = ['#6366f1', '#ec4899', '#10b981', '#f59e0b'];
const CELL = 64;
const PAD = 26;
const DOT = 6;
const HIT = 22;

function colorFor(players: Player[], playerId: string | null): string {
  if (!playerId) return 'rgba(148,163,184,0.55)';
  const index = players.findIndex((player) => player.id === playerId);
  return PLAYER_COLORS[(index < 0 ? 0 : index) % PLAYER_COLORS.length];
}

function DotsAndBoxesGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<DotsAndBoxesPublicState>) {
  const cols = state?.cols ?? 6;
  const rows = state?.rows ?? 6;
  const isMyTurn = state?.currentPlayerId === myPlayerId && state?.phase === 'playing';
  const currentPlayer = players.find((player) => player.id === state?.currentPlayerId);

  const { width, height } = useMemo(
    () => ({ width: (cols - 1) * CELL + PAD * 2, height: (rows - 1) * CELL + PAD * 2 }),
    [cols, rows],
  );

  const point = (row: number, col: number) => ({ x: PAD + col * CELL, y: PAD + row * CELL });

  const draw = (orientation: 'h' | 'v', row: number, col: number) => {
    if (!isMyTurn) return;
    sendAction({ type: 'draw', payload: { orientation, row, col } } satisfies GameAction);
    play('click');
    vibrate('buttonPress');
  };

  const hIndex = (row: number, col: number) => row * (cols - 1) + col;
  const vIndex = (row: number, col: number) => row * cols + col;

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({ ...player, score: state?.scores?.[player.id] ?? player.score }))}
        myPlayerId={myPlayerId}
        currentTurnPlayerId={state?.currentPlayerId ?? null}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge tone="primary">
          Boxes {state?.claimedBoxes ?? 0}/{state?.totalBoxes ?? 0}
        </Badge>
        <Badge tone={isMyTurn ? 'success' : 'default'}>
          {isMyTurn ? 'Your turn' : currentPlayer ? `${currentPlayer.nickname}'s turn` : 'Waiting'}
        </Badge>
      </div>

      <div className="card flex justify-center overflow-auto p-3">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-auto w-full max-w-[560px] touch-manipulation select-none"
          role="grid"
          aria-label="Dots and boxes board"
        >
          {/* Claimed boxes */}
          {Array.from({ length: Math.max(0, (rows - 1) * (cols - 1)) }, (_, index) => {
            const row = Math.floor(index / (cols - 1));
            const col = index % (cols - 1);
            const owner = state?.boxes?.[index] ?? null;
            if (!owner) return null;
            const topLeft = point(row, col);
            return (
              <rect
                key={`box-${index}`}
                x={topLeft.x + 5}
                y={topLeft.y + 5}
                width={CELL - 10}
                height={CELL - 10}
                rx={8}
                fill={colorFor(players, owner)}
                opacity={0.32}
              />
            );
          })}

          {/* Horizontal line slots */}
          {Array.from({ length: rows }, (_, row) =>
            Array.from({ length: Math.max(0, cols - 1) }, (_, col) => {
              const index = hIndex(row, col);
              const drawn = state?.hLines?.[index] ?? false;
              const from = point(row, col);
              const to = point(row, col + 1);
              return (
                <g key={`h-${row}-${col}`} className="group">
                  <line
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke={drawn ? '#a5b4fc' : 'transparent'}
                    strokeWidth={drawn ? 6 : 5}
                    strokeLinecap="round"
                  />
                  {!drawn ? (
                    <line
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke="#6366f1"
                      strokeWidth={6}
                      strokeLinecap="round"
                      className="opacity-0 transition-opacity group-hover:opacity-40"
                    />
                  ) : null}
                  <rect
                    x={from.x + DOT}
                    y={from.y - HIT / 2}
                    width={CELL - DOT * 2}
                    height={HIT}
                    fill="transparent"
                    className={cn(isMyTurn && !drawn && 'cursor-pointer')}
                    onClick={() => draw('h', row, col)}
                    aria-label={drawn ? undefined : `Draw horizontal line row ${row + 1} position ${col + 1}`}
                  />
                </g>
              );
            }),
          )}

          {/* Vertical line slots */}
          {Array.from({ length: Math.max(0, rows - 1) }, (_, row) =>
            Array.from({ length: cols }, (_, col) => {
              const index = vIndex(row, col);
              const drawn = state?.vLines?.[index] ?? false;
              const from = point(row, col);
              const to = point(row + 1, col);
              return (
                <g key={`v-${row}-${col}`} className="group">
                  <line
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke={drawn ? '#a5b4fc' : 'transparent'}
                    strokeWidth={drawn ? 6 : 5}
                    strokeLinecap="round"
                  />
                  {!drawn ? (
                    <line
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke="#6366f1"
                      strokeWidth={6}
                      strokeLinecap="round"
                      className="opacity-0 transition-opacity group-hover:opacity-40"
                    />
                  ) : null}
                  <rect
                    x={from.x - HIT / 2}
                    y={from.y + DOT}
                    width={HIT}
                    height={CELL - DOT * 2}
                    fill="transparent"
                    className={cn(isMyTurn && !drawn && 'cursor-pointer')}
                    onClick={() => draw('v', row, col)}
                    aria-label={drawn ? undefined : `Draw vertical line column ${col + 1} position ${row + 1}`}
                  />
                </g>
              );
            }),
          )}

          {/* Dots */}
          {Array.from({ length: rows }, (_, row) =>
            Array.from({ length: cols }, (_, col) => {
              const position = point(row, col);
              return (
                <circle
                  key={`dot-${row}-${col}`}
                  cx={position.x}
                  cy={position.y}
                  r={DOT}
                  fill="#e2e8f0"
                />
              );
            }),
          )}
        </svg>
      </div>

      <ul className="flex flex-wrap justify-center gap-3 text-xs text-slate-300">
        {players.map((player) => (
          <li key={player.id} className="flex items-center gap-1.5">
            <span
              className="h-3 w-3 rounded-sm"
              style={{ backgroundColor: colorFor(players, player.id) }}
              aria-hidden
            />
            {player.nickname}
            {player.id === myPlayerId ? ' (you)' : ''}
            <span className="tabular-nums text-slate-400">{state?.scores?.[player.id] ?? 0}</span>
          </li>
        ))}
      </ul>

      <p className="text-center text-xs text-slate-500">
        Complete a box to score and keep your turn. The server tracks every line and box.
      </p>
    </div>
  );
}

export const dotsAndBoxesClient: ClientGameModule = {
  metadata: DOTS_AND_BOXES_METADATA,
  Component: DotsAndBoxesGame as unknown as ComponentType<GameComponentProps<never>>,
};
