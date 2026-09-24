import { ESTIMATE_QUESTIONS_DE, type EstimateQuestion } from "@couch-clash/content";
import { z } from "zod";
import { createQuestionRoundModule } from "../question-round/engine";
import { pickFresh } from "../random";
import { estimateMeta } from "./meta";
import type { EstimatePublicQuestion, EstimateSolution } from "./types";

export function createEstimateModule(pool: readonly EstimateQuestion[] = ESTIMATE_QUESTIONS_DE) {
  return createQuestionRoundModule<EstimateQuestion, number, EstimatePublicQuestion, EstimateSolution>({
    meta: estimateMeta,
    answerSchema: z.number().finite().min(-1e12).max(1e12),
    pickQuestions: (ctx, { questionCount, excludeContentIds }) =>
      pickFresh(pool, questionCount, excludeContentIds, ctx.random),
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
}

/** "12.000 km" / "1989" – German number format, for the host's commentary. */
export function formatEstimate(value: number, unit: string, format: "number" | "year"): string {
  const number = format === "year" ? String(Math.round(value)) : value.toLocaleString("de-DE", { maximumFractionDigits: 2 });
  return unit && format !== "year" ? `${number} ${unit}` : number;
}

export const estimateModule = createEstimateModule();
