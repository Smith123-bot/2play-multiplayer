import { Link } from 'react-router-dom';
import { useMemo } from 'react';
import { buildHomeAboutContent, findStaticInfoPage } from '@2play/shared';
import { InfoPageShell, InfoSection } from '../components/info/InfoPageShell';
import { Badge } from '../components/ui/Badge';
import { useGameStore } from '../stores/gameStore';

const PAGE = findStaticInfoPage('/about')!;

/**
 * /about — what DuoPlay is, its purpose, how rooms work and which game types
 * exist. Counts and categories come from the live GameRegistry metadata, so
 * the page stays true as the catalogue evolves.
 */
export default function AboutScreen() {
  const games = useGameStore((store) => store.games);
  const about = useMemo(() => buildHomeAboutContent(games), [games]);

  return (
    <InfoPageShell page={PAGE}>
      <InfoSection title="What DuoPlay is">
        <p>
          DuoPlay is a real-time <strong>2D multiplayer game platform</strong> for 2–4
          players. Every game runs entirely in the browser — nothing to install or download —
          while DuoPlay's servers enforce the rules, keep score and relay every move between
          players as it happens.
        </p>
        <p>
          The purpose is simple: make it effortless to play proper games with friends. No
          sign-up wall, no launcher, no installs — pick a nickname, open a room and play.
          The catalogue you see
          {about.totalGames > 0 ? ` (${about.totalGames} games today)` : ''} always comes from
          the live registry — the same one the server and the games list use.
        </p>
      </InfoSection>

      <InfoSection title="How multiplayer rooms work">
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            <strong>Create a room</strong> — pick a game and the platform mints a
            six-character room code.
          </li>
          <li>
            <strong>Invite friends</strong> — they enter the code on the Join page (or join a
            public room you opened up). Rooms are private until you share the code.
          </li>
          <li>
            <strong>Ready up and play</strong> — when everyone is ready the host starts the
            match; the server runs a fair 3-2-1 countdown, then relays moves in real time.
            In-room text chat and emotes keep the table talk alive.
          </li>
          <li>
            <strong>Rematch or leave</strong> — after the result, vote for a rematch to run it
            back in the same room, or head back to the lobby.
          </li>
        </ol>
      </InfoSection>

      <InfoSection title="Supported game types">
        <p>
          The catalogue spans reflex, memory, word, strategy, math and co-op games — from
          one-tap reaction duels to full chess and card battles.{' '}
          {about.aiGames > 0 && (
            <>
              {about.aiGames} of {about.totalGames} games can also be played against the
              computer at selectable difficulty.
            </>
          )}
        </p>
        <ul className="flex flex-wrap gap-2" aria-label="Game categories">
          {about.categories.map((category) => (
            <li key={category.id}>
              <Badge>
                {category.label} · {category.gameCount}
              </Badge>
            </li>
          ))}
        </ul>
        <p>
          <Link to="/games" className="font-medium text-primary-300 hover:underline">
            Browse the full catalogue
          </Link>
          , or read the <Link to="/faq" className="font-medium text-primary-300 hover:underline">FAQ</Link> for
          the creating-and-joining walkthrough.
        </p>
      </InfoSection>
    </InfoPageShell>
  );
}
