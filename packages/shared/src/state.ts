import type { Avatar } from "./avatar";

/**
 * Room state machine. Transitions are driven by client intents and by
 * timestamps (phaseEndsAt) that Durable Object alarms act on – never by
 * in-memory setTimeout, which does not survive hibernation.
 *
 *   lobby → setup → [intro → play → scoreboard] × categories → finale
 *                ↑___________________________________________________|
 *                                 "Nochmal spielen"
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

/** Player as visible to every client (no secrets). */
export interface PublicPlayer {
  id: string;
  name: string;
  avatar: Avatar;
  joinedAt: number;
  connected: boolean;
}

export interface PublicRound {
  categoryId: string;
  questionCount: number;
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
}
