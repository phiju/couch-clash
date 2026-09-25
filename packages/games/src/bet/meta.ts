import type { CategoryMeta } from "@couch-clash/shared";

export const BET_CONFIG = {
  /** Seconds to place the wager (the category is already shown). */
  wagerSeconds: 12,
  /** Wager buttons on the phones (plus "Eigene Eingabe"). */
  presets: [50, 100, 200],
} as const;

/**
 * How high a player may bet. Default "SCORE_OR_FLOOR": max(current score,
 * floor) – players with 0 or few points can still bet the floor (100).
 */
export const WAGER_LIMIT_STRATEGIES = ["SCORE_OR_FLOOR"] as const;
export type WagerLimitStrategy = (typeof WAGER_LIMIT_STRATEGIES)[number];

export const betMeta = {
  id: "bet",
  name: "Bet",
  description: "Erst die Kategorie, dann der Einsatz: richtig gewinnt ihn, falsch kostet ihn.",
  emoji: "💰",
  ageRating: 6,
  tags: ["wissen", "risiko", "familie", "party"],
  inputType: "multiple_choice",
  secondsPerQuestion: 20,
  questionsPerRound: { min: 3, default: 6, max: 15 },
  scoring: {
    mode: "absolute",
    maxPoints: 100,
    speedModifier: { enabled: false, fastestMultiplier: 1.5, slowestMultiplier: 0.5 },
    points: { defaultWager: 50, wagerFloor: 100 },
  },
  scoringPoints: [
    { id: "defaultWager", label: "Einsatz ohne Wahl", default: 50 },
    { id: "wagerFloor", label: "Höchsteinsatz mindestens", default: 100 },
  ],
  scoringFields: ["points"],
  // Question + the wager (12 s).
  estimatedSecondsPerQuestion: 33,
  contentSource: "static",
  modes: ["kids", "family", "party"],
  contentPool: "quiz",
  announceIntro: true,
  capExempt: true,
  risk: true,
} as const satisfies CategoryMeta;
