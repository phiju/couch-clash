/** Musik-Quiz scoring (pure). All amounts come from the host's "Punkte-Einstellungen". */
import type { MusikPointId } from "./meta";

export type MusikPoints = Record<MusikPointId, number>;

/**
 * Buzzer questions: full points (`fast`) for a buzz within the first
 * `fastSeconds` of the clip, then falling linearly to `slow` at the clip's
 * end. The position is the clip position at the buzz (pauses don't count).
 */
export function buzzPoints(positionMs: number, clipMs: number, p: Pick<MusikPoints, "fast" | "slow" | "fastSeconds">): number {
  const fullUntil = p.fastSeconds * 1000;
  if (positionMs <= fullUntil) return p.fast;
  const span = Math.max(1, clipMs - fullUntil);
  const share = Math.min(1, (positionMs - fullUntil) / span);
  return Math.round(p.fast - (p.fast - p.slow) * share);
}

/** A band member instead of the band: `memberShare` % of the points. */
export function partialPoints(points: number, memberShare: number): number {
  return Math.round((points * Math.min(100, Math.max(0, memberShare))) / 100);
}

/** Points for one year tip: exact · ±1 · ±2 · ±5 · else 0. */
export function yearTipPoints(tip: number, year: number, p: Pick<MusikPoints, "yearExact" | "year1" | "year2" | "year5">): number {
  const off = Math.abs(tip - year);
  if (off === 0) return p.yearExact;
  if (off <= 1) return p.year1;
  if (off <= 2) return p.year2;
  if (off <= 5) return p.year5;
  return 0;
}

/**
 * Everyone's year tips → points. When nobody is exact, the closest tip(s)
 * get the `yearClosest` bonus on top (ties share it, each gets it in full).
 */
export function scoreYears(
  tips: Readonly<Record<string, number>>,
  year: number,
  p: Pick<MusikPoints, "yearExact" | "year1" | "year2" | "year5" | "yearClosest">,
): { points: Record<string, number>; closest: string[] } {
  const points: Record<string, number> = {};
  for (const [id, tip] of Object.entries(tips)) points[id] = yearTipPoints(tip, year, p);
  const entries = Object.entries(tips);
  if (entries.length === 0 || entries.some(([, tip]) => tip === year) || p.yearClosest <= 0) return { points, closest: [] };
  const best = Math.min(...entries.map(([, tip]) => Math.abs(tip - year)));
  const closest = entries.filter(([, tip]) => Math.abs(tip - year) === best).map(([id]) => id);
  for (const id of closest) points[id] = (points[id] ?? 0) + p.yearClosest;
  return { points, closest };
}
