import type { CategoryMeta } from "@couch-clash/shared";

export const estimateMeta = {
  id: "estimate",
  name: "Schätzfragen",
  description: "Tippt eine Zahl ein. Wer am nächsten dran ist, gewinnt.",
  emoji: "🎯",
  ageRating: 6,
  tags: ["wissen", "familie", "party"],
  inputType: "number",
  secondsPerQuestion: 30,
  questionsPerRound: { min: 3, default: 6, max: 15 },
  scoring: { basePoints: 100, speedBonus: false, minPercent: 10, estimateScale: "distance" },
  scoringFields: ["basePoints", "speedBonus", "minPercent", "estimateScale"],
  estimatedSecondsPerQuestion: 32,
  contentSource: "static",
} as const satisfies CategoryMeta;
