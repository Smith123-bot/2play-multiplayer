import { BookOpen, Gamepad2, Trophy, Users, Zap } from 'lucide-react';
import type { GameMetadata } from '@2play/shared';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';

export function HowToPlayModal({
  game,
  open,
  onClose,
  firstVisit = false,
}: {
  game: GameMetadata;
  open: boolean;
  onClose: () => void;
  firstVisit?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      closeOnBackdrop={!firstVisit}
      title={<span className="flex items-center gap-2"><BookOpen className="h-5 w-5 text-primary-300" /> How to play {game.name}</span>}
      description={game.description}
      footer={<Button onClick={onClose}>{firstVisit ? 'Got it — ready up' : 'Close rules'}</Button>}
    >
      <div className="space-y-5 text-sm text-slate-300">
        <div className="flex flex-wrap gap-2">
          <Badge icon={<Users className="h-3 w-3" />}>{game.minPlayers === game.maxPlayers ? `${game.minPlayers} players` : `${game.minPlayers}–${game.maxPlayers} players`}</Badge>
          <Badge icon={<Gamepad2 className="h-3 w-3" />}>{game.controls}</Badge>
          <Badge icon={<Zap className="h-3 w-3" />}>{game.estimatedDuration}s recommended</Badge>
        </div>
        <section>
          <h3 className="mb-2 flex items-center gap-2 font-semibold text-white"><Trophy className="h-4 w-4 text-amber-300" /> Objective and how to play</h3>
          <ol className="space-y-2">
            {game.rules.map((rule, index) => <li key={rule} className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary-500/20 text-xs font-bold text-primary-200">{index + 1}</span><span>{rule}</span></li>)}
          </ol>
        </section>
        <section className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-white/[.03] p-3"><h3 className="mb-1 font-semibold text-white">Controls</h3><p>{game.controls}</p></div>
          <div className="rounded-xl border border-white/10 bg-white/[.03] p-3"><h3 className="mb-1 font-semibold text-white">Scoring</h3><p>{game.scoring}</p></div>
          <div className="rounded-xl border border-white/10 bg-white/[.03] p-3 sm:col-span-2"><h3 className="mb-1 font-semibold text-white">How to win</h3><p>{game.winCondition}</p><p className="mt-1 text-xs text-slate-400">The server decides scores, timeouts, winners, and draws. Unfinished players are ranked according to this game’s server rules.</p></div>
        </section>
      </div>
    </Modal>
  );
}
