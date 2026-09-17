import { Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AppShell } from './components/layout/AppShell';
import { NicknamePrompt } from './components/NicknamePrompt';
import { ReconnectOverlay } from './components/connection/ReconnectOverlay';
import { LoadingBlock } from './components/ui/Spinner';
import { useConnection } from './hooks/useConnection';
import { useAudioUnlock } from './hooks/useAudioUnlock';
import { useGameStore } from './stores/gameStore';
import { lazy, Suspense, useEffect } from 'react';
import { HomeScreen } from './screens/HomeScreen';

/**
 * Route-level code splitting.
 *
 * HomeScreen stays in the main chunk because it is the landing route and must
 * paint immediately; every other screen is fetched on first navigation. The
 * `./screens` barrel is deliberately NOT imported here — re-exporting all
 * eleven screens from one module would pull them straight back into the initial
 * bundle and undo the split.
 */
const GameBrowserScreen = lazy(() => import('./screens/GameBrowserScreen'));
const GameDetailsScreen = lazy(() => import('./screens/GameDetailsScreen'));
const CreateRoomScreen = lazy(() => import('./screens/CreateRoomScreen'));
const JoinRoomScreen = lazy(() => import('./screens/JoinRoomScreen'));
const RoomScreen = lazy(() => import('./screens/RoomScreen'));
const SettingsScreen = lazy(() => import('./screens/SettingsScreen'));
const StatisticsScreen = lazy(() => import('./screens/StatisticsScreen'));
const FavoritesScreen = lazy(() => import('./screens/FavoritesScreen'));
const NotFoundScreen = lazy(() => import('./screens/NotFoundScreen'));
const ErrorScreen = lazy(() => import('./screens/ErrorScreen'));
// Public information & legal pages — lazy like every non-landing route.
const AboutScreen = lazy(() => import('./screens/AboutScreen'));
const PrivacyScreen = lazy(() => import('./screens/PrivacyScreen'));
const TermsScreen = lazy(() => import('./screens/TermsScreen'));
const ContactScreen = lazy(() => import('./screens/ContactScreen'));
const FaqScreen = lazy(() => import('./screens/FaqScreen'));

export function App() {
  // Single place where the socket is connected and bridged into the stores.
  useConnection();
  useAudioUnlock();
  const loadGames = useGameStore((store) => store.load);

  useEffect(() => {
    void loadGames();
  }, [loadGames]);

  return (
    <>
      <AppShell>
        <Suspense fallback={<LoadingBlock message="Loading…" />}>
        <Routes>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/games" element={<GameBrowserScreen />} />
          <Route path="/games/:gameId" element={<GameDetailsScreen />} />
          <Route path="/create" element={<CreateRoomScreen />} />
          <Route path="/join" element={<JoinRoomScreen />} />
          <Route path="/room/:roomId" element={<RoomScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="/stats" element={<StatisticsScreen />} />
          <Route path="/statistics" element={<Navigate to="/stats" replace />} />
          <Route path="/favorites" element={<FavoritesScreen />} />
          <Route path="/about" element={<AboutScreen />} />
          <Route path="/privacy" element={<PrivacyScreen />} />
          <Route path="/terms" element={<TermsScreen />} />
          <Route path="/contact" element={<ContactScreen />} />
          <Route path="/faq" element={<FaqScreen />} />
          <Route path="/error" element={<ErrorScreen />} />
          <Route path="*" element={<NotFoundScreen />} />
        </Routes>
        </Suspense>
      </AppShell>

      <NicknamePrompt />
      <ReconnectOverlay />

      <Toaster
        position="top-center"
        toastOptions={{
          duration: 3200,
          style: {
            background: '#1a1a2e',
            color: '#e2e8f0',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '12px',
            fontSize: '14px',
            maxWidth: '92vw',
          },
          success: { iconTheme: { primary: '#10b981', secondary: '#0f0f1a' } },
          error: { iconTheme: { primary: '#ef4444', secondary: '#0f0f1a' } },
        }}
      />
    </>
  );
}

export default App;
