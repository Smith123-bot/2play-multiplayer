import { Link } from 'react-router-dom';
import { cn } from '../../utils/cn';
import { APP_CONFIG } from '../../core/config';

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <Link
      to="/"
      className={cn('group inline-flex items-center gap-2.5 rounded-xl focus-visible:ring-2', className)}
      aria-label={`${APP_CONFIG.name} home`}
    >
      <span className="relative grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-primary-500 via-secondary-500 to-accent-500 shadow-lg shadow-primary-500/30 transition-transform duration-200 group-hover:scale-105">
        <span className="text-lg font-black text-white">2</span>
      </span>
      {!compact ? (
        <span className="flex flex-col leading-none">
          <span className="text-xl font-extrabold tracking-tight text-white">
            2<span className="text-gradient">PLAY</span>
          </span>
          <span className="mt-0.5 hidden text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400 sm:block">
            {APP_CONFIG.tagline}
          </span>
        </span>
      ) : null}
    </Link>
  );
}
