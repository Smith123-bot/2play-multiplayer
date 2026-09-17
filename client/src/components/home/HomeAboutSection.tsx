import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, DoorOpen, KeyRound } from 'lucide-react';
import type { GameMetadata } from '@2play/shared';
import { SITE_NAME, buildHomeAboutContent } from '@2play/shared';
import { Badge } from '../ui/Badge';

/**
 * "What is DuoPlay?" — the homepage's readable content section.
 *
 * Deliberately rendered LAST on the page: every interactive surface (hero
 * actions, game rails, public rooms) stays within the first scrolls on a
 * phone, while crawlers and curious readers still get genuinely useful text.
 * Every number in here is derived from the live catalogue via
 * buildHomeAboutContent — nothing is written by hand and nothing can go stale
 * when a game ships or is retired.
 */
export function HomeAboutSection({ games }: { games: readonly GameMetadata[] }) {
  const about = useMemo(() => buildHomeAboutContent(games), [games]);
  if (about.totalGames === 0) return null;

  return (
    <section
      aria-labelledby="about-duoplay"
      className="space-y-6 rounded-3xl border border-white/10 bg-surface/60 p-6 sm:p-8"
    >
      <div>
        <h2 id="about-duoplay" className="text-xl font-bold text-white">
          What is {SITE_NAME}?
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">
          {SITE_NAME} is a collection of {about.totalGames} two-dimensional multiplayer games
          that run right here in your browser. Matches happen in real time for two to four
          players, the server keeps the score so every result is fair, and there is nothing
          to install — you pick a nickname and you are playing.
        </p>
      </div>

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Game categories
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          The library covers {about.categories.length} kinds of play, from quick reflex
          tests to long strategy duels:
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {about.categories.map((category) => (
            <Badge key={category.id} tone="primary">
              {category.label} · {category.gameCount}
            </Badge>
          ))}
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            How rooms work
          </h3>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-slate-300">
            <li>Create a room for any game and you get a six-character code.</li>
            <li>Share the code — friends open {SITE_NAME}, tap Join room and type it in.</li>
            <li>
              The match starts when everyone is ready. Chat, results and instant rematches
              all happen inside the same room.
            </li>
          </ol>
        </div>
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Playing with friends — or solo
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">
            Rooms are private by default: only people with the code can join, or you can open
            a public room and let anyone drop in. {about.aiGames} of the {about.totalGames}{' '}
            games also include computer opponents at selectable difficulty, so you can
            practice or fill empty seats while you wait.
          </p>
        </div>
      </div>

      <nav aria-label="Get started" className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/5 pt-4 text-sm">
        <Link
          to="/create"
          className="inline-flex items-center gap-1.5 font-medium text-primary-300 hover:underline"
        >
          <DoorOpen className="h-4 w-4" aria-hidden /> Create a room and invite friends
        </Link>
        <Link
          to="/join"
          className="inline-flex items-center gap-1.5 font-medium text-primary-300 hover:underline"
        >
          <KeyRound className="h-4 w-4" aria-hidden /> Join a room with a code
        </Link>
        <Link
          to="/games"
          className="inline-flex items-center gap-1.5 font-medium text-primary-300 hover:underline"
        >
          Browse all {about.totalGames} games <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </nav>
    </section>
  );
}

export default HomeAboutSection;
