import { scoreAnswer, type ScoreResult } from "../scoring";
import { isCorrectAnswer, type KnowledgeScoreInput } from "./engine";

/**
 * Punktesammler scoring (also Kategorienvorgabe): correct → maxPoints (100),
 * wrong or no answer → 0; optional speed bonus; the per-question cap applies.
 */
export function scoreCorrectAnswers<G>(input: KnowledgeScoreInput<G>): { results: Record<string, ScoreResult> } {
  const results: Record<string, ScoreResult> = {};
  for (const [id, a] of Object.entries(input.answers)) {
    results[id] = scoreAnswer(input.scoring, { correct: isCorrectAnswer(input.question, a) }, {
      responseTimeMs: a.at - input.questionStartedAt,
      timeLimitMs: input.questionMs,
    });
  }
  return { results };
}
