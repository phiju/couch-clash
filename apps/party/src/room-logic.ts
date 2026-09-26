/**
 * Pure, storage-free room logic. The Durable Object (room.ts) owns I/O –
 * connections, storage, alarms – and delegates every decision to these
 * functions so they can be unit-tested without a Workers runtime.
 */
import {
  AVATAR_COLORS,
  BOT_CONFIG,
  BOT_NAMES,
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
  type VoiceSettings,
  DEFAULT_MODE_SETTINGS,
  MODE_CHEEKINESS,
  normalizeModeSettings,
  type GameModeSettings,
} from "@couch-clash/shared";
import { GAME_MODULES, getModule, normalizeScoring, type ModuleRegistry } from "@couch-clash/games";
import { currentQuestionKey, publicGame, settingsSummary } from "./game-flow";
import { fail, ok, type Result } from "./result";
import { publicPhoto, type PhotoRecord, type PhotoUsage } from "./avatar/photo-logic";
import type { QuestionVotes } from "./stats/votes";
import { VOICE_CONFIG } from "./voice/config";
import { accountLow, defaultRoomVoice, effectiveCheekiness, normalizeRoomVoice, type RoomVoice } from "./voice/rules";
import { poolSizesFor } from "./pools";

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
  /**
   * Late join: the question that was running when the player joined
   * (`currentQuestionKey`) – they play from the next one. Cleared then.
   */
  joinedDuring?: string;
  /** Test bot ("🤖 Testspieler hinzufügen"): always connected, acts on its own, not in the statistics. */
  bot?: true;
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
  /** Game settings, edited by the host in the lobby (kept across games). */
  settings: GameRound[];
  /** Running game (from "Spiel starten" until back in the lobby), else null. */
  game: GameRecord | null;
  /** Content ids played in this room (across games) – avoids repeats. */
  usedContentIds: string[];
  /** Host setting "Foto-Avatare erlauben". */
  photoAvatars: boolean;
  /** Images generated in this room (room-wide limit, kept after kicks/resets). */
  photoUsage: PhotoUsage;
  /** The host mascot's voice: settings, budget, commentary memory. */
  voice: RoomVoice;
  /** 👍/👎 for the current question (written to the statistics when it is over). */
  questionVotes: QuestionVotes | null;
  /** Global game mode (Kids / Familie / Party). */
  mode: GameModeSettings;
  /** The host confirmed "alle über 18" for Party mode in this room. */
  partyConfirmed: boolean;
  /** Host setting "Neue Spieler während des Spiels zulassen" (default on). */
  lateJoin: boolean;
  /**
   * Players whose connection dropped: still counted as connected until this
   * time (grace period, CONNECTION_CONFIG.graceMs). Persisted, so a restarted
   * room keeps the same view.
   */
  graceUntil: Record<string, number>;
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
  /** "Spiel beenden": the finale shows the standings so far. */
  endedEarly?: boolean;
  /** Content ids played in this game (the finale never replays them). */
  contentIds?: string[];
  /** Placing decided by a finale category (Survival-Finale) – replaces the points order in the finale. */
  finalRanking?: { playerId: string; place: number }[];
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
  // The separate "setup" phase (after "Nochmal spielen") is gone – those rooms wait in the lobby.
  const legacySetup = (room.phase as string) === "setup";
  return {
    ...room,
    ...(legacySetup ? { phase: "lobby" as const, phaseEndsAt: null, game: null } : {}),
    settings: normalizeRounds(room.settings, registry),
    game: room.game && !legacySetup
      ? {
          ...room.game,
          rounds: normalizeRounds(room.game.rounds, registry),
          questionLeaderboard: room.game.questionLeaderboard ?? null,
        }
      : null,
    usedContentIds: room.usedContentIds ?? [],
    photoAvatars: room.photoAvatars ?? true,
    photoUsage: room.photoUsage ?? { base: 0, expressions: 0 },
    voice: normalizeRoomVoice(room.voice),
    questionVotes: room.questionVotes ?? null,
    // Rooms saved before game modes → Familie.
    mode: normalizeModeSettings(room.mode),
    partyConfirmed: room.partyConfirmed ?? false,
    lateJoin: room.lateJoin ?? true,
    graceUntil: room.graceUntil ?? {},
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
    voice: defaultRoomVoice(),
    questionVotes: null,
    mode: { ...DEFAULT_MODE_SETTINGS },
    partyConfirmed: false,
    lateJoin: true,
    graceUntil: {},
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

/** Phases in which a new player may join when the host allows late joins. */
const LATE_JOIN_PHASES: readonly Phase[] = ["intro", "play", "scoreboard"];

/**
 * A new player. In the lobby always; later only with "Neue Spieler während
 * des Spiels zulassen": 0 points, and during a running question they play
 * from the next one (`joinedDuring`).
 */
export function joinPlayer(
  room: RoomRecord,
  input: { name: string; avatar: Avatar },
  deps: Deps,
  registry: ModuleRegistry = GAME_MODULES,
): Result<{ room: RoomRecord; player: PlayerRecord; late: boolean }> {
  const late = room.phase !== "lobby";
  if (late && !LATE_JOIN_PHASES.includes(room.phase)) return fail("GAME_ALREADY_STARTED");
  if (late && !room.lateJoin) return fail("LATE_JOIN_CLOSED");
  const name = cleanName(input.name);
  if (name.length < 1 || name.length > NAME_MAX_LENGTH) return fail("INVALID_NAME");
  const key = nameKey(name);
  if (room.players.some((p) => nameKey(p.name) === key)) return fail("NAME_TAKEN");
  if (room.players.length >= MAX_PLAYERS) return fail("ROOM_FULL");

  const newSecret = deps.secret ?? (() => generateSecret());
  const running = room.phase === "play" ? currentQuestionKey(room, registry) : null;
  const player: PlayerRecord = {
    id: newSecret().slice(0, 12),
    secret: newSecret(),
    name,
    avatar: input.avatar,
    joinedAt: deps.now,
    ...(running ? { joinedDuring: running } : {}),
  };
  const game = room.game ? { ...room.game, scores: { ...room.game.scores, [player.id]: 0 } } : null;
  return ok({ room: { ...room, game, players: [...room.players, player] }, player, late });
}

/**
 * "Ich war schon dabei": a phone without valid credentials takes over a
 * player's seat. Only seats without an open connection (`online`) can be
 * claimed – a connected player can't be hijacked. The secret is rotated,
 * so the old one stops working; id, score, avatar and history stay.
 */
export function claimSeat(
  room: RoomRecord,
  playerId: string,
  online: ReadonlySet<string>,
  deps: Deps,
): Result<{ room: RoomRecord; player: PlayerRecord }> {
  const player = room.players.find((p) => p.id === playerId);
  if (!player) return fail("UNKNOWN_PLAYER");
  if (online.has(playerId)) return fail("SEAT_TAKEN");
  const secret = (deps.secret ?? (() => generateSecret()))();
  const claimed = { ...player, secret };
  return ok({ room: { ...room, players: room.players.map((p) => (p.id === playerId ? claimed : p)) }, player: claimed });
}

/**
 * Who counts as connected: an open connection, or dropped less than the
 * grace period ago. Short network blips change nothing.
 */
export function effectivePresence(room: RoomRecord, online: ReadonlySet<string>, now: number): Set<string> {
  const out = new Set(online);
  for (const [id, until] of Object.entries(room.graceUntil)) if (until > now) out.add(id);
  return out;
}

/** A player's last connection closed: counted as connected for the grace period. */
export function startGrace(room: RoomRecord, playerId: string, now: number, graceMs: number): RoomRecord {
  if (!room.players.some((p) => p.id === playerId)) return room;
  return { ...room, graceUntil: { ...room.graceUntil, [playerId]: now + graceMs } };
}

/** Back online (or removed): no grace needed any more. */
export function endGrace(room: RoomRecord, playerId: string): RoomRecord {
  if (!(playerId in room.graceUntil)) return room;
  const graceUntil = { ...room.graceUntil };
  delete graceUntil[playerId];
  return { ...room, graceUntil };
}

/** Grace periods that are over (the room then re-checks the question). Null when none. */
export function expireGrace(room: RoomRecord, now: number): RoomRecord | null {
  const entries = Object.entries(room.graceUntil);
  const kept = entries.filter(([, until]) => until > now);
  return kept.length === entries.length ? null : { ...room, graceUntil: Object.fromEntries(kept) };
}

/** When the next grace period ends (alarm), or null. */
export function nextGraceDeadline(room: RoomRecord): number | null {
  const times = Object.values(room.graceUntil);
  return times.length ? Math.min(...times) : null;
}

/** Host: "Neue Spieler während des Spiels zulassen". */
export function setLateJoin(room: RoomRecord, enabled: boolean): Result<RoomRecord> {
  return ok({ ...room, lateJoin: enabled });
}

/** Emoji avatars for test bots. */
const BOT_CHARACTERS = ["robot", "alien", "ghost", "octopus", "dino", "owl"] as const;
const BOT_COLORS = AVATAR_COLORS.map((c) => c.id);

/**
 * Host (test mode): a test bot joins – in the lobby, at most BOT_CONFIG.maxBots.
 * A normal player with `bot: true`; removed again with the normal kick.
 */
export function addBot(room: RoomRecord, deps: Deps & { random?: () => number }): Result<{ room: RoomRecord; player: PlayerRecord }> {
  if (room.phase !== "lobby") return fail("WRONG_PHASE");
  const bots = room.players.filter((p) => p.bot);
  if (bots.length >= BOT_CONFIG.maxBots) return fail("BOT_LIMIT");
  if (room.players.length >= MAX_PLAYERS) return fail("ROOM_FULL");
  const taken = new Set(room.players.map((p) => nameKey(p.name)));
  const name = BOT_NAMES.find((n) => !taken.has(nameKey(n))) ?? `Bot-${bots.length + 1}`;
  const random = deps.random ?? Math.random;
  const newSecret = deps.secret ?? (() => generateSecret());
  const player: PlayerRecord = {
    id: newSecret().slice(0, 12),
    secret: newSecret(),
    name,
    avatar: { character: BOT_CHARACTERS[bots.length % BOT_CHARACTERS.length]!, color: BOT_COLORS[Math.floor(random() * BOT_COLORS.length)]! },
    joinedAt: deps.now,
    bot: true,
  };
  return ok({ room: { ...room, players: [...room.players, player] }, player });
}

/** Test bots in this room. */
export function botIds(room: RoomRecord): Set<string> {
  return new Set(room.players.filter((p) => p.bot).map((p) => p.id));
}

export function kickPlayer(room: RoomRecord, playerId: string): Result<RoomRecord> {
  if (!room.players.some((p) => p.id === playerId)) return fail("UNKNOWN_PLAYER");
  return ok(endGrace({ ...room, players: room.players.filter((p) => p.id !== playerId) }, playerId));
}

export function toPublicState(
  room: RoomRecord,
  /** playerIds: connected incl. grace period; online: open connection right now. */
  connected: { host: boolean; playerIds: ReadonlySet<string>; online?: ReadonlySet<string> },
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
      // Bots never need a phone: always there.
      connected: !!p.bot || connected.playerIds.has(p.id),
      online: !!p.bot || (connected.online ?? connected.playerIds).has(p.id),
      ...(p.bot ? { bot: true } : {}),
    })),
    game: publicGame(room, viewer, registry),
    settings: viewer.role === "host" ? room.settings : null,
    settingsSummary: settingsSummary(room.settings, registry, room.mode.mode),
    mode: room.mode,
    partyConfirmed: viewer.role === "host" && room.partyConfirmed,
    poolSizes: viewer.role === "host" ? poolSizesFor(room.mode, registry) : null,
    photoAvatars: room.photoAvatars,
    lateJoin: room.lateJoin,
    voice: viewer.role === "host" ? publicVoice(room) : null,
  };
}

function publicVoice(room: RoomRecord): PublicRoomState["voice"] {
  return {
    ...room.voice.settings,
    effectiveCheekiness: effectiveCheekiness(room.voice.settings, room.mode.mode),
    allowedCheekiness: MODE_CHEEKINESS[room.mode.mode].allowed,
    status: room.voice.status,
    errorCode: room.voice.errorCode,
    creditsUsed: room.voice.creditsUsed,
    creditBudget: VOICE_CONFIG.creditBudgetPerRoom,
    account: room.voice.account,
    accountLow: accountLow(room.voice.account),
  };
}

/** Host changes the moderator settings (lobby). */
export function updateVoiceSettings(room: RoomRecord, settings: VoiceSettings): Result<RoomRecord> {
  if (room.phase !== "lobby") return fail("WRONG_PHASE");
  return ok({ ...room, voice: { ...room.voice, settings } });
}
