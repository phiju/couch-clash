import { QUIZ_QUESTIONS_DE, QuizQuestionSchema, type QuizQuestion } from "@couch-clash/content";
import type { CategoryMeta, ContentEntry, ModuleContext, ModuleInitOptions, QuestionMedia } from "@couch-clash/shared";
import { listEntries, parseWith, pickForRound } from "../content-pool";
import { z } from "zod";
import { createQuestionRoundModule, type QuestionRoundConfig, type RoundSummaryConfig } from "../question-round/engine";
import { shuffle } from "../random";
import { quizMeta } from "./meta";
import type { QuizPublicQuestion, QuizSolution } from "./types";

/** A multiple-choice question as stored; categories built on the quiz may add a picture and an explanation. */
export type QuizLikeQuestion = QuizQuestion & { media?: QuestionMedia | null; explanation?: string };

/** Question as played: options shuffled, correctIndex adjusted. */
export interface PreparedQuizQuestion {
  id: string;
  text: string;
  options: string[];
  correctIndex: number;
  media?: QuestionMedia | null;
  explanation?: string;
  /** Scenes: who drives in which order at the reveal (vehicle ids, "ped:<arm>" for pedestrians). */
  driveOrder?: string[];
}

export function prepareQuizQuestion(q: QuizLikeQuestion, random: () => number): PreparedQuizQuestion {
  const order = shuffle([0, 1, 2, 3], random);
  return {
    id: q.id,
    text: q.text,
    options: order.map((i) => q.options[i]!),
    correctIndex: order.indexOf(q.correctIndex),
    ...(q.media ? { media: q.media } : {}),
    ...(q.explanation ? { explanation: q.explanation } : {}),
  };
}

const entry = (q: QuizLikeQuestion): ContentEntry => ({
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

/** Everything a multiple-choice category may change; the defaults are the plain quiz. */
export interface QuizModuleConfig<T extends QuizLikeQuestion, TSummary> {
  meta: CategoryMeta;
  schema: z.ZodType<T>;
  pool: readonly T[];
  /** Which questions a round gets (default: fresh ones, weighted by difficulty). */
  pick?(pool: readonly T[], ctx: ModuleContext, options: ModuleInitOptions): T[];
  /** Adds data for the reveal (e.g. the drive order of a scene). */
  prepare?(prepared: PreparedQuizQuestion, source: T): PreparedQuizQuestion;
  questionSeconds?: QuestionRoundConfig<PreparedQuizQuestion, number, QuizPublicQuestion, QuizSolution>["questionSeconds"];
  revealMs?: QuestionRoundConfig<PreparedQuizQuestion, number, QuizPublicQuestion, QuizSolution>["revealMs"];
  highlights?: QuestionRoundConfig<PreparedQuizQuestion, number, QuizPublicQuestion, QuizSolution>["highlights"];
  summary?: RoundSummaryConfig<TSummary>;
}

export function createQuizLikeModule<T extends QuizLikeQuestion, TSummary = never>(config: QuizModuleConfig<T, TSummary>) {
  const { meta, schema, pool } = config;
  const module = createQuestionRoundModule<PreparedQuizQuestion, number, QuizPublicQuestion, QuizSolution, TSummary>({
    meta,
    answerSchema: z.number().int().min(0).max(3),
    pickQuestions: (ctx, options) => {
      const picked = config.pick ? config.pick(pool, ctx, options) : pickForRound(pool, schema, options, ctx.random, meta);
      return picked.map((q) => {
        const prepared = prepareQuizQuestion(q, ctx.random);
        return config.prepare ? config.prepare(prepared, q) : prepared;
      });
    },
    questionSeconds: config.questionSeconds,
    revealMs: config.revealMs,
    highlights: config.highlights,
    summary: config.summary,
    baseScoreInput: (question, answer) => ({ correct: answer === question.correctIndex }),
    publicQuestion: (q) => ({ text: q.text, options: q.options, ...(q.media ? { media: q.media } : {}) }),
    solution: (q) => ({
      correctIndex: q.correctIndex,
      ...(q.explanation ? { explanation: q.explanation } : {}),
      ...(q.driveOrder ? { driveOrder: q.driveOrder } : {}),
    }),
    describe: {
      question: (q) => q.text,
      solution: (q) => q.options[q.correctIndex] ?? "",
      answer: (q, a) => q.options[a] ?? "",
    },
  });
  return {
    ...module,
    listContent: (extra?: readonly unknown[]) => listEntries(pool, schema, extra, entry),
    parseContent: (raw: unknown) => parseWith(schema, raw),
  };
}

export function createQuizModule(pool: readonly QuizQuestion[] = QUIZ_QUESTIONS_DE) {
  return createQuizLikeModule({ meta: quizMeta, schema: QuizQuestionSchema, pool });
}

export const quizModule = createQuizModule();
