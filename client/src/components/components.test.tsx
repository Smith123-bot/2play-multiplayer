import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Button } from './ui/Button';
import { Card, CardHeader } from './ui/Card';
import { Input } from './ui/Input';
import { Toggle } from './ui/Toggle';
import { GameCard } from './game/GameCard';
import { PlayerList } from './room/PlayerList';
import { HostControls } from './room/HostControls';
import { RematchPanel } from './rematch/RematchPanel';
import { REACTION_RACE_METADATA, type Player, type RoomState } from '@2play/shared';

const player = (overrides: Partial<Player> = {}): Player =>
  ({
    id: 'p1',
    nickname: 'Player One',
    avatar: '🦊',
    isHost: false,
    isReady: false,
    isConnected: true,
    isAI: false,
    aiDifficulty: null,
    score: 0,
    seatIndex: 0,
    joinedAt: Date.now(),
    isDisconnected: false,
    reconnectDeadline: null,
    disconnectedAt: null,
    role: 'player',
    ...overrides,
  }) as Player;

describe('UI components', () => {
  it('Button fires clicks and honours the disabled state', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Start</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(onClick).toHaveBeenCalledTimes(1);

    const second = vi.fn();
    render(<Button onClick={second} disabled>Disabled</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Disabled' }));
    expect(second).not.toHaveBeenCalled();
  });

  it('Input renders labels, hints and errors accessibly', () => {
    render(<Input label="Nickname" hint="3-20 chars" error="Too short" />);
    const input = screen.getByLabelText('Nickname');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby');
    expect(screen.getByRole('alert')).toHaveTextContent('Too short');
  });

  it('Card header renders title, subtitle and action', () => {
    render(
      <Card>
        <CardHeader title="Lobby" subtitle="Waiting for players" action={<span>2/4</span>} />
      </Card>,
    );
    expect(screen.getByText('Lobby')).toBeInTheDocument();
    expect(screen.getByText('Waiting for players')).toBeInTheDocument();
    expect(screen.getByText('2/4')).toBeInTheDocument();
  });

  it('Toggle exposes switch semantics', async () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Private room" />);
    const toggle = screen.getByRole('switch', { name: 'Private room' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('GameCard renders metadata and toggles favorites', async () => {
    const onToggle = vi.fn();
    render(
      <MemoryRouter>
        <GameCard game={REACTION_RACE_METADATA} favorite onToggleFavorite={onToggle} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Reaction Race')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Reaction Race' })).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'Remove Reaction Race from favorites' }),
    );
    expect(onToggle).toHaveBeenCalledWith('reaction-race');
  });

  it('GameCard (inline mode) expands to show Play with AI, Create Room and Join Room', async () => {
    const onToggleExpand = vi.fn();
    const onQuickPlay = vi.fn();
    const onCreateRoom = vi.fn();
    const onJoinRoom = vi.fn();

    render(
      <MemoryRouter>
        <GameCard
          game={REACTION_RACE_METADATA}
          expanded
          onToggleExpand={onToggleExpand}
          onQuickPlay={onQuickPlay}
          onCreateRoom={onCreateRoom}
          onJoinRoom={onJoinRoom}
        />
      </MemoryRouter>,
    );

    const playWithAI = screen.getByRole('button', { name: /Play with AI/i });
    await userEvent.click(playWithAI);
    expect(onQuickPlay).toHaveBeenCalledWith('reaction-race');

    await userEvent.click(screen.getByRole('button', { name: /Create Room/i }));
    expect(onCreateRoom).toHaveBeenCalledWith('reaction-race');

    await userEvent.click(screen.getByRole('button', { name: /Join Room/i }));
    expect(onJoinRoom).toHaveBeenCalledWith('reaction-race');
  });

  it('GameCard (inline mode) hides Play with AI for a game without AI support', () => {
    render(
      <MemoryRouter>
        <GameCard
          game={{ ...REACTION_RACE_METADATA, hasAI: false }}
          expanded
          onToggleExpand={vi.fn()}
          onQuickPlay={vi.fn()}
          onCreateRoom={vi.fn()}
          onJoinRoom={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('button', { name: /Play with AI/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Play with AI unavailable/i)).toBeInTheDocument();
  });

  it('HostControls (Create Room lobby) has no AI difficulty selector or Add AI control', () => {
    render(
      <HostControls
        game={REACTION_RACE_METADATA}
        settings={{ playerCount: 2, aiOpponents: 0, aiDifficulty: 'medium' }}
        maxPlayers={2}
        playerCount={2}
        canStart
        startBlockedReason={null}
      />,
    );

    expect(screen.queryByLabelText(/AI difficulty/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/AI opponents/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add AI opponent/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start match' })).toBeInTheDocument();
  });

  it('PlayerList shows host, readiness and disconnect state', () => {
    render(
      <PlayerList
        players={[
          player({ id: 'p1', isHost: true, isReady: true }),
          player({ id: 'p2', nickname: 'Bot', isAI: true, aiDifficulty: 'hard' }),
          player({ id: 'p3', nickname: 'Gone', isConnected: false, isDisconnected: true }),
        ]}
        myPlayerId="p1"
        hostPlayerId="p1"
        canKick={false}
      />,
    );
    expect(screen.getByText('Host')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText(/AI hard/)).toBeInTheDocument();
    expect(screen.getByText(/Reconnecting/)).toBeInTheDocument();
  });

  it('RematchPanel reflects votes and calls the handlers', async () => {
    const onRequest = vi.fn();
    const onLeave = vi.fn();
    const room = {
      id: 'ABC234',
      players: [player({ id: 'p1', isReady: true }), player({ id: 'p2', nickname: 'Two' })],
      rematchVotes: { p1: true },
      rematchDeadline: Date.now() + 30_000,
    } as unknown as RoomState;

    render(
      <RematchPanel
        room={room}
        myPlayerId="p1"
        onRequest={onRequest}
        onCancel={vi.fn()}
        onLeave={onLeave}
      />,
    );

    expect(screen.getByText('1/2 players ready')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Cancel vote/i }));
    expect(screen.getByRole('button', { name: /Leave room/i })).toBeInTheDocument();
  });
});
