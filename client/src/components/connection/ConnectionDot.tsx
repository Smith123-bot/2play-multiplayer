import { useConnectionStore } from '../../stores/connectionStore';
import { cn } from '../../utils/cn';

const LABELS = {
  CONNECTED: 'Connected',
  CONNECTING: 'Connecting',
  DISCONNECTED: 'Disconnected',
  RECONNECTING: 'Reconnecting',
} as const;

export function ConnectionDot({ className }: { className?: string }) {
  const state = useConnectionStore((store) => store.state);
  const tone =
    state === 'CONNECTED' ? 'bg-success' : state === 'CONNECTING' ? 'bg-warning' : 'bg-danger';

  return (
    <span className={cn('inline-flex items-center gap-2 text-xs text-slate-400', className)}>
      <span
        className={cn('h-2 w-2 rounded-full', tone, state !== 'CONNECTED' && 'animate-pulse')}
        aria-hidden
      />
      <span aria-live="polite">{LABELS[state]}</span>
    </span>
  );
}
