import type { CategoryMeta } from "@couch-clash/shared";

/**
 * Punktesammler – the successor of "Wissensfragen". The id stays "quiz":
 * statistics, saved host settings and the planner keep working.
 */
export const quizMeta = {
  id: "quiz",
  name: "Punktesammler",
  description: "Klassisches Quiz – jede richtige Antwort bringt Punkte.",
  emoji: "🧠",
  ageRating: 6,
  tags: ["wissen", "familie", "kinder", "party"],
  inputType: "multiple_choice",
  secondsPerQuestion: 20,
  questionsPerRound: { min: 3, default: 8, max: 20 },
  scoring: {
    mode: "absolute",
    maxPoints: 100,
    // Fixed 100 per correct answer; the host may switch the speed bonus on.
    speedModifier: { enabled: false, fastestMultiplier: 1.5, slowestMultiplier: 0.5 },
  },
  scoringFields: ["maxPoints", "speedModifier", "perQuestionCap"],
  estimatedSecondsPerQuestion: 22,
  contentSource: "static",
  modes: ["kids", "family", "party"],
  announceIntro: true,
} as const satisfies CategoryMeta;
