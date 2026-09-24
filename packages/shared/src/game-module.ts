/**
 * Contracts for category modules (quiz, estimation, drawing, …).
 *
 * A module is pure logic: the room calls it with the current module state
 * and a context, and gets a new state back. It never does I/O and never
 * uses timers – it returns `phaseEndsAt` and the room's Durable Object
 * alarm calls `onTimer` when that time has passed.
 *
 * The UI side (HostView / PlayerView) lives in apps/web/src/games.
 */
import { z } from "zod";
import type { ErrorCode } from "./messages";

export const AGE_RATINGS = [0, 6, 12, 16, 18] as const;
export type AgeRating = (typeof AGE_RATINGS)[number];

export type InputType =
  | "multiple_choice"
  | "number"
  | "text"
  | "drawing"
  | "buzzer"
  | "ranking";

export type ContentSource = "static" | "generated" | "ai" | "user";

export const ScoringSettingsSchema = z.object({
  /** Points for a perfect answer. */
  basePoints: z.number().int().min(0).max(10_000),
  /** Faster answers score more (fastest 100 %, slowest minPercent). */
  speedBonus: z.boolean(),
  /** Percentage the slowest / farthest scoring answer still gets. */
  minPercent: z.number().int().min(0).max(100),
  /** Estimation: scale by distance to the answer or by rank. */
  estimateScale: z.enum(["distance", "rank"]),
});
export type ScoringSettings = z.infer<typeof ScoringSettingsSchema>;
export type ScoringField = keyof ScoringSettings;

export interface CategoryMeta {
  id: string;
  name: string;
  description: string;
  emoji: string;
  ageRating: AgeRating;
  tags: string[];
  inputType: InputType;
  secondsPerQuestion: number;
  questionsPerRound: { min: number; default: number; max: number };
  /** Default scoring settings. */
  scoring: ScoringSettings;
  /** Which scoring settings the host may edit for this category. */
  scoringFields: ScoringField[];
  /** Average seconds per question incl. reveal – for the duration estimate. */
  estimatedSecondsPerQuestion: number;
  contentSource: ContentSource;
}

/** Who is looking at the state. Public state is built per viewer. */
export type Viewer = { role: "host" } | { role: "player"; playerId: string } | { role: "guest" };

export interface ModulePlayer {
  id: string;
  connected: boolean;
}

export interface ModuleContext {
  /** Server time, epoch ms. */
  now: number;
  players: readonly ModulePlayer[];
  /** Uniform random number in [0, 1). */
  random: () => number;
}

export interface ModuleInitOptions {
  questionCount: number;
  scoring: ScoringSettings;
  /** Content already played in this room – avoid if possible. */
  excludeContentIds: readonly string[];
}

export interface ModuleUpdate<TState> {
  state: TState;
  /** When the room should call onTimer (epoch ms), or null for no timer. */
  phaseEndsAt: number | null;
  /** The category is finished – the room moves on to the scoreboard. */
  done?: boolean;
  /** Points to add, per player id. */
  scoreDelta?: Record<string, number>;
  /** Content ids used, so later rounds/games in this room avoid repeats. */
  usedContentIds?: string[];
}

export type ModuleActionResult<TState> = ModuleUpdate<TState> | { error: ErrorCode };

export interface GameModule<TState = unknown, TAction = unknown, TPublic = unknown> {
  meta: CategoryMeta;
  /** Validates player actions before handleAction sees them. */
  actionSchema: z.ZodType<TAction>;
  init(ctx: ModuleContext, options: ModuleInitOptions): ModuleUpdate<TState>;
  handleAction(
    state: TState,
    action: TAction,
    playerId: string,
    ctx: ModuleContext,
  ): ModuleActionResult<TState>;
  /** phaseEndsAt has passed – or the host pressed "Weiter". */
  onTimer(state: TState, ctx: ModuleContext): ModuleUpdate<TState>;
  /** Players connected/disconnected/were removed. Return null if nothing changes. */
  onPlayersChanged?(state: TState, ctx: ModuleContext): ModuleUpdate<TState> | null;
  /** Strip everything this viewer must not see (correct answers, others' answers). */
  toPublicState(state: TState, viewer: Viewer): TPublic;
}
