import { Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AppShell } from './components/layout/AppShell';
import { NicknamePrompt } from './components/NicknamePrompt';
import { ReconnectOverlay } from './components/connection/ReconnectOverlay';
import { useConnection } from './hooks/useConnection';
import { useAudioUnlock } from './hooks/useAudioUnlock';
import { useGameStore } from './stores/gameStore';
import { useEffect } from 'react';
import {
  HomeScreen,
  GameBrowserScreen,
  GameDetailsScreen,
  CreateRoomScreen,
  JoinRoomScreen,
  RoomScreen,
  SettingsScreen,
  StatisticsScreen,
  FavoritesScreen,
  NotFoundScreen,
  ErrorScreen,
} from './screens';

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
          <Route path="/error" element={<ErrorScreen />} />
          <Route path="*" element={<NotFoundScreen />} />
        </Routes>
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
