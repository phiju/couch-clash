/**
 * "Zufall" with a target duration: a random plan (categories, order,
 * questions per category) that fills the chosen time as closely as possible.
 * Pure – the settings panel calls it, unit tests pin it with a seeded rng.
 */
import { estimateGameSeconds, type CategoryMeta, type GameMode } from "@couch-clash/shared";
import { shuffle } from "./random";

export const PLANNER_CONFIG = {
  /** Target durations offered to the host (minutes). */
  durations: [15, 30, 45, 60, 90] as const,
  defaultMinutes: 45,
  /** About one category per this many minutes (at least 2). */
  minutesPerCategory: 12,
  /**
   * From this length on a category may come up twice (never back to back).
   * Shorter games repeat only when the available categories cannot fill the time.
   */
  repeatFromMinutes: 60,
  /** Categories slower than this per question count as "slow" (e.g. bluff). */
  slowSecondsPerQuestion: 60,
  tolerance: 0.1,
} as const;

export interface PlanInput {
  mode: GameMode;
  targetMinutes: number;
  categories: readonly CategoryMeta[];
  /** Eligible questions per category in this mode. */
  pools: Readonly<Record<string, number>>;
  random: () => number;
  /** Categories with a higher minPlayers are left out. */
  playerCount?: number;
}

export interface PlannedGame {
  rounds: { categoryId: string; questionCount: number }[];
  estimatedSeconds: number;
}

/** Categories that may come up: offered in this mode, enough players, enough questions. */
export function plannableCategories(input: Omit<PlanInput, "random" | "targetMinutes">): CategoryMeta[] {
  return input.categories.filter(
    (c) =>
      c.modes.includes(input.mode) &&
      (input.playerCount === undefined || input.playerCount >= (c.minPlayers ?? 1)) &&
      (input.pools[c.id] ?? 0) >= c.questionsPerRound.min,
  );
}

const isSlow = (c: CategoryMeta) => c.estimatedSecondsPerQuestion >= PLANNER_CONFIG.slowSecondsPerQuestion;

/** Quick and slow categories alternate; a slow ("strong") one closes the game if there is one. */
function arrange(chosen: CategoryMeta[], random: () => number): CategoryMeta[] {
  const quick = shuffle(chosen.filter((c) => !isSlow(c)), random);
  const slow = shuffle(chosen.filter(isSlow), random);
  const finale = slow.pop();
  const out: CategoryMeta[] = [];
  // Never the same category twice in a row: take the most frequent remaining one that differs.
  const take = (pool: CategoryMeta[], last: CategoryMeta | undefined) => {
    let best = -1;
    let bestCount = -1;
    pool.forEach((c, i) => {
      if (c.id === last?.id) return;
      const n = pool.filter((x) => x.id === c.id).length;
      if (n > bestCount) {
        bestCount = n;
        best = i;
      }
    });
    return pool.splice(best >= 0 ? best : 0, 1);
  };
  while (quick.length || slow.length) {
    const last = out.at(-1);
    const wantSlow = last ? !isSlow(last) && slow.length > 0 : false;
    const pool = wantSlow || quick.length === 0 ? slow : quick;
    out.push(...take(pool, last));
  }
  if (finale) {
    if (out.at(-1)?.id === finale.id) {
      // Move a different category between the two.
      const j = out.findIndex((c) => c.id !== finale.id);
      if (j >= 0) out.push(...out.splice(j, 1));
    }
    out.push(finale);
  }
  return out;
}

/** Rule breaks at position i: same category again, two risk games in a row, standings needed in round 1. */
function breaksRule(list: readonly CategoryMeta[], i: number): boolean {
  const c = list[i]!;
  const prev = list[i - 1];
  if (i === 0) return !!c.needsStandings;
  return prev!.id === c.id || (!!c.risk && !!prev!.risk);
}

const ruleBreaks = (list: readonly CategoryMeta[]) => list.reduce((n, _, i) => n + (breaksRule(list, i) ? 1 : 0), 0);

/**
 * Zufall rules: never two risk games (Double or Nothing, Bet, Punkteklau)
 * back to back, Punkteklau only after a scored round. Repaired with the
 * nearest swap that helps; what still breaks a rule is left out.
 */
export function applyOrderRules(list: readonly CategoryMeta[]): CategoryMeta[] {
  let out = [...list];
  for (let guard = 0; guard < out.length * out.length && ruleBreaks(out) > 0; guard++) {
    const i = out.findIndex((_, k) => breaksRule(out, k));
    const current = ruleBreaks(out);
    let fixed: CategoryMeta[] | null = null;
    for (let d = 1; d < out.length && !fixed; d++) {
      for (const j of [i + d, i - d]) {
        if (j < 0 || j >= out.length) continue;
        const swapped = [...out];
        [swapped[i], swapped[j]] = [swapped[j]!, swapped[i]!];
        if (ruleBreaks(swapped) < current) {
          fixed = swapped;
          break;
        }
      }
    }
    if (!fixed) break;
    out = fixed;
  }
  // Nothing helps (e.g. only risk games left) → drop the round that breaks the rule.
  while (ruleBreaks(out) > 0) out.splice(out.findIndex((_, k) => breaksRule(out, k)), 1);
  return out;
}

/** `count` rounds: every category once first, then again in the same order (balanced repeats). */
function pickCategories(available: CategoryMeta[], count: number, random: () => number): CategoryMeta[] {
  const distinct = shuffle(available, random);
  const chosen = distinct.slice(0, Math.min(count, distinct.length));
  let i = 0;
  while (chosen.length < count && distinct.length > 1) chosen.push(distinct[i++ % distinct.length]!);
  return chosen;
}

/** Questions per round so the estimate lands as close to the target as possible. */
function fillQuestions(rounds: CategoryMeta[], pools: Readonly<Record<string, number>>, targetSec: number): number[] {
  // Questions left per category (a repeated category shares its pool).
  const left: Record<string, number> = { ...pools };
  const maxOf = rounds.map((c) => c.questionsPerRound.max);
  const counts = rounds.map((c) => {
    const n = Math.min(c.questionsPerRound.min, left[c.id] ?? 0);
    left[c.id] = (left[c.id] ?? 0) - n;
    return n;
  });
  const total = () => estimateGameSeconds(rounds.map((meta, i) => ({ meta, questionCount: counts[i]! })));
  // Add questions where the round is relatively emptiest, while it brings us closer.
  for (;;) {
    const now = total();
    let best = -1;
    let bestFill = Infinity;
    for (let i = 0; i < rounds.length; i++) {
      const c = rounds[i]!;
      if (counts[i]! >= maxOf[i]! || (left[c.id] ?? 0) <= 0) continue;
      const after = now + c.estimatedSecondsPerQuestion;
      if (Math.abs(after - targetSec) >= Math.abs(now - targetSec)) continue;
      const fill = counts[i]! / maxOf[i]!;
      if (fill < bestFill) {
        bestFill = fill;
        best = i;
      }
    }
    if (best < 0) break;
    counts[best]!++;
    left[rounds[best]!.id]!--;
  }
  return counts;
}

/** Drops rounds without enough questions left and merges neighbours of the same category. */
function finalize(rounds: CategoryMeta[], counts: number[]): PlannedGame {
  const kept: { meta: CategoryMeta; questionCount: number }[] = [];
  rounds.forEach((meta, i) => {
    const n = counts[i]!;
    if (n < meta.questionsPerRound.min) return;
    const last = kept.at(-1);
    if (last?.meta.id === meta.id) last.questionCount = Math.min(meta.questionsPerRound.max, last.questionCount + n);
    else kept.push({ meta, questionCount: n });
  });
  // A dropped round may have separated two risk games – still no rule breaks.
  for (let i = 1; i <= kept.length; i++) {
    const metas = kept.map((r) => r.meta);
    const k = metas.findIndex((_, j) => breaksRule(metas, j));
    if (k < 0) break;
    kept.splice(k, 1);
  }
  return {
    rounds: kept.map((r) => ({ categoryId: r.meta.id, questionCount: r.questionCount })),
    estimatedSeconds: estimateGameSeconds(kept),
  };
}

export function planGame(input: PlanInput): PlannedGame {
  const available = plannableCategories(input);
  if (available.length === 0) return { rounds: [], estimatedSeconds: 0 };
  const targetSec = input.targetMinutes * 60;
  const longGame = input.targetMinutes >= PLANNER_CONFIG.repeatFromMinutes;
  let count = Math.max(2, Math.round(input.targetMinutes / PLANNER_CONFIG.minutesPerCategory));
  if (!longGame) count = Math.min(count, available.length);

  let best: PlannedGame | null = null;
  // More rounds when the categories are too short to fill the time (long games, small maxima).
  for (let attempt = 0; attempt < 12; attempt++) {
    const rounds = applyOrderRules(arrange(pickCategories(available, count, input.random), input.random));
    const counts = fillQuestions(rounds, input.pools, targetSec);
    const plan = finalize(rounds, counts);
    if (!best || Math.abs(plan.estimatedSeconds - targetSec) < Math.abs(best.estimatedSeconds - targetSec)) best = plan;
    const tooShort = plan.estimatedSeconds < targetSec * (1 - PLANNER_CONFIG.tolerance);
    // More rounds help only while there are questions left to play.
    const questionsLeft = available.some(
      (c) => (input.pools[c.id] ?? 0) - plan.rounds.filter((r) => r.categoryId === c.id).reduce((n, r) => n + r.questionCount, 0) >= c.questionsPerRound.min,
    );
    if (!tooShort || !questionsLeft || available.length < 2) break;
    count++;
  }
  return best!;
}
