import type { CategoryMeta } from "@couch-clash/shared";

export const CATEGORY_PICK_CONFIG = {
  /** Seconds to pick a category card. */
  pickSeconds: 12,
  /** Category cards on offer. */
  offerSize: 3,
  /** A pick holds for this many questions (a block). */
  questionsPerPick: 1,
} as const;

/** Who picks the category: the player in last place (default) or the host. */
export const PICKER_STRATEGIES = ["LAST_PLACE", "HOST"] as const;
export type PickerStrategy = (typeof PICKER_STRATEGIES)[number];

export const categoryPickMeta = {
  id: "category-pick",
  name: "Kategorienvorgabe",
  description: "Wer ganz hinten liegt, sucht die Kategorie aus – dann raten alle.",
  emoji: "🎯",
  ageRating: 6,
  tags: ["wissen", "familie", "kinder", "party"],
  inputType: "multiple_choice",
  secondsPerQuestion: 20,
  questionsPerRound: { min: 3, default: 6, max: 15 },
  scoring: {
    mode: "absolute",
    maxPoints: 100,
    speedModifier: { enabled: false, fastestMultiplier: 1.5, slowestMultiplier: 0.5 },
  },
  scoringFields: ["maxPoints", "speedModifier", "perQuestionCap"],
  // Question + one pick (12 s) per question.
  estimatedSecondsPerQuestion: 34,
  contentSource: "static",
  modes: ["kids", "family", "party"],
  contentPool: "quiz",
  announceIntro: true,
  options: [{ id: "hostPicks", label: "Der Host wählt die Kategorie (statt dem Letzten)", default: false }],
} as const satisfies CategoryMeta;
