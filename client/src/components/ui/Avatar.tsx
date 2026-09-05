import { cn } from '../../utils/cn';

export interface AvatarProps {
  emoji: string;
  nickname?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  ring?: boolean;
}

const SIZES = {
  sm: 'h-8 w-8 text-base',
  md: 'h-11 w-11 text-xl',
  lg: 'h-14 w-14 text-2xl',
} as const;

export function Avatar({ emoji, nickname, size = 'md', className, ring = false }: AvatarProps) {
  return (
    <div
      title={nickname}
      aria-label={nickname ? `${nickname} avatar` : 'avatar'}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-primary-500/30 to-secondary-500/30',
        SIZES[size],
        ring && 'ring-2 ring-primary-400',
        className,
      )}
    >
      <span aria-hidden>{emoji}</span>
    </div>
  );
}
