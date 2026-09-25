/** Eligible questions per category for a game mode (static content), cached. */
import { contentPoolOf, eligibleForMode, type GameModeSettings } from "@couch-clash/shared";
import { GAME_MODULES, type ModuleRegistry } from "@couch-clash/games";

const cache = new WeakMap<ModuleRegistry, Map<string, Record<string, number>>>();

export function poolSizesFor(mode: GameModeSettings, registry: ModuleRegistry = GAME_MODULES): Record<string, number> {
  const key = `${mode.mode}:${mode.allow16 ? 16 : 12}`;
  let byMode = cache.get(registry);
  if (!byMode) cache.set(registry, (byMode = new Map()));
  const hit = byMode.get(key);
  if (hit) return hit;
  const sizes: Record<string, number> = {};
  for (const [id, module] of Object.entries(registry)) {
    // Games that play another category's questions (e.g. every knowledge game → "quiz").
    const owner = registry[contentPoolOf(module.meta)] ?? module;
    const entries = owner.listContent?.();
    // Without a catalog (generated content) the pool is unlimited.
    sizes[id] = entries ? entries.filter((e) => eligibleForMode(e, mode, module.meta)).length : Number.MAX_SAFE_INTEGER;
  }
  byMode.set(key, sizes);
  return sizes;
}
