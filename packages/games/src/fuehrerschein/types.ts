import type { QuestionRoundPublicState } from "../question-round/types";
import type { QuizAnswer, QuizPublicQuestion, QuizSolution } from "../quiz/types";

/** One player's exam result after the round – show only, never points. */
export interface ExamResult {
  playerId: string;
  correct: number;
  total: number;
  passed: boolean;
}

export interface ExamSummary {
  results: ExamResult[];
  /** Share of right answers needed to pass (e.g. 0.7). */
  passShare: number;
}

export type FuehrerscheinPublicState = QuestionRoundPublicState<QuizPublicQuestion, QuizAnswer, QuizSolution, ExamSummary>;
