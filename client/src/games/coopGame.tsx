import { useEffect, useState, type ComponentType } from 'react';
import type { GameAction } from '@2play/shared';
import type { SoundName } from '../audio/sounds';
import type { HapticPattern } from '../haptics/HapticsManager';
import { LOVE_MAZE_METADATA, SYNC_JUMP_METADATA, COUPLE_SYNC_METADATA, COUPLE_MEMORY_METADATA, BUILD_TOGETHER_METADATA } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from './registry/types';
import { GameHUD } from '../components/game/GameHUD';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { cn } from '../utils/cn';

type State = { kind: string; level: number; phase: string; teamScore: number; syncScore: number; round: number; roundTarget: number; pairsFound: number; cards: Array<{ id: number; symbol: string | null; matched: boolean }>; selection: number[]; pieces: Array<{ id: number; x: number; y: number; rotation: number; placedBy: string | null }>; objectives: { switches: boolean[]; keys: boolean[]; doorOpen: boolean; exitPlayers: string[] }; players: Record<string, { x: number; y: number; score: number; checkpoints: number; mistakes: number; finished: boolean }>; };
const emit = (sendAction: (action: GameAction) => void, action: GameAction, play: (s: SoundName) => void, vibrate: (s: HapticPattern) => void) => { sendAction(action); play(action.type === 'move' ? 'click' : 'score'); vibrate(action.type === 'move' ? 'buttonPress' : 'success'); };
function CoopGame({ state, players, myPlayerId, sendAction, play, vibrate }: GameComponentProps<State>) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 500); return () => window.clearInterval(id); }, []);
  const me = myPlayerId ? state.players[myPlayerId] : undefined;
  const action = (type: string, payload: Record<string, unknown> = {}) => emit(sendAction, { type, payload }, play, vibrate);
  const other = Object.keys(state.players).find((id) => id !== myPlayerId);
  const grid = (state.kind === 'maze' || state.kind === 'jump') ? Array.from({ length: state.kind === 'maze' ? 100 : 60 }) : [];
  return <div className="space-y-4">
    <GameHUD players={players.map((p) => ({ ...p, score: state.players[p.id]?.score ?? 0 }))} myPlayerId={myPlayerId} label="Team score" />
    <div className="flex flex-wrap gap-2"><Badge tone="primary">TEAM {state.teamScore}</Badge><Badge tone="accent">Level {state.level}/10</Badge>{state.kind === 'jump' ? <Badge tone="success">Sync {state.syncScore}%</Badge> : null}{state.kind === 'sync' ? <Badge>Round {Math.min(state.round, 10)}/10</Badge> : null}{state.kind === 'memory' ? <Badge>Pairs {state.pairsFound}/8</Badge> : null}</div>
    {state.kind === 'maze' || state.kind === 'jump' ? <>
      <div className={cn('mx-auto grid aspect-square max-w-lg gap-1 rounded-2xl border border-white/10 bg-slate-950 p-2', state.kind === 'maze' ? 'grid-cols-10' : 'grid-cols-10')}>{grid.map((_, i) => { const x = i % 10, y = Math.floor(i / 10); const mine = me && me.x === x && me.y === y; const partner = other && state.players[other]?.x === x && state.players[other]?.y === y; const door = state.kind === 'maze' && x === 5 && y < 5; return <div key={i} className={cn('relative rounded border border-white/5 bg-white/[.04]', door && !state.objectives.doorOpen && 'bg-rose-500/30', (mine || partner) && 'bg-primary-500/30')}>{mine ? <span className="absolute inset-1 rounded-full bg-rose-400" /> : null}{partner ? <span className="absolute inset-1 rounded-full bg-sky-400" /> : null}</div>; })}</div>
      <div className="flex flex-wrap justify-center gap-2"><Button onClick={() => action('move',{dx:0,dy:-1})}>↑</Button><Button onClick={() => action('move',{dx:-1,dy:0})}>←</Button><Button onClick={() => action('move',{dx:1,dy:0})}>→</Button><Button onClick={() => action('move',{dx:0,dy:1})}>↓</Button>{state.kind === 'jump' ? <Button variant="secondary" onClick={() => action('jump')}>Jump</Button> : null}</div>
      {state.kind === 'maze' ? <div className="flex flex-wrap justify-center gap-2"><Button variant="secondary" onClick={() => action('switch',{index:0})}>Switch A</Button><Button variant="secondary" onClick={() => action('switch',{index:1})}>Switch B</Button><Button variant="secondary" onClick={() => action('key',{index:0})}>Key A</Button><Button variant="secondary" onClick={() => action('key',{index:1})}>Key B</Button><Button variant="secondary" onClick={() => action('checkpoint')}>Checkpoint</Button><Button variant="success" onClick={() => action('exit')}>Enter exit</Button></div> : <div className="flex justify-center gap-2"><Button variant="secondary" onClick={() => action('checkpoint')}>Checkpoint</Button><Button variant="success" onClick={() => action('finish')}>Finish</Button></div>}
    </> : null}
    {state.kind === 'sync' ? <Card className="mx-auto max-w-lg"><p className="mb-3 text-center text-sm text-slate-300">Both partners submit the requested signal: <strong className="text-white">{state.roundTarget}</strong></p><div className="grid grid-cols-4 gap-2">{[0,1,2,3].map((v) => <Button key={v} onClick={() => action('press',{value:v})}>{v}</Button>)}</div><p className="mt-3 text-center text-xs text-slate-500">Wait for your partner and communicate before choosing.</p></Card> : null}
    {state.kind === 'memory' ? <div className="mx-auto grid max-w-lg grid-cols-4 gap-2">{state.cards.map((card) => <button key={card.id} type="button" disabled={card.matched || state.selection.includes(card.id)} onClick={() => action('reveal',{cardId:card.id})} className={cn('aspect-square rounded-xl border text-2xl', card.matched ? 'border-success bg-success/20' : card.symbol ? 'border-primary-400 bg-primary-500/20' : 'border-white/10 bg-white/[.05]')}>{card.symbol ?? '?'}</button>)}</div> : null}
    {state.kind === 'build' ? <Card className="mx-auto max-w-lg"><p className="mb-3 text-center text-sm">Target structure: place every required block. Each partner must contribute.</p><div className="grid grid-cols-4 gap-2">{state.pieces.map((piece) => <Button key={piece.id} disabled={piece.placedBy !== null} onClick={() => action('place',{pieceId:piece.id,x:piece.id%4,y:Math.floor(piece.id/4),rotation:piece.id%4})}>{piece.placedBy ? 'Placed' : `Place ${piece.id+1}`}</Button>)}</div><Button className="mt-3 w-full" variant="success" onClick={() => action('complete')}>Validate structure</Button></Card> : null}
    <p className="text-center text-xs text-slate-500">Team play • {state.phase === 'finished' ? 'Match complete' : `Both players contribute • ${Math.max(0, Math.ceil(((state as any).endsAt ?? now) - now) / 1000)}s remaining`}</p>
  </div>;
}
export const loveMazeClient: ClientGameModule = { metadata: LOVE_MAZE_METADATA, Component: CoopGame as unknown as ComponentType<GameComponentProps<never>> };
export const syncJumpClient: ClientGameModule = { metadata: SYNC_JUMP_METADATA, Component: CoopGame as unknown as ComponentType<GameComponentProps<never>> };
export const coupleSyncClient: ClientGameModule = { metadata: COUPLE_SYNC_METADATA, Component: CoopGame as unknown as ComponentType<GameComponentProps<never>> };
export const coupleMemoryClient: ClientGameModule = { metadata: COUPLE_MEMORY_METADATA, Component: CoopGame as unknown as ComponentType<GameComponentProps<never>> };
export const buildTogetherClient: ClientGameModule = { metadata: BUILD_TOGETHER_METADATA, Component: CoopGame as unknown as ComponentType<GameComponentProps<never>> };
