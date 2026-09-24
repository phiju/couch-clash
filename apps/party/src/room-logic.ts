/**
 * Pure, storage-free room logic. The Durable Object (room.ts) owns I/O –
 * connections, storage, alarms – and delegates every decision to these
 * functions so they can be unit-tested without a Workers runtime.
 */
import {
  MAX_PLAYERS,
  MIN_PLAYERS_TO_START,
  NAME_MAX_LENGTH,
  ROOM_TTL_MS,
  generateSecret,
  type Avatar,
  type Phase,
  type PublicRoomState,
  type ScoringSettings,
  type Viewer,
} from "@couch-clash/shared";
import { GAME_MODULES, type ModuleRegistry } from "@couch-clash/games";
import { publicGame } from "./game-flow";
import { fail, ok, type Result } from "./result";

export interface PlayerRecord {
  id: string;
  /** Reconnect secret, stored in the player's localStorage. */
  secret: string;
  name: string;
  avatar: Avatar;
  joinedAt: number;
}

/** Everything persisted in Durable Object storage for one room. */
export interface RoomRecord {
  code: string;
  hostToken: string;
  createdAt: number;
  expiresAt: number;
  phase: Phase;
  phaseStartedAt: number;
  phaseEndsAt: number | null;
  players: PlayerRecord[];
  /** Running game (from "Los geht's" until back to setup), else null. */
  game: GameRecord | null;
  /** Content ids played in this room (across games) – avoids repeats. */
  usedContentIds: string[];
}

export interface GameRound {
  categoryId: string;
  questionCount: number;
  scoring: ScoringSettings;
}

export interface GameRecord {
  rounds: GameRound[];
  roundIndex: number;
  /** State of the current category module (only in phase "play"). */
  moduleState: unknown;
  scores: Record<string, number>;
  roundGain: Record<string, number>;
}

/** Fills fields added after 0.1 for rooms stored by an older version. */
export function normalizeRoomRecord(room: RoomRecord): RoomRecord {
  return { ...room, game: room.game ?? null, usedContentIds: room.usedContentIds ?? [] };
}

export type { Result };

export interface Deps {
  now: number;
  secret?: () => string;
}

export function createRoomRecord(code: string, hostToken: string, now: number): RoomRecord {
  return {
    code,
    hostToken,
    createdAt: now,
    expiresAt: now + ROOM_TTL_MS,
    phase: "lobby",
    phaseStartedAt: now,
    phaseEndsAt: null,
    players: [],
    game: null,
    usedContentIds: [],
  };
}

export function isExpired(room: RoomRecord, now: number): boolean {
  return now >= room.expiresAt;
}

/** Constant-time string comparison (avoids leaking token prefixes via timing). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function authenticateHost(room: RoomRecord, token: string): boolean {
  return safeEqual(room.hostToken, token);
}

export function authenticatePlayer(
  room: RoomRecord,
  playerId: string,
  secret: string,
): Result<PlayerRecord> {
  const player = room.players.find((p) => p.id === playerId);
  if (!player || !safeEqual(player.secret, secret)) return fail("UNKNOWN_PLAYER");
  return ok(player);
}

/** Normalizes a display name: trims and collapses inner whitespace. */
export function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function nameKey(name: string): string {
  return cleanName(name).toLocaleLowerCase("de-DE");
}

export function joinPlayer(
  room: RoomRecord,
  input: { name: string; avatar: Avatar },
  deps: Deps,
): Result<{ room: RoomRecord; player: PlayerRecord }> {
  if (room.phase !== "lobby") return fail("GAME_ALREADY_STARTED");
  const name = cleanName(input.name);
  if (name.length < 1 || name.length > NAME_MAX_LENGTH) return fail("INVALID_NAME");
  const key = nameKey(name);
  if (room.players.some((p) => nameKey(p.name) === key)) return fail("NAME_TAKEN");
  if (room.players.length >= MAX_PLAYERS) return fail("ROOM_FULL");

  const newSecret = deps.secret ?? (() => generateSecret());
  const player: PlayerRecord = {
    id: newSecret().slice(0, 12),
    secret: newSecret(),
    name,
    avatar: input.avatar,
    joinedAt: deps.now,
  };
  return ok({ room: { ...room, players: [...room.players, player] }, player });
}

export function kickPlayer(room: RoomRecord, playerId: string): Result<RoomRecord> {
  if (!room.players.some((p) => p.id === playerId)) return fail("UNKNOWN_PLAYER");
  return ok({ ...room, players: room.players.filter((p) => p.id !== playerId) });
}

export function startGame(room: RoomRecord, now: number): Result<RoomRecord> {
  if (room.phase !== "lobby") return fail("GAME_ALREADY_STARTED");
  if (room.players.length < MIN_PLAYERS_TO_START) return fail("NOT_ENOUGH_PLAYERS");
  return ok({ ...room, phase: "setup", phaseStartedAt: now, phaseEndsAt: null });
}

export function toPublicState(
  room: RoomRecord,
  connected: { host: boolean; playerIds: ReadonlySet<string> },
  viewer: Viewer,
  registry: ModuleRegistry = GAME_MODULES,
): PublicRoomState {
  return {
    code: room.code,
    phase: room.phase,
    phaseStartedAt: room.phaseStartedAt,
    phaseEndsAt: room.phaseEndsAt,
    createdAt: room.createdAt,
    expiresAt: room.expiresAt,
    hostConnected: connected.host,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      joinedAt: p.joinedAt,
      connected: connected.playerIds.has(p.id),
    })),
    game: publicGame(room, viewer, registry),
  };
}
