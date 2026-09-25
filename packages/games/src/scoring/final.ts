import { DEFAULT_PER_QUESTION_CAP, type ScoringSettings } from "@couch-clash/shared";
import { calculateBaseScore, type BaseScoreInputs } from "./base";
import { calculateSpeedModifier } from "./speed";

/** finalScore = round(baseScore × speedModifier); base 0 stays 0. */
export function calculateFinalScore(baseScore: number, speedModifier: number): number {
  if (!(baseScore > 0)) return 0; // a fast wrong answer never earns points
  return Math.max(0, Math.round(baseScore * speedModifier));
}

/** What every client gets per player at the reveal. */
export interface ScoreResult {
  baseScore: number;
  speedModifier: number;
  finalScore: number;
}

export const NO_ANSWER: ScoreResult = { baseScore: 0, speedModifier: 1, finalScore: 0 };

/**
 * Scores ONE answer: quality first, then speed. Depends only on this
 * player's answer and response time – never on the other players.
 */
export function scoreAnswer<M extends ScoringSettings["mode"]>(
  scoring: ScoringSettings & { mode: M },
  input: BaseScoreInputs[M],
  timing: { responseTimeMs: number; timeLimitMs: number },
): ScoreResult {
  const baseScore = calculateBaseScore(scoring.mode, input, scoring.maxPoints);
  const speedModifier = calculateSpeedModifier(timing.responseTimeMs, timing.timeLimitMs, scoring.speedModifier);
  return { baseScore, speedModifier, finalScore: capPerQuestion(calculateFinalScore(baseScore, speedModifier), scoring) };
}

/** The global per-question cap (default 200), applied after every category's own scoring. */
export function capPerQuestion(points: number, scoring: Pick<ScoringSettings, "perQuestionCap">): number {
  return Math.min(points, scoring.perQuestionCap ?? DEFAULT_PER_QUESTION_CAP);
}
