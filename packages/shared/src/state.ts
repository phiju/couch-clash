import type { Avatar } from "./avatar";

/**
 * Room state machine. Transitions are driven by client intents and by
 * timestamps (phaseEndsAt) checked by Durable Object alarms – never by
 * in-memory setTimeout, which does not survive hibernation.
 *
 *   lobby → setup → round → results → (round …) → finale
 */
export const PHASES = ["lobby", "setup", "round", "results", "finale"] as const;
export type Phase = (typeof PHASES)[number];

export const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_PLAYERS = 16;
export const MIN_PLAYERS_TO_START = 1;
export const NAME_MAX_LENGTH = 20;

/** Player as visible to every client (no secrets). */
export interface PublicPlayer {
  id: string;
  name: string;
  avatar: Avatar;
  joinedAt: number;
  connected: boolean;
}

/** Room state broadcast to every client. */
export interface PublicRoomState {
  code: string;
  phase: Phase;
  /** Epoch ms when the current phase started. */
  phaseStartedAt: number;
  /** Epoch ms when the current phase ends automatically, or null if open-ended. */
  phaseEndsAt: number | null;
  createdAt: number;
  expiresAt: number;
  hostConnected: boolean;
  players: PublicPlayer[];
}
