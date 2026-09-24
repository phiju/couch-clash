import { QUIZ_QUESTIONS_DE, type QuizQuestion } from "@couch-clash/content";
import { z } from "zod";
import { createQuestionRoundModule } from "../question-round/engine";
import { pickFresh, shuffle } from "../random";
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

export function createQuizModule(pool: readonly QuizQuestion[] = QUIZ_QUESTIONS_DE) {
  return createQuestionRoundModule<PreparedQuizQuestion, number, QuizPublicQuestion, QuizSolution>({
    meta: quizMeta,
    answerSchema: z.number().int().min(0).max(3),
    pickQuestions: (ctx, { questionCount, excludeContentIds }) =>
      pickFresh(pool, questionCount, excludeContentIds, ctx.random).map((q) =>
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
}

export const quizModule = createQuizModule();
