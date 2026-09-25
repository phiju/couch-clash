import { QUIZ_QUESTIONS_DE, QuizQuestionSchema, type QuizQuestion } from "@couch-clash/content";
import type { ContentEntry } from "@couch-clash/shared";
import { listEntries, parseWith } from "../content-pool";
import { createKnowledgeModule, upfrontQuestions, type KnowledgeGame } from "../knowledge/engine";
import { scoreCorrectAnswers } from "../knowledge/scoring";
import { quizMeta } from "./meta";

export { prepareQuizQuestion, type PreparedQuizQuestion } from "../knowledge/questions";

const entry = (q: QuizQuestion): ContentEntry => ({
  id: q.id,
  text: q.text,
  answer: q.options[q.correctIndex] ?? "",
  difficulty: q.difficulty,
  ageRating: q.ageRating,
  tags: q.tags,
  payload: q,
  alcohol: q.alcohol,
  adult: q.adult,
});

/** Punktesammler: everyone answers, +100 per correct answer, next. */
export const punktesammler: KnowledgeGame<null> = {
  meta: quizMeta,
  init: (ctx, options, pool) => ({ game: null, questions: upfrontQuestions(ctx, options, pool, quizMeta) }),
  score: scoreCorrectAnswers,
  publicExtra: () => null,
};

/**
 * The "quiz" module also owns the multiple-choice content: the admin page,
 * statistics and generated questions of every knowledge game are kept here.
 */
export function createQuizModule(pool: readonly QuizQuestion[] = QUIZ_QUESTIONS_DE) {
  return {
    ...createKnowledgeModule(punktesammler, pool),
    listContent: (extra?: readonly unknown[]) => listEntries(pool, QuizQuestionSchema, extra, entry),
    parseContent: (raw: unknown) => parseWith(QuizQuestionSchema, raw),
  };
}

export const quizModule = createQuizModule();
