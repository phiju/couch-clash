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

/**
 * Bluff: points for finding the real definition and for fooling others.
 *   base = maxPoints × (votedCorrect + knewIt) + round(maxPoints × perFooledShare) × fooled
 * (defaults: 100 for the right vote, 100 for writing a correct definition, 50 per fooled player)
 */
export interface BluffInput {
  votedCorrect: boolean;
  /** Wrote an essentially correct definition ("Gewusst!"). */
  knewIt: boolean;
  /** Players who voted for this player's invented definition. */
  fooled: number;
  /** Share of maxPoints per fooled player (default 0.5). */
  perFooledShare?: number;
  /** Share of maxPoints for "Gewusst!" (default 1). */
  knewItShare?: number;
}

export interface BaseScoreInputs {
  absolute: AbsoluteInput;
  proximity: ProximityInput;
  bluff: BluffInput;
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

  bluff: ({ votedCorrect, knewIt, fooled, perFooledShare = 0.5, knewItShare = 1 }, maxPoints) =>
    (votedCorrect ? maxPoints : 0) +
    (knewIt ? Math.round(maxPoints * knewItShare) : 0) +
    Math.round(maxPoints * perFooledShare) * Math.max(0, Math.floor(fooled)),
};

/** Modes whose base score may exceed maxPoints (points add up from several parts). */
const UNCAPPED_MODES: ReadonlySet<BaseScoreMode> = new Set(["bluff"]);

/** 0..maxPoints (bluff: ≥ 0), rounded to whole points. */
export function calculateBaseScore<M extends BaseScoreMode>(
  mode: M,
  input: BaseScoreInputs[M],
  maxPoints: number,
): number {
  const strategy = BASE_SCORE_STRATEGIES[mode] as Strategy<BaseScoreInputs[M]>;
  const score = strategy(input, maxPoints);
  if (!Number.isFinite(score)) return 0;
  const capped = UNCAPPED_MODES.has(mode) ? score : Math.min(maxPoints, score);
  return Math.round(Math.max(0, capped));
}
