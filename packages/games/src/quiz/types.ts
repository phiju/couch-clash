import type { QuestionRoundPublicState } from "../question-round/types";

export interface QuizPublicQuestion {
  text: string;
  options: string[];
}

export interface QuizSolution {
  correctIndex: number;
}

/** Index of the chosen option. */
export type QuizAnswer = number;

export type QuizPublicState = QuestionRoundPublicState<QuizPublicQuestion, QuizAnswer, QuizSolution>;
