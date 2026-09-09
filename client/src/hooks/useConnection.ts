import { useCallback, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import type {
  ChatMessagePayload,
  ChatMutedPayload,
  ChatSystemPayload,
  ConnectionEstablishedPayload,
  GameFinishedPayload,
  GameStartedPayload,
  NotificationPayload,
  PlayerDisconnectedPayload,
  PlayerReconnectedPayload,
  RoomClosedPayload,
  RoomCreatedPayload,
  RoomJoinedPayload,
  RoomState,
} from '@2play/shared';
import { SERVER_EVENTS } from '@2play/shared';
import { socketClient } from '../multiplayer/socketClient';
import { authenticateSession } from '../multiplayer/session';
import { useChatStore } from '../stores/chatStore';
import { useConnectionStore } from '../stores/connectionStore';
import { getLocalPlayerId, setLocalPlayerId, useRoomStore } from '../stores/roomStore';
import { useSessionStore } from '../stores/sessionStore';
import { audioManager } from '../audio/AudioManager';
import { hapticsManager } from '../haptics/HapticsManager';

/**
 * Bridges socket traffic into the Zustand stores.
 *
 * Mounted once (in `<App/>`) so there is exactly one set of listeners for the
 * whole application lifetime — no duplicate handlers, no leaked subscriptions.
 */
export function useConnection(): { ensureSession: (nickname?: string, avatar?: string) => Promise<boolean> } {
  const setConnectionState = useConnectionStore((state) => state.setState);
  const setServerTime = useConnectionStore((state) => state.setServerTime);
  const setReconnectDeadline = useConnectionStore((state) => state.setReconnectDeadline);
  const session = useSessionStore((state) => state.session);
  const nickname = useSessionStore((state) => state.nickname);
  const avatar = useSessionStore((state) => state.avatar);
  const pushRecentRoom = useSessionStore((state) => state.pushRecentRoom);
  const pushRecentlyPlayed = useSessionStore((state) => state.pushRecentlyPlayed);
  const authenticating = useRef(false);

  const authenticate = useCallback(
    async (explicitNickname?: string, explicitAvatar?: string): Promise<boolean> => {
      if (authenticating.current) return false;
      const current = useSessionStore.getState();
      const name = (explicitNickname ?? current.nickname ?? '').trim();
      if (name.length < 3) return false;
      authenticating.current = true;
      try {
        const sessionInfo = await authenticateSession(name, explicitAvatar ?? current.avatar);
        if (sessionInfo) return true;
        toast.error('Could not sign you in. Check your nickname and try again.');
        return false;
      } finally {
        authenticating.current = false;
      }
    },
    [],
  );

  useEffect(() => {
    socketClient.connect();
    setConnectionState(socketClient.connectionState);

    const offStatus = socketClient.onStatusChange((state) => {
      setConnectionState(state, state === 'RECONNECTING' ? 'Connection lost. Reconnecting…' : null);
    });

    const offConnect = socketClient.on<undefined>('__internal:connect', () => {
      const stored = useSessionStore.getState().getStoredSession();
      const name = stored?.nickname ?? useSessionStore.getState().nickname;
      if (name && name.length >= 3) void authenticate(name, stored?.avatar ?? useSessionStore.getState().avatar);
    });

    const offDisconnect = socketClient.on<string>('__internal:disconnect', (reason) => {
      if (reason === 'io client disconnect') setConnectionState('DISCONNECTED', 'Disconnected.');
    });

    const offEstablished = socketClient.on<ConnectionEstablishedPayload>(
      SERVER_EVENTS.CONNECTION_ESTABLISHED,
      (payload) => setServerTime(payload.serverTime),
    );

    const offRoomCreated = socketClient.on<RoomCreatedPayload>(SERVER_EVENTS.ROOM_CREATED, (payload) => {
      useRoomStore.getState().setRoom(payload.room);
      pushRecentRoom({ id: payload.room.id, gameId: payload.room.gameId });
      audioManager.play('roomCreated');
      hapticsManager.trigger('success');
    });

    const offRoomJoined = socketClient.on<RoomJoinedPayload>(SERVER_EVENTS.ROOM_JOINED, (payload) => {
      useRoomStore.getState().setRoom(payload.room);
      setLocalPlayerId(payload.playerId);
      pushRecentRoom({ id: payload.room.id, gameId: payload.room.gameId });
      audioManager.play('roomJoined');
      hapticsManager.trigger('success');
    });

    const offRoomUpdated = socketClient.on<{ room: RoomState }>(SERVER_EVENTS.ROOM_UPDATED, (payload) => {
      useRoomStore.getState().updateRoom(payload.room);
      useChatStore.getState().clearPending();
    });

    const offRoomClosed = socketClient.on<RoomClosedPayload>(SERVER_EVENTS.ROOM_CLOSED, (payload) => {
      useRoomStore.getState().setRoomClosed(payload.reason);
      useRoomStore.getState().clearRoom();
      toast.error('The room was closed.');
    });

    // Chat is broadcast as a dedicated event for low latency. Append it
    // directly instead of waiting for the next room snapshot.
    const appendChat = (payload: ChatMessagePayload | ChatSystemPayload) => {
      useRoomStore.getState().appendChatMessage(payload.roomId, payload.message);
    };
    const offChatMessage = socketClient.on<ChatMessagePayload>(SERVER_EVENTS.CHAT_MESSAGE, appendChat);
    const offChatEmote = socketClient.on<ChatMessagePayload>(SERVER_EVENTS.CHAT_EMOTE, appendChat);
    const offChatSystem = socketClient.on<ChatSystemPayload>(SERVER_EVENTS.CHAT_SYSTEM, appendChat);

    const offMuted = socketClient.on<ChatMutedPayload>(SERVER_EVENTS.CHAT_MUTED, (payload) => {
      if (payload.playerId === getLocalPlayerId()) {
        useChatStore.getState().setMutedUntil(payload.until);
        toast.error('You were muted for 60 seconds (repeated messages).');
      }
    });

    const offDisconnected = socketClient.on<PlayerDisconnectedPayload>(
      SERVER_EVENTS.PLAYER_DISCONNECTED,
      (payload) => {
        if (payload.playerId === getLocalPlayerId()) {
          setReconnectDeadline(payload.reconnectDeadline);
          toast.error('Connection lost. Trying to reconnect…');
        } else {
          toast(`${payload.nickname} lost connection.`, { icon: '📶' });
        }
      },
    );

    const offReconnected = socketClient.on<PlayerReconnectedPayload>(
      SERVER_EVENTS.PLAYER_RECONNECTED,
      (payload) => {
        if (payload.playerId === getLocalPlayerId()) {
          setReconnectDeadline(null);
          toast.success('Reconnected!');
        } else {
          toast.success(`${payload.nickname} reconnected.`);
        }
        audioManager.play('notification');
      },
    );

    const offCountdown = socketClient.on<{ value: number }>(SERVER_EVENTS.GAME_COUNTDOWN, (payload) => {
      if (payload.value > 0) {
        audioManager.play('countdown');
        hapticsManager.trigger('countdown');
      } else {
        audioManager.play('gameStart');
        hapticsManager.trigger('gameStart');
      }
    });

    const offStarted = socketClient.on<GameStartedPayload>(SERVER_EVENTS.GAME_STARTED, () => {
      const room = useRoomStore.getState().room;
      if (room) pushRecentlyPlayed(room.gameId);
    });

    const offFinished = socketClient.on<GameFinishedPayload>(SERVER_EVENTS.GAME_FINISHED, (payload) => {
      useRoomStore.getState().setLastResult(payload.result);
      const myId = getLocalPlayerId();
      const isWinner = payload.result.winners.includes(myId ?? '');
      audioManager.play(payload.result.isDraw ? 'draw' : isWinner ? 'victory' : 'defeat');
      hapticsManager.trigger(payload.result.isDraw ? 'success' : isWinner ? 'victory' : 'defeat');
    });

    const offNotification = socketClient.on<NotificationPayload>(SERVER_EVENTS.NOTIFICATION, (payload) => {
      if (payload.level === 'error') toast.error(payload.title);
      else if (payload.level === 'success') toast.success(payload.title);
      else if (payload.level === 'warning') toast(payload.title, { icon: '⚠️' });
      else toast(payload.title);
    });

    const offError = socketClient.on<{ error: { message: string; code?: string } }>(
      SERVER_EVENTS.ERROR,
      (payload) => {
        // Room-scoped errors are already surfaced by their own acks; only show
        // server-pushed errors that the user would otherwise miss.
        if (payload.error.code === 'E007') toast.error(payload.error.message);
      },
    );

    return () => {
      offStatus();
      offConnect();
      offDisconnect();
      offEstablished();
      offRoomCreated();
      offRoomJoined();
      offRoomUpdated();
      offRoomClosed();
      offChatMessage();
      offChatEmote();
      offChatSystem();
      offMuted();
      offDisconnected();
      offReconnected();
      offCountdown();
      offStarted();
      offFinished();
      offNotification();
      offError();
    };
  }, [
    authenticate,
    pushRecentRoom,
    pushRecentlyPlayed,
    setConnectionState,
    setReconnectDeadline,
    setServerTime,
  ]);

  // Authenticate automatically when we already know a nickname.
  useEffect(() => {
    if (session || !nickname || nickname.trim().length < 3) return;
    if (socketClient.connected) void authenticate(nickname, avatar);
  }, [session, nickname, avatar, authenticate]);

  return { ensureSession: authenticate };
}

export default useConnection;
