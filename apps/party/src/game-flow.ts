/**
 * Pure game flow on top of the room: setup → intro → play → scoreboard →
 * … → finale. Category-agnostic: everything category-specific happens in
 * the module looked up from the registry.
 *
 * Timers are timestamps (phaseEndsAt). The Durable Object sets an alarm for
 * that time and calls `advance` – the same function the host's "Weiter"
 * button uses.
 */
import {
  INTRO_MS,
  MIN_PLAYERS_TO_START,
  SCOREBOARD_MS,
  type GameModule,
  type ModuleContext,
  type ModuleUpdate,
  type Phase,
  type PublicGameState,
  type ScoringSettings,
  type Viewer,
} from "@couch-clash/shared";
import { GAME_MODULES, getModule, type ModuleRegistry } from "@couch-clash/games";
import { fail, ok, type Result } from "./result";
import type { GameRecord, GameRound, RoomRecord } from "./room-logic";

/** Keep the "already played" list bounded. */
const MAX_USED_CONTENT_IDS = 1000;

export interface FlowDeps {
  now: number;
  random: () => number;
  /** Player ids with at least one open connection. */
  connectedPlayerIds: ReadonlySet<string>;
  registry?: ModuleRegistry;
}

function setPhase(room: RoomRecord, phase: Phase, now: number, phaseEndsAt: number | null): RoomRecord {
  return { ...room, phase, phaseStartedAt: now, phaseEndsAt };
}

function moduleContext(room: RoomRecord, deps: FlowDeps): ModuleContext {
  return {
    now: deps.now,
    random: deps.random,
    players: room.players.map((p) => ({ id: p.id, connected: deps.connectedPlayerIds.has(p.id) })),
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

/** Applies a module result to the room: state, points, timers, "done". */
function applyModuleUpdate(room: RoomRecord, update: ModuleUpdate<unknown>, now: number): RoomRecord {
  const game = room.game!;
  const usedContentIds = update.usedContentIds?.length
    ? [...new Set([...room.usedContentIds, ...update.usedContentIds])].slice(-MAX_USED_CONTENT_IDS)
    : room.usedContentIds;
  const nextGame: GameRecord = {
    ...game,
    moduleState: update.done ? null : update.state,
    scores: addPoints(game.scores, update.scoreDelta),
    roundGain: addPoints(game.roundGain, update.scoreDelta),
  };
  const next: RoomRecord = { ...room, game: nextGame, usedContentIds };
  if (update.done) return setPhase(next, "scoreboard", now, now + SCOREBOARD_MS);
  return { ...next, phaseEndsAt: update.phaseEndsAt };
}

/** Only the fields a category allows are taken from the host; the rest are defaults. */
function sanitizeScoring(module: GameModule, input: ScoringSettings): ScoringSettings {
  const scoring: ScoringSettings = { ...module.meta.scoring };
  for (const field of module.meta.scoringFields) {
    (scoring as Record<string, unknown>)[field] = input[field];
  }
  return scoring;
}

export function beginGame(room: RoomRecord, rounds: readonly GameRound[], deps: FlowDeps): Result<RoomRecord> {
  const registry = deps.registry ?? GAME_MODULES;
  if (room.phase !== "setup") return fail("WRONG_PHASE");
  if (room.players.length < MIN_PLAYERS_TO_START) return fail("NOT_ENOUGH_PLAYERS");
  if (rounds.length === 0) return fail("INVALID_PLAN");

  const planned: GameRound[] = [];
  for (const round of rounds) {
    const module = getModule(round.categoryId, registry);
    if (!module) return fail("INVALID_PLAN");
    const { min, max } = module.meta.questionsPerRound;
    planned.push({
      categoryId: round.categoryId,
      questionCount: Math.min(max, Math.max(min, round.questionCount)),
      scoring: sanitizeScoring(module, round.scoring),
    });
  }

  const game: GameRecord = {
    rounds: planned,
    roundIndex: 0,
    moduleState: null,
    scores: Object.fromEntries(room.players.map((p) => [p.id, 0])),
    roundGain: {},
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
  });
  const playing = setPhase({ ...room, game: { ...game, roundGain: {} } }, "play", deps.now, null);
  return ok(applyModuleUpdate(playing, update, deps.now));
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
      return ok(applyModuleUpdate(room, module.onTimer(game.moduleState, moduleContext(room, deps)), deps.now));
    }
    case "scoreboard": {
      const nextIndex = game.roundIndex + 1;
      if (nextIndex < game.rounds.length) {
        return ok(
          setPhase({ ...room, game: { ...game, roundIndex: nextIndex } }, "intro", deps.now, deps.now + INTRO_MS),
        );
      }
      return ok(setPhase(room, "finale", deps.now, null));
    }
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
  return ok(applyModuleUpdate(room, result, deps.now));
}

/** Connection changes (disconnect, kick) may end a question early. Null = no change. */
export function handlePresenceChange(room: RoomRecord, deps: FlowDeps): RoomRecord | null {
  const registry = deps.registry ?? GAME_MODULES;
  if (room.phase !== "play" || room.game?.moduleState == null) return null;
  const module = currentModule(room, registry);
  const update = module?.onPlayersChanged?.(room.game.moduleState, moduleContext(room, deps));
  return update ? applyModuleUpdate(room, update, deps.now) : null;
}

/** "Nochmal spielen" / end game: back to setup with the same players, scores reset. */
export function playAgain(room: RoomRecord, now: number): Result<RoomRecord> {
  if (!["intro", "play", "scoreboard", "finale"].includes(room.phase)) return fail("WRONG_PHASE");
  return ok(setPhase({ ...room, game: null }, "setup", now, null));
}

export function backToLobby(room: RoomRecord, now: number): Result<RoomRecord> {
  if (room.phase !== "setup") return fail("WRONG_PHASE");
  return ok(setPhase(room, "lobby", now, null));
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
  };
}
