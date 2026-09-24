/** Client-safe types for question-based categories (no logic, no content). */
import type { PointsBreakdown } from "../scoring";

export type { PointsBreakdown };

export const REVEAL_MS = 8_000;

export interface QuestionRoundPublicState<TQuestion, TAnswer, TSolution> {
  step: "question" | "reveal";
  /** 0-based question index and total questions in this category. */
  index: number;
  total: number;
  question: TQuestion;
  /** Server time when the question was shown. */
  questionStartedAt: number;
  /** Server time when the current step ends. */
  stepEndsAt: number;
  /** Who has answered already (not what). */
  answeredPlayerIds: string[];
  /** Only for the viewing player: their own answer. */
  myAnswer: TAnswer | null;
  /** Only in the reveal step. */
  reveal: {
    solution: TSolution;
    answers: Record<string, TAnswer>;
    results: Record<string, PointsBreakdown>;
  } | null;
}

export interface AnswerAction<TAnswer> {
  type: "answer";
  value: TAnswer;
}
