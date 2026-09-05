import { NavLink } from 'react-router-dom';
import { BarChart3, Gamepad2, Heart, Home, Settings } from 'lucide-react';
import { cn } from '../../utils/cn';

const ITEMS = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/games', label: 'Games', icon: Gamepad2, end: false },
  { to: '/favorites', label: 'Favorites', icon: Heart, end: false },
  { to: '/stats', label: 'Stats', icon: BarChart3, end: false },
  { to: '/settings', label: 'Settings', icon: Settings, end: false },
];

/** Mobile-first bottom navigation with 44px+ touch targets. */
export function BottomNav() {
  return (
    <nav
      className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-background/95 backdrop-blur-xl md:hidden"
      aria-label="Bottom navigation"
    >
      <div className="grid grid-cols-5">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex min-h-touch flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium transition-colors',
                  isActive ? 'text-primary-300' : 'text-slate-400 hover:text-slate-200',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={cn('h-5 w-5', isActive && 'animate-pop')} aria-hidden />
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
