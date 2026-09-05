export interface GameRepositoryStats {
  totalPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  favoriteGameId: string | null;
}
