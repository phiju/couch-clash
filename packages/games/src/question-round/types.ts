/** Client-safe types for question-based categories (no logic, no content). */
import type { ScoreResult } from "../scoring/final";

export type { ScoreResult };

/**
 * Steps per question: question → reveal (correct answer, ~3 s) →
 * leaderboard (animated ranking, ~7 s) → next question.
 */
export type QuestionRoundStep = "question" | "reveal" | "leaderboard";

export interface QuestionRoundPublicState<TQuestion, TAnswer, TSolution> {
  step: QuestionRoundStep;
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
  /** Only in the reveal and leaderboard steps. */
  reveal: {
    solution: TSolution;
    answers: Record<string, TAnswer>;
    results: Record<string, ScoreResult>;
  } | null;
}

export interface AnswerAction<TAnswer> {
  type: "answer";
  value: TAnswer;
}
