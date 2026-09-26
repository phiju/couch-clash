import type { CategoryMeta, CategoryOption, ScoringPoint } from "@couch-clash/shared";

/**
 * Musik-Quiz: well-known party songs, one question type per song – "Wie
 * heißt der Song?" (buzzer), "Wer singt das?" (buzzer) or "Aus welchem
 * Jahr?" (everyone at once). Kids: title only, four options, no timer.
 *
 * Client-safe: no songs, no logic. The question types themselves (filter,
 * flow, check, scoring) are registered in question-types.ts.
 */

/** Genres the host can pick (ids = SONG_GENRE_IDS in @couch-clash/content). None picked = Zufall. */
export const MUSIK_GENRES = [
  { id: "80er", label: "80er", emoji: "📼" },
  { id: "90er", label: "90er", emoji: "💿" },
  { id: "2000er", label: "2000er", emoji: "📱" },
  { id: "schlager-klassiker", label: "Schlager-Klassiker", emoji: "🌹" },
  { id: "schlager-party", label: "Schlager-Party", emoji: "🪩" },
  { id: "ballermann", label: "Ballermann & Après-Ski", emoji: "🍻" },
  { id: "oktoberfest", label: "Oktoberfest & Wiesn", emoji: "🥨" },
  { id: "ndw", label: "Neue Deutsche Welle", emoji: "🎹" },
  { id: "party-international", label: "Party-Klassiker international", emoji: "🕺" },
  { id: "kinder", label: "Kinderlieder & Kinder-Hits (nur Kids)", emoji: "🧸" },
] as const;
export type MusikGenreId = (typeof MUSIK_GENRES)[number]["id"];

/** Question types in the order of the settings. Each has an option `type<Id>` and a weight `weight<Id>`. */
export const MUSIK_QUESTION_TYPE_IDS = ["title", "artist", "year"] as const;
export type MusikQuestionTypeId = (typeof MUSIK_QUESTION_TYPE_IDS)[number];

/** What the TV shows big before the song (2–3 s) – and the phones. */
export const MUSIK_TYPE_INFO: Record<MusikQuestionTypeId, { label: string; emoji: string; hint: string; optionId: string; weightId: string }> = {
  title: { label: "Wie heißt der Song?", emoji: "🎵", hint: "Buzzern und den Titel eintippen!", optionId: "typeTitle", weightId: "weightTitle" },
  artist: { label: "Wer singt das?", emoji: "🎤", hint: "Buzzern und den Interpreten eintippen!", optionId: "typeArtist", weightId: "weightArtist" },
  year: { label: "Aus welchem Jahr?", emoji: "📅", hint: "Alle tippen gleichzeitig das Jahr!", optionId: "typeYear", weightId: "weightYear" },
};
/** Kids see the title question as multiple choice. */
export const MUSIK_KIDS_INFO = { label: "Wie heißt der Song?", emoji: "🎵", hint: "Hör gut zu und tipp den richtigen Titel an!" } as const;

export const genreOptionId = (id: MusikGenreId) => `genre-${id}`;

export const MUSIK_CONFIG = {
  /** The question type big on the TV before each song. */
  announceMs: 2_800,
  /** Length of a preview clip (Deezer / iTunes previews are 30 s). */
  clipMs: 30_000,
  /** The solution with cover, title and artist. */
  revealMs: 6_000,
  /** Kids: once everyone answered, a short moment before the solution (a last change still counts). */
  kidsSettleMs: 1_500,
  /** Longest free-text answer. */
  maxAnswerLength: 60,
  /** Waiting for fresh preview URLs at the round start before playing what is there. */
  previewTimeoutMs: 12_000,
  /** Candidate songs per slot (the first one with a preview plays). */
  sparesPerSlot: 2,
  /** Songs below this provider popularity are not played (the import filters by the same number). */
  minPopularity: 0,
  /** Year slider range and start. */
  yearMin: 1950,
  yearDefault: 1990,
  /** "Aus welchem Jahr?": off by this much or more → the host teases. */
  wayOffYears: 15,
  /** Borderline check by the text model (option aiCheck). */
  aiCheckTimeoutMs: 4_000,
  /** Test bots: chance per second of the clip to buzz, and to know it. */
  botBuzzChance: 0.35,
} as const;

const DEFAULT_POINTS = {
  fast: 200,
  slow: 50,
  fastSeconds: 5,
  wrongBuzz: 0,
  memberShare: 50,
  answerSeconds: 10,
  yearExact: 200,
  year1: 150,
  year2: 100,
  year5: 50,
  yearClosest: 50,
  yearSeconds: 20,
  kids: 100,
  weightTitle: 1,
  weightArtist: 1,
  weightYear: 1,
} as const;
export type MusikPointId = keyof typeof DEFAULT_POINTS;

const scoringPoints: readonly (ScoringPoint & { id: MusikPointId })[] = [
  { id: "fast", label: "Titel/Interpret: Buzz in den ersten Sekunden", default: DEFAULT_POINTS.fast },
  { id: "fastSeconds", label: "… volle Punkte bis Sekunde", default: DEFAULT_POINTS.fastSeconds, min: 1, max: 20, step: 1 },
  { id: "slow", label: "Titel/Interpret: Buzz am Clip-Ende", default: DEFAULT_POINTS.slow },
  { id: "wrongBuzz", label: "Minuspunkte für Fehl-Buzz (0 = aus)", default: DEFAULT_POINTS.wrongBuzz, min: 0, max: 200 },
  { id: "memberShare", label: "Bandmitglied statt Band (% der Punkte)", default: DEFAULT_POINTS.memberShare, min: 0, max: 100, step: 10 },
  { id: "answerSeconds", label: "Antwortzeit nach dem Buzz (Sekunden)", default: DEFAULT_POINTS.answerSeconds, min: 5, max: 30, step: 1 },
  { id: "yearExact", label: "Jahr: exakt", default: DEFAULT_POINTS.yearExact },
  { id: "year1", label: "Jahr: ±1", default: DEFAULT_POINTS.year1 },
  { id: "year2", label: "Jahr: ±2", default: DEFAULT_POINTS.year2 },
  { id: "year5", label: "Jahr: ±5", default: DEFAULT_POINTS.year5 },
  { id: "yearClosest", label: "Jahr: Bonus für den Nächsten (wenn keiner exakt)", default: DEFAULT_POINTS.yearClosest },
  { id: "yearSeconds", label: "Jahr: Sekunden Musik", default: DEFAULT_POINTS.yearSeconds, min: 15, max: 30, step: 1 },
  { id: "kids", label: "Kids: richtige Antwort", default: DEFAULT_POINTS.kids },
  { id: "weightTitle", label: "Gewichtung „Wie heißt der Song?“", default: DEFAULT_POINTS.weightTitle, min: 0, max: 5, step: 1 },
  { id: "weightArtist", label: "Gewichtung „Wer singt das?“", default: DEFAULT_POINTS.weightArtist, min: 0, max: 5, step: 1 },
  { id: "weightYear", label: "Gewichtung „Aus welchem Jahr?“", default: DEFAULT_POINTS.weightYear, min: 0, max: 5, step: 1 },
];

const options: readonly CategoryOption[] = [
  ...MUSIK_QUESTION_TYPE_IDS.map((t) => ({ id: MUSIK_TYPE_INFO[t].optionId, label: `Fragetyp: ${MUSIK_TYPE_INFO[t].label}`, default: true })),
  ...MUSIK_GENRES.map((g) => ({ id: genreOptionId(g.id), label: `${g.emoji} ${g.label}`, default: false })),
  { id: "aiCheck", label: "KI prüft knappe Antworten (Grenzfälle)", default: false },
];

export const musikMeta = {
  id: "musik",
  name: "Musik-Quiz",
  description:
    "Partyhits zum Mitsingen! Vor jedem Song seht ihr die Frage: Titel oder Interpret erraten (wer zuerst buzzert, darf antworten) oder das Jahr schätzen. Genres wählen – keins gewählt heißt Zufall.",
  emoji: "🎶",
  ageRating: 0,
  tags: ["musik", "buzzer", "mitsingen", "party", "kinder"],
  inputType: "buzzer",
  secondsPerQuestion: MUSIK_CONFIG.clipMs / 1000,
  questionsPerRound: { min: 3, default: 8, max: 15 },
  scoring: {
    mode: "absolute",
    maxPoints: DEFAULT_POINTS.fast,
    speedModifier: { enabled: false, fastestMultiplier: 1, slowestMultiplier: 1 },
    points: { ...DEFAULT_POINTS },
    perQuestionCap: 200,
  },
  scoringPoints,
  scoringFields: ["points", "perQuestionCap"],
  /** Announcement, ~15–20 s of music, the solution and the leaderboard. */
  estimatedSecondsPerQuestion: 38,
  contentSource: "static",
  modes: ["kids", "family", "party"],
  kidsMaxDifficulty: 3,
  options,
  announceIntro: true,
} as const satisfies CategoryMeta;
