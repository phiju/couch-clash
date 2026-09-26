import type { CategoryMeta } from "@couch-clash/shared";

/**
 * Stadt, Land, Fluss: a random letter and a few categories – everyone fills
 * them in at the same time on the phone. Then the host reads out EVERY
 * answer, category by category, with one gag each.
 *
 * Categories and letters live in packages/content/data/stadt-land-fluss.de.json;
 * round length, number of categories and all points are host settings
 * ("Punkte-Einstellungen") – nothing here needs a code change to tune.
 */
export const SLF_DEFAULTS = {
  /** Points: the only valid answer in its category · valid and unique · valid but shared · funniest answer (vote). */
  only: 20,
  unique: 10,
  duplicate: 5,
  vote: 10,
  /** Familie / Party: categories per letter and seconds to write. */
  categoriesAdults: 4,
  secondsAdults: 60,
  /** Kids: fewer categories, more time. */
  categoriesKids: 3,
  secondsKids: 90,
  /** After "Stopp!" everyone else has this long. */
  stopSeconds: 10,
} as const;

export const SLF_CONFIG = {
  /** The letter on the TV before the phones open. */
  introMs: 4_500,
  /** Longest answer per field. */
  maxAnswerLength: 40,
  /** AI check of all answers of a letter (one call, strong model); without an answer in time the letter check alone decides. */
  checkTimeoutMs: 9_000,
  checkMaxMs: 11_000,
  /** The host's gags (one call for all categories, fast model); without them the host reads without gags. */
  scriptTimeoutMs: 6_000,
  scriptMaxMs: 8_000,
  /** Reading out one category when the voice is silent (or slower: the room waits for the voice). */
  revealLeadMs: 1_200,
  revealMsPerChar: 62,
  revealMinMsPerCategory: 5_000,
  /** Voting for the funniest "kreativ" answer. */
  voteSeconds: 25,
  /** The funniest answer and the round's points. */
  tallyMs: 7_000,
  /** Gag of one category (after the names are filled in). */
  maxGagLength: 160,
  /** Settings the host may change – limits. */
  minCategories: 2,
  maxCategories: 6,
  minSeconds: 30,
  maxSeconds: 180,
  minStopSeconds: 3,
  maxStopSeconds: 30,
} as const;

export const slfMeta = {
  id: "stadt-land-fluss",
  name: "Stadt, Land, Fluss",
  description: "Ein Buchstabe, ein paar Kategorien – alle schreiben gleichzeitig. Wer zuerst fertig ist, ruft Stopp! Danach liest der Moderator jede Antwort vor.",
  emoji: "✏️",
  ageRating: 6,
  tags: ["sprache", "kreativ", "klassiker", "familie", "kinder", "party"],
  inputType: "text",
  secondsPerQuestion: SLF_DEFAULTS.secondsAdults,
  /** One "question" = one letter. */
  questionsPerRound: { min: 1, default: 3, max: 6 },
  scoring: {
    mode: "absolute",
    maxPoints: SLF_DEFAULTS.only,
    speedModifier: { enabled: false, fastestMultiplier: 1, slowestMultiplier: 1 },
    points: { ...SLF_DEFAULTS },
    /** 6 categories à 20 + the vote. */
    perQuestionCap: 200,
  },
  scoringPoints: [
    { id: "only", label: "Einzige gültige Antwort der Kategorie", default: SLF_DEFAULTS.only, step: 5 },
    { id: "unique", label: "Gültig und einzigartig", default: SLF_DEFAULTS.unique, step: 5 },
    { id: "duplicate", label: "Gültig, aber doppelt", default: SLF_DEFAULTS.duplicate, step: 5 },
    { id: "vote", label: "Witzigste Antwort (Abstimmung)", default: SLF_DEFAULTS.vote, step: 5 },
    {
      id: "categoriesAdults",
      label: "Kategorien pro Buchstabe (Familie / Party)",
      default: SLF_DEFAULTS.categoriesAdults,
      min: SLF_CONFIG.minCategories,
      max: SLF_CONFIG.maxCategories,
      step: 1,
    },
    {
      id: "secondsAdults",
      label: "Sekunden zum Schreiben (Familie / Party)",
      default: SLF_DEFAULTS.secondsAdults,
      min: SLF_CONFIG.minSeconds,
      max: SLF_CONFIG.maxSeconds,
      step: 5,
    },
    {
      id: "categoriesKids",
      label: "Kategorien pro Buchstabe (Kids)",
      default: SLF_DEFAULTS.categoriesKids,
      min: SLF_CONFIG.minCategories,
      max: SLF_CONFIG.maxCategories,
      step: 1,
    },
    {
      id: "secondsKids",
      label: "Sekunden zum Schreiben (Kids)",
      default: SLF_DEFAULTS.secondsKids,
      min: SLF_CONFIG.minSeconds,
      max: SLF_CONFIG.maxSeconds,
      step: 5,
    },
    {
      id: "stopSeconds",
      label: "Sekunden nach „Stopp!“",
      default: SLF_DEFAULTS.stopSeconds,
      min: SLF_CONFIG.minStopSeconds,
      max: SLF_CONFIG.maxStopSeconds,
      step: 1,
    },
  ],
  scoringFields: ["points", "perQuestionCap"],
  /** Letter, writing, check, reading every answer, vote, leaderboard. */
  estimatedSecondsPerQuestion: 170,
  contentSource: "static",
  modes: ["kids", "family", "party"],
  announceIntro: true,
} as const satisfies CategoryMeta;
