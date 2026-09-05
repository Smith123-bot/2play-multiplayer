import { useState } from 'react';
import { Check, Copy, Lock, Users } from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { cn } from '../../utils/cn';

export function RoomCodeCard({
  code,
  isPrivate,
  playerCount,
  maxPlayers,
  className,
}: {
  code: string;
  isPrivate: boolean;
  playerCount: number;
  maxPlayers: number;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Clipboard API may be unavailable (insecure context) — fall back silently.
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-2xl border border-white/10 bg-gradient-to-br from-primary-500/15 via-surface to-secondary-500/10 p-4 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div>
        <p className="text-xs uppercase tracking-wider text-slate-400">Room code</p>
        <div className="mt-1 flex items-center gap-2">
          <span
            className="font-mono text-3xl font-bold tracking-[0.25em] text-white"
            aria-label={`Room code ${code.split('').join(' ')}`}
          >
            {code}
          </span>
          <Button variant="ghost" size="sm" onClick={() => void copy()} icon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <p className="mt-1 text-xs text-slate-400">Share this code with your friends.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={isPrivate ? 'warning' : 'success'} icon={isPrivate ? <Lock className="h-3 w-3" /> : <Users className="h-3 w-3" />}>
          {isPrivate ? 'Private' : 'Public'}
        </Badge>
        <Badge tone="primary">
          {playerCount}/{maxPlayers} players
        </Badge>
      </div>
    </div>
  );
}
