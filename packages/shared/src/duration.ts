import type { CategoryMeta } from "./game-module";
import { INTRO_MS, SCOREBOARD_MS } from "./state";

export interface PlannedRound {
  meta: Pick<CategoryMeta, "estimatedSecondsPerQuestion">;
  questionCount: number;
}

/** Estimated game length in seconds: intro + questions + scoreboard per category. */
export function estimateGameSeconds(rounds: readonly PlannedRound[]): number {
  return rounds.reduce(
    (sum, r) =>
      sum +
      INTRO_MS / 1000 +
      r.questionCount * r.meta.estimatedSecondsPerQuestion +
      SCOREBOARD_MS / 1000,
    0,
  );
}

/** "ca. 12 Minuten" – rounded to whole minutes, at least 1. */
export function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes === 1 ? "ca. 1 Minute" : `ca. ${minutes} Minuten`;
}
