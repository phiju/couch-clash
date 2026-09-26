import type { CategoryId } from "@couch-clash/games/meta";
import { betViews } from "./bet";
import { bluffViews, skurrilViews } from "./bluff";
import { categoryPickViews } from "./category-pick";
import { doubleViews } from "./double";
import { estimateViews } from "./estimate";
import { fuehrerscheinViews } from "./fuehrerschein";
import { pixelpanikViews } from "./pixelpanik";
import { quizViews } from "./quiz";
import { slfViews } from "./stadt-land-fluss";
import { stealViews } from "./steal";
import { survivalViews } from "./survival";
import type { GameViews } from "./types";

/**
 * UI registry: one entry per category id. TypeScript fails if a category
 * registered in packages/games has no views here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const GAME_VIEWS: Record<CategoryId, GameViews<any>> = {
  quiz: quizViews,
  estimate: estimateViews,
  "category-pick": categoryPickViews,
  "double-or-nothing": doubleViews,
  bet: betViews,
  steal: stealViews,
  fuehrerschein: fuehrerscheinViews,
  pixelpanik: pixelpanikViews,
  bluff: bluffViews,
  skurril: skurrilViews,
  "stadt-land-fluss": slfViews,
  survival: survivalViews,
};

export function getGameViews(categoryId: string): GameViews<unknown> | undefined {
  return (GAME_VIEWS as Record<string, GameViews<unknown>>)[categoryId];
}
