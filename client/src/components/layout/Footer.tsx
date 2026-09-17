import { Link, useLocation } from 'react-router-dom';
import { STATIC_INFO_PAGES, SITE_NAME } from '@2play/shared';
import { APP_CONFIG } from '../../core/config';

/**
 * Consistent public footer: the information/legal link chain plus the home
 * and catalogue anchors, so every crawlable page closes the
 * Home → Games → About/Privacy/Terms/Contact/FAQ ring.
 *
 * Hidden on room pages only — there the gameplay owns the viewport.
 */
export function Footer() {
  const location = useLocation();
  if (location.pathname.startsWith('/room/')) return null;

  return (
    <footer className="border-t border-white/5 px-4 pb-24 pt-6 md:pb-8">
      <nav
        aria-label="Site information"
        className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-6 gap-y-2"
      >
        <Link to="/" className="text-xs text-slate-400 transition-colors hover:text-white">
          Home
        </Link>
        <Link to="/games" className="text-xs text-slate-400 transition-colors hover:text-white">
          Games
        </Link>
        {STATIC_INFO_PAGES.map((page) => (
          <Link
            key={page.path}
            to={page.path}
            className="text-xs text-slate-400 transition-colors hover:text-white"
          >
            {page.title}
          </Link>
        ))}
      </nav>
      <p className="mt-3 text-center text-xs text-slate-500">
        {APP_CONFIG.name} v{APP_CONFIG.version} — {SITE_NAME} · {APP_CONFIG.tagline}
      </p>
    </footer>
  );
}
