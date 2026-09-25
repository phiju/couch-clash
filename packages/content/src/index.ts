/**
 * Question content. Files live in ../data and are validated with zod when
 * this module is loaded – a broken question file fails fast (and in tests).
 */
import { z } from "zod";
import bluffDe from "../data/bluff.de.json";
import estimateDe from "../data/estimate.de.json";
import fuehrerscheinDe from "../data/fuehrerschein.de.json";
import quizDe from "../data/quiz.de.json";
import { BluffWordSchema, EstimateQuestionSchema, FuehrerscheinQuestionSchema, QuizQuestionSchema } from "./schema";

export * from "./schema";

function load<T extends z.ZodType>(schema: T, data: unknown, name: string): z.infer<T>[] {
  const questions = z.array(schema).parse(data, { error: () => `Invalid content in ${name}` });
  const ids = new Set<string>();
  for (const q of questions as { id: string }[]) {
    if (ids.has(q.id)) throw new Error(`Duplicate question id ${q.id} in ${name}`);
    ids.add(q.id);
  }
  return questions;
}

export const QUIZ_QUESTIONS_DE = load(QuizQuestionSchema, quizDe, "quiz.de.json");
export const ESTIMATE_QUESTIONS_DE = load(EstimateQuestionSchema, estimateDe, "estimate.de.json");
export const FUEHRERSCHEIN_QUESTIONS_DE = load(FuehrerscheinQuestionSchema, fuehrerscheinDe, "fuehrerschein.de.json");
export const BLUFF_WORDS_DE = load(BluffWordSchema, bluffDe, "bluff.de.json");
