import { useMemo, type ComponentType } from 'react';
import { HEXA_CONQUEST_METADATA, type GameAction, type Player } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

export interface HexTilePublic {
  col: number;
  row: number;
  kind: 'normal' | 'bonus' | 'energy' | 'blocked';
  owner: string | null;
  value: number;
  start: boolean;
}

export interface HexaConquestPublicState {
  phase: 'idle' | 'playing' | 'finished';
  cols: number;
  rows: number;
  tiles: HexTilePublic[];
  scores: Record<string, number>;
  specials: Record<string, number>;
  captured: Record<string, number>;
  currentPlayerId: string | null;
  turnOrder: string[];
  turnEndsAt: number | null;
  endsAt: number | null;
  lastEvent: string | null;
  lastCapture: { playerId: string; col: number; row: number; kind: string } | null;
  serverTime: number;
}

const PLAYER_COLORS = ['#6366f1', '#10b981', '#ec4899', '#f59e0b'];
const SIZE = 16;
const PAD = 18;

function colorFor(players: Player[], playerId: string | null): string {
  if (!playerId) return 'rgba(148,163,184,0.35)';
  const index = players.findIndex((player) => player.id === playerId);
  return PLAYER_COLORS[(index < 0 ? 0 : index) % PLAYER_COLORS.length]!;
}

function hexNeighbors(col: number, row: number): Array<{ col: number; row: number }> {
  const odd = row & 1;
  const deltas = odd
    ? [
        [1, 0],
        [1, -1],
        [0, -1],
        [-1, 0],
        [0, 1],
        [1, 1],
      ]
    : [
        [1, 0],
        [0, -1],
        [-1, -1],
        [-1, 0],
        [-1, 1],
        [0, 1],
      ];
  return deltas.map(([dc, dr]) => ({ col: col + dc!, row: row + dr! }));
}

function hexCenter(col: number, row: number): { x: number; y: number } {
  const x = SIZE * Math.sqrt(3) * (col + 0.5 * (row & 1));
  const y = SIZE * 1.5 * row;
  return { x: x + PAD + SIZE, y: y + PAD + SIZE };
}

function hexPoints(cx: number, cy: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 180) * (60 * i - 30);
    return `${cx + SIZE * Math.cos(angle)},${cy + SIZE * Math.sin(angle)}`;
  }).join(' ');
}

function HexaConquestGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<HexaConquestPublicState>) {
  const cols = state?.cols ?? 15;
  const rows = state?.rows ?? 11;
  const isMyTurn = state?.currentPlayerId === myPlayerId && state?.phase === 'playing';
  const currentPlayer = players.find((player) => player.id === state?.currentPlayerId);
  const mySpecials = myPlayerId ? (state?.specials?.[myPlayerId] ?? 0) : 0;

  const { width, height } = useMemo(
    () => ({
      width: SIZE * Math.sqrt(3) * (cols + 0.5) + PAD * 2,
      height: SIZE * 1.5 * (rows - 1) + SIZE * 2 + PAD * 2,
    }),
    [cols, rows],
  );

  const owned = useMemo(() => {
    const set = new Set<string>();
    for (const tile of state?.tiles ?? []) {
      if (tile.owner === myPlayerId) set.add(`${tile.col},${tile.row}`);
    }
    return set;
  }, [state?.tiles, myPlayerId]);

  const adjacent = useMemo(() => {
    const set = new Set<string>();
    for (const key of owned) {
      const [col, row] = key.split(',').map(Number);
      for (const n of hexNeighbors(col!, row!)) set.add(`${n.col},${n.row}`);
    }
    return set;
  }, [owned]);

  const tap = (tile: HexTilePublic) => {
    if (!isMyTurn) return;
    if (tile.kind === 'blocked' || tile.owner) return;
    const key = `${tile.col},${tile.row}`;
    const isAdj = adjacent.has(key);
    if (isAdj) {
      sendAction({ type: 'capture', payload: { col: tile.col, row: tile.row } } satisfies GameAction);
    } else if (mySpecials > 0) {
      sendAction({ type: 'bridge', payload: { col: tile.col, row: tile.row } } satisfies GameAction);
    } else {
      return;
    }
    play('click');
    vibrate('buttonPress');
  };

  if (!state || state.phase === 'idle' || state.tiles.length === 0) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Laying the hex map…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({ ...player, score: state.scores?.[player.id] ?? player.score }))}
        myPlayerId={myPlayerId}
        currentTurnPlayerId={state.currentPlayerId}
        deadline={state.turnEndsAt ?? state.endsAt}
        label={state.turnEndsAt ? 'Turn time' : 'Match time'}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge tone={isMyTurn ? 'success' : 'default'}>
          {isMyTurn ? 'Your turn' : currentPlayer ? `${currentPlayer.nickname}'s turn` : 'Waiting'}
        </Badge>
        <Badge tone={mySpecials > 0 ? 'accent' : 'default'}>Bridge charges {mySpecials}</Badge>
        {state.phase === 'finished' ? <Badge tone="accent">Match over</Badge> : null}
      </div>

      <div className="card overflow-auto p-2">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="mx-auto h-auto w-full max-w-[640px] touch-manipulation select-none"
          role="grid"
          aria-label="Hexa Conquest board"
        >
          {state.tiles.map((tile) => {
            const { x, y } = hexCenter(tile.col, tile.row);
            const key = `${tile.col},${tile.row}`;
            const isAdj = adjacent.has(key);
            const fill = tile.kind === 'blocked' ? '#1e293b' : tile.owner ? colorFor(players, tile.owner) : '#0f172a';
            const stroke =
              tile.kind === 'bonus' ? '#fbbf24' : tile.kind === 'energy' ? '#22d3ee' : tile.start ? '#e2e8f0' : '#334155';
            const canTap =
              isMyTurn && tile.kind !== 'blocked' && !tile.owner && (isAdj || mySpecials > 0);
            return (
              <g key={key}>
                <polygon
                  points={hexPoints(x, y)}
                  fill={fill}
                  fillOpacity={tile.owner ? 0.72 : tile.kind === 'blocked' ? 0.9 : 0.55}
                  stroke={isAdj && isMyTurn && !tile.owner ? '#a5b4fc' : stroke}
                  strokeWidth={tile.kind === 'bonus' || tile.kind === 'energy' ? 2.2 : 1.2}
                  className={cn(canTap && 'cursor-pointer')}
                  onClick={() => tap(tile)}
                  aria-label={
                    tile.kind === 'blocked'
                      ? 'Blocked hex'
                      : `Hex ${tile.col + 1},${tile.row + 1}${tile.owner ? ' claimed' : ''}`
                  }
                />
                {tile.kind === 'bonus' && !tile.owner ? (
                  <text x={x} y={y + 4} textAnchor="middle" fontSize={9} fill="#fde68a">
                    +2
                  </text>
                ) : null}
                {tile.kind === 'energy' && !tile.owner ? (
                  <text x={x} y={y + 4} textAnchor="middle" fontSize={9} fill="#a5f3fc">
                    E
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>

      <p className="text-center text-xs text-slate-500">
        Tap an outlined neighbour to expand. A non-adjacent tap spends a Bridge charge. Gold = bonus, cyan = energy.
      </p>
    </div>
  );
}

export const hexaConquestClient: ClientGameModule = {
  metadata: HEXA_CONQUEST_METADATA,
  Component: HexaConquestGame as unknown as ComponentType<GameComponentProps<never>>,
};
