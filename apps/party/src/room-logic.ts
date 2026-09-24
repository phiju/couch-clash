/**
 * Pure, storage-free room logic. The Durable Object (room.ts) owns I/O –
 * connections, storage, alarms – and delegates every decision to these
 * functions so they can be unit-tested without a Workers runtime.
 */
import {
  MAX_PLAYERS,
  NAME_MAX_LENGTH,
  ROOM_TTL_MS,
  generateSecret,
  type Avatar,
  type Phase,
  type PublicRoomState,
  type GameRoundSettings,
  type LeaderboardEntry,
  type Viewer,
} from "@couch-clash/shared";
import { GAME_MODULES, getModule, normalizeScoring, type ModuleRegistry } from "@couch-clash/games";
import { publicGame, settingsSummary } from "./game-flow";
import { fail, ok, type Result } from "./result";
import { publicPhoto, type PhotoRecord, type PhotoUsage } from "./avatar/photo-logic";

export interface PlayerRecord {
  id: string;
  /** Reconnect secret, stored in the player's localStorage. */
  secret: string;
  name: string;
  avatar: Avatar;
  joinedAt: number;
  /** AI photo avatar (emoji `avatar` stays the fallback). */
  photo?: PhotoRecord;
  /** Base images generated for this player (also counts after a reset). */
  photoGenerations?: number;
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
  /** Game settings, edited by the host in lobby/setup. */
  settings: GameRound[];
  /** Running game (from "Spiel starten" until back to setup), else null. */
  game: GameRecord | null;
  /** Content ids played in this room (across games) – avoids repeats. */
  usedContentIds: string[];
  /** Host setting "Foto-Avatare erlauben". */
  photoAvatars: boolean;
  /** Images generated in this room (room-wide limit, kept after kicks/resets). */
  photoUsage: PhotoUsage;
}

/** One category of the game settings (sanitized against the registry). */
export type GameRound = GameRoundSettings;

export interface GameRecord {
  rounds: GameRound[];
  roundIndex: number;
  /** State of the current category module (only in phase "play"). */
  moduleState: unknown;
  scores: Record<string, number>;
  roundGain: Record<string, number>;
  /** Leaderboard snapshot of the last scored question (current category). */
  questionLeaderboard: LeaderboardEntry[] | null;
}

/** Old scoring shapes (before the scoring refactor) → category defaults. */
function normalizeRounds(rounds: readonly GameRound[] | undefined, registry: ModuleRegistry): GameRound[] {
  return (rounds ?? []).flatMap((r) => {
    const module = getModule(r.categoryId, registry);
    return module ? [{ ...r, scoring: normalizeScoring(module.meta, r.scoring) }] : [];
  });
}

/** Fills fields added later for rooms stored by an older version. */
export function normalizeRoomRecord(room: RoomRecord, registry: ModuleRegistry = GAME_MODULES): RoomRecord {
  return {
    ...room,
    settings: normalizeRounds(room.settings, registry),
    game: room.game
      ? {
          ...room.game,
          rounds: normalizeRounds(room.game.rounds, registry),
          questionLeaderboard: room.game.questionLeaderboard ?? null,
        }
      : null,
    usedContentIds: room.usedContentIds ?? [],
    photoAvatars: room.photoAvatars ?? true,
    photoUsage: room.photoUsage ?? { base: 0, expressions: 0 },
  };
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
    settings: [],
    game: null,
    usedContentIds: [],
    photoAvatars: true,
    photoUsage: { base: 0, expressions: 0 },
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
      avatar: p.photo ? { ...p.avatar, photo: publicPhoto(p, room.code) } : p.avatar,
      joinedAt: p.joinedAt,
      connected: connected.playerIds.has(p.id),
    })),
    game: publicGame(room, viewer, registry),
    settings: viewer.role === "host" ? room.settings : null,
    settingsSummary: settingsSummary(room.settings, registry),
    photoAvatars: room.photoAvatars,
  };
}
