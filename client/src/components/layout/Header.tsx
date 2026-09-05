import { useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { BarChart3, Heart, Menu, Settings, Users, X } from 'lucide-react';
import { Logo } from './Logo';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';
import { useSessionStore } from '../../stores/sessionStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { cn } from '../../utils/cn';

const NAV_ITEMS = [
  { to: '/games', label: 'Games', icon: Users },
  { to: '/favorites', label: 'Favorites', icon: Heart },
  { to: '/stats', label: 'Stats', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function Header() {
  const location = useLocation();
  const nickname = useSessionStore((state) => state.nickname);
  const avatar = useSessionStore((state) => state.avatar);
  const connection = useConnectionStore((state) => state.state);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
        <Logo />

        <nav className="hidden items-center gap-1 md:flex" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = location.pathname.startsWith(item.to);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={cn(
                  'inline-flex min-h-touch items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                  active ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <Badge
            tone={connection === 'CONNECTED' ? 'success' : connection === 'CONNECTING' ? 'warning' : 'danger'}
            className="hidden sm:inline-flex"
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                connection === 'CONNECTED' ? 'bg-success' : 'bg-warning animate-pulse',
              )}
              aria-hidden
            />
            {connection === 'CONNECTED' ? 'Online' : connection === 'CONNECTING' ? 'Connecting' : 'Offline'}
          </Badge>

          {nickname ? (
            <Link
              to="/settings"
              className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 py-1 pl-1 pr-3 transition hover:bg-white/10"
              aria-label={`Profile: ${nickname}`}
            >
              <Avatar emoji={avatar} nickname={nickname} size="sm" />
              <span className="hidden max-w-[120px] truncate text-sm font-medium text-slate-200 sm:block">
                {nickname}
              </span>
            </Link>
          ) : null}

          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-300 hover:bg-white/5 md:hidden"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {menuOpen ? (
        <nav className="border-t border-white/5 bg-surface/95 px-4 py-2 md:hidden" aria-label="Mobile navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-touch items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium',
                    isActive ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5',
                  )
                }
              >
                <Icon className="h-4 w-4" aria-hidden />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
      ) : null}
    </header>
  );
}
