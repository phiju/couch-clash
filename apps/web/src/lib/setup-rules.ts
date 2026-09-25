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
