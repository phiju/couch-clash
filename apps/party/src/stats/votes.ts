/** 👍 / 👎 per question: one vote per player, tapping again changes it. */
export type Vote = "up" | "down";

export interface QuestionVotes {
  contentId: string;
  categoryId: string;
  byPlayer: Record<string, Vote>;
}

export function applyVote(
  votes: QuestionVotes | null,
  target: { contentId: string; categoryId: string },
  playerId: string,
  vote: Vote,
): QuestionVotes {
  const current = votes?.contentId === target.contentId ? votes : { ...target, byPlayer: {} };
  return { ...current, byPlayer: { ...current.byPlayer, [playerId]: vote } };
}

export function voteCounts(votes: QuestionVotes): { up: number; down: number } {
  const all = Object.values(votes.byPlayer);
  return { up: all.filter((v) => v === "up").length, down: all.filter((v) => v === "down").length };
}
