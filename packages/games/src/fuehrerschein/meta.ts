import type { CategoryMeta } from "@couch-clash/shared";

export const fuehrerscheinMeta = {
  id: "fuehrerschein",
  name: "Führerscheinprüfung",
  description: "Schilder, Vorfahrt und Verkehrsregeln – hättet ihr die Prüfung bestanden?",
  emoji: "🚗",
  ageRating: 6,
  tags: ["verkehr", "familie", "kinder", "party"],
  inputType: "multiple_choice",
  /** Text and sign questions; scenes get FUEHRERSCHEIN_CONFIG.sceneSeconds. */
  secondsPerQuestion: 15,
  questionsPerRound: { min: 5, default: 8, max: 10 },
  scoring: {
    mode: "absolute",
    maxPoints: 100,
    speedModifier: { enabled: true, fastestMultiplier: 1.5, slowestMultiplier: 0.5 },
  },
  scoringFields: ["maxPoints", "speedModifier", "perQuestionCap"],
  /** Answer (15–20 s) + reveal with explanation / drive-through + leaderboard. */
  estimatedSecondsPerQuestion: 30,
  contentSource: "static",
  modes: ["kids", "family", "party"],
  // The two kids questions with difficulty 2 (Spielstraße, Zebrastreifen-Schild) are still easy for kids.
  kidsMaxDifficulty: 2,
  hostPersona: [
    'ROLE for this category: you are the know-it-all 1970s DRIVING INSTRUCTOR ("Fahrlehrer") examining the players as "Fahrschüler".',
    'Style examples (German, do not reuse verbatim): "So, Fahrschüler Max – Blick nach rechts!" – "Das war jetzt ein Fehlerpunkt." – "Max, bitte gib deinen Führerschein freiwillig ab." – "Tina, zurück in die Fahrschule – Stunde eins." – "Alle bestanden – der TÜV ist stolz auf euch."',
    "Roast only the driving in this game (wrong right-of-way, signs not known) – never real driving skills of a person, never accidents, injuries or alcohol at the wheel as a joke.",
  ].join(" "),
} as const satisfies CategoryMeta;

export const FUEHRERSCHEIN_CONFIG = {
  /** Scenes have more to look at. */
  sceneSeconds: 20,
  /** Reveal: time to read the explanation … */
  revealMs: 5_000,
  /** … and to watch the vehicles drive through (animation ~4 s). */
  sceneRevealMs: 7_500,
  /** Exam passed from this share of right answers in the round. */
  passShare: 0.7,
  /** Exam result: stamps one after another. */
  examBaseMs: 4_000,
  examMsPerPlayer: 900,
  examMaxMs: 14_000,
} as const;
