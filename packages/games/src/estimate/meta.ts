import type { CategoryMeta } from "@couch-clash/shared";

export const estimateMeta = {
  id: "estimate",
  name: "Wer ist am nächsten dran?",
  description: "Schätzt die Zahl – wer am nächsten dran ist, bekommt die meisten Punkte.",
  emoji: "📏",
  ageRating: 6,
  tags: ["wissen", "familie", "party"],
  inputType: "number",
  secondsPerQuestion: 30,
  questionsPerRound: { min: 3, default: 6, max: 15 },
  scoring: {
    mode: "proximity",
    maxPoints: 100,
    speedModifier: { enabled: false, fastestMultiplier: 1.5, slowestMultiplier: 0.5 },
  },
  scoringFields: ["maxPoints", "speedModifier", "perQuestionCap"],
  estimatedSecondsPerQuestion: 32,
  contentSource: "static",
  modes: ["kids", "family", "party"],
  // Estimating is guessing – difficulty 2 is still fine for kids.
  kidsMaxDifficulty: 2,
} as const satisfies CategoryMeta;
