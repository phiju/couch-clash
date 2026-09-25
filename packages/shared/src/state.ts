import type { GameMode, GameModeSettings } from "./modes";
import type { Avatar } from "./avatar";
import type { ScoringSettings } from "./game-module";
import type { LeaderboardEntry } from "./leaderboard";
import type { PublicPhotoAvatar } from "./photo";
import type { Cheekiness, VoiceSettings, VoiceStatus } from "./voice";

/**
 * Room state machine. Transitions are driven by client intents and by
 * timestamps (phaseEndsAt) that Durable Object alarms act on – never by
 * in-memory setTimeout, which does not survive hibernation.
 *
 *   lobby ──────→ [intro → play → scoreboard] × categories → finale
 *   setup ──↗                                                   |
 *     ↑________________________ "Nochmal spielen" _____________|
 *
 * Settings are edited in the lobby (and in setup, after a game).
 *
 * During "play" the category module owns the flow (e.g. question → reveal)
 * and reports its own phaseEndsAt.
 */
export const PHASES = ["lobby", "setup", "intro", "play", "scoreboard", "finale"] as const;
export type Phase = (typeof PHASES)[number];

export const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_PLAYERS = 16;
export const MIN_PLAYERS_TO_START = 1;
export const NAME_MAX_LENGTH = 20;

/** Category intro card before each category. */
export const INTRO_MS = 4_000;
/** Scoreboard after each category (host can skip). */
export const SCOREBOARD_MS = 10_000;
/** After each question: correct answer, then the animated leaderboard. */
export const REVEAL_ANSWER_MS = 3_000;
export const REVEAL_LEADERBOARD_MS = 7_000;

/** Emoji avatar plus the optional AI photo avatar (emoji stays the fallback). */
export type PublicAvatar = Avatar & { photo?: PublicPhotoAvatar };

/** Player as visible to every client (no secrets). */
export interface PublicPlayer {
  id: string;
  name: string;
  avatar: PublicAvatar;
  joinedAt: number;
  connected: boolean;
}

export interface PublicRound {
  categoryId: string;
  questionCount: number;
}

/** One category in the game settings. */
export interface GameRoundSettings {
  categoryId: string;
  questionCount: number;
  scoring: ScoringSettings;
  /** Category options (CategoryMeta.options), id → on/off. */
  options?: Record<string, boolean>;
}

/** What players see of the settings: a short summary. */
export interface SettingsSummary {
  /** Global game mode ("Familie · 3 Kategorien · ca. 15 Min"). */
  mode: GameMode;
  categoryIds: string[];
  questionCount: number;
  estimatedSeconds: number;
}

/** Game progress. `module` is the category module's state as seen by this viewer. */
export interface PublicGameState {
  rounds: PublicRound[];
  roundIndex: number;
  /** Total points per player id. */
  scores: Record<string, number>;
  /** Points gained in the current category per player id. */
  roundGain: Record<string, number>;
  module: unknown;
  /**
   * Animated ranking: after a question (play), per category (scoreboard)
   * or final (finale, no gains). Null when there is nothing to show.
   */
  leaderboard: LeaderboardEntry[] | null;
  /** The current question (for 👍/👎 on phones and "Stimmt nicht?" on the host), null outside questions. */
  currentQuestion: { contentId: string; revealed: boolean } | null;
}

/** Room state sent to a client. Built per viewer – may differ between clients. */
export interface PublicRoomState {
  code: string;
  phase: Phase;
  /** Epoch ms (server clock) when the current phase started. */
  phaseStartedAt: number;
  /** Epoch ms (server clock) when the current phase ends automatically, or null. */
  phaseEndsAt: number | null;
  createdAt: number;
  expiresAt: number;
  hostConnected: boolean;
  players: PublicPlayer[];
  game: PublicGameState | null;
  /** Full game settings – host only (null for everyone else). */
  settings: GameRoundSettings[] | null;
  /** Short summary for everyone, null if nothing is selected. */
  settingsSummary: SettingsSummary | null;
  /** Global game mode (Kids / Familie / Party) with its options. */
  mode: GameModeSettings;
  /** Host only: Party mode confirmed ("alle über 18") in this room. */
  partyConfirmed: boolean;
  /** Host only: eligible questions per category in the current mode (warning + slider cap). */
  poolSizes: Record<string, number> | null;
  /** Host setting "Foto-Avatare erlauben". */
  photoAvatars: boolean;
  /** Moderator voice settings – host only (null for everyone else). */
  voice:
    | (VoiceSettings & {
        effectiveCheekiness: Cheekiness;
        /** Levels the host may pick in the current game mode. */
        allowedCheekiness: readonly Cheekiness[];
        /** Silent because the voice service refused (quota, key) or the room's character budget is used up. */
        status: VoiceStatus;
        /** Error code of the last refusal, e.g. "401 missing_permissions". */
        errorCode: string | null;
        charsUsed: number;
        charBudget: number;
      })
    | null;
}
