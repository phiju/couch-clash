/**
 * Pure game flow on top of the room: lobby → intro → play → scoreboard →
 * … → finale → lobby. Category-agnostic: everything category-specific happens in
 * the module looked up from the registry.
 *
 * Timers are timestamps (phaseEndsAt). The Durable Object sets an alarm for
 * that time and calls `advance` – the same function the host's "Weiter"
 * button uses.
 */
import {
  buildLeaderboard,
  estimateGameSeconds,
  INTRO_MS,
  MIN_PLAYERS_TO_START,
  SCOREBOARD_MS,
  type GameModule,
  type ModuleContext,
  type ModuleProgress,
  type ModuleTask,
  type GameMode,
  type GameModeSettings,
  DEFAULT_PER_QUESTION_CAP,
  EARLY_FINALE_MS,
  FINALE_MS,
  MODE_CHEEKINESS,
  type ModuleUpdate,
  contentPoolOf,
  type Phase,
  type PublicGameState,
  type SettingsSummary,
  type Viewer,
} from "@couch-clash/shared";
import {
  GAME_MODULES,
  categoryAvailable,
  getModule,
  normalizeCategoryOptions,
  normalizeScoring,
  type ModuleRegistry,
} from "@couch-clash/games";
import { fail, ok, type Result } from "./result";
import { poolSizesFor } from "./pools";
import type { GameRecord, GameRound, RoomRecord } from "./room-logic";
import type { ContentFilter } from "./stats/content-filter";

/** Keep the "already played" list bounded. */
const MAX_USED_CONTENT_IDS = 1000;

export interface FlowDeps {
  now: number;
  random: () => number;
  /** Player ids with at least one open connection. */
  connectedPlayerIds: ReadonlySet<string>;
  registry?: ModuleRegistry;
  /** Blocked ids + generated content (question statistics); null/undefined → no filter. */
  content?: ContentFilter | null;
}

function setPhase(room: RoomRecord, phase: Phase, now: number, phaseEndsAt: number | null): RoomRecord {
  return { ...room, phase, phaseStartedAt: now, phaseEndsAt };
}

/**
 * The question running right now ("round:question"), or null outside a
 * question. Late joiners are remembered with it and play from the next one.
 */
export function currentQuestionKey(room: RoomRecord, registry: ModuleRegistry = GAME_MODULES): string | null {
  const game = room.game;
  if (room.phase !== "play" || !game || game.moduleState == null) return null;
  const progress = currentModule(room, registry)?.progress?.(game.moduleState);
  return `${game.roundIndex}:${progress ? progress.index : "round"}`;
}

/** Players who joined during the running question (they neither answer nor block it). */
export function waitingPlayerIds(room: RoomRecord, registry: ModuleRegistry = GAME_MODULES): string[] {
  const key = currentQuestionKey(room, registry);
  return key ? room.players.filter((p) => p.joinedDuring === key).map((p) => p.id) : [];
}

function moduleContext(room: RoomRecord, deps: FlowDeps): ModuleContext {
  const waiting = new Set(waitingPlayerIds(room, deps.registry ?? GAME_MODULES));
  return {
    now: deps.now,
    random: deps.random,
    players: room.players
      .filter((p) => !waiting.has(p.id))
      .map((p) => ({ id: p.id, connected: deps.connectedPlayerIds.has(p.id), name: p.name })),
    scores: room.game?.scores ?? {},
  };
}

/** Late joiners whose question is over now play along (their marker is dropped). */
function settleLateJoiners(room: RoomRecord, registry: ModuleRegistry): RoomRecord {
  if (!room.players.some((p) => p.joinedDuring)) return room;
  const key = currentQuestionKey(room, registry);
  if (!room.players.some((p) => p.joinedDuring && p.joinedDuring !== key)) return room;
  return {
    ...room,
    players: room.players.map((p) => {
      if (!p.joinedDuring || p.joinedDuring === key) return p;
      const rest = { ...p };
      delete rest.joinedDuring;
      return rest;
    }),
  };
}

function currentModule(room: RoomRecord, registry: ModuleRegistry): GameModule | undefined {
  const round = room.game?.rounds[room.game.roundIndex];
  return round ? getModule(round.categoryId, registry) : undefined;
}

function addPoints(target: Record<string, number>, delta: Record<string, number> | undefined) {
  const out = { ...target };
  for (const [id, points] of Object.entries(delta ?? {})) out[id] = (out[id] ?? 0) + points;
  return out;
}

/**
 * Global per-question cap (default 200 per player), applied after every
 * category's own scoring – future categories can't break the balance either.
 * Risk games (CategoryMeta.capExempt) are exempt: their points are the bet.
 */
export function capScoreDelta(
  delta: Record<string, number> | undefined,
  scoring: { perQuestionCap?: number } | undefined,
  capExempt = false,
): Record<string, number> | undefined {
  if (!delta || capExempt) return delta;
  const cap = scoring?.perQuestionCap ?? DEFAULT_PER_QUESTION_CAP;
  return Object.fromEntries(Object.entries(delta).map(([id, points]) => [id, Math.min(points, cap)]));
}

/** Applies a module result to the room: state, points, timers, "done". */
function applyModuleUpdate(
  room: RoomRecord,
  raw: ModuleUpdate<unknown>,
  now: number,
  registry: ModuleRegistry = GAME_MODULES,
): RoomRecord {
  const game = room.game!;
  const round = game.rounds[game.roundIndex];
  const capExempt = !!(round && getModule(round.categoryId, registry)?.meta.capExempt);
  const update = { ...raw, scoreDelta: capScoreDelta(raw.scoreDelta, round?.scoring, capExempt) };
  const usedContentIds = update.usedContentIds?.length
    ? [...new Set([...room.usedContentIds, ...update.usedContentIds])].slice(-MAX_USED_CONTENT_IDS)
    : room.usedContentIds;
  const nextGame: GameRecord = {
    ...game,
    moduleState: update.done ? null : update.state,
    scores: addPoints(game.scores, update.scoreDelta),
    roundGain: addPoints(game.roundGain, update.scoreDelta),
    // A scored question (even with 0 points for everyone) gets a leaderboard snapshot.
    questionLeaderboard: update.scoreDelta
      ? buildLeaderboard(room.players, game.scores, update.scoreDelta)
      : game.questionLeaderboard,
  };
  const next: RoomRecord = { ...room, game: nextGame, usedContentIds };
  if (update.done) return settleLateJoiners(setPhase(next, "scoreboard", now, now + SCOREBOARD_MS), registry);
  return settleLateJoiners({ ...next, phaseEndsAt: update.phaseEndsAt }, registry);
}


/** Validates host settings against the registry: known categories, clamped counts, allowed fields. */
export function sanitizeSettings(
  rounds: readonly GameRound[],
  registry: ModuleRegistry = GAME_MODULES,
  mode?: GameModeSettings,
): Result<GameRound[]> {
  const planned: GameRound[] = [];
  const pools = mode ? poolSizesFor(mode, registry) : null;
  for (const round of rounds) {
    const module = getModule(round.categoryId, registry);
    if (!module) return fail("INVALID_PLAN");
    // A category may come up more than once (Zufall plans for long games), never directly again.
    if (planned.at(-1)?.categoryId === round.categoryId) return fail("INVALID_PLAN");
    // Categories not offered in the game mode are left out.
    if (mode && !module.meta.modes.includes(mode.mode)) continue;
    const { min } = module.meta.questionsPerRound;
    // Never more questions than the mode's pool has.
    const max = Math.min(module.meta.questionsPerRound.max, pools?.[round.categoryId] ?? Infinity);
    if (max < min) continue;
    planned.push({
      categoryId: round.categoryId,
      questionCount: Math.min(max, Math.max(min, round.questionCount)),
      scoring: normalizeScoring(module.meta, round.scoring),
      ...(module.meta.options?.length ? { options: normalizeCategoryOptions(module.meta, round.options) } : {}),
    });
  }
  return ok(planned);
}

/** Host changes the settings – allowed while nothing is running (lobby). */
export function updateSettings(
  room: RoomRecord,
  rounds: readonly GameRound[],
  registry: ModuleRegistry = GAME_MODULES,
): Result<RoomRecord> {
  if (room.phase !== "lobby") return fail("WRONG_PHASE");
  const settings = sanitizeSettings(rounds, registry, room.mode);
  if (!settings.ok) return settings;
  return ok({ ...room, settings: settings.value });
}

/**
 * Host picks the game mode. Party needs a one-time confirmation per room.
 * A new mode sets the host voice's default "Frechheit" and drops categories
 * the mode doesn't offer.
 */
export function updateMode(
  room: RoomRecord,
  mode: GameModeSettings,
  confirmAdult: boolean,
  registry: ModuleRegistry = GAME_MODULES,
): Result<RoomRecord> {
  if (room.phase !== "lobby") return fail("WRONG_PHASE");
  if (mode.mode === "party" && !room.partyConfirmed && !confirmAdult) return fail("PARTY_CONFIRM_REQUIRED");
  const changed = mode.mode !== room.mode.mode;
  const voice = changed
    ? { ...room.voice, settings: { ...room.voice.settings, cheekiness: MODE_CHEEKINESS[mode.mode].default } }
    : room.voice;
  const settings = sanitizeSettings(room.settings, registry, mode);
  return ok({
    ...room,
    mode,
    partyConfirmed: room.partyConfirmed || (mode.mode === "party" && confirmAdult),
    voice,
    settings: settings.ok ? settings.value : room.settings,
  });
}

export function settingsSummary(
  settings: readonly GameRound[],
  registry: ModuleRegistry = GAME_MODULES,
  mode: GameMode = "family",
): SettingsSummary | null {
  if (settings.length === 0) return null;
  const planned = settings.flatMap((r) => {
    const module = getModule(r.categoryId, registry);
    return module ? [{ meta: module.meta, questionCount: r.questionCount }] : [];
  });
  return {
    mode,
    categoryIds: settings.map((r) => r.categoryId),
    questionCount: settings.reduce((sum, r) => sum + r.questionCount, 0),
    estimatedSeconds: estimateGameSeconds(planned),
  };
}

/** "Spiel starten": from the lobby, with the stored settings. */
export function beginGame(room: RoomRecord, deps: FlowDeps): Result<RoomRecord> {
  const registry = deps.registry ?? GAME_MODULES;
  if (room.phase !== "lobby") return fail("WRONG_PHASE");
  if (room.players.length < MIN_PLAYERS_TO_START) return fail("NOT_ENOUGH_PLAYERS");
  const settings = sanitizeSettings(room.settings, registry, room.mode);
  if (!settings.ok) return settings;
  if (settings.value.length === 0) return fail("INVALID_PLAN");
  // Categories that need more players (e.g. bluffing) are skipped.
  const rounds = settings.value.filter((r) => {
    const meta = getModule(r.categoryId, registry)?.meta;
    return !!meta && categoryAvailable(meta, room.players.length);
  });
  if (rounds.length === 0) return fail("NOT_ENOUGH_PLAYERS");

  const game: GameRecord = {
    rounds,
    roundIndex: 0,
    moduleState: null,
    scores: Object.fromEntries(room.players.map((p) => [p.id, 0])),
    roundGain: {},
    questionLeaderboard: null,
  };
  return ok(setPhase({ ...room, game }, "intro", deps.now, deps.now + INTRO_MS));
}

function startRound(room: RoomRecord, deps: FlowDeps, registry: ModuleRegistry): Result<RoomRecord> {
  const game = room.game!;
  const round = game.rounds[game.roundIndex]!;
  const module = getModule(round.categoryId, registry);
  if (!module) return fail("INVALID_PLAN");
  const update = module.init(moduleContext(room, deps), {
    questionCount: round.questionCount,
    scoring: round.scoring,
    excludeContentIds: room.usedContentIds,
    blockedContentIds: deps.content?.blocked,
    // Generated questions are stored under the category that owns the content (e.g. "quiz").
    extraContent: deps.content?.extra[contentPoolOf(module.meta)],
    options: normalizeCategoryOptions(module.meta, round.options),
    mode: room.mode,
  });
  const playing = setPhase(
    { ...room, game: { ...game, roundGain: {}, questionLeaderboard: null } },
    "play",
    deps.now,
    null,
  );
  return ok(applyModuleUpdate(playing, update, deps.now, registry));
}

/** Timer expired or host pressed "Weiter": move the game forward one step. */
export function advance(room: RoomRecord, deps: FlowDeps): Result<RoomRecord> {
  const registry = deps.registry ?? GAME_MODULES;
  const game = room.game;
  if (!game) return fail("WRONG_PHASE");

  switch (room.phase) {
    case "intro":
      return startRound(room, deps, registry);
    case "play": {
      const module = currentModule(room, registry);
      if (!module || game.moduleState == null) return fail("WRONG_PHASE");
      return ok(applyModuleUpdate(room, module.onTimer(game.moduleState, moduleContext(room, deps)), deps.now, registry));
    }
    case "scoreboard": {
      const nextIndex = game.roundIndex + 1;
      if (nextIndex < game.rounds.length) {
        return ok(
          setPhase({ ...room, game: { ...game, roundIndex: nextIndex } }, "intro", deps.now, deps.now + INTRO_MS),
        );
      }
      return ok(setPhase(room, "finale", deps.now, deps.now + FINALE_MS));
    }
    case "finale":
      return backToLobby(room, deps.now);
    default:
      return fail("WRONG_PHASE");
  }
}

/** A player's category action (e.g. an answer). Validated with the module's zod schema. */
export function handlePlayerAction(
  room: RoomRecord,
  playerId: string,
  action: unknown,
  deps: FlowDeps,
): Result<RoomRecord> {
  const registry = deps.registry ?? GAME_MODULES;
  if (room.phase !== "play" || room.game?.moduleState == null) return fail("WRONG_PHASE");
  const module = currentModule(room, registry);
  if (!module) return fail("WRONG_PHASE");
  const parsed = module.actionSchema.safeParse(action);
  if (!parsed.success) return fail("INVALID_MESSAGE");
  const result = module.handleAction(room.game.moduleState, parsed.data, playerId, moduleContext(room, deps));
  if ("error" in result) return fail(result.error);
  return ok(applyModuleUpdate(room, result, deps.now, registry));
}

/** Server work the current module waits for (e.g. an AI check), or null. */
export function pendingModuleTask(room: RoomRecord, registry: ModuleRegistry = GAME_MODULES): ModuleTask | null {
  if (room.phase !== "play" || room.game?.moduleState == null) return null;
  return currentModule(room, registry)?.pendingTask?.(room.game.moduleState) ?? null;
}

/** Result of a module task (null = timeout/failure). Null when the task is outdated. */
export function resolveModuleTask(room: RoomRecord, taskId: string, result: unknown, deps: FlowDeps): RoomRecord | null {
  const registry = deps.registry ?? GAME_MODULES;
  if (room.phase !== "play" || room.game?.moduleState == null) return null;
  const module = currentModule(room, registry);
  const update = module?.resolveTask?.(room.game.moduleState, taskId, result, moduleContext(room, deps));
  return update ? applyModuleUpdate(room, update, deps.now, registry) : null;
}

/** Connection changes (disconnect, kick) may end a question early. Null = no change. */
export function handlePresenceChange(room: RoomRecord, deps: FlowDeps): RoomRecord | null {
  const registry = deps.registry ?? GAME_MODULES;
  if (room.phase !== "play" || room.game?.moduleState == null) return null;
  const module = currentModule(room, registry);
  const update = module?.onPlayersChanged?.(room.game.moduleState, moduleContext(room, deps));
  return update ? applyModuleUpdate(room, update, deps.now, registry) : null;
}

/** Anyone scored (positive or negative) in this game? Otherwise there is nothing to celebrate. */
export function hasScores(room: RoomRecord): boolean {
  return Object.values(room.game?.scores ?? {}).some((points) => points !== 0);
}

/**
 * "Spiel beenden" during intro/play/scoreboard: a short award ceremony with
 * the current scores. A running question is dropped (no points for it).
 * Nobody scored yet → straight back to the lobby.
 */
export function endGame(room: RoomRecord, now: number): Result<RoomRecord> {
  if (room.phase !== "intro" && room.phase !== "play" && room.phase !== "scoreboard") return fail("WRONG_PHASE");
  if (!room.game || !hasScores(room)) return ok(toLobby(room, now));
  const game: GameRecord = { ...room.game, moduleState: null, roundGain: {}, questionLeaderboard: null, endedEarly: true };
  return ok(setPhase({ ...room, game }, "finale", now, now + EARLY_FINALE_MS));
}

/**
 * Finale over ("Zurück zur Lobby" or its timer): the normal lobby with the
 * same players and settings. The game (and its scores) is dropped – the next
 * one starts at 0.
 */
export function backToLobby(room: RoomRecord, now: number): Result<RoomRecord> {
  if (room.phase !== "finale") return fail("WRONG_PHASE");
  return ok(toLobby(room, now));
}

function toLobby(room: RoomRecord, now: number): RoomRecord {
  // Late-join markers belong to the finished game ("0:0" would match the next game's first question).
  const players = room.players.map((p) => {
    if (!p.joinedDuring) return p;
    const rest = { ...p };
    delete rest.joinedDuring;
    return rest;
  });
  return setPhase({ ...room, players, game: null }, "lobby", now, null);
}

/** Timer due? (Alarms can fire a few ms early/late; the room checks this.) */
export function isTimerDue(room: RoomRecord, now: number): boolean {
  return room.phaseEndsAt !== null && now >= room.phaseEndsAt;
}

export function publicGame(
  room: RoomRecord,
  viewer: Viewer,
  registry: ModuleRegistry = GAME_MODULES,
): PublicGameState | null {
  const game = room.game;
  if (!game) return null;
  const module = room.phase === "play" && game.moduleState != null ? currentModule(room, registry) : undefined;
  return {
    rounds: game.rounds.map((r) => ({ categoryId: r.categoryId, questionCount: r.questionCount })),
    roundIndex: game.roundIndex,
    scores: game.scores,
    roundGain: game.roundGain,
    module: module ? module.toPublicState(game.moduleState, viewer) : null,
    leaderboard: publicLeaderboard(room, game),
    currentQuestion: currentQuestion(module?.progress?.(game.moduleState)),
    waitingPlayerIds: waitingPlayerIds(room, registry),
    endedEarly: !!game.endedEarly,
  };
}

function currentQuestion(p: ModuleProgress | null | undefined): PublicGameState["currentQuestion"] {
  return p?.contentId ? { contentId: p.contentId, revealed: !!p.revealed } : null;
}

function publicLeaderboard(room: RoomRecord, game: GameRecord) {
  switch (room.phase) {
    case "play":
      // Only after a question was scored – never during the question itself.
      return game.questionLeaderboard;
    case "scoreboard": {
      const before: Record<string, number> = {};
      for (const [id, score] of Object.entries(game.scores)) before[id] = score - (game.roundGain[id] ?? 0);
      return buildLeaderboard(room.players, before, game.roundGain);
    }
    case "finale":
      return buildLeaderboard(room.players, game.scores, {});
    default:
      return null;
  }
}
