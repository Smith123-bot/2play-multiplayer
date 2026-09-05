import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';

export type BadgeTone = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'accent';

const TONES: Record<BadgeTone, string> = {
  default: 'border-white/10 bg-white/5 text-slate-300',
  primary: 'border-primary-400/40 bg-primary-500/15 text-primary-200',
  success: 'border-success/40 bg-success/15 text-emerald-300',
  warning: 'border-warning/40 bg-warning/15 text-amber-300',
  danger: 'border-danger/40 bg-danger/15 text-red-300',
  accent: 'border-accent/40 bg-accent/15 text-pink-300',
};

export function Badge({
  tone = 'default',
  children,
  className,
  icon,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
