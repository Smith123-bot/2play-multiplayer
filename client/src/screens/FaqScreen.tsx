import { Link } from 'react-router-dom';
import { useMemo } from 'react';
import { buildHomeAboutContent, findStaticInfoPage } from '@2play/shared';
import { InfoPageShell, InfoSection } from '../components/info/InfoPageShell';
import { useGameStore } from '../stores/gameStore';

const PAGE = findStaticInfoPage('/faq')!;

interface FaqEntry {
  question: string;
  answer: React.ReactNode;
}

/**
 * /faq — answers sourced from the platform's real behavior (room codes,
 * 2–4 players, session reconnects, persisted favorites, auto-tracked stats,
 * rate-limited chat). Counts come from the live registry, not hand-typed.
 */
export default function FaqScreen() {
  const games = useGameStore((store) => store.games);
  const about = useMemo(() => buildHomeAboutContent(games), [games]);
  const playerRange = useMemo(() => {
    if (games.length === 0) return '2–4';
    const min = Math.min(...games.map((game) => game.minPlayers));
    const max = Math.max(...games.map((game) => game.maxPlayers));
    return `${min}–${max}`;
  }, [games]);

  const entries: FaqEntry[] = [
    {
      question: 'What is DuoPlay?',
      answer: (
        <>
          A real-time multiplayer game platform for {playerRange} players: open a room, share
          a code and play together in the browser — no installs, no accounts, just a nickname.
          The server enforces every rule so all players see the same fair match.{' '}
          <Link to="/about" className="font-medium text-primary-300 hover:underline">More on the About page</Link>.
        </>
      ),
    },
    {
      question: 'Is DuoPlay 2D?',
      answer: (
        <>
          Yes — every game in the catalogue is a lightweight 2D experience built for quick
          sessions: boards, grids, cards, words and reaction tests that render instantly on
          any phone, tablet or desktop browser.
        </>
      ),
    },
    {
      question: 'How do I create a room?',
      answer: (
        <>
          Open <Link to="/create" className="font-medium text-primary-300 hover:underline">Create Room</Link> (or pick
          a game from the <Link to="/games" className="font-medium text-primary-300 hover:underline">catalogue</Link>),
          choose the game and player count, and the platform generates a private room with a
          six-character code. You stay in the room lobby until everyone is ready; the host
          starts the match.
        </>
      ),
    },
    {
      question: 'How do I join a room?',
      answer: (
        <>
          Ask the host for the room code, open{' '}
          <Link to="/join" className="font-medium text-primary-300 hover:underline">Join Room</Link> and type the six
          characters (letters A–Z and digits 2–9; case does not matter). Rooms listed under
          Public Rooms can also be joined without a code.
        </>
      ),
    },
    {
      question: 'How many players can play?',
      answer: (
        <>
          Depending on the game, {playerRange} players share a room. Each game page shows its
          exact range, and {about.aiGames} of {about.totalGames} games also support computer
          opponents at easy, medium or hard difficulty for solo practice.
        </>
      ),
    },
    {
      question: 'How do Favorites work?',
      answer: (
        <>
          Tap the heart on any game card to add it to Favorites. The list is stored against
          your anonymous session and survives page reloads and browser restarts on the same
          device; remove a game with the same heart, any time.
        </>
      ),
    },
    {
      question: 'How do Stats work?',
      answer: (
        <>
          After every finished match the server records it once: matches played, wins, losses,
          draws and win rate per game, plus a recent-match history. The Stats page reads those
          server-authoritative totals — there is nothing to update manually.
        </>
      ),
    },
    {
      question: 'What happens if I disconnect?',
      answer: (
        <>
          Your seat is held: the other player sees you as disconnected while the server keeps
          your place for a grace period — two minutes by default, per server configuration.
          Reopen DuoPlay (or reconnect on the same network) within that window and you rejoin
          automatically with your identity and the match state intact; after the window the
          seat is released and the room moves on without you.
        </>
      ),
    },
    {
      question: 'How does chat work?',
      answer: (
        <>
          Every room has text chat plus quick emotes, visible to the seated players. Messages
          are sanitized and rate-limited against spam, and the transcript lives only as long
          as the room — closing the room deletes it.
        </>
      ),
    },
    {
      question: 'Troubleshooting: common issues',
      answer: (
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong>&quot;Room not found&quot;</strong> — rooms close when everyone leaves or
            after inactivity; ask the host for a fresh code and check for typing mix-ups
            (codes never contain the digits 0 or 1).
          </li>
          <li>
            <strong>&quot;Cannot join&quot;</strong> — the room may be full or already in a
            match; public listings show only joinable rooms.
          </li>
          <li>
            <strong>Frequent disconnects</strong> — the connection banner shows live status;
            on mobile, switching networks drops the socket, but the reconnect grace (above)
            restores your seat.
          </li>
          <li>
            <strong>Stats or favorites look stale</strong> — they are cached briefly for
            performance; a page refresh reloads them from the server.
          </li>
        </ul>
      ),
    },
  ];

  return (
    <InfoPageShell page={PAGE}>
      <div className="grid gap-4 md:grid-cols-2">
        {entries.map((entry) => (
          <section
            key={entry.question}
            className="space-y-2 rounded-3xl border border-white/10 bg-surface/60 p-6"
          >
            <h2 className="text-base font-bold text-white">{entry.question}</h2>
            <div className="text-sm leading-relaxed text-slate-300">{entry.answer}</div>
          </section>
        ))}
      </div>
      <InfoSection title="Still stuck?">
        <p>
          The <Link to="/contact" className="font-medium text-primary-300 hover:underline">contact page</Link> lists the
          configured channel, and the <Link to="/privacy" className="font-medium text-primary-300 hover:underline">Privacy Policy</Link>{' '}
          explains exactly what data exists and for how long.
        </p>
      </InfoSection>
    </InfoPageShell>
  );
}
