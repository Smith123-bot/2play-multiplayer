import { useEffect, useState, type ComponentType } from 'react';
import { LUDO_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { cn } from '../../utils/cn';

interface State { phase: 'idle'|'playing'|'finished'; currentPlayerId: string|null; dice: number|null; canRoll: boolean; turnEndsAt: number|null; winnerId: string|null; lastEvent: string|null; players: Record<string, { color: string; tokens: { progress: number }[]; score: number; captures: number; finished: boolean }>; }
const colors: Record<string,string> = { red: 'bg-rose-500', blue: 'bg-sky-500', green: 'bg-emerald-500', yellow: 'bg-amber-400' };
const TRACK_CELLS: ReadonlyArray<[number, number]> = [[6,0],[6,1],[6,2],[6,3],[6,4],[6,5],[5,6],[4,6],[3,6],[2,6],[1,6],[0,6],[0,7],[0,8],[1,8],[2,8],[3,8],[4,8],[5,8],[6,9],[6,10],[6,11],[6,12],[6,13],[6,14],[7,14],[8,14],[8,13],[8,12],[8,11],[8,10],[8,9],[9,8],[10,8],[11,8],[12,8],[13,8],[14,8],[14,7],[14,6],[13,6],[12,6],[11,6],[10,6],[9,6],[8,5],[8,4],[8,3],[8,2],[8,1],[8,0],[7,0]];
const START_OFFSETS = [0, 13, 26, 39];
function tokenCell(color: number, progress: number): [number, number] | null {
  if (progress < 0 || progress >= 52) return null;
  return TRACK_CELLS[(START_OFFSETS[color] + progress) % TRACK_CELLS.length] ?? null;
}
function Ludo({ state, players, myPlayerId, sendAction, play, vibrate }: GameComponentProps<State>) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 250); return () => window.clearInterval(timer); }, []);
  useEffect(() => { if (state.lastEvent?.startsWith('capture:')) { play('score'); vibrate('success'); } else if (state.lastEvent?.startsWith('winner:')) { play('victory'); vibrate('victory'); } }, [state.lastEvent, play, vibrate]);
  const me = myPlayerId ? state.players[myPlayerId] : undefined;
  const canMoveToken = (progress: number) => Boolean(state.dice && progress < 56 && (progress >= 0 || state.dice === 6) && progress + state.dice <= 56);
  const roll = () => { sendAction({ type: 'roll-dice' } satisfies GameAction); play('click'); vibrate('buttonPress'); };
  return <div className="space-y-4"><GameHUD players={players.map((p) => ({ ...p, score: state.players[p.id]?.score ?? p.score }))} myPlayerId={myPlayerId} deadline={state.turnEndsAt} label="Turn timer" />
    <div className="flex flex-wrap gap-2"><Badge tone="primary">{state.currentPlayerId === myPlayerId ? 'Your turn' : 'Waiting for turn'}</Badge><Badge tone="accent">Dice: {state.dice ?? '—'}</Badge>{state.winnerId && <Badge tone="success">Winner decided</Badge>}</div>
    <div aria-label="Ludo board" className="mx-auto grid aspect-square w-full max-w-lg grid-cols-15 gap-px rounded-2xl border border-white/10 bg-slate-950/80 p-2">{Array.from({ length: 225 }, (_, cell) => { const x = cell % 15; const y = Math.floor(cell / 15); const trackIndex = TRACK_CELLS.findIndex(([tx, ty]) => tx === x && ty === y); const center = x >= 6 && x <= 8 && y >= 6 && y <= 8; const base = x < 6 && y < 6 ? 'bg-rose-500/20' : x > 8 && y < 6 ? 'bg-sky-500/20' : x < 6 && y > 8 ? 'bg-emerald-500/20' : x > 8 && y > 8 ? 'bg-amber-400/20' : ''; const occupants = Object.entries(state.players).flatMap(([id, p]) => p.tokens.map((token, tokenIndex) => ({ id, token, tokenIndex, p }))).filter(({ p, token }) => { const position = tokenCell(p.color === 'red' ? 0 : p.color === 'blue' ? 1 : p.color === 'green' ? 2 : 3, token.progress); return position ? position[0] === x && position[1] === y : false; }); return <div key={cell} className={cn('relative rounded-[2px] border border-white/5', trackIndex >= 0 ? 'bg-white/[.14]' : base || 'bg-white/[.025]', center && 'bg-gradient-to-br from-rose-400/40 via-sky-400/40 to-amber-300/40')}>{occupants.map(({ id, tokenIndex, p }) => <span key={`${id}-${tokenIndex}`} title={`${p.color} token`} className={cn('absolute left-1/4 top-1/4 h-1/2 w-1/2 rounded-full border-2 border-white/70', colors[p.color] ?? 'bg-white', id === myPlayerId && 'ring-2 ring-white')} />)}</div>; })}</div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{me?.tokens.map((token, index) => <Button key={index} variant={token.progress >= 0 ? 'secondary' : 'outline'} disabled={state.currentPlayerId !== myPlayerId || state.dice === null || state.phase !== 'playing' || !canMoveToken(token.progress)} onClick={() => { sendAction({ type: 'move-token', payload: { tokenIndex: index } }); play('score'); vibrate('success'); }}>{`Token ${index + 1}`}<span className="ml-1 text-xs opacity-70">{token.progress < 0 ? 'yard' : token.progress >= 56 ? 'home' : token.progress}</span></Button>)}</div>
    <Button className="mx-auto block min-w-32" disabled={!state.canRoll || state.currentPlayerId !== myPlayerId || state.phase !== 'playing'} onClick={roll}>Roll {state.dice ?? ''}</Button><p className="text-center text-xs text-slate-500">{state.turnEndsAt ? `${Math.max(0, Math.ceil((state.turnEndsAt - now) / 1000))}s remaining` : 'Bring all four tokens home.'}</p>
  </div>;
}
export const ludoClient: ClientGameModule = { metadata: LUDO_METADATA, Component: Ludo as unknown as ComponentType<GameComponentProps<never>> };
