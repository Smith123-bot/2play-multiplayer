import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../utils/cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hoverable?: boolean;
  padded?: boolean;
  glow?: boolean;
}

export function Card({ hoverable = false, padded = true, glow = false, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'card',
        hoverable && 'card-hover',
        padded && 'p-4 sm:p-5',
        glow && 'ring-1 ring-primary-400/30',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  icon,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-4 flex items-start justify-between gap-3', className)}>
      <div className="flex min-w-0 items-start gap-2">
        {icon ? <span className="mt-0.5 text-primary-300">{icon}</span> : null}
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-white">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p> : null}
        </div>
      </div>
      {action}
    </div>
  );
}
