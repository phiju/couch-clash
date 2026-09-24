/**
 * Server entry point (@couch-clash/games): module registry with logic and
 * content. Used by the party worker only.
 */
import type { GameModule } from "@couch-clash/shared";
import { estimateModule } from "./estimate/module";
import type { CategoryId } from "./meta";
import { quizModule } from "./quiz/module";

export * from "./meta";
export * from "./scoring";

/** ── Register new categories here (2/2) ── */
export const GAME_MODULES: Record<CategoryId, GameModule> = {
  quiz: quizModule as unknown as GameModule,
  estimate: estimateModule as unknown as GameModule,
};

export type ModuleRegistry = Readonly<Record<string, GameModule>>;

export function getModule(id: string, registry: ModuleRegistry = GAME_MODULES): GameModule | undefined {
  return Object.hasOwn(registry, id) ? registry[id] : undefined;
}
