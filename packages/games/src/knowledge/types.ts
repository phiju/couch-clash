/**
 * Client-safe types of the knowledge games (Punktesammler, Kategorienvorgabe,
 * Double or Nothing, Bet, Punkteklau). No logic, no content.
 *
 * They all play the same multiple-choice questions through one engine
 * (knowledge/engine.ts); each game adds its own phases and scoring.
 */
import type { KnowledgeCategory } from "@couch-clash/shared";
import type { ScoreResult } from "../scoring/final";

/** Extra step a game may put in front of every question (on the phones). */
export type KnowledgePreStep = "pick" | "decide" | "wager";

/**
 * Steps per question: [pick | decide | wager] → question → reveal →
 * leaderboard → next question.
 */
export type KnowledgeStep = KnowledgePreStep | "question" | "reveal" | "leaderboard";

/**
 * One player's result for a question. `finalScore` is the points actually
 * added – negative in risk games (lost bets, stolen points).
 */
export interface KnowledgeResult extends ScoreResult {
  correct: boolean;
  answered: boolean;
}

export interface KnowledgePublicQuestion {
  text: string;
  options: string[];
}

export interface KnowledgePublicState<TExtra = unknown> {
  step: KnowledgeStep;
  /** 0-based question index and total questions in this round. */
  index: number;
  total: number;
  /** Server times: current step, question start, end of the current step. */
  stepStartedAt: number;
  questionStartedAt: number;
  stepEndsAt: number;
  /** Topic of the current question – known before the question in Bet (and after the pick). */
  category: KnowledgeCategory | null;
  /** The question – null until the question step. */
  question: KnowledgePublicQuestion | null;
  /** Who has answered already (not what). */
  answeredPlayerIds: string[];
  /** Pre-step: who has decided / wagered / picked already (not what). */
  actedPlayerIds: string[];
  /** Only for the viewing player: their own answer. */
  myAnswer: number | null;
  /** Only in the reveal and leaderboard steps. */
  reveal: {
    correctIndex: number;
    answers: Record<string, number>;
    results: Record<string, KnowledgeResult>;
  } | null;
  /** Game-specific public part (see the *Extra types below). */
  extra: TExtra;
}

/** Answer action (every knowledge game). */
export interface KnowledgeAnswerAction {
  type: "answer";
  value: number;
}

// ── Game-specific public parts ─────────────────────────────────────────

export type PickedBy = "picker" | "random";

export interface CategoryPickExtra {
  /** Who picks the category for this block (a player id or HOST_ACTOR_ID). */
  pickerId: string | null;
  /** The three category cards on offer. */
  offer: KnowledgeCategory[];
  selectedCategory: KnowledgeCategory | null;
  /** Picked by the picker or at random (timeout). */
  pickedBy: PickedBy | null;
  /** Everyone was tied (e.g. the game start) – the picker was drawn by lot. */
  byLot: boolean;
}

export type RiskMode = "normal" | "double";

export interface DoubleExtra {
  /** Everyone's decision – only at the reveal. */
  decisions: Record<string, RiskMode> | null;
  /** The viewing player's own decision. */
  myDecision: RiskMode | null;
  /** Points for this game (from the host settings). */
  points: { normal: number; double: number; doubleLoss: number };
}

export interface BetExtra {
  /** Highest allowed wager per player for this question. */
  maxWagers: Record<string, number>;
  /** Wager buttons on the phones. */
  presets: readonly number[];
  /** Wager of players who don't bet in time (capped at their maximum). */
  defaultWager: number;
  /** Everyone's wager – only at the reveal. */
  wagers: Record<string, number> | null;
  /** The viewing player's own wager. */
  myWager: number | null;
}

export interface StealExtra {
  /** The leaders (targets) of this question; empty → nobody leads yet (plays like Punktesammler). */
  targetIds: string[];
  /** Their score when the question started. */
  targetScore: number;
  /** At the reveal: what happened. */
  outcome: StealOutcome | null;
  /**
   * Nobody could steal – everyone is a leader: alone ("solo") or all tied
   * ("tied"). The question plays like Punktesammler. Null otherwise.
   */
  noHeist: "solo" | "tied" | null;
}

export interface StealOutcome {
  /** Every target answered correctly (or nobody could steal). */
  defended: boolean;
  /** Thief id → points stolen. */
  stolen: Record<string, number>;
  /** Target id → points lost. */
  lost: Record<string, number>;
}

export type QuizPublicState = KnowledgePublicState<null>;
export type CategoryPickPublicState = KnowledgePublicState<CategoryPickExtra>;
export type DoublePublicState = KnowledgePublicState<DoubleExtra>;
export type BetPublicState = KnowledgePublicState<BetExtra>;
export type StealPublicState = KnowledgePublicState<StealExtra>;
