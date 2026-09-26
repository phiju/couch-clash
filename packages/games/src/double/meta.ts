import type { CategoryMeta } from "@couch-clash/shared";

export const DOUBLE_CONFIG = {
  /** Seconds for the secret CASH OUT / BET decision. */
  decideSeconds: 10,
  /** Seconds the TV uncovers everyone's choice (and the cash-outs) before the question. */
  showdownSeconds: 5,
  /** Question n has level n – five questions climb from easy (1) to very hard (5). */
  maxLevel: 5,
  /** From this level on the host warns before the question. */
  warnLevel: 4,
} as const;

/** The pot after a right answer: 2 × pot + bonus (an empty pot → bonus): 100 → 300 → 700 → 1,500 → 3,100. */
export const potAfterWin = (pot: number, bonus: number) => 2 * pot + bonus;

export const doubleMeta = {
  id: "double-or-nothing",
  name: "Double or Nothing",
  description:
    "Jede richtige Antwort lässt deinen Topf wachsen – aber die Fragen werden immer schwerer. Vor jeder Frage geheim: kassieren oder alles setzen?",
  emoji: "🎲",
  ageRating: 6,
  tags: ["wissen", "risiko", "familie", "party"],
  inputType: "multiple_choice",
  secondsPerQuestion: 20,
  questionsPerRound: { min: 3, default: 5, max: DOUBLE_CONFIG.maxLevel },
  scoring: {
    mode: "absolute",
    maxPoints: 100,
    speedModifier: { enabled: false, fastestMultiplier: 1.5, slowestMultiplier: 0.5 },
    points: { bonus: 100 },
  },
  scoringPoints: [{ id: "bonus", label: "Topf-Bonus je richtiger Antwort (Topf × 2 + Bonus)", default: 100 }],
  scoringFields: ["points"],
  // Question + decision (10 s) + showdown (5 s).
  estimatedSecondsPerQuestion: 42,
  contentSource: "static",
  modes: ["kids", "family", "party"],
  contentPool: "quiz",
  announceIntro: true,
  capExempt: true,
  risk: true,
} as const satisfies CategoryMeta;
