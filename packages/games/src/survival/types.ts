/** Client-safe types of the Survival-Finale (no logic, no content). */
import type { DangerLevel, SurvivalPhaseConfig } from "./config";

/**
 * intro (score conversion + rules) → question → reveal → [phase_change |
 * sudden_death] → question … → [tiebreak → tiebreak_reveal] → winner.
 */
export type SurvivalStep =
  | "intro"
  | "question"
  | "reveal"
  | "phase_change"
  | "sudden_death"
  | "tiebreak"
  | "tiebreak_reveal"
  | "winner";

/**
 * Game events for the TV, the moderator and sound hooks. The logic only
 * reports what happened; what the host says about it is decided elsewhere.
 */
export const SURVIVAL_EVENT_TYPES = [
  "FINALE_STARTED",
  "SCORES_CONVERTED",
  "PHASE_CHANGED",
  "FAST_CORRECT",
  "WRONG_ANSWER",
  "TIME_DECAY_STARTED",
  "TIMEOUT",
  "WARNING",
  "CRITICAL",
  "NEAR_ELIMINATION",
  "COMEBACK",
  "ELIMINATED",
  "MULTIPLE_PLAYERS_CRITICAL",
  "FINAL_TWO",
  "SUDDEN_DEATH",
  "TIEBREAK",
  "WINNER",
] as const;
export type SurvivalEventType = (typeof SURVIVAL_EVENT_TYPES)[number];

export interface SurvivalEvent {
  /** Increasing per finale – consumers remember the last one they handled. */
  seq: number;
  type: SurvivalEventType;
  /** Server time the event happened (eliminations: the exact moment the score hit 0). */
  at: number;
  playerId?: string;
  playerIds?: string[];
  score?: number;
  previousScore?: number;
  scoreChange?: number;
  responseMs?: number;
  phase?: SurvivalPhaseConfig["id"];
  danger?: DangerLevel;
  /** SUDDEN_DEATH: which one (1, 2, 3). */
  round?: number;
}

/** What one question did to one player (all amounts ≥ 0; total is signed). */
export interface SurvivalScoreChange {
  bonus: number;
  decay: number;
  penalty: number;
  drain: number;
  total: number;
}

export interface SurvivalPublicPlayer {
  id: string;
  /** Lane from the left (0-based) – fixed for the whole finale. */
  lane: number;
  /** Points from the main game (never changed by the finale). */
  mainScore: number;
  /** Life energy at the start of the finale. */
  startScore: number;
  /** Settled life energy, never below 0 (the server may go below internally). */
  score: number;
  danger: DangerLevel;
  eliminated: boolean;
  eliminatedAt: number | null;
  /** 1-based question number of the elimination. */
  eliminatedQuestion: number | null;
  /** Current question: answered already (not what). */
  answered: boolean;
  /** Current question: decay already settled into `score` (live display: see liveSurvivalScore). */
  decayApplied: number;
  /** Current question: the change so far (visible as soon as it happens). */
  change: SurvivalScoreChange | null;
}

export interface SurvivalPublicQuestion {
  /** 1-based question number in the finale. */
  number: number;
  text: string;
  options: string[];
  /** Server times (epoch ms): answerable from, bonus until, decay from, timeout. */
  startedAt: number;
  bonusUntil: number;
  decayFrom: number;
  timeoutAt: number;
  phase: SurvivalPhaseConfig;
  /** Players alive when the question started. */
  aliveAtStart: string[];
}

export interface SurvivalPublicTiebreak {
  attempt: number;
  participants: string[];
  text: string;
  unit: string;
  format: "number" | "year";
  startedAt: number;
  endsAt: number;
  answeredPlayerIds: string[];
  myAnswer: number | null;
  /** After the tie-breaker. */
  reveal: {
    answer: number;
    answers: Record<string, number>;
    /** Participants from best to worst (non-answerers last). */
    order: string[];
    winnerId: string | null;
  } | null;
}

export interface SurvivalPublicState {
  step: SurvivalStep;
  stepStartedAt: number;
  stepEndsAt: number;
  phaseIndex: number;
  phase: SurvivalPhaseConfig;
  /** Questions finished so far. */
  questionsPlayed: number;
  suddenDeaths: number;
  /** Lane order, left → right. */
  players: SurvivalPublicPlayer[];
  question: SurvivalPublicQuestion | null;
  /** The viewing player's own option (current question). */
  myAnswer: number | null;
  /** After the question: the right option and everyone's answers. */
  reveal: { correctIndex: number; answers: Record<string, number> } | null;
  tiebreak: SurvivalPublicTiebreak | null;
  winnerId: string | null;
  /** Played alone: the finale ends when the player is out. */
  solo: boolean;
  /** Final placing (winner step): places by elimination order, ties share a place. */
  ranking: SurvivalRankingEntry[] | null;
  events: SurvivalEvent[];
  /** Rule numbers the screens need to show live values. */
  rules: { wrongAnswerPenalty: number; scoreDecayPerSecond: number; moderatorCaptions: boolean };
}

export interface SurvivalRankingEntry {
  playerId: string;
  place: number;
}

export type SurvivalAction = { type: "answer"; value: number } | { type: "estimate"; value: number };
