/** Pure helpers for the finale (regular and after "Spiel beenden") – tested. */
import type { LeaderboardEntry } from "@couch-clash/shared";

/** Headline on the TV: the regular winner line, or the early end. */
export const EARLY_FINALE_TITLE = "Spiel beendet – Zwischenstand";

/** Early finale: the top 3 on the podium (ties share a step), everyone else in the list below. */
export function splitPodium(entries: readonly LeaderboardEntry[]): { podium: LeaderboardEntry[]; rest: LeaderboardEntry[] } {
  const ordered = [...entries].sort((a, b) => a.positionAfter - b.positionAfter);
  return { podium: ordered.slice(0, 3), rest: ordered.slice(3) };
}

/** Podium order left → right: 2nd, 1st, 3rd (as on a real podium). */
export function podiumOrder<T>(podium: readonly T[]): T[] {
  const [first, second, third] = podium;
  return [second, first, third].filter((e): e is T => e !== undefined);
}

function points(n: number): string {
  return `${n.toLocaleString("de-DE")} ${Math.abs(n) === 1 ? "Punkt" : "Punkte"}`;
}

/**
 * Phone: "Platz 2 von 5 – 740 Punkte" (null if the player is not ranked).
 * `points: false` after the Survival-Finale – the place is the elimination order, not the points.
 */
export function placeText(entries: readonly LeaderboardEntry[], playerId: string, opts: { points?: boolean } = {}): string | null {
  const mine = entries.find((e) => e.playerId === playerId);
  if (!mine) return null;
  const place = `Platz ${mine.rankAfter} von ${entries.length}`;
  return opts.points === false ? place : `${place} – ${points(mine.scoreAfter)}`;
}

export interface PodiumSlot {
  /** The step, by height (1 in the middle, highest). */
  step: 1 | 2 | 3;
  /** Who stands on it – null: an empty step (e.g. a finale of two). */
  entry: LeaderboardEntry | null;
  /** The place shown on the step (shared places show the same number). */
  place: number;
}

/**
 * Survival-Finale ceremony: always three steps, left → right 2 · 1 · 3, in
 * the order of the final placing (the finale's elimination order: 2 = out
 * last, 3 = before). A shared place shows its real number.
 */
export function survivalPodium(entries: readonly LeaderboardEntry[]): PodiumSlot[] {
  const { podium } = splitPodium(entries);
  const slot = (step: 1 | 2 | 3): PodiumSlot => {
    const entry = podium[step - 1] ?? null;
    return { step, entry, place: entry?.rankAfter ?? step };
  };
  return [slot(2), slot(1), slot(3)];
}
