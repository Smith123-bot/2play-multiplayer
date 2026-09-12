import { useCallback, useEffect, useState } from 'react';
import type { GameMetadata, HowToPlay } from '@2play/shared';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

/**
 * The single, shared How To Play popup.
 *
 * Every game reuses this component — games never ship their own rules dialog.
 * Games that provide structured `metadata.howToPlay` get the full layout;
 * everything else falls back to the existing flat `rules` list, so all
 * previously shipped games keep working untouched.
 */

export interface HowToPlayContentProps {
  game: GameMetadata;
}

function sectionsFor(game: GameMetadata): HowToPlay {
  // Derived from the metadata every game already has.
  const derived: HowToPlay = {
    objective: game.description,
    steps: game.rules,
    controls: { mobile: game.controls, desktop: game.controls },
    scoring: game.scoring,
    winCondition: game.winCondition,
    timeLimit: `About ${Math.max(1, Math.round(game.estimatedDuration / 60))} min per match.`,
    specialRules: [],
    playerCount:
      game.minPlayers === game.maxPlayers
        ? `${game.minPlayers} players`
        : `${game.minPlayers}–${game.maxPlayers} players`,
  };
  // A game may override any subset of the sections; everything else is derived.
  const override = game.howToPlay;
  if (!override) return derived;
  return {
    ...derived,
    ...override,
    controls: { ...derived.controls, ...(override.controls ?? {}) },
  };
}

function Section({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-300">
        <span aria-hidden>{icon}</span> {title}
      </h3>
      <div className="text-sm text-slate-400">{children}</div>
    </section>
  );
}

export function HowToPlayContent({ game }: HowToPlayContentProps) {
  const content = sectionsFor(game);
  return (
    <div className="space-y-4">
      <Section icon="🎯" title="Objective">
        <p>{content.objective}</p>
      </Section>

      <Section icon="🎮" title="How to play">
        <ol className="list-decimal space-y-1 pl-5">
          {content.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </Section>

      <Section icon="🕹" title="Controls">
        <p>
          <span className="text-slate-300">Mobile:</span> {content.controls.mobile}
        </p>
        <p>
          <span className="text-slate-300">Desktop:</span> {content.controls.desktop}
        </p>
      </Section>

      <Section icon="⭐" title="Scoring">
        <p>{content.scoring}</p>
      </Section>

      <Section icon="🏆" title="Win condition">
        <p>{content.winCondition}</p>
      </Section>

      <Section icon="⏱" title="Time limit">
        <p>{content.timeLimit}</p>
      </Section>

      {content.specialRules.length > 0 ? (
        <Section icon="✨" title="Special rules">
          <ul className="list-disc space-y-1 pl-5">
            {content.specialRules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section icon="👥" title="Players">
        <p>{content.playerCount}</p>
      </Section>
    </div>
  );
}

export interface HowToPlayModalProps {
  game: GameMetadata;
  open: boolean;
  onClose: () => void;
}

export function HowToPlayModal({ game, open, onClose }: HowToPlayModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={game.name}
      description="How to play"
      size="md"
      footer={
        <Button onClick={onClose} className="w-full">
          Got it
        </Button>
      }
    >
      <HowToPlayContent game={game} />
    </Modal>
  );
}

const STORAGE_PREFIX = '2play:howtoplay:';

/**
 * Shows the rules popup automatically the first time a player opens a given
 * game, and exposes a manual re-open. The "seen" flag is per game and stored
 * locally, so it never costs a server round trip.
 */
export function useHowToPlay(gameId: string | undefined, enabled = true): {
  open: boolean;
  show: () => void;
  close: () => void;
} {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!enabled || !gameId) return;
    let seen = false;
    try {
      seen = window.localStorage.getItem(`${STORAGE_PREFIX}${gameId}`) === '1';
    } catch {
      seen = false;
    }
    if (!seen) setOpen(true);
  }, [gameId, enabled]);

  const close = useCallback(() => {
    setOpen(false);
    if (!gameId) return;
    try {
      window.localStorage.setItem(`${STORAGE_PREFIX}${gameId}`, '1');
    } catch {
      // Private mode / storage disabled: the popup simply shows again later.
    }
  }, [gameId]);

  const show = useCallback(() => setOpen(true), []);

  return { open, show, close };
}
