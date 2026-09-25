import type { CategoryId } from "@couch-clash/games/meta";
import { bluffViews } from "./bluff";
import { estimateViews } from "./estimate";
import { quizViews } from "./quiz";
import type { GameViews } from "./types";

/**
 * UI registry: one entry per category id. TypeScript fails if a category
 * registered in packages/games has no views here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const GAME_VIEWS: Record<CategoryId, GameViews<any>> = {
  quiz: quizViews,
  estimate: estimateViews,
  bluff: bluffViews,
};

export function getGameViews(categoryId: string): GameViews<unknown> | undefined {
  return (GAME_VIEWS as Record<string, GameViews<unknown>>)[categoryId];
}
