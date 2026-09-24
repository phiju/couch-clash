import { AGE_RATINGS } from "@couch-clash/shared";
import { z } from "zod";

const base = {
  id: z.string().regex(/^[a-z0-9-]+$/),
  text: z.string().min(5).max(200),
  ageRating: z.union(AGE_RATINGS.map((a) => z.literal(a))),
  tags: z.array(z.string().min(1)).min(1),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
};

export const QuizQuestionSchema = z
  .object({
    ...base,
    options: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1), z.string().min(1)]),
    correctIndex: z.number().int().min(0).max(3),
  })
  .refine((q) => new Set(q.options).size === 4, "Options must be distinct");

export const EstimateQuestionSchema = z.object({
  ...base,
  answer: z.number().finite(),
  /** Shown after the number, e.g. "m", "km". Empty for years. */
  unit: z.string().max(20),
  /** "year" is displayed without thousands separator. */
  format: z.enum(["number", "year"]).default("number"),
  /** Short fact shown at the reveal. */
  fact: z.string().max(200).optional(),
});

export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;
export type EstimateQuestion = z.infer<typeof EstimateQuestionSchema>;
