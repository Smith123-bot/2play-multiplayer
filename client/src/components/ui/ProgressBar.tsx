import { cn } from '../../utils/cn';

export function ProgressBar({
  value,
  max = 100,
  tone = 'primary',
  className,
  label,
}: {
  value: number;
  max?: number;
  tone?: 'primary' | 'success' | 'warning' | 'danger';
  className?: string;
  label?: string;
}) {
  const percent = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  const tones = {
    primary: 'bg-gradient-to-r from-primary-500 to-secondary-500',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
  } as const;

  return (
    <div className={cn('w-full', className)}>
      {label ? <div className="mb-1 text-xs text-slate-400">{label}</div> : null}
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'progress'}
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-300 ease-out', tones[tone])}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
