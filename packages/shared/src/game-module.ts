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
import type { GameMode, GameModeSettings } from "./modes";

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

/**
 * Scoring model:  Final Score = Base Score × Speed Modifier
 *
 * - Base score = answer quality, per player, never compared to other players.
 *   The mode picks the strategy (see packages/games/src/scoring/base.ts).
 * - Speed modifier = optional multiplier measured against the question's
 *   time limit (see packages/games/src/scoring/speed.ts).
 */
export const BASE_SCORE_MODES = ["absolute", "proximity", "bluff"] as const;
export type BaseScoreMode = (typeof BASE_SCORE_MODES)[number];

export const SpeedModifierSettingsSchema = z.object({
  enabled: z.boolean(),
  /** Multiplier for an instant answer (response time 0). */
  fastestMultiplier: z.number().min(0).max(5),
  /** Multiplier for an answer at the time limit. */
  slowestMultiplier: z.number().min(0).max(5),
});
export type SpeedModifierSettings = z.infer<typeof SpeedModifierSettingsSchema>;

export const DEFAULT_SPEED_MODIFIER: SpeedModifierSettings = {
  enabled: false,
  fastestMultiplier: 1.5,
  slowestMultiplier: 0.5,
};

/** No player gets more than this per question, in any category (balance). */
export const DEFAULT_PER_QUESTION_CAP = 200;

export const ScoringSettingsSchema = z.object({
  /** How answer quality becomes the base score (fixed per category). */
  mode: z.enum(BASE_SCORE_MODES),
  /** Base score for a perfect answer. */
  maxPoints: z.number().int().min(0).max(10_000),
  speedModifier: SpeedModifierSettingsSchema,
  /** Category-specific amounts (CategoryMeta.scoringPoints), e.g. Bluff: find / know / fool. */
  points: z.record(z.string().max(20), z.number().int().min(0).max(10_000)).optional(),
  /** Maximum points per player per question (default 200). */
  perQuestionCap: z.number().int().min(0).max(10_000).optional(),
});
export type ScoringSettings = z.infer<typeof ScoringSettingsSchema>;
/** Settings the host may edit (the mode is part of the category). */
export type ScoringField = "maxPoints" | "speedModifier" | "points" | "perQuestionCap";

/** One category-specific amount the host may set ("Punkte-Einstellungen"). */
export interface ScoringPoint {
  id: string;
  label: string;
  default: number;
}

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
  /** Category-specific amounts in `scoring.points` (labels for the host). */
  scoringPoints?: readonly ScoringPoint[];
  /** Which scoring settings the host may edit for this category. */
  scoringFields: ScoringField[];
  /** Average seconds per question incl. reveal – for the duration estimate. */
  estimatedSecondsPerQuestion: number;
  contentSource: ContentSource;
  /** Fewer players → the category cannot be selected (e.g. bluffing needs someone to fool). */
  minPlayers?: number;
  /** Game modes this category is offered in. */
  modes: readonly GameMode[];
  /** Kids mode: highest question difficulty that is still child-friendly (default 1). */
  kidsMaxDifficulty?: 1 | 2 | 3;
  /** Extra on/off settings the host may change for this category. */
  options?: readonly CategoryOption[];
  /**
   * The host plays a role in this category (English prompt text for the
   * commentary), e.g. the know-it-all driving instructor. Hard limits stay.
   */
  hostPersona?: string;
}

export interface CategoryOption {
  id: string;
  label: string;
  default: boolean;
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
  /** Content that must never be played (quarantined / removed in the admin page). */
  blockedContentIds?: ReadonlySet<string>;
  /** Extra content for this category (e.g. AI-generated replacements) – validated by the module. */
  extraContent?: readonly unknown[];
  /** Host settings from CategoryMeta.options (id → on/off). */
  options?: Readonly<Record<string, boolean>>;
  /** Global game mode: filters the questions (eligibleForMode) and weights difficulty. */
  mode?: GameModeSettings;
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
  /** Where the category stands – lets the room time the host's commentary. Optional. */
  progress?(state: TState): ModuleProgress | null;
  /** Facts about the question just revealed, for the host's commentary. Optional. */
  revealFacts?(state: TState): RevealFacts | null;
  /** Facts about the round summary (e.g. exam passed / failed) while it shows, for the host. Optional. */
  summaryFacts?(state: TState): RoundSummaryFacts | null;
  /** Aggregated numbers for the question just revealed (question statistics). Optional. */
  toStats?(state: TState): QuestionStatsPayload | null;
  /** All content of this category (static + extra) for the admin page. Optional. */
  listContent?(extraContent?: readonly unknown[]): ContentEntry[];
  /** Validates one content item (AI-generated or edited in the admin page). Optional. */
  parseContent?(raw: unknown): { ok: true; value: unknown } | { ok: false; error: string };
  /**
   * Server work the module is waiting for (e.g. an AI check of the players'
   * texts). The room runs it (at most once per id) and hands the result to
   * resolveTask – null on timeout/failure. Optional.
   */
  pendingTask?(state: TState): ModuleTask | null;
  /** Result of pendingTask. Return null if the task is outdated. */
  resolveTask?(state: TState, taskId: string, result: unknown, ctx: ModuleContext): ModuleUpdate<TState> | null;
  /** Texts the host reads out now, in order (e.g. the answer options). Optional. */
  readAloud?(state: TState): ReadAloud | null;
}

/** Generic server tasks a module may request. */
export type ModuleTask = {
  /** Unique per state – the room runs each id once. */
  id: string;
  /** A JSON answer from the text model; the module builds the prompt and validates the reply. */
  kind: "llm_json";
  input: { system: string; user: string };
  timeoutMs: number;
  /** "strong": a more capable (slower) model, e.g. for judging answers. Default "fast". */
  model?: "fast" | "strong";
};

export interface ReadAloud {
  /** Changes when there is something new to read. */
  key: string;
  items: { cue: string; text: string }[];
}

/** Numbers for one played question – never names or answers. */
export interface QuestionStatsPayload {
  contentId: string;
  /** Players who answered. */
  answers: number;
  /** Answers that were right (estimates: very close). */
  correct: number;
  sumResponseMs: number;
  /** Estimates: Σ |answer − correct| / zeroRange (each capped at 1); null where it makes no sense. */
  sumErrorPct: number | null;
  /** Category-specific extra numbers (e.g. Bluff: players who found the real definition). */
  extra?: Record<string, number>;
}

/** One content item as the admin page shows it. */
export interface ContentEntry {
  id: string;
  text: string;
  /** The correct answer as text. */
  answer: string;
  difficulty: number;
  ageRating: number;
  tags: string[];
  /** The raw item (for editing generated content). */
  payload: unknown;
  /** Stats show an average error (estimates) instead of only a correct rate. */
  errorMetric?: boolean;
  alcohol?: boolean;
  adult?: boolean;
}

export interface ModuleProgress {
  /** 0-based question index and total questions. */
  index: number;
  total: number;
  step: string;
  /** Id of the current question's content (for ratings and reports). */
  contentId?: string;
  /** The answers are revealed (ratings/reports allowed from here on). */
  revealed?: boolean;
}

/** Plain-text facts about one revealed question (server only, never sent to phones). */
export interface RevealFacts {
  question: string;
  correctAnswer: string;
  /** Per player id; players without an answer are missing. */
  answers: Record<string, RevealedAnswer>;
  /** Extra hints for the commentary (no names – those come from `note`). */
  highlights?: string[];
}

/** The round summary as plain facts (server only). Show only – it never changes points. */
export interface RoundSummaryFacts {
  /** What the summary is, e.g. "Prüfungsergebnis der Führerscheinprüfung". */
  title: string;
  /** Per player id, in the order the screen shows them. */
  players: { playerId: string; verdict: string; correct: number; total: number }[];
  highlights: string[];
}

export interface RevealedAnswer {
  /** The answer as text, e.g. "Paris" or "5 m". */
  text: string;
  correct: boolean;
  /** Answer quality 0…1 (base score / max points). */
  accuracy: number;
  points: number;
  responseMs: number;
  /** Extra fact about this player, e.g. "hat 2 Mitspieler reingelegt". */
  note?: string;
}
