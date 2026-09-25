import type { CategoryMeta } from "./game-module";
import { INTRO_MS, SCOREBOARD_MS } from "./state";

/** Time outside the questions, for duration estimates and the Zufall planner. */
export const DURATION_CONFIG = {
  /** Per category: intro card + scoreboard. */
  perCategoryOverheadSec: (INTRO_MS + SCOREBOARD_MS) / 1000,
  /** Per game: host's opening, player intro and finale. */
  perGameOverheadSec: 45,
} as const;

export interface PlannedRound {
  meta: Pick<CategoryMeta, "estimatedSecondsPerQuestion">;
  questionCount: number;
}

/** Estimated game length in seconds: per game overhead + per category (intro, questions, scoreboard). */
export function estimateGameSeconds(rounds: readonly PlannedRound[]): number {
  if (rounds.length === 0) return 0;
  return rounds.reduce<number>(
    (sum, r) => sum + DURATION_CONFIG.perCategoryOverheadSec + r.questionCount * r.meta.estimatedSecondsPerQuestion,
    DURATION_CONFIG.perGameOverheadSec,
  );
}

/** "ca. 12 Minuten" – rounded to whole minutes, at least 1. */
export function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes === 1 ? "ca. 1 Minute" : `ca. ${minutes} Minuten`;
}
