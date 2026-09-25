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
  type KnowledgeCategory,
  type ModeFilterMeta,
  type ModuleInitOptions,
  type QuestionMedia,
} from "@couch-clash/shared";
import { playablePool } from "../content-pool";
import { selectWithPartyShare } from "../party-share";
import { shuffle } from "../random";

/** A multiple-choice question as stored; categories built on the quiz may add a picture and an explanation. */
export type QuizLikeQuestion = QuizQuestion & { media?: QuestionMedia | null; explanation?: string };

/** A question as played: options shuffled, correctIndex adjusted. */
export interface PreparedQuizQuestion {
  id: string;
  text: string;
  options: string[];
  correctIndex: number;
  /** Topic (primaryCategory) – null for generated questions without one. */
  category?: KnowledgeCategory | null;
  media?: QuestionMedia | null;
  explanation?: string;
  /** Scenes: who drives in which order at the reveal (vehicle ids, "ped:<arm>" for pedestrians). */
  driveOrder?: string[];
  /** From the party pool (adult) – for the host's commentary. */
  partyItem?: boolean;
}

export function prepareQuizQuestion(q: QuizLikeQuestion, random: () => number): PreparedQuizQuestion {
  const order = shuffle([0, 1, 2, 3], random);
  return {
    id: q.id,
    text: q.text,
    options: order.map((i) => q.options[i]!),
    correctIndex: order.indexOf(q.correctIndex),
    category: q.primaryCategory ?? null,
    ...(q.media ? { media: q.media } : {}),
    ...(q.explanation ? { explanation: q.explanation } : {}),
    ...(q.adult ? { partyItem: true } : {}),
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
  "blockedContentIds" | "extraContent" | "mode" | "excludeContentIds" | "log"
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
 * by difficulty; Party mode mixes in the party share (selectWithPartyShare).
 */
export function selectQuestions(
  candidates: readonly QuizQuestion[],
  count: number,
  options: KnowledgePoolOptions,
  random: () => number,
  label = "quiz",
): QuizQuestion[] {
  return selectWithPartyShare(candidates, count, options, random, label);
}

/** Questions for a whole round, prepared (options shuffled). */
export function pickKnowledgeQuestions(
  options: ModuleInitOptions,
  random: () => number,
  meta: ModeFilterMeta,
  pool: readonly QuizQuestion[] = QUIZ_QUESTIONS_DE,
): PreparedQuizQuestion[] {
  const candidates = knowledgePool(pool, options, meta);
  return selectQuestions(candidates, options.questionCount, options, random, meta.id).map((q) => prepareQuizQuestion(q, random));
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
