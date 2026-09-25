import { ESTIMATE_QUESTIONS_DE, EstimateQuestionSchema, type EstimateQuestion } from "@couch-clash/content";
import type { ContentEntry } from "@couch-clash/shared";
import { listEntries, parseWith, pickForRound } from "../content-pool";
import { z } from "zod";
import { createQuestionRoundModule } from "../question-round/engine";
import { estimateMeta } from "./meta";
import type { EstimatePublicQuestion, EstimateSolution } from "./types";

const entry = (q: EstimateQuestion): ContentEntry => ({
  id: q.id,
  text: q.text,
  answer: formatEstimate(q.answer, q.unit, q.format),
  difficulty: q.difficulty,
  ageRating: q.ageRating,
  tags: q.tags,
  payload: q,
  alcohol: q.alcohol,
  adult: q.adult,
  errorMetric: true,
});

export function createEstimateModule(pool: readonly EstimateQuestion[] = ESTIMATE_QUESTIONS_DE) {
  const module = createQuestionRoundModule<EstimateQuestion, number, EstimatePublicQuestion, EstimateSolution>({
    meta: estimateMeta,
    answerSchema: z.number().finite().min(-1e12).max(1e12),
    pickQuestions: (ctx, options) =>
      pickForRound(pool, EstimateQuestionSchema, options, ctx.random, estimateMeta),
    errorShare: (q, a) => Math.abs(a - q.answer) / (q.zeroRange ?? Math.max(Math.abs(q.answer), 1e-9)),
    baseScoreInput: (question, answer) => ({
      answer,
      correctAnswer: question.answer,
      zeroRange: question.zeroRange,
    }),
    publicQuestion: (q) => ({ text: q.text, unit: q.unit, format: q.format }),
    solution: (q) => ({ answer: q.answer, unit: q.unit, format: q.format, fact: q.fact ?? null }),
    describe: {
      question: (q) => q.text,
      solution: (q) => formatEstimate(q.answer, q.unit, q.format),
      answer: (q, a) => formatEstimate(a, q.unit, q.format),
    },
  });
  return {
    ...module,
    listContent: (extra?: readonly unknown[]) => listEntries(pool, EstimateQuestionSchema, extra, entry),
    parseContent: (raw: unknown) => parseWith(EstimateQuestionSchema, raw),
  };
}

/** "12.000 km" / "1989" – German number format, for the host's commentary. */
export function formatEstimate(value: number, unit: string, format: "number" | "year"): string {
  const number = format === "year" ? String(Math.round(value)) : value.toLocaleString("de-DE", { maximumFractionDigits: 2 });
  return unit && format !== "year" ? `${number} ${unit}` : number;
}

export const estimateModule = createEstimateModule();
