import type { PublicPlayer } from "@couch-clash/shared";

export interface RankedPlayer {
  player: PublicPlayer;
  rank: number;
  score: number;
  gain: number;
}

/** Sorted by score, ties share a rank (1, 1, 3, …). */
export function rankPlayers(
  players: readonly PublicPlayer[],
  scores: Record<string, number>,
  gains: Record<string, number> = {},
): RankedPlayer[] {
  const sorted = [...players].sort((a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0));
  let rank = 0;
  let prev: number | null = null;
  return sorted.map((player, i) => {
    const score = scores[player.id] ?? 0;
    if (score !== prev) rank = i + 1;
    prev = score;
    return { player, rank, score, gain: gains[player.id] ?? 0 };
  });
}
