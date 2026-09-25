import { categoryAvailable } from "@couch-clash/games/meta";
import type { CategoryMeta, GameModeSettings } from "@couch-clash/shared";

/** Category may be played: enough players, offered in the game mode, enough questions in the mode. */
export function isAvailable(
  meta: CategoryMeta,
  playerCount: number,
  mode: GameModeSettings,
  pools: Record<string, number> | null,
): boolean {
  return (
    categoryAvailable(meta, playerCount) &&
    (meta.modes as readonly string[]).includes(mode.mode) &&
    (pools?.[meta.id] ?? Infinity) >= meta.questionsPerRound.min
  );
}

/**
 * A saved card order plus categories added since: each new one goes right
 * after its predecessor in the registry (so new games land where the
 * library lists them, not at the end).
 */
export function mergeLibraryOrder(stored: readonly string[], registry: readonly string[]): string[] {
  const out = stored.filter((id, i) => registry.includes(id) && stored.indexOf(id) === i);
  registry.forEach((id, i) => {
    if (out.includes(id)) return;
    const before = registry.slice(0, i).reverse().find((prev) => out.includes(prev));
    out.splice(before ? out.indexOf(before) + 1 : 0, 0, id);
  });
  return out;
}

/** Version of the saved settings on this device (setupStore). */
export const SETUP_VERSION = 2;

/**
 * "Wissensfragen" (id quiz) became the Punktesammler with a fixed 100 per
 * answer: settings saved before (version < 2) that still have the old
 * default speed bonus switch it off. A bonus the host tuned stays.
 */
export function migrateQuizScoring<T extends { speedModifier?: { enabled: boolean; fastestMultiplier: number; slowestMultiplier: number } }>(
  scoring: T | undefined,
  version: number | undefined,
): T | undefined {
  const speed = scoring?.speedModifier;
  if (!scoring || !speed || (version ?? 1) >= SETUP_VERSION) return scoring;
  const oldDefault = speed.enabled && speed.fastestMultiplier === 1.5 && speed.slowestMultiplier === 0.5;
  return oldDefault ? { ...scoring, speedModifier: { ...speed, enabled: false } } : scoring;
}
