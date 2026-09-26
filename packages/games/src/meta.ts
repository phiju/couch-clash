/**
 * Client-safe entry point (@couch-clash/games/meta): category metadata and
 * public state types. Must not import logic or content (answers!).
 */
import type { CategoryMeta } from "@couch-clash/shared";
import { betMeta } from "./bet/meta";
import { bluffMeta } from "./bluff/meta";
import { categoryPickMeta } from "./category-pick/meta";
import { doubleMeta } from "./double/meta";
import { estimateMeta } from "./estimate/meta";
import { fuehrerscheinMeta } from "./fuehrerschein/meta";
import { musikMeta } from "./musik/meta";
import { pixelpanikMeta } from "./pixelpanik/meta";
import { quizMeta } from "./quiz/meta";
import { skurrilMeta } from "./skurril/meta";
import { slfMeta } from "./stadt-land-fluss/meta";
import { stealMeta } from "./steal/meta";
import { survivalMeta } from "./survival/meta";

/** ── Register new categories here (1/2) ── The order is the order of the game library. */
export const CATEGORY_METAS = [
  quizMeta,
  estimateMeta,
  categoryPickMeta,
  doubleMeta,
  betMeta,
  stealMeta,
  fuehrerscheinMeta,
  pixelpanikMeta,
  musikMeta,
  bluffMeta,
  skurrilMeta,
  slfMeta,
  // The finale (not a card in the library – its own switch in the settings).
  survivalMeta,
] as const satisfies readonly CategoryMeta[];

export type CategoryId = (typeof CATEGORY_METAS)[number]["id"];

export function getCategoryMeta(id: string): CategoryMeta | undefined {
  return CATEGORY_METAS.find((m) => m.id === id);
}

export { betMeta, bluffMeta, categoryPickMeta, doubleMeta, estimateMeta, fuehrerscheinMeta, musikMeta, pixelpanikMeta, quizMeta, skurrilMeta, slfMeta, stealMeta, survivalMeta };
export { SLF_CONFIG, SLF_DEFAULTS } from "./stadt-land-fluss/meta";
export type * from "./stadt-land-fluss/types";
export { PIXELPANIK_CONFIG, PIXELPANIK_STAGES } from "./pixelpanik/meta";
export * from "./pixelpanik/types";
export { MUSIK_CONFIG, MUSIK_GENRES, MUSIK_KIDS_INFO, MUSIK_QUESTION_TYPE_IDS, MUSIK_TYPE_INFO, genreOptionId, type MusikGenreId, type MusikQuestionTypeId } from "./musik/meta";
export * from "./musik/types";
export { BET_CONFIG } from "./bet/meta";
export { CATEGORY_PICK_CONFIG } from "./category-pick/meta";
export { DOUBLE_CONFIG, potAfterWin } from "./double/meta";
export { FUEHRERSCHEIN_CONFIG } from "./fuehrerschein/meta";
export { examStampDelayMs } from "./fuehrerschein/exam";
export { BLUFF_CONFIG, OPTION_LETTERS } from "./bluff/meta";
export { bluffLead, bluffQuestion, withIndefiniteArticle } from "./bluff/text";
export { normalizeScoring } from "./scoring/normalize";
export { normalizeCategoryOptions } from "./options";
export { PLANNER_CONFIG, planGame, plannableCategories, type PlanInput, type PlannedGame } from "./planner";
export * from "./question-round/types";
export type * from "./knowledge/types";
export type { QuizAnswer, QuizLikePublicState, QuizPublicQuestion, QuizSolution } from "./quiz/types";
export type * from "./estimate/types";
export type * from "./bluff/types";
export type * from "./fuehrerschein/types";
// Survival-Finale: config, rules and public types (the TV and phones show live values with the same formulas).
export * from "./survival/config";
export * from "./survival/rules";
export * from "./survival/types";
