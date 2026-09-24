import type { QuestionRoundPublicState } from "../question-round/types";

export interface EstimatePublicQuestion {
  text: string;
  unit: string;
  format: "number" | "year";
}

export interface EstimateSolution {
  answer: number;
  unit: string;
  format: "number" | "year";
  fact: string | null;
}

export type EstimateAnswer = number;

export type EstimatePublicState = QuestionRoundPublicState<
  EstimatePublicQuestion,
  EstimateAnswer,
  EstimateSolution
>;
