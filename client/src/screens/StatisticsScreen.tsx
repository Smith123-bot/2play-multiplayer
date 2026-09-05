import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Award, BarChart3, Clock, Trophy } from 'lucide-react';
import { Card, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { ProgressBar } from '../components/ui/ProgressBar';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingBlock } from '../components/ui/Spinner';
import { useStatisticsStore } from '../stores/statisticsStore';
import { useGameStore } from '../stores/gameStore';
import { useSessionStore } from '../stores/sessionStore';
import { formatDuration } from '../utils/format';

export function StatisticsScreen() {
  const { statistics, history, summary, loading, load } = useStatisticsStore();
  const games = useGameStore((store) => store.games);
  const loadGames = useGameStore((store) => store.load);
  const session = useSessionStore((store) => store.session);

  useEffect(() => {
    void loadGames();
    void load();
  }, [load, loadGames]);

  if (!session) {
    return (
      <EmptyState
        icon="👤"
        title="Pick a nickname to track stats"
        description="Statistics are linked to your local player session."
        action={
          <Link to="/" className="btn-primary">
            Back home
          </Link>
        }
      />
    );
  }

  if (loading && !summary) return <LoadingBlock message="Loading statistics…" />;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-white">Statistics</h1>
        <p className="mt-1 text-sm text-slate-400">Your results across every 2PLAY game.</p>
      </header>

      {summary ? (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card className="text-center">
            <Trophy className="mx-auto mb-1 h-5 w-5 text-amber-300" aria-hidden />
            <p className="stat-value">{summary.totalPlayed}</p>
            <p className="stat-label">Matches</p>
          </Card>
          <Card className="text-center">
            <Award className="mx-auto mb-1 h-5 w-5 text-success" aria-hidden />
            <p className="stat-value">{summary.wins}</p>
            <p className="stat-label">Wins</p>
          </Card>
          <Card className="text-center">
            <BarChart3 className="mx-auto mb-1 h-5 w-5 text-primary-300" aria-hidden />
            <p className="stat-value">{summary.winRate}%</p>
            <p className="stat-label">Win rate</p>
          </Card>
          <Card className="text-center">
            <Clock className="mx-auto mb-1 h-5 w-5 text-secondary-400" aria-hidden />
            <p className="stat-value">{summary.draws}</p>
            <p className="stat-label">Draws</p>
          </Card>
        </section>
      ) : null}

      <Card>
        <CardHeader title="Per game" subtitle="Wins, losses and best score" />
        {statistics.length === 0 ? (
          <EmptyState
            icon="🎯"
            title="No matches recorded yet"
            description="Finish a match to see your statistics here."
          />
        ) : (
          <ul className="space-y-4">
            {statistics.map((stat) => {
              const game = games.find((entry) => entry.id === stat.gameId);
              const total = Math.max(1, stat.totalPlayed);
              return (
                <li key={stat.gameId} className="surface-muted p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className="text-xl" aria-hidden>
                        {game?.icon ?? '🎮'}
                      </span>
                      <Link to={`/games/${stat.gameId}`} className="font-medium text-white hover:underline">
                        {game?.name ?? stat.gameId}
                      </Link>
                    </span>
                    <Badge tone={stat.wins > stat.losses ? 'success' : 'default'}>
                      {stat.wins}W · {stat.losses}L · {stat.draws}D
                    </Badge>
                  </div>
                  <ProgressBar
                    value={(stat.wins / total) * 100}
                    tone="success"
                    label={`Win rate ${Math.round((stat.wins / total) * 100)}% · best score ${stat.bestScore}`}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Match history" subtitle="Your most recent matches" />
        {history.length === 0 ? (
          <EmptyState icon="🕓" title="No history yet" description="Play a match to build your history." />
        ) : (
          <ul className="divide-y divide-white/5">
            {history.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">{entry.gameName}</p>
                  <p className="truncate text-xs text-slate-400">
                    Room {entry.roomId} · {formatDuration(entry.durationSeconds)} ·{' '}
                    {entry.players.map((player) => player.nickname).join(', ')}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-sm tabular-nums text-slate-300">{entry.score}</span>
                  <Badge
                    tone={
                      entry.result === 'win' ? 'success' : entry.result === 'loss' ? 'danger' : 'warning'
                    }
                  >
                    {entry.result}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export default StatisticsScreen;
