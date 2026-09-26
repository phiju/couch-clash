import type { CategoryMeta } from "@couch-clash/shared";

/**
 * Survival-Finale: the last round of a game. The main game's points become
 * life energy; questions keep coming until one player is left.
 * Plays the multiple-choice questions of the quiz (statistics stay there).
 */
export const survivalMeta = {
  id: "survival",
  name: "Survival-Finale",
  description: "Eure Punkte sind euer Leben. Wer zuerst im Schleim landet, ist raus – der Letzte gewinnt.",
  emoji: "🟢",
  ageRating: 6,
  tags: ["finale", "wissen", "familie", "kinder", "party"],
  inputType: "multiple_choice",
  secondsPerQuestion: 20,
  // No fixed number of questions – the finale ends when one player is left.
  questionsPerRound: { min: 1, default: 1, max: 1 },
  scoring: {
    mode: "absolute",
    maxPoints: 0,
    speedModifier: { enabled: false, fastestMultiplier: 1, slowestMultiplier: 1 },
  },
  scoringFields: [],
  // A typical finale: ~20 questions incl. reveal – the planner treats the round as one long "question".
  estimatedSecondsPerQuestion: 480,
  contentSource: "static",
  modes: ["kids", "family", "party"],
  contentPool: "quiz",
  capExempt: true,
  risk: true,
  needsStandings: true,
  finale: true,
} as const satisfies CategoryMeta;
