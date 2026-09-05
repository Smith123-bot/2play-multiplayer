import type { AuthSuccessPayload, SessionInfo } from '@2play/shared';
import { CLIENT_EVENTS } from '@2play/shared';
import { socketClient } from './socketClient';
import { setLocalPlayerId } from '../stores/roomStore';
import { useSessionStore as sessionStore } from '../stores/sessionStore';

/**
 * Authenticates (or restores) the local session over the socket.
 * Idempotent: repeated calls reuse the existing session token.
 */
export async function authenticateSession(
  nickname?: string,
  avatar?: string,
): Promise<SessionInfo | null> {
  const state = sessionStore.getState();
  const name = (nickname ?? state.nickname ?? '').trim();
  if (name.length < 3) return null;

  const response = await socketClient.emitAck<AuthSuccessPayload>(CLIENT_EVENTS.AUTHENTICATE, {
    nickname: name,
    avatar: avatar ?? state.avatar ?? '🦊',
    ...(state.session?.sessionToken ? { sessionToken: state.session.sessionToken } : {}),
  });

  if (!response.ok || !response.data) return null;
  sessionStore.getState().setSession(response.data.session);
  setLocalPlayerId(response.data.session.playerId);
  return response.data.session;
}

/** True when the player already has a usable session. */
export function hasSession(): boolean {
  return sessionStore.getState().session !== null;
}

export function currentSessionToken(): string | null {
  return sessionStore.getState().session?.sessionToken ?? null;
}
