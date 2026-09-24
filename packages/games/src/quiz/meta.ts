import type { CategoryMeta } from "@couch-clash/shared";

export const quizMeta = {
  id: "quiz",
  name: "Wissensfragen",
  description: "Vier Antworten, eine ist richtig. Wer schnell ist, bekommt mehr Punkte.",
  emoji: "🧠",
  ageRating: 6,
  tags: ["wissen", "familie", "kinder", "party"],
  inputType: "multiple_choice",
  secondsPerQuestion: 20,
  questionsPerRound: { min: 3, default: 8, max: 20 },
  scoring: { basePoints: 100, speedBonus: true, minPercent: 10, estimateScale: "distance" },
  scoringFields: ["basePoints", "speedBonus", "minPercent"],
  estimatedSecondsPerQuestion: 22,
  contentSource: "static",
} as const satisfies CategoryMeta;
