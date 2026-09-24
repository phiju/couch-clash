/**
 * BASE SCORE – answer quality, per player. Never compares players.
 *
 * Strategy registry: one entry per mode. A new mode = one new entry here
 * (plus its name in BASE_SCORE_MODES in @couch-clash/shared).
 */
import type { BaseScoreMode } from "@couch-clash/shared";

/** Absolute: correct → maxPoints, wrong → 0 (e.g. multiple choice). */
export interface AbsoluteInput {
  correct: boolean;
}

/**
 * Proximity: measured only against the correct answer.
 *   error = |answer − correctAnswer|
 *   base  = maxPoints × max(0, 1 − error / zeroRange)
 * zeroRange defaults to |correctAnswer| (100 % of the correct value).
 */
export interface ProximityInput {
  answer: number;
  correctAnswer: number;
  /** Error at which the score reaches 0 (same unit as the answer). */
  zeroRange?: number;
}

export interface BaseScoreInputs {
  absolute: AbsoluteInput;
  proximity: ProximityInput;
}

type Strategy<TInput> = (input: TInput, maxPoints: number) => number;

export const BASE_SCORE_STRATEGIES: { [M in BaseScoreMode]: Strategy<BaseScoreInputs[M]> } = {
  absolute: ({ correct }, maxPoints) => (correct === true ? maxPoints : 0),

  proximity: ({ answer, correctAnswer, zeroRange }, maxPoints) => {
    if (!Number.isFinite(answer) || !Number.isFinite(correctAnswer)) return 0; // invalid = no answer
    const range = zeroRange ?? Math.abs(correctAnswer);
    if (!(range > 0) || !Number.isFinite(range)) {
      // Only reachable for content without a usable zeroRange (the schema forbids it):
      // exact hit still counts, anything else is 0.
      return answer === correctAnswer ? maxPoints : 0;
    }
    const error = Math.abs(answer - correctAnswer);
    return maxPoints * Math.max(0, 1 - error / range);
  },
};

/** 0..maxPoints, rounded to whole points. */
export function calculateBaseScore<M extends BaseScoreMode>(
  mode: M,
  input: BaseScoreInputs[M],
  maxPoints: number,
): number {
  const strategy = BASE_SCORE_STRATEGIES[mode] as Strategy<BaseScoreInputs[M]>;
  const score = strategy(input, maxPoints);
  return Number.isFinite(score) ? Math.round(Math.min(maxPoints, Math.max(0, score))) : 0;
}
