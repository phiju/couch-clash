import { ESTIMATE_QUESTIONS_DE, type EstimateQuestion } from "@couch-clash/content";
import { z } from "zod";
import { createQuestionRoundModule } from "../question-round/engine";
import { pickFresh } from "../random";
import { scoreEstimate } from "../scoring";
import { estimateMeta } from "./meta";
import type { EstimatePublicQuestion, EstimateSolution } from "./types";

export function createEstimateModule(pool: readonly EstimateQuestion[] = ESTIMATE_QUESTIONS_DE) {
  return createQuestionRoundModule<EstimateQuestion, number, EstimatePublicQuestion, EstimateSolution>({
    meta: estimateMeta,
    answerSchema: z.number().finite().min(-1e12).max(1e12),
    pickQuestions: (ctx, { questionCount, excludeContentIds }) =>
      pickFresh(pool, questionCount, excludeContentIds, ctx.random),
    score: (question, answers, scoring) => scoreEstimate(answers, question.answer, scoring),
    publicQuestion: (q) => ({ text: q.text, unit: q.unit, format: q.format }),
    solution: (q) => ({ answer: q.answer, unit: q.unit, format: q.format, fact: q.fact ?? null }),
  });
}

export const estimateModule = createEstimateModule();
