import type { CategoryMeta } from "@couch-clash/shared";

/**
 * Pixelpanik: a picture on the TV starts as 4×4 big pixels and gets sharper
 * in six stages. Whoever recognizes it earlier gets more points. The phones
 * never show the picture – only the input.
 */
export const PIXELPANIK_STAGES = [
  { id: "s1", size: 4, label: "4×4" },
  { id: "s2", size: 8, label: "8×8" },
  { id: "s3", size: 16, label: "16×16" },
  { id: "s4", size: 32, label: "32×32" },
  { id: "s5", size: 64, label: "64×64" },
  /** size 0 = full resolution. */
  { id: "s6", size: 0, label: "volle Auflösung" },
] as const;

export const PIXELPANIK_CONFIG = {
  /** Seconds per stage (host setting "Sekunden pro Stufe", clamped to min … max). */
  defaultStageSeconds: 4,
  minStageSeconds: 2,
  maxStageSeconds: 15,
  /** The solution after the last stage (or once everyone is done). */
  revealMs: 5_000,
  /** Stages 1–2 (4×4, 8×8): a right answer here is an "early hit" (zoom-in on the TV, the host is suspicious). */
  earlyStages: 2,
  /** Longest guess a phone may send. */
  maxGuessLength: 40,
  /** Test bots: chance per stage to guess now (they get braver as the picture gets sharper). */
  botGuessChance: [0.15, 0.25, 0.4, 0.55, 0.75, 1],
} as const;

const DEFAULT_STAGE_POINTS = { s1: 200, s2: 180, s3: 150, s4: 100, s5: 50, s6: 20 } as const;

export const pixelpanikMeta = {
  id: "pixelpanik",
  name: "Pixelpanik",
  description: "Ein Bild, stark verpixelt – es wird Stufe für Stufe schärfer. Wer es früh erkennt, kassiert die meisten Punkte!",
  emoji: "👾",
  ageRating: 6,
  tags: ["bilder", "raten", "familie", "kinder", "party"],
  inputType: "text",
  /** Six stages à 4 s (the solution and the leaderboard come on top). */
  secondsPerQuestion: 6 * PIXELPANIK_CONFIG.defaultStageSeconds,
  questionsPerRound: { min: 3, default: 5, max: 10 },
  scoring: {
    mode: "absolute",
    maxPoints: DEFAULT_STAGE_POINTS.s1,
    speedModifier: { enabled: false, fastestMultiplier: 1, slowestMultiplier: 1 },
    points: { ...DEFAULT_STAGE_POINTS, stageSeconds: PIXELPANIK_CONFIG.defaultStageSeconds },
    perQuestionCap: 200,
  },
  scoringPoints: [
    ...PIXELPANIK_STAGES.map((s) => ({ id: s.id, label: `Erkannt bei ${s.label}`, default: DEFAULT_STAGE_POINTS[s.id] })),
    {
      id: "stageSeconds",
      label: "Sekunden pro Stufe",
      default: PIXELPANIK_CONFIG.defaultStageSeconds,
      min: PIXELPANIK_CONFIG.minStageSeconds,
      max: PIXELPANIK_CONFIG.maxStageSeconds,
      step: 1,
    },
  ],
  scoringFields: ["points", "perQuestionCap"],
  /** Six stages, the solution and the leaderboard (most pictures end a bit earlier). */
  estimatedSecondsPerQuestion: 36,
  contentSource: "static",
  modes: ["kids", "family", "party"],
  /** Pictures fit every mode: no party share, motifs aren't tied to a mode (Kids still need four options). */
  modeNeutral: true,
  /** Kids get their own motifs (with four options) – any difficulty. */
  kidsMaxDifficulty: 3,
  announceIntro: true,
} as const satisfies CategoryMeta;
