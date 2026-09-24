import type { CategoryMeta } from "@couch-clash/shared";

export const quizMeta = {
  id: "quiz",
  name: "Wissensfragen",
  description: "Vier Antworten, eine ist richtig. Wer schnell antwortet, bekommt mehr Punkte.",
  emoji: "🧠",
  ageRating: 6,
  tags: ["wissen", "familie", "kinder", "party"],
  inputType: "multiple_choice",
  secondsPerQuestion: 20,
  questionsPerRound: { min: 3, default: 8, max: 20 },
  scoring: {
    mode: "absolute",
    maxPoints: 100,
    speedModifier: { enabled: true, fastestMultiplier: 1.5, slowestMultiplier: 0.5 },
  },
  scoringFields: ["maxPoints", "speedModifier"],
  estimatedSecondsPerQuestion: 22,
  contentSource: "static",
} as const satisfies CategoryMeta;
