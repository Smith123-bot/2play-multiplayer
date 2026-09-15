import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomListResultPayload, RoomSummary } from '@2play/shared';
import { SERVER_EVENTS } from '@2play/shared';
import { socketClient } from '../multiplayer/socketClient';
import { useRoomActions } from './useRoomActions';
import { useConnectionStore } from '../stores/connectionStore';

/**
 * Live public room listing.
 *
 * The server pushes the listing over the existing `room:list` socket channel
 * whenever it may have changed (created / joined / left / closed / match
 * start / finish), so a newly created public room appears without a refresh.
 * This hook subscribes to those pushes and only falls back to explicit
 * fetching on mount, on filter change, after a reconnect (pushes sent while
 * offline are missed) and on a slow 60 s safety-net poll — never aggressive
 * polling, never a page reload.
 */
const FALLBACK_REFRESH_MS = 60_000;

export function usePublicRooms(gameId?: string) {
  const { listRooms } = useRoomActions();
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const connection = useConnectionStore((store) => store.state);
  const filterRef = useRef<string | null>(gameId ?? null);
  filterRef.current = gameId ?? null;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listRooms(filterRef.current ?? undefined);
      setRooms(result);
    } finally {
      setLoading(false);
    }
  }, [listRooms]);

  const backgroundRefresh = useCallback(async () => {
    // Safety-net refresh: updates silently so no spinner flashes.
    try {
      const result = await listRooms(filterRef.current ?? undefined);
      setRooms(result);
    } catch {
      // The next push or poll will repair it; never break the page.
    }
  }, [listRooms]);

  // Initial fetch + refetch when the game filter changes.
  useEffect(() => {
    void refresh();
  }, [refresh, gameId]);

  // Live server pushes on the same `room:list` channel as the request/response
  // flow (pushes are unfiltered, so a game filter is applied client-side —
  // public summaries only, nothing private is ever exposed).
  useEffect(() => {
    const off = socketClient.on<RoomListResultPayload>(SERVER_EVENTS.ROOM_LIST, (payload) => {
      const filter = filterRef.current;
      setRooms(filter ? payload.rooms.filter((room) => room.gameId === filter) : payload.rooms);
      setLoading(false);
    });
    return off;
  }, []);

  // Refetch after a reconnect (pushes sent while offline were missed).
  const wasConnected = useRef(connection === 'CONNECTED');
  useEffect(() => {
    const isConnected = connection === 'CONNECTED';
    if (isConnected && !wasConnected.current) void backgroundRefresh();
    wasConnected.current = isConnected;
  }, [connection, backgroundRefresh]);

  // Slow safety net only — live updates come from the socket.
  useEffect(() => {
    const timer = window.setInterval(() => void backgroundRefresh(), FALLBACK_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [backgroundRefresh]);

  return { rooms, loading, refresh };
}

export default usePublicRooms;
