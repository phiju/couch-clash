import type { CategoryMeta } from "@couch-clash/shared";

/** Whom the others rob. New variants (e.g. the runner-up too) are one entry in TARGET_STRATEGY_FNS. */
export const TARGET_STRATEGIES = ["CURRENT_LEADER"] as const;
export type TargetStrategy = (typeof TARGET_STRATEGIES)[number];

export const stealMeta = {
  id: "steal",
  name: "Punkteklau",
  description: "Wer richtig liegt, klaut dem Spitzenreiter Punkte – außer der weiß es selbst.",
  emoji: "🦹",
  ageRating: 6,
  tags: ["wissen", "risiko", "familie", "party"],
  inputType: "multiple_choice",
  secondsPerQuestion: 20,
  questionsPerRound: { min: 3, default: 6, max: 15 },
  scoring: {
    mode: "absolute",
    maxPoints: 100,
    speedModifier: { enabled: false, fastestMultiplier: 1.5, slowestMultiplier: 0.5 },
    points: { steal: 100, defendBonus: 0, correct: 100 },
  },
  scoringPoints: [
    { id: "steal", label: "Klau pro richtiger Antwort", default: 100 },
    { id: "defendBonus", label: "Bonus fürs Verteidigen", default: 0 },
    { id: "correct", label: "Richtig, solange niemand führt", default: 100 },
  ],
  scoringFields: ["points"],
  estimatedSecondsPerQuestion: 24,
  contentSource: "static",
  modes: ["kids", "family", "party"],
  contentPool: "quiz",
  announceIntro: true,
  capExempt: true,
  risk: true,
  needsStandings: true,
} as const satisfies CategoryMeta;
