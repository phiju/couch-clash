/**
 * Client-safe entry point (@couch-clash/games/meta): category metadata and
 * public state types. Must not import logic or content (answers!).
 */
import type { CategoryMeta } from "@couch-clash/shared";
import { estimateMeta } from "./estimate/meta";
import { quizMeta } from "./quiz/meta";

/** ── Register new categories here (1/2) ── */
export const CATEGORY_METAS = [quizMeta, estimateMeta] as const satisfies readonly CategoryMeta[];

export type CategoryId = (typeof CATEGORY_METAS)[number]["id"];

export function getCategoryMeta(id: string): CategoryMeta | undefined {
  return CATEGORY_METAS.find((m) => m.id === id);
}

export { estimateMeta, quizMeta };
export { normalizeScoring } from "./scoring/normalize";
export * from "./question-round/types";
export type * from "./quiz/types";
export type * from "./estimate/types";
