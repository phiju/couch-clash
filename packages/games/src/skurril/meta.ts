import type { CategoryMeta } from "@couch-clash/shared";

/** Skurrile Ereignisse: the Bluff-Lexikon mechanics with true, bizarre stories. */
export const skurrilMeta = {
  id: "skurril",
  name: "Skurrile Ereignisse",
  description: "Wahre Geschichten, die keiner glaubt – erfinde die beste Lüge und finde die Wahrheit!",
  emoji: "🤯",
  ageRating: 6,
  tags: ["wissen", "kreativ", "familie", "kinder", "party"],
  inputType: "text",
  /** Writing time per story (more to read than a single word). */
  secondsPerQuestion: 75,
  questionsPerRound: { min: 3, default: 5, max: 10 },
  scoring: {
    mode: "bluff",
    maxPoints: 100,
    speedModifier: { enabled: false, fastestMultiplier: 1.5, slowestMultiplier: 0.5 },
    /** find: true answer found · know: knew the story · fool: fooling EVERYONE (scaled by the share). */
    points: { find: 100, know: 100, fool: 100 },
    perQuestionCap: 200,
  },
  scoringPoints: [
    { id: "find", label: "Wahre Antwort gefunden", default: 100 },
    { id: "know", label: "Selbst richtig geantwortet (Gewusst!)", default: 100 },
    { id: "fool", label: "Alle reingelegt (anteilig)", default: 100 },
  ],
  scoringFields: ["points", "perQuestionCap"],
  /** Reading the story, writing, check, reading the options, voting, reveal, leaderboard. */
  estimatedSecondsPerQuestion: 170,
  contentSource: "static",
  /** Somebody has to be fooled. */
  minPlayers: 2,
  /** Unlike the Bluff-Lexikon also for kids: the kids stories are written for children. */
  modes: ["kids", "family", "party"],
  /** Kids: every story rated 6, whatever its difficulty. */
  kidsMaxDifficulty: 3,
  announceIntro: true,
  options: [{ id: "showOriginals", label: "Originaltexte der Spieler bei der Auflösung zeigen", default: false }],
} as const satisfies CategoryMeta;
