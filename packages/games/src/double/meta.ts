import type { CategoryMeta } from "@couch-clash/shared";

export const DOUBLE_CONFIG = {
  /** Seconds for the secret NORMAL / DOUBLE decision. */
  decideSeconds: 8,
} as const;

export const doubleMeta = {
  id: "double-or-nothing",
  name: "Double or Nothing",
  description: "Vor jeder Frage geheim entscheiden: normal spielen oder alles verdoppeln – auch den Verlust.",
  emoji: "🎲",
  ageRating: 6,
  tags: ["wissen", "risiko", "familie", "party"],
  inputType: "multiple_choice",
  secondsPerQuestion: 20,
  questionsPerRound: { min: 3, default: 6, max: 15 },
  scoring: {
    mode: "absolute",
    maxPoints: 100,
    speedModifier: { enabled: false, fastestMultiplier: 1.5, slowestMultiplier: 0.5 },
    points: { normal: 100, double: 200, doubleLoss: 200 },
  },
  scoringPoints: [
    { id: "normal", label: "NORMAL richtig", default: 100 },
    { id: "double", label: "DOUBLE richtig", default: 200 },
    { id: "doubleLoss", label: "DOUBLE falsch (Abzug)", default: 200 },
  ],
  scoringFields: ["points"],
  // Question + the decision (8 s).
  estimatedSecondsPerQuestion: 29,
  contentSource: "static",
  modes: ["kids", "family", "party"],
  contentPool: "quiz",
  announceIntro: true,
  capExempt: true,
  risk: true,
} as const satisfies CategoryMeta;
