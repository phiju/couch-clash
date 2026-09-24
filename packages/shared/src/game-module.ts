/**
 * Interfaces for future category modules (quiz, estimation, drawing, …).
 * Nothing implements these yet – they pin down the shape so the room and
 * UI can be built around them.
 */
import type { Phase, PublicPlayer } from "./state";

export type AgeRating = "all" | "6+" | "12+" | "16+" | "18+";

export type InputType =
  | "none"
  | "buttons"
  | "multiple_choice"
  | "text"
  | "number"
  | "slider"
  | "drawing"
  | "buzzer"
  | "ranking";

export type ContentSource = "static" | "generated" | "ai" | "user";

export interface ScoringConfig {
  /** Points for a correct / winning answer. */
  basePoints: number;
  /** Extra points for fast answers, scaled by remaining time. */
  speedBonus?: number;
  /** Points deducted for wrong answers (e.g. betting categories). */
  penalty?: number;
  /** Whether points depend on closeness (estimation) rather than right/wrong. */
  proximity?: boolean;
}

export interface Category {
  id: string;
  name: string;
  description?: string;
  ageRating: AgeRating;
  tags: string[];
  inputType: InputType;
  scoring: ScoringConfig;
  secondsPerQuestion: number;
  questionsPerRound: number;
  contentSource: ContentSource;
}

/** Context handed to a module by the room on every call. */
export interface GameContext {
  now: number;
  players: readonly PublicPlayer[];
  random: () => number;
}

/** What a module returns after handling something. */
export interface ModuleUpdate<TState> {
  state: TState;
  /** Absolute epoch ms when onTimer should fire next, or null for none. */
  phaseEndsAt?: number | null;
  /** Request a room phase change (e.g. round → results). */
  nextPhase?: Phase;
  /** Points to add per player id. */
  scoreDelta?: Record<string, number>;
}

export interface HostViewProps<TState> {
  state: TState;
  players: readonly PublicPlayer[];
  phaseEndsAt: number | null;
}

export interface PlayerViewProps<TState, TAction> {
  state: TState;
  playerId: string;
  phaseEndsAt: number | null;
  sendAction: (action: TAction) => void;
}

/**
 * A game module. `TView` is the UI component type (React components in the
 * web app) – kept generic so this package stays framework-free.
 */
export interface GameModule<TState, TAction, TView = unknown> {
  category: Category;
  /** Create the initial module state for a round. */
  init(ctx: GameContext, config?: unknown): ModuleUpdate<TState>;
  /** Handle a validated player/host action. Must be pure. */
  handleAction(
    state: TState,
    action: TAction,
    from: { playerId: string } | { host: true },
    ctx: GameContext,
  ): ModuleUpdate<TState>;
  /** Called by the room when phaseEndsAt has passed (via DO alarm). */
  onTimer(state: TState, ctx: GameContext): ModuleUpdate<TState>;
  /** Strip secrets (e.g. correct answers) before sending state to clients. */
  toPublicState?(state: TState, viewer: { playerId: string } | { host: true }): unknown;
  HostView: TView;
  PlayerView: TView;
}
