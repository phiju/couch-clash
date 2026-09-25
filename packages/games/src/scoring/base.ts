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
 * Bluff: points for finding the real definition and for fooling others –
 * the fooling bonus scales with the share of players fooled, so it doesn't
 * grow with the number of players:
 *   found the real one:  + find
 *   your bluff:          + fool × pickers / eligibleVoters
 *   you knew it:         + know + fool × realPickers / eligibleVoters
 * (defaults 100 each; the per-question cap of 200 is applied afterwards)
 */
export interface BluffInput {
  /** Voted for the real definition. */
  found: boolean;
  /** Wrote an essentially correct definition ("Gewusst!"). */
  knew: boolean;
  /** Players who picked this player's invented definition. */
  pickers: number;
  /** Players who picked the real definition (the knowers' bonus). */
  realPickers: number;
  /** Players allowed to vote in this word, without this player. */
  eligibleVoters: number;
  points: { find: number; know: number; fool: number };
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

  bluff: ({ found, knew, pickers, realPickers, eligibleVoters, points }) => {
    const share = (n: number) => (eligibleVoters > 0 ? Math.max(0, Math.min(n, eligibleVoters)) / eligibleVoters : 0);
    return (
      (found ? points.find : 0) +
      Math.round(points.fool * share(pickers)) +
      (knew ? points.know + Math.round(points.fool * share(realPickers)) : 0)
    );
  },
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
