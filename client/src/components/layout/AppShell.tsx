import type { ReactNode } from 'react';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { Footer } from './Footer';
import { ConnectionBanner } from '../connection/ConnectionBanner';
import { ActiveRoomPrompt } from '../room/ActiveRoomPrompt';
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
        <ActiveRoomPrompt />
        {children}
      </main>
      <BottomNav />
      <Footer />
    </div>
  );
}
