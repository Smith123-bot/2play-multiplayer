import { beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from './settingsStore';
import { useRoomStore, setLocalPlayerId } from './roomStore';
import { useSessionStore } from './sessionStore';
import { useConnectionStore } from './connectionStore';
import { useChatStore } from './chatStore';
import { useUiStore } from './uiStore';
import type { RoomState } from '@2play/shared';

const baseRoom = (overrides: Partial<RoomState> = {}): RoomState =>
  ({
    id: 'ABC234',
    gameId: 'reaction-race',
    hostPlayerId: 'p1',
    maxPlayers: 2,
    isPrivate: false,
    status: 'LOBBY',
    players: [],
    countdownValue: 0,
    matchNumber: 1,
    gameStartedAt: null,
    gameResult: null,
    gameState: null,
    rematchVotes: {},
    rematchDeadline: null,
    settings: { playerCount: 2, aiOpponents: 0, aiDifficulty: 'medium' },
    chat: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    stateVersion: 1,
    ...overrides,
  }) as RoomState;

describe('stores', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useSettingsStore.getState().reset();
    useRoomStore.getState().clearRoom();
  });

  it('persists and applies audio settings', () => {
    const store = useSettingsStore.getState();
    store.setAudio({ masterVolume: 0.5, muted: true });
    expect(useSettingsStore.getState().audio.masterVolume).toBe(0.5);
    expect(useSettingsStore.getState().audio.muted).toBe(true);

    useSettingsStore.getState().toggleMute();
    expect(useSettingsStore.getState().audio.muted).toBe(false);

    const persisted = JSON.parse(window.localStorage.getItem('2play.settings') ?? '{}');
    expect(persisted.audio.masterVolume).toBe(0.5);
  });

  it('toggles haptics and theme', () => {
    useSettingsStore.getState().setHaptics(false);
    expect(useSettingsStore.getState().hapticsEnabled).toBe(false);
    useSettingsStore.getState().setTheme('light');
    expect(useSettingsStore.getState().theme).toBe('light');
    useSettingsStore.getState().setTheme('dark');
  });

  it('ignores stale room snapshots', () => {
    const store = useRoomStore.getState();
    store.setRoom(baseRoom({ stateVersion: 10 }));
    store.updateRoom(baseRoom({ stateVersion: 5, status: 'PLAYING' }));
    expect(useRoomStore.getState().room?.status).toBe('LOBBY');

    store.updateRoom(baseRoom({ stateVersion: 11, status: 'PLAYING' }));
    expect(useRoomStore.getState().room?.status).toBe('PLAYING');
  });

  /**
   * Incremental chat delivery: the server omits `chat` from a snapshot when
   * the transcript is unchanged for the viewer. The store must carry the
   * previous array over — with the SAME reference, so memoized chat components
   * can skip gameplay-only snapshots — and must never leak chat across rooms.
   */
  it('carries chat over incremental snapshots without chat', () => {
    const store = useRoomStore.getState();
    const transcript = [{ id: 'm1', roomId: 'ABC234', text: 'hi' } as never];
    store.setRoom(baseRoom({ stateVersion: 10, chat: transcript }));
    const withChat = useRoomStore.getState().room;
    expect(withChat?.chat).toBe(transcript);

    // Gameplay-only snapshot: no `chat` field at all.
    const { chat: _omitted, ...withoutChat } = baseRoom({ stateVersion: 11, status: 'PLAYING' });
    void _omitted;
    store.updateRoom(withoutChat as RoomState);
    const carried = useRoomStore.getState().room;
    expect(carried?.chat).toBe(transcript);
    expect(carried?.status).toBe('PLAYING');

    // A different room without chat must NOT inherit the previous transcript.
    store.setRoom(baseRoom({ id: 'XYZ789', stateVersion: 1 }));
    expect(useRoomStore.getState().room?.chat).toEqual([]);
  });

  it('tracks the local player and the last result', () => {
    setLocalPlayerId('p1');
    const store = useRoomStore.getState();
    store.setRoom(
      baseRoom({
        players: [{ id: 'p1', nickname: 'Me', score: 3 } as never, { id: 'p2' } as never],
      }),
    );
    expect(useRoomStore.getState().me()?.nickname).toBe('Me');

    store.setLastResult({ gameId: 'reaction-race' } as never);
    expect(useRoomStore.getState().lastResult).not.toBeNull();
  });

  it('stores the session and recently played games', () => {
    useSessionStore.getState().setIdentity('Tester', '🐼');
    expect(useSessionStore.getState().nickname).toBe('Tester');
    expect(useSessionStore.getState().avatar).toBe('🐼');

    useSessionStore.getState().pushRecentlyPlayed('math-rush');
    useSessionStore.getState().pushRecentlyPlayed('word-race');
    expect(useSessionStore.getState().recentlyPlayed[0]).toBe('word-race');
  });

  it('tracks connection state and server clock offset', () => {
    useConnectionStore.getState().setState('RECONNECTING', 'lost');
    expect(useConnectionStore.getState().state).toBe('RECONNECTING');

    const now = Date.now();
    useConnectionStore.getState().setServerTime(now + 2000);
    expect(useConnectionStore.getState().serverNow()).toBeGreaterThan(now + 1500);

    useConnectionStore.getState().setState('CONNECTED');
    expect(useConnectionStore.getState().lastConnectedAt).toBeGreaterThan(0);
  });

  it('keeps chat drafts and mute state', () => {
    useChatStore.getState().setDraft('hello');
    expect(useChatStore.getState().draft).toBe('hello');
    useChatStore.getState().setMutedUntil(Date.now() + 60_000);
    expect(useChatStore.getState().mutedUntil).toBeGreaterThan(Date.now());
  });

  it('opens and resolves the nickname gate', () => {
    let called = false;
    useUiStore.getState().openNicknamePrompt(() => {
      called = true;
    });
    expect(useUiStore.getState().nicknamePromptOpen).toBe(true);
    useUiStore.getState().resolvePending();
    expect(called).toBe(true);
    expect(useUiStore.getState().nicknamePromptOpen).toBe(false);
  });
});
