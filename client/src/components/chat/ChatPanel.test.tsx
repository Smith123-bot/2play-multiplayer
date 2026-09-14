import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ChatMessage } from '@2play/shared';
import { ChatPanel } from './ChatPanel';

/**
 * Chat panel contract: the transcript renders ONLY real player messages and
 * explicit emotes. System/lifecycle lines ("Match finished…", "Rematch
 * accepted…", "The match is starting…", join/leave notices) are status
 * information — they must never appear as chat, even if a stale snapshot or
 * legacy server build still puts them in the array.
 */

const myId = 'p1';

function playerMessage(text: string, playerId = myId): ChatMessage {
  return {
    id: `m-${text}`,
    roomId: 'r1',
    type: 'message',
    playerId,
    nickname: playerId === myId ? 'You' : 'Rival',
    avatar: '🦊',
    text,
    emote: null,
    systemEvent: null,
    createdAt: Date.now(),
  } as ChatMessage;
}

function systemMessage(event: string, text: string): ChatMessage {
  return {
    id: `sys-${event}`,
    roomId: 'r1',
    type: 'system',
    playerId: null,
    nickname: 'System',
    avatar: '🎮',
    text,
    emote: null,
    systemEvent: event,
    createdAt: Date.now(),
  } as ChatMessage;
}

function emoteMessage(emote: string, playerId = 'p2'): ChatMessage {
  return {
    id: `e-${emote}-${playerId}`,
    roomId: 'r1',
    type: 'emote',
    playerId,
    nickname: playerId === myId ? 'You' : 'Rival',
    avatar: '🐼',
    text: '',
    emote,
    systemEvent: null,
    createdAt: Date.now(),
  } as ChatMessage;
}

describe('ChatPanel', () => {
  it('renders player messages and emotes with author and time', () => {
    render(
      <ChatPanel
        messages={[playerMessage('good luck!'), playerMessage('you too', 'p2'), emoteMessage('🔥')]}
        myPlayerId={myId}
      />,
    );
    expect(screen.getByText('good luck!')).toBeInTheDocument();
    expect(screen.getByText('you too')).toBeInTheDocument();
    // Emote rows show the emoji plus the author name (multiple rows may exist).
    expect(screen.getAllByText('🔥').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Rival').length).toBeGreaterThan(0);
  });

  it('never renders lifecycle/system messages as chat', () => {
    const { container } = render(
      <ChatPanel
        messages={[
          systemMessage('game_started', 'The match is starting!'),
          playerMessage('gg'),
          systemMessage('game_finished', 'Match finished. You wins!'),
          systemMessage('rematch_started', 'Rematch accepted — new match starting!'),
          systemMessage('player_joined', 'Rival joined the room.'),
          emoteMessage('👏'),
        ]}
        myPlayerId={myId}
      />,
    );
    expect(screen.getByText('gg')).toBeInTheDocument();
    expect(container.textContent).not.toContain('The match is starting');
    expect(container.textContent).not.toContain('Match finished');
    expect(container.textContent).not.toContain('Rematch accepted');
    expect(container.textContent).not.toContain('joined the room');
  });

  it('shows the empty state when only lifecycle noise is present', () => {
    render(
      <ChatPanel messages={[systemMessage('game_finished', 'Match finished. Rival wins!')]} myPlayerId={myId} />,
    );
    expect(screen.getByText(/No messages yet/)).toBeInTheDocument();
  });
});
