/**
 * Server entry point (@couch-clash/games): module registry with logic and
 * content. Used by the party worker only.
 */
import type { GameModule } from "@couch-clash/shared";
import { betModule } from "./bet/module";
import { bluffModule } from "./bluff/module";
import { categoryPickModule } from "./category-pick/module";
import { doubleModule } from "./double/module";
import { estimateModule } from "./estimate/module";
import { fuehrerscheinModule } from "./fuehrerschein/module";
import type { CategoryId } from "./meta";
import { quizModule } from "./quiz/module";
import { skurrilModule } from "./skurril/module";
import { stealModule } from "./steal/module";

export * from "./meta";
export * from "./scoring";

/** ── Register new categories here (2/2) ── */
export const GAME_MODULES: Record<CategoryId, GameModule> = {
  quiz: quizModule as unknown as GameModule,
  estimate: estimateModule as unknown as GameModule,
  "category-pick": categoryPickModule as unknown as GameModule,
  "double-or-nothing": doubleModule as unknown as GameModule,
  bet: betModule as unknown as GameModule,
  steal: stealModule as unknown as GameModule,
  fuehrerschein: fuehrerscheinModule as unknown as GameModule,
  bluff: bluffModule as unknown as GameModule,
  skurril: skurrilModule as unknown as GameModule,
};

export type ModuleRegistry = Readonly<Record<string, GameModule>>;

export function getModule(id: string, registry: ModuleRegistry = GAME_MODULES): GameModule | undefined {
  return Object.hasOwn(registry, id) ? registry[id] : undefined;
}
