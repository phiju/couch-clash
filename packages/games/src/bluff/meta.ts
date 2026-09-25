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
    maxPoints: 100,
    speedModifier: { enabled: false, fastestMultiplier: 1.5, slowestMultiplier: 0.5 },
    /** find: real one found · know: wrote a correct definition · fool: fooling EVERYONE (scaled by the share). */
    points: { find: 100, know: 100, fool: 100 },
    perQuestionCap: 200,
  },
  scoringPoints: [
    { id: "find", label: "Echte Erklärung gefunden", default: 100 },
    { id: "know", label: "Selbst richtig erklärt (Gewusst!)", default: 100 },
    { id: "fool", label: "Alle reingelegt (anteilig)", default: 100 },
  ],
  scoringFields: ["points", "perQuestionCap"],
  /** Writing, check, reading, voting, reveal, leaderboard. */
  estimatedSecondsPerQuestion: 150,
  contentSource: "static",
  /** Not for kids: very rare words, free writing. */
  modes: ["family", "party"],
  options: [
    { id: "showOriginals", label: "Originaltexte der Spieler bei der Auflösung zeigen", default: false },
    /** Few players (or alone): the host invents extra wrong answers. */
    { id: "aiDecoys", label: "KI-Lügen ergänzen (immer mind. 3 falsche Antworten)", default: true },
  ],
} as const satisfies CategoryMeta;

/** Timings (points: see scoring.points in bluffMeta). */
export const BLUFF_CONFIG = {
  maxDefinitionLength: 80,
  voteSeconds: 30,
  /** AI check of the definitions (strong model); without an answer in time a local check runs. */
  checkTimeoutMs: 6_000,
  /** The check step never takes longer than this (the room's alarm falls back). */
  checkMaxMs: 8_000,
  /** A "correct" verdict below this confidence counts as a bluff (safer for the game). */
  minCorrectConfidence: 0.6,
  /** Reading the options: lead-in + time per option (longer when the host's voice is slower). */
  presentLeadMs: 1_500,
  presentMsPerOption: 3_500,
  /** Who fooled whom. */
  revealBaseMs: 4_500,
  revealMsPerOption: 1_200,
  revealMaxMs: 12_000,
  /** The real definition with a sting. */
  solutionMs: 4_500,
  /** "KI-Lügen ergänzen": at least this many wrong options (player bluffs + AI decoys). */
  minWrongOptions: 3,
  /** Decoys are asked for (in the same AI check call) when fewer players than this wrote something. */
  decoysBelowSubmissions: 5,
} as const;

export const OPTION_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
