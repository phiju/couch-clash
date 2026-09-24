/**
 * Pure scoring functions. All factors are in [0, 1]; points are rounded to
 * whole numbers at the very end.
 */
import type { ScoringSettings } from "@couch-clash/shared";

export interface PointsBreakdown {
  points: number;
  /** 1 = correct / closest. 0 = wrong. */
  accuracy: number;
  /** 1 = fastest (or speed bonus off). */
  speed: number;
}

/**
 * Linear scale: `best` → 100 %, `worst` → minPercent, everything in between
 * linear by value. If best == worst everyone gets 100 %.
 */
export function linearFactor(value: number, best: number, worst: number, minPercent: number): number {
  if (worst === best) return 1;
  return 1 - (1 - minPercent / 100) * ((value - best) / (worst - best));
}

/** Time factor per id among the given (scoring) answers. `at` = server receive time. */
export function timeFactors(
  entries: readonly { id: string; at: number }[],
  settings: Pick<ScoringSettings, "speedBonus" | "minPercent">,
): Map<string, number> {
  const result = new Map<string, number>();
  if (!settings.speedBonus || entries.length === 0) {
    for (const e of entries) result.set(e.id, 1);
    return result;
  }
  const times = entries.map((e) => e.at);
  const first = Math.min(...times);
  const last = Math.max(...times);
  for (const e of entries) result.set(e.id, linearFactor(e.at, first, last, settings.minPercent));
  return result;
}

function points(settings: ScoringSettings, accuracy: number, speed: number): number {
  return Math.round(settings.basePoints * accuracy * speed);
}

/** Quiz: wrong/no answer = 0; correct = basePoints × timeFactor (among correct answers). */
export function scoreQuiz(
  answers: readonly { id: string; correct: boolean; at: number }[],
  settings: ScoringSettings,
): Record<string, PointsBreakdown> {
  const correct = answers.filter((a) => a.correct);
  const speed = timeFactors(correct, settings);
  const result: Record<string, PointsBreakdown> = {};
  for (const a of answers) {
    if (!a.correct) {
      result[a.id] = { points: 0, accuracy: 0, speed: 0 };
      continue;
    }
    const s = speed.get(a.id) ?? 1;
    result[a.id] = { points: points(settings, 1, s), accuracy: 1, speed: s };
  }
  return result;
}

/**
 * Estimate: closest gets 100 %, farthest minPercent – linear by distance
 * ("distance") or by rank position ("rank", robust against wild outliers).
 * Time factor among everyone who answered.
 */
export function scoreEstimate(
  answers: readonly { id: string; value: number; at: number }[],
  correctValue: number,
  settings: ScoringSettings,
): Record<string, PointsBreakdown> {
  const result: Record<string, PointsBreakdown> = {};
  if (answers.length === 0) return result;

  const distances = answers.map((a) => Math.abs(a.value - correctValue));
  const accuracy = new Map<string, number>();

  if (settings.estimateScale === "rank") {
    // Standard competition ranking: equal distances share a rank (1, 1, 3, …).
    const sorted = [...distances].sort((x, y) => x - y);
    const rankOf = (d: number) => sorted.indexOf(d) + 1;
    const ranks = distances.map(rankOf);
    const worst = Math.max(...ranks);
    answers.forEach((a, i) => accuracy.set(a.id, linearFactor(ranks[i]!, 1, worst, settings.minPercent)));
  } else {
    const best = Math.min(...distances);
    const worst = Math.max(...distances);
    answers.forEach((a, i) =>
      accuracy.set(a.id, linearFactor(distances[i]!, best, worst, settings.minPercent)),
    );
  }

  const speed = timeFactors(answers, settings);
  for (const a of answers) {
    const acc = accuracy.get(a.id) ?? 0;
    const s = speed.get(a.id) ?? 1;
    result[a.id] = { points: points(settings, acc, s), accuracy: acc, speed: s };
  }
  return result;
}
