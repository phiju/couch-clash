import { QUIZ_QUESTIONS_DE, QuizQuestionSchema, type QuizQuestion } from "@couch-clash/content";
import type { ContentEntry } from "@couch-clash/shared";
import { listEntries, parseWith, pickForRound } from "../content-pool";
import { z } from "zod";
import { createQuestionRoundModule } from "../question-round/engine";
import { shuffle } from "../random";
import { quizMeta } from "./meta";
import type { QuizPublicQuestion, QuizSolution } from "./types";

/** Question as played: options shuffled, correctIndex adjusted. */
export interface PreparedQuizQuestion {
  id: string;
  text: string;
  options: string[];
  correctIndex: number;
}

export function prepareQuizQuestion(q: QuizQuestion, random: () => number): PreparedQuizQuestion {
  const order = shuffle([0, 1, 2, 3], random);
  return {
    id: q.id,
    text: q.text,
    options: order.map((i) => q.options[i]!),
    correctIndex: order.indexOf(q.correctIndex),
  };
}

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

export function createQuizModule(pool: readonly QuizQuestion[] = QUIZ_QUESTIONS_DE) {
  const module = createQuestionRoundModule<PreparedQuizQuestion, number, QuizPublicQuestion, QuizSolution>({
    meta: quizMeta,
    answerSchema: z.number().int().min(0).max(3),
    pickQuestions: (ctx, options) =>
      pickForRound(pool, QuizQuestionSchema, options, ctx.random, quizMeta).map((q) =>
        prepareQuizQuestion(q, ctx.random),
      ),
    baseScoreInput: (question, answer) => ({ correct: answer === question.correctIndex }),
    publicQuestion: (q) => ({ text: q.text, options: q.options }),
    solution: (q) => ({ correctIndex: q.correctIndex }),
    describe: {
      question: (q) => q.text,
      solution: (q) => q.options[q.correctIndex] ?? "",
      answer: (q, a) => q.options[a] ?? "",
    },
  });
  return {
    ...module,
    listContent: (extra?: readonly unknown[]) => listEntries(pool, QuizQuestionSchema, extra, entry),
    parseContent: (raw: unknown) => parseWith(QuizQuestionSchema, raw),
  };
}

export const quizModule = createQuizModule();
