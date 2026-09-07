import { useCallback } from 'react';
import toast from 'react-hot-toast';
import type {
  AddAIPayload,
  ChatEmotePayload,
  ChatSendPayload,
  CreateRoomPayload,
  JoinRoomPayload,
  KickPlayerPayload,
  QuickPlayPayload,
  ReadyPayload,
  RemoveAIPayload,
  RoomCreatedPayload,
  RoomJoinedPayload,
  RoomListResultPayload,
  RoomSettingsPayload,
  SelectGamePayload,
} from '@2play/shared';
import { CLIENT_EVENTS } from '@2play/shared';
import { socketClient } from '../multiplayer/socketClient';
import { audioManager } from '../audio/AudioManager';
import { hapticsManager } from '../haptics/HapticsManager';
import { useRoomStore } from '../stores/roomStore';

function fail(error?: { message?: string }): null {
  if (error?.message) toast.error(error.message);
  hapticsManager.trigger('error');
  return null;
}

/**
 * Every room/match interaction the UI can perform.
 * The server remains authoritative: these only send intents.
 */
export function useRoomActions() {
  const listRooms = useCallback(async (gameId?: string, includePrivate = false) => {
    const response = await socketClient.emitAck<RoomListResultPayload>(CLIENT_EVENTS.ROOM_LIST, {
      ...(gameId ? { gameId } : {}),
      includePrivate,
    });
    return response.ok && response.data ? response.data.rooms : [];
  }, []);

  const createRoom = useCallback(async (payload: CreateRoomPayload) => {
    const response = await socketClient.emitAck<RoomCreatedPayload>(CLIENT_EVENTS.ROOM_CREATE, payload);
    if (!response.ok || !response.data) return fail(response.error);
    audioManager.play('roomCreated');
    hapticsManager.trigger('success');
    return response.data.room;
  }, []);

  const quickPlay = useCallback(async (payload: QuickPlayPayload) => {
    const response = await socketClient.emitAck<RoomCreatedPayload>(CLIENT_EVENTS.ROOM_QUICK_PLAY, payload);
    if (!response.ok || !response.data) return fail(response.error);
    audioManager.play('roomCreated');
    hapticsManager.trigger('success');
    return response.data.room;
  }, []);

  const joinRoom = useCallback(async (payload: JoinRoomPayload) => {
    const response = await socketClient.emitAck<RoomJoinedPayload>(CLIENT_EVENTS.ROOM_JOIN, payload);
    if (!response.ok || !response.data) return fail(response.error);
    audioManager.play('roomJoined');
    hapticsManager.trigger('success');
    return response.data.room;
  }, []);

  const leaveRoom = useCallback(async () => {
    const response = await socketClient.emitAck<{ left: boolean }>(CLIENT_EVENTS.ROOM_LEAVE, {});
    if (!response.ok) fail(response.error);
    useRoomStore.getState().clearRoom();
    return response.ok;
  }, []);

  const kickPlayer = useCallback(async (payload: KickPlayerPayload) => {
    const response = await socketClient.emitAck<{ kicked: boolean }>(CLIENT_EVENTS.ROOM_KICK, payload);
    if (!response.ok) return fail(response.error);
    toast.success('Player removed.');
    return true;
  }, []);

  const addAI = useCallback(async (payload: AddAIPayload) => {
    const response = await socketClient.emitAck<{ playerId: string }>(CLIENT_EVENTS.ROOM_ADD_AI, payload);
    if (!response.ok) return fail(response.error);
    audioManager.play('playerJoined');
    return true;
  }, []);

  const removeAI = useCallback(async (payload: RemoveAIPayload) => {
    const response = await socketClient.emitAck<{ removed: boolean }>(CLIENT_EVENTS.ROOM_REMOVE_AI, payload);
    if (!response.ok) return fail(response.error);
    return true;
  }, []);

  const setReady = useCallback(async (payload: ReadyPayload) => {
    const response = await socketClient.emitAck<{ isReady: boolean }>(CLIENT_EVENTS.LOBBY_READY, payload);
    if (!response.ok) return fail(response.error);
    audioManager.play('click');
    hapticsManager.trigger('buttonPress');
    return response.data?.isReady ?? payload.isReady;
  }, []);

  const selectGame = useCallback(async (payload: SelectGamePayload) => {
    const response = await socketClient.emitAck<{ gameId: string }>(CLIENT_EVENTS.LOBBY_SELECT_GAME, payload);
    if (!response.ok) return fail(response.error);
    return true;
  }, []);

  const updateSettings = useCallback(async (payload: RoomSettingsPayload) => {
    const response = await socketClient.emitAck<RoomSettingsPayload>(CLIENT_EVENTS.LOBBY_SETTINGS, payload);
    if (!response.ok) return fail(response.error);
    return response.data ?? null;
  }, []);

  const startGame = useCallback(async () => {
    const response = await socketClient.emitAck<{ started: boolean }>(CLIENT_EVENTS.GAME_START, {});
    if (!response.ok) return fail(response.error);
    hapticsManager.trigger('gameStart');
    return true;
  }, []);

  const leaveMatch = useCallback(async () => {
    const response = await socketClient.emitAck<{ left: boolean }>(CLIENT_EVENTS.GAME_LEAVE, {});
    if (!response.ok) fail(response.error);
    return response.ok;
  }, []);

  const requestRematch = useCallback(async () => {
    const response = await socketClient.emitAck<{ votes: Record<string, boolean> }>(
      CLIENT_EVENTS.REMATCH_REQUEST,
      {},
    );
    if (!response.ok) return fail(response.error);
    audioManager.play('click');
    hapticsManager.trigger('buttonPress');
    return true;
  }, []);

  const cancelRematch = useCallback(async () => {
    const response = await socketClient.emitAck<{ votes: Record<string, boolean> }>(
      CLIENT_EVENTS.REMATCH_CANCEL,
      {},
    );
    if (!response.ok) return fail(response.error);
    return true;
  }, []);

  const sendChat = useCallback(async (payload: ChatSendPayload) => {
    const response = await socketClient.emitAck<{ sent: boolean }>(CLIENT_EVENTS.CHAT_SEND, payload);
    if (!response.ok) {
      toast.error(response.error?.message ?? 'Message not sent.');
      return false;
    }
    audioManager.play('click');
    return true;
  }, []);

  const sendEmote = useCallback(async (payload: ChatEmotePayload) => {
    const response = await socketClient.emitAck<{ sent: boolean }>(CLIENT_EVENTS.CHAT_EMOTE, payload);
    if (!response.ok) {
      toast.error(response.error?.message ?? 'Emote not sent.');
      return false;
    }
    audioManager.play('notification');
    return true;
  }, []);

  const reconnectToRoom = useCallback(async (roomId: string, sessionToken: string) => {
    const response = await socketClient.emitAck<{ room: RoomJoinedPayload['room']; playerId: string }>(
      CLIENT_EVENTS.RECONNECT_ATTEMPT,
      { roomId, sessionToken },
    );
    if (!response.ok || !response.data) return fail(response.error);
    useRoomStore.getState().setRoom(response.data.room);
    return response.data.room;
  }, []);

  return {
    listRooms,
    createRoom,
    quickPlay,
    joinRoom,
    leaveRoom,
    kickPlayer,
    addAI,
    removeAI,
    setReady,
    selectGame,
    updateSettings,
    startGame,
    leaveMatch,
    requestRematch,
    cancelRematch,
    sendChat,
    sendEmote,
    reconnectToRoom,
  };
}

export type RoomActions = ReturnType<typeof useRoomActions>;
