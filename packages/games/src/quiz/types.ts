import type { QuestionMedia } from "@couch-clash/shared";
import type { QuestionRoundPublicState } from "../question-round/types";

export interface QuizPublicQuestion {
  text: string;
  options: string[];
  /** Führerscheinprüfung: a traffic sign or junction scene shown with the question. */
  media?: QuestionMedia;
}

export interface QuizSolution {
  correctIndex: number;
  /** Short "why", shown under the correct answer (not read out). */
  explanation?: string;
  /** Scenes: who drives in which order (vehicle ids, "ped:<arm>" for pedestrians). */
  driveOrder?: string[];
}

/** Index of the chosen option. */
export type QuizAnswer = number;

export type QuizPublicState = QuestionRoundPublicState<QuizPublicQuestion, QuizAnswer, QuizSolution>;
