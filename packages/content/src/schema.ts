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

export const EstimateQuestionSchema = z
  .object({
    ...base,
    answer: z.number().finite(),
    /** Shown after the number, e.g. "m", "km". Empty for years. */
    unit: z.string().max(20),
    /** "year" is displayed without thousands separator. */
    format: z.enum(["number", "year"]).default("number"),
    /**
     * Proximity scoring: the error (same unit as the answer) at which the
     * score reaches 0. Default: |answer| (100 % of the correct value).
     */
    zeroRange: z.number().finite().positive().optional(),
    /** Short fact shown at the reveal. */
    fact: z.string().max(200).optional(),
  })
  // A percentage of the answer makes no sense for years or for answers near 0.
  .refine((q) => q.format !== "year" || q.zeroRange !== undefined, {
    message: "Year questions need a zeroRange (e.g. 25–50 years)",
    path: ["zeroRange"],
  })
  .refine((q) => q.answer !== 0 || q.zeroRange !== undefined, {
    message: "Questions whose answer is 0 need a zeroRange",
    path: ["zeroRange"],
  });

export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;
export type EstimateQuestion = z.infer<typeof EstimateQuestionSchema>;

/** Bluff-Lexikon: a very rare real German NOUN (mostly Latin/Greek) and its meaning. */
export const BluffWordSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  article: z.enum(["der", "die", "das"]),
  /** A noun: capitalized, one word. */
  word: z.string().regex(/^\p{Lu}[\p{L}-]+$/u, "A single capitalized noun").max(40),
  /** Plural nouns ("die Vibrissen") → "Vibrissen sind …?". */
  plural: z.boolean().optional(),
  /** Short, like a dictionary entry, without the word itself. */
  definition: z.string().min(3).max(80),
  ageRating: z.union(AGE_RATINGS.map((a) => z.literal(a))),
  tags: z.array(z.string().min(1)).min(1),
  difficulty: z.union([z.literal(2), z.literal(3)]),
  sourceNote: z.string().max(120).optional(),
});

export type BluffWord = z.infer<typeof BluffWordSchema>;
