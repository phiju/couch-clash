/**
 * Client-safe entry point (@couch-clash/games/meta): category metadata and
 * public state types. Must not import logic or content (answers!).
 */
import type { CategoryMeta } from "@couch-clash/shared";
import { bluffMeta } from "./bluff/meta";
import { estimateMeta } from "./estimate/meta";
import { quizMeta } from "./quiz/meta";

/** ── Register new categories here (1/2) ── */
export const CATEGORY_METAS = [quizMeta, estimateMeta, bluffMeta] as const satisfies readonly CategoryMeta[];

export type CategoryId = (typeof CATEGORY_METAS)[number]["id"];

/** Enough players for this category (e.g. bluffing needs at least 2)? */
export function categoryAvailable(meta: CategoryMeta, playerCount: number): boolean {
  return playerCount >= (meta.minPlayers ?? 1);
}

export function getCategoryMeta(id: string): CategoryMeta | undefined {
  return CATEGORY_METAS.find((m) => m.id === id);
}

export { bluffMeta, estimateMeta, quizMeta };
export { BLUFF_CONFIG, OPTION_LETTERS } from "./bluff/meta";
export { bluffLead, bluffQuestion, withIndefiniteArticle } from "./bluff/text";
export { normalizeScoring } from "./scoring/normalize";
export { normalizeCategoryOptions } from "./options";
export * from "./question-round/types";
export type * from "./quiz/types";
export type * from "./estimate/types";
export type * from "./bluff/types";
