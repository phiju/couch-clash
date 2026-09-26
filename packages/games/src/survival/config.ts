/**
 * Survival-Finale – every number the rules use, in one place (client-safe:
 * the TV and the phones read the same config to show live timers).
 *
 * Times are seconds (as the host would describe them), converted to ms only
 * inside the rules.
 */

export const SURVIVAL_PHASE_IDS = ["phase1", "phase2", "phase3", "death"] as const;
export type SurvivalPhaseId = (typeof SURVIVAL_PHASE_IDS)[number];

/** One pressure level. Phase changes only take effect between questions. */
export interface SurvivalPhaseConfig {
  id: SurvivalPhaseId;
  /** Shown on the TV and the phones ("PHASE 2", "DEATH MODE"). */
  label: string;
  /** A correct answer up to this many seconds earns the speed bonus. */
  speedBonusThreshold: number;
  /** From this many seconds on, an unanswered player loses points every full second. */
  scoreDecayThreshold: number;
  /** Hard limit: no answer by then counts as wrong. */
  questionTimeout: number;
  /** Speed bonus for a fast correct answer (0: none). */
  speedBonus: number;
  /** Deducted from every living player at the end of each question (0: none). */
  baseDrain: number;
}

export const SURVIVAL_PHASES: readonly SurvivalPhaseConfig[] = [
  { id: "phase1", label: "PHASE 1", speedBonusThreshold: 5, scoreDecayThreshold: 10, questionTimeout: 20, speedBonus: 50, baseDrain: 0 },
  { id: "phase2", label: "PHASE 2", speedBonusThreshold: 4, scoreDecayThreshold: 8, questionTimeout: 16, speedBonus: 50, baseDrain: 0 },
  { id: "phase3", label: "PHASE 3", speedBonusThreshold: 3, scoreDecayThreshold: 6, questionTimeout: 12, speedBonus: 50, baseDrain: 0 },
  { id: "death", label: "DEATH MODE", speedBonusThreshold: 2, scoreDecayThreshold: 4, questionTimeout: 8, speedBonus: 0, baseDrain: 50 },
];

export const DANGER_LEVELS = ["SAFE", "WARNING", "CRITICAL", "ELIMINATION_IMMINENT", "ELIMINATED"] as const;
export type DangerLevel = (typeof DANGER_LEVELS)[number];

export interface SurvivalConfig {
  /** Start-score conversion: startMin + (startMax − startMin) × (score / best) ^ startExponent. */
  startMin: number;
  startMax: number;
  startExponent: number;
  /** Start scores are rounded to multiples of this. */
  startRounding: number;
  /** Every wrong answer (and no answer by the timeout). */
  wrongAnswerPenalty: number;
  /** Lost per started full second after the decay threshold. */
  scoreDecayPerSecond: number;
  /** Escalation: the next phase after this many questions. */
  questionsPerPhase: number;
  phases: readonly SurvivalPhaseConfig[];
  /** Everyone died in the same question: they come back with this. */
  suddenDeathScore: number;
  /** After this many sudden deaths, the next "everyone died" goes to the estimate question. */
  maxSuddenDeathRounds: number;
  /** Estimate tie-breaker: answer time, and attempts when nobody answers. */
  tiebreakSeconds: number;
  maxTiebreakAttempts: number;
  /**
   * Danger levels as "wrong answers left": WARNING at score ≤ warning × penalty,
   * CRITICAL ≤ critical × penalty, ELIMINATION_IMMINENT ≤ imminent × penalty.
   */
  danger: { warning: number; critical: number; imminent: number };
  /** Show-only step lengths (ms). */
  introMs: number;
  revealMs: number;
  phaseChangeMs: number;
  suddenDeathMs: number;
  tiebreakRevealMs: number;
  winnerMs: number;
  /** Questions queued at the start (fresh ones first, then ones from earlier games). */
  questionQueueSize: number;
  /** Ask the AI for more questions when fewer than this are left in the queue. */
  aiRefillBelow: number;
  aiMaxRequests: number;
  aiQuestionsPerRequest: number;
  aiTimeoutMs: number;
  /** Recent events kept in the state (TV + moderator read them by `seq`). */
  maxEvents: number;
  /** Subtitle line for the moderator (off by default – the host voice speaks). */
  moderatorCaptions: boolean;
}

export const SURVIVAL_CONFIG: SurvivalConfig = {
  startMin: 200,
  startMax: 1200,
  startExponent: 1,
  startRounding: 10,
  wrongAnswerPenalty: 200,
  scoreDecayPerSecond: 10,
  questionsPerPhase: 4,
  phases: SURVIVAL_PHASES,
  suddenDeathScore: 100,
  maxSuddenDeathRounds: 3,
  tiebreakSeconds: 30,
  maxTiebreakAttempts: 3,
  danger: { warning: 3, critical: 2, imminent: 1 },
  introMs: 18_000,
  revealMs: 5_000,
  phaseChangeMs: 4_000,
  suddenDeathMs: 6_000,
  tiebreakRevealMs: 8_000,
  winnerMs: 12_000,
  questionQueueSize: 80,
  aiRefillBelow: 5,
  aiMaxRequests: 3,
  aiQuestionsPerRequest: 10,
  aiTimeoutMs: 20_000,
  maxEvents: 40,
  moderatorCaptions: false,
};

/** Index of DEATH MODE (always the last phase). */
export function deathPhaseIndex(config: Pick<SurvivalConfig, "phases"> = SURVIVAL_CONFIG): number {
  return config.phases.length - 1;
}
