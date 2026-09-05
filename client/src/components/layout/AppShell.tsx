import type { ReactNode } from 'react';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { ConnectionBanner } from '../connection/ConnectionBanner';
import { cn } from '../../utils/cn';

export function AppShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-full flex-col">
      <Header />
      <ConnectionBanner />
      <main
        className={cn(
          'mx-auto w-full flex-1 px-4 pb-24 pt-6 md:pb-10',
          wide ? 'max-w-7xl' : 'max-w-6xl',
        )}
      >
        {children}
      </main>
      <BottomNav />
      <footer className="hidden border-t border-white/5 py-6 text-center text-xs text-slate-500 md:block">
        2PLAY v2.1 — Strictly 2D. Built for friends, families and quick matches.
      </footer>
    </div>
  );
}
