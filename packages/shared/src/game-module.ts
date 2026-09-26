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
import type { BotContext } from "./bots";
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
  /** Input range and step (default 0 … 10,000 in steps of 10) – e.g. seconds instead of points. */
  min?: number;
  max?: number;
  step?: number;
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
  /** Game modes this category is offered in. */
  modes: readonly GameMode[];
  /** Kids mode: highest question difficulty that is still child-friendly (default 1). */
  kidsMaxDifficulty?: 1 | 2 | 3;
  /**
   * Content fits every mode the category is offered in (e.g. Pixelpanik):
   * no party share per round, the items' own mode tags are ignored. The
   * global mode filter (eligibleForMode – no adult items in Kids / Familie)
   * still applies.
   */
  modeNeutral?: boolean;
  /** Extra on/off settings the host may change for this category. */
  options?: readonly CategoryOption[];
  /**
   * The host plays a role in this category (English prompt text for the
   * commentary), e.g. the know-it-all driving instructor. Hard limits stay.
   */
  hostPersona?: string;
  /**
   * Scoring is exempt from the global per-question cap (risk games like
   * Double or Nothing, Bet, Punkteklau – their points are part of the bet).
   */
  capExempt?: boolean;
  /**
   * Plays the questions of another category (e.g. every knowledge game plays
   * the "quiz" questions): statistics, the admin page, generated questions and
   * "Stimmt nicht?" are kept under that category. Default: its own id.
   */
  contentPool?: string;
  /** The host reads the description aloud on the intro card (new games explain themselves). */
  announceIntro?: boolean;
  /** Risk game (points can be lost): Zufall never plans two of them back to back. */
  risk?: boolean;
  /** Plays with the standings (e.g. robs the leader): Zufall never plans it as the first round. */
  needsStandings?: boolean;
  /**
   * The big last round of a game (Survival-Finale): always played last, at
   * most once, never planned by Zufall, switched on separately in the settings.
   * When it is done the game goes straight to the finale with its placing.
   */
  finale?: boolean;
}

/** The category whose questions a category plays (CategoryMeta.contentPool). */
export function contentPoolOf(meta: Pick<CategoryMeta, "id" | "contentPool">): string {
  return meta.contentPool ?? meta.id;
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
  /** Display name – only for lines the host reads out (never sent to a text model). */
  name?: string;
}

export interface ModuleContext {
  /** Server time, epoch ms. */
  now: number;
  players: readonly ModulePlayer[];
  /** Uniform random number in [0, 1). */
  random: () => number;
  /**
   * Current total scores per player id (before this update). Categories that
   * play with the standings (last place picks, the leader gets robbed, bets
   * up to your score) read them; missing ids count as 0.
   */
  scores?: Readonly<Record<string, number>>;
}

/**
 * Player id the room uses for category actions sent by the host screen
 * (e.g. the host picks a category). Never a real player id.
 */
export const HOST_ACTOR_ID = "@host";

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
  /** Server log for content problems (e.g. a party pool that ran dry). Optional. */
  log?: (message: string, data?: Record<string, unknown>) => void;
  /** Content played in the running game so far – never again in this game (e.g. the finale). */
  currentGameContentIds?: readonly string[];
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
  /**
   * Final placing decided by the category (finale categories, e.g. the
   * Survival-Finale's elimination order) – the game's finale shows it instead
   * of the points order. Ties share a place.
   */
  ranking?: { playerId: string; place: number }[];
}

export type ModuleActionResult<TState> = ModuleUpdate<TState> | { error: ErrorCode };

/**
 * TTask: the tasks this module asks for. Most modules only use the text
 * model (the default); the room's runner handles every ModuleTask kind.
 */
export interface GameModule<TState = unknown, TAction = unknown, TPublic = unknown, TTask extends ModuleTask = LlmJsonTask> {
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
  /**
   * Aggregated numbers for the question just revealed (question statistics).
   * `exclude`: players whose answers don't count (test bots). Null when no
   * answer is left to count. Optional.
   */
  toStats?(state: TState, exclude?: ReadonlySet<string>): QuestionStatsPayload | null;
  /**
   * Test bots: what this bot does right now (an action for handleAction), or
   * null when it has nothing to do (already answered, not its turn, …).
   * Optional – without it bots just wait and the timers move the game on.
   */
  botAction?(state: TState, botId: string, ctx: ModuleContext, bot: BotContext): unknown;
  /** All content of this category (static + extra) for the admin page. Optional. */
  listContent?(extraContent?: readonly unknown[]): ContentEntry[];
  /** Validates one content item (AI-generated or edited in the admin page). Optional. */
  parseContent?(raw: unknown): { ok: true; value: unknown } | { ok: false; error: string };
  /**
   * Server work the module is waiting for (e.g. an AI check of the players'
   * texts). The room runs it (at most once per id) and hands the result to
   * resolveTask – null on timeout/failure. Optional.
   */
  pendingTask?(state: TState): TTask | null;
  /** Result of pendingTask. Return null if the task is outdated. */
  resolveTask?(state: TState, taskId: string, result: unknown, ctx: ModuleContext): ModuleUpdate<TState> | null;
  /** Texts the host reads out now, in order (e.g. the answer options). Optional. */
  readAloud?(state: TState): ReadAloud | null;
}

/** Generic server tasks a module may request. */
export type ModuleTask = LlmJsonTask | SongPreviewsTask | SongCatalogTask;

interface ModuleTaskBase {
  /** Unique per state – the room runs each id once. */
  id: string;
  timeoutMs: number;
}

/** A JSON answer from the text model; the module builds the prompt and validates the reply. */
export interface LlmJsonTask extends ModuleTaskBase {
  kind: "llm_json";
  input: { system: string; user: string };
  /** "strong": a more capable (slower) model, e.g. for judging answers. Default "fast". */
  model?: "fast" | "strong";
}

/** A track whose audio the room should look up (Musik-Quiz). */
export interface SongPreviewRequest {
  songId: string;
  provider: "deezer" | "itunes" | "local" | "applemusic";
  trackId: string;
  title: string;
  artist: string;
  /** Local test songs: the file (no lookup needed). */
  previewUrl?: string | null;
}

/**
 * Fresh preview URLs from the song providers (they carry expiring tokens, so
 * they are fetched when a round starts and never stored for long). Result:
 * songId → URL or null.
 */
export interface SongPreviewsTask extends ModuleTaskBase {
  kind: "song_previews";
  input: { tracks: SongPreviewRequest[] };
}

/**
 * Songs for a Musik-Quiz round, fetched live from the song provider (Deezer
 * playlists of the genres). Result: `{ songs: Song[], previews: songId → URL }`
 * – the module validates it.
 */
export interface SongCatalogTask extends ModuleTaskBase {
  kind: "song_catalog";
  input: { genres: string[]; questions: number };
}

export interface ReadAloud {
  /** Changes when there is something new to read. */
  key: string;
  items: {
    cue: string;
    text: string;
    /**
     * A long text that is new every time (e.g. every answer of a round):
     * the voice uses its model for long read-outs (configurable, see the
     * party worker's voice config). Short fixed texts leave it out.
     */
    long?: boolean;
  }[];
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
  /** Where the content comes from (URL), e.g. the true stories of Skurrile Ereignisse. */
  source?: string;
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
  /** The item came from the party pool (alcohol, love, sex) – the host may get cheekier. */
  partyItem?: boolean;
  /** "estimate": answers are numbers scored by closeness (wild estimates / bullseyes). */
  answerKind?: "estimate";
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
  /** Bluff games: how many players this player's invented answer fooled. */
  fooled?: number;
}
