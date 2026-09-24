/**
 * Leaderboard snapshots for the animated ranking. Computed on the server;
 * clients only animate from these numbers.
 */

export interface LeaderboardEntry {
  playerId: string;
  scoreBefore: number;
  pointsGained: number;
  scoreAfter: number;
  /** Competition ranking: ties share a rank (1, 1, 3, …). */
  rankBefore: number;
  rankAfter: number;
  /** Row position (0-based, unique) – ties ordered by name. */
  positionBefore: number;
  positionAfter: number;
}

interface RankablePlayer {
  id: string;
  name: string;
}

/** Order by score desc, then name (stable, locale-aware); ties share a rank. */
export function rankByScore(
  players: readonly RankablePlayer[],
  scores: Readonly<Record<string, number>>,
): { id: string; rank: number; position: number }[] {
  const sorted = [...players].sort(
    (a, b) =>
      (scores[b.id] ?? 0) - (scores[a.id] ?? 0) ||
      a.name.localeCompare(b.name, "de", { sensitivity: "base" }) ||
      a.id.localeCompare(b.id),
  );
  let rank = 0;
  let prev: number | null = null;
  return sorted.map((p, position) => {
    const score = scores[p.id] ?? 0;
    if (score !== prev) rank = position + 1;
    prev = score;
    return { id: p.id, rank, position };
  });
}

/** Entries sorted by the new order (positionAfter). */
export function buildLeaderboard(
  players: readonly RankablePlayer[],
  scoresBefore: Readonly<Record<string, number>>,
  gained: Readonly<Record<string, number>>,
): LeaderboardEntry[] {
  const scoresAfter: Record<string, number> = {};
  for (const p of players) scoresAfter[p.id] = (scoresBefore[p.id] ?? 0) + (gained[p.id] ?? 0);
  const before = new Map(rankByScore(players, scoresBefore).map((r) => [r.id, r]));
  return rankByScore(players, scoresAfter).map((after) => {
    const b = before.get(after.id)!;
    return {
      playerId: after.id,
      scoreBefore: scoresBefore[after.id] ?? 0,
      pointsGained: gained[after.id] ?? 0,
      scoreAfter: scoresAfter[after.id]!,
      rankBefore: b.rank,
      rankAfter: after.rank,
      positionBefore: b.position,
      positionAfter: after.position,
    };
  });
}
