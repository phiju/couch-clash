/**
 * The questions every knowledge game plays: the multiple-choice content
 * (packages/content, quiz.de.json + generated ones) in its stored format.
 * Nothing is migrated – this file only selects and prepares questions and
 * offers a view model on top.
 */
import { QUIZ_QUESTIONS_DE, QuizQuestionSchema, type QuizQuestion } from "@couch-clash/content";
import {
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_CATEGORY_LABELS,
  difficultyWeight,
  type KnowledgeCategory,
  type ModeFilterMeta,
  type ModuleInitOptions,
} from "@couch-clash/shared";
import { playablePool } from "../content-pool";
import { pickFresh, shuffle } from "../random";

export const KNOWLEDGE_POOL_CONFIG = {
  /**
   * Party mode: share of questions from the party pool (adult: true). If
   * there are not enough, the family pool fills up.
   */
  partyShare: 0.3,
} as const;

/** A question as played: options shuffled, correctIndex adjusted. */
export interface PreparedQuizQuestion {
  id: string;
  text: string;
  options: string[];
  correctIndex: number;
  /** Topic (primaryCategory) – null for generated questions without one. */
  category?: KnowledgeCategory | null;
}

export function prepareQuizQuestion(q: QuizQuestion, random: () => number): PreparedQuizQuestion {
  const order = shuffle([0, 1, 2, 3], random);
  return {
    id: q.id,
    text: q.text,
    options: order.map((i) => q.options[i]!),
    correctIndex: order.indexOf(q.correctIndex),
    category: q.primaryCategory ?? null,
  };
}

/** View model for game code that thinks in answers rather than indexes. */
export interface KnowledgeQuestion {
  id: string;
  question: string;
  answers: { id: string; text: string }[];
  correctAnswerId: string;
  category: KnowledgeCategory | null;
  categoryLabel: string | null;
  difficulty: number;
}

/** Adapter on top of the stored format (ids stay the content ids). */
export function toKnowledgeQuestion(q: QuizQuestion): KnowledgeQuestion {
  const category = q.primaryCategory ?? null;
  return {
    id: q.id,
    question: q.text,
    answers: q.options.map((text, i) => ({ id: String(i), text })),
    correctAnswerId: String(q.correctIndex),
    category,
    categoryLabel: category ? KNOWLEDGE_CATEGORY_LABELS[category] : null,
    difficulty: q.difficulty,
  };
}

export type KnowledgePoolOptions = Pick<
  ModuleInitOptions,
  "blockedContentIds" | "extraContent" | "mode" | "excludeContentIds"
>;

/** Everything playable in this mode (static + generated, minus blocked). */
export function knowledgePool(
  pool: readonly QuizQuestion[],
  options: KnowledgePoolOptions,
  meta: ModeFilterMeta,
): QuizQuestion[] {
  return playablePool(pool, QuizQuestionSchema, options, meta);
}

/**
 * `count` questions from `candidates`: not played recently first, weighted
 * by difficulty. Party mode mixes in ~partyShare party questions (adult) –
 * as many as there are, the family pool fills up the rest.
 */
export function selectQuestions(
  candidates: readonly QuizQuestion[],
  count: number,
  options: KnowledgePoolOptions,
  random: () => number,
  partyShare: number = KNOWLEDGE_POOL_CONFIG.partyShare,
): QuizQuestion[] {
  const weight = (q: QuizQuestion) => difficultyWeight(q.difficulty, options.mode);
  const exclude = options.excludeContentIds ?? [];
  if (options.mode?.mode !== "party") return pickFresh(candidates, count, exclude, random, weight);
  const party = candidates.filter((q) => q.adult);
  const family = candidates.filter((q) => !q.adult);
  const wantParty = Math.min(party.length, Math.round(count * Math.min(1, Math.max(0, partyShare))));
  const fromParty = pickFresh(party, wantParty, exclude, random, weight);
  const fromFamily = pickFresh(family, count - fromParty.length, exclude, random, weight);
  // Family pool too small → more party questions.
  const rest = count - fromParty.length - fromFamily.length;
  const extra = rest > 0 ? pickFresh(party.filter((q) => !fromParty.includes(q)), rest, exclude, random, weight) : [];
  return shuffle([...fromParty, ...fromFamily, ...extra], random);
}

/** Questions for a whole round, prepared (options shuffled). */
export function pickKnowledgeQuestions(
  options: ModuleInitOptions,
  random: () => number,
  meta: ModeFilterMeta,
  pool: readonly QuizQuestion[] = QUIZ_QUESTIONS_DE,
): PreparedQuizQuestion[] {
  const candidates = knowledgePool(pool, options, meta);
  return selectQuestions(candidates, options.questionCount, options, random).map((q) => prepareQuizQuestion(q, random));
}

/** Playable questions per topic (Kategorienvorgabe: which cards can be offered). */
export function questionsByCategory(questions: readonly QuizQuestion[]): Record<KnowledgeCategory, QuizQuestion[]> {
  const out = Object.fromEntries(KNOWLEDGE_CATEGORIES.map((c) => [c, [] as QuizQuestion[]])) as Record<
    KnowledgeCategory,
    QuizQuestion[]
  >;
  for (const q of questions) if (q.primaryCategory) out[q.primaryCategory].push(q);
  return out;
}
