import { useEffect, useState, type ComponentType } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react';
import { ARROW_PUZZLE_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

interface State { phase: 'idle'|'playing'|'finished'; size: number; tiles: { direction: 'up'|'down'|'left'|'right'; cleared: boolean }[]; players: Record<string, { cleared: number; score: number; completedAt: number|null }>; endsAt: number|null; winnerId: string|null; lastEvent: string|null; }
const Icons = { up: ArrowUp, down: ArrowDown, left: ArrowLeft, right: ArrowRight };
function ArrowPuzzle({ state, players, myPlayerId, sendAction, play, vibrate }: GameComponentProps<State>) {
  const [event, setEvent] = useState(state.lastEvent);
  useEffect(() => { if (state.lastEvent !== event) { setEvent(state.lastEvent); if (state.lastEvent?.startsWith('clear:')) { play('correct'); vibrate('buttonPress'); } } }, [state.lastEvent, event, play, vibrate]);
  const me = myPlayerId ? state.players[myPlayerId] : undefined;
  return <div className="space-y-4"><GameHUD players={players.map((p) => ({ ...p, score: state.players[p.id]?.score ?? p.score }))} myPlayerId={myPlayerId} deadline={state.endsAt} label="Puzzle timer" /><div className="flex flex-wrap gap-2"><Badge tone="primary">{me?.cleared ?? 0}/{state.tiles.length} cleared</Badge><Badge tone={state.winnerId ? 'success' : 'warning'}>{state.winnerId ? 'Puzzle complete' : 'Unlock the arrows'}</Badge></div><div role="grid" aria-label="Arrow puzzle" className="mx-auto grid w-full max-w-md grid-cols-5 gap-2 rounded-2xl border border-white/10 bg-slate-950/70 p-3">{state.tiles.map((tile, index) => { const Icon = Icons[tile.direction]; const cleared = tile.cleared; return <button key={index} type="button" role="gridcell" aria-label={`Arrow ${index + 1}`} disabled={cleared || state.phase !== 'playing'} onClick={() => { sendAction({ type: 'activate-arrow', payload: { index } } satisfies GameAction); play('click'); vibrate('buttonPress'); }} className={cn('grid aspect-square place-items-center rounded-xl border transition active:scale-95', cleared ? 'border-transparent bg-emerald-500/10 text-emerald-300/30' : 'border-white/10 bg-white/10 text-white hover:bg-primary-500/30')}><Icon className="h-7 w-7" aria-hidden /></button>; })}</div><p className="text-center text-xs text-slate-500">Only arrows pointing outside the board or at a cleared tile can move. Everyone receives the same generated puzzle.</p></div>;
}
export const arrowPuzzleClient: ClientGameModule = { metadata: ARROW_PUZZLE_METADATA, Component: ArrowPuzzle as unknown as ComponentType<GameComponentProps<never>> };
