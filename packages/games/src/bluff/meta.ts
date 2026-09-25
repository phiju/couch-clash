import type { CategoryMeta } from "@couch-clash/shared";

export const bluffMeta = {
  id: "bluff",
  name: "Bluff-Lexikon",
  description: "Erfinde die beste Erklärung – und finde die echte!",
  emoji: "📖",
  ageRating: 12,
  tags: ["sprache", "kreativ", "familie", "party"],
  inputType: "text",
  /** Writing time per word. */
  secondsPerQuestion: 60,
  questionsPerRound: { min: 3, default: 5, max: 10 },
  scoring: {
    mode: "bluff",
    /** Points for voting for the real definition (the other amounts are shares of it). */
    maxPoints: 100,
    speedModifier: { enabled: false, fastestMultiplier: 1.5, slowestMultiplier: 0.5 },
  },
  scoringFields: ["maxPoints"],
  /** Writing, check, reading, voting, reveal, leaderboard. */
  estimatedSecondsPerQuestion: 150,
  contentSource: "static",
  /** Somebody has to be fooled. */
  minPlayers: 2,
} as const satisfies CategoryMeta;

/** Timings and point shares (maxPoints = points for finding the real definition). */
export const BLUFF_CONFIG = {
  maxDefinitionLength: 80,
  voteSeconds: 30,
  /** Per player who voted for your invented definition, as a share of maxPoints (100 → 50). */
  perFooledShare: 0.5,
  /** Writing an essentially correct definition ("Gewusst!"), as a share of maxPoints. */
  knewItShare: 1,
  /** AI check of the definitions; without an answer in time everything is shown as written. */
  checkTimeoutMs: 5_000,
  /** The check step never takes longer than this (the room's alarm falls back). */
  checkMaxMs: 7_000,
  /** Reading the options: lead-in + time per option (longer when the host's voice is slower). */
  presentLeadMs: 1_500,
  presentMsPerOption: 3_500,
  /** Who fooled whom. */
  revealBaseMs: 4_500,
  revealMsPerOption: 1_200,
  revealMaxMs: 12_000,
  /** The real definition with a sting. */
  solutionMs: 4_500,
} as const;

export const OPTION_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
