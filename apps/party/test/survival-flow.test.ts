/**
 * Survival-Finale through the room's real game flow (alarms = advance at
 * phaseEndsAt, answers = handlePlayerAction, presence changes).
 */
import { GAME_MODULES, SURVIVAL_CONFIG, survivalModule, type SurvivalPublicState, type SurvivalState } from "@couch-clash/games";
import type { ScoringSettings } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import {
  advance,
  beginGame,
  handlePlayerAction,
  handlePresenceChange,
  isTimerDue,
  publicGame,
  sanitizeSettings,
  updateSettings,
  type FlowDeps,
} from "../src/game-flow";
import type { Result } from "../src/result";
import { createRoomRecord, joinPlayer, type RoomRecord } from "../src/room-logic";

const T0 = 1_700_000_000_000;
const avatar = { character: "fox", color: "red" } as const;
const registry = GAME_MODULES;
const scoring: ScoringSettings = survivalModule.meta.scoring;

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r.value;
}

let seed = 11;
const random = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

function deps(now: number, connected: string[]): FlowDeps {
  return { now, random, connectedPlayerIds: new Set(connected), registry };
}

/** Anna (2000 from the main game) and Ben (90) reach the finale. */
function finaleRoom() {
  let room = createRoomRecord("SURV", "host-token-0123456789abcdef", T0);
  const ids: string[] = [];
  for (const name of ["Anna", "Ben"]) {
    const r = unwrap(joinPlayer(room, { name, avatar }, { now: T0 }));
    room = r.room;
    ids.push(r.player.id);
  }
  room = unwrap(updateSettings(room, [{ categoryId: "survival", questionCount: 1, scoring }], registry));
  room = unwrap(beginGame(room, deps(T0, ids)));
  const [anna, ben] = ids as [string, string];
  room = { ...room, game: { ...room.game!, scores: { [anna]: 2000, [ben]: 90 } } };
  // Category intro → the finale's own intro (score conversion + rules).
  room = unwrap(advance(room, deps(room.phaseEndsAt!, ids)));
  return { room, anna, ben, ids };
}

const state = (room: RoomRecord) => room.game!.moduleState as SurvivalState;

/** Rules → start sequence (the elevators ride up) → first question, by the room's alarms. */
function toFirstQuestion(room: RoomRecord, ids: string[]): RoomRecord {
  let r = room;
  for (let i = 0; i < 5 && state(r).step !== "question"; i++) r = unwrap(advance(r, deps(r.phaseEndsAt!, ids)));
  expect(state(r).step).toBe("question");
  return r;
}

function answer(room: RoomRecord, playerId: string, correct: boolean, afterMs: number, ids: string[]) {
  const q = state(room).question!;
  const value = correct ? q.question.correctIndex : (q.question.correctIndex + 1) % 4;
  return handlePlayerAction(room, playerId, { type: "answer", value }, deps(q.startedAt + afterMs, ids));
}

describe("Survival-Finale in the room", () => {
  it("converts the main-game points and never touches them", () => {
    const { room, anna, ben } = finaleRoom();
    expect(room.phase).toBe("play");
    expect(state(room).step).toBe("intro");
    expect(room.phaseEndsAt).toBe(room.phaseStartedAt + SURVIVAL_CONFIG.introMs);
    const pub = publicGame(room, { role: "host" }, registry)!.module as SurvivalPublicState;
    expect(pub.players.map((p) => [p.mainScore, p.startScore])).toEqual([
      [2000, 1200],
      [90, 250],
    ]);
    expect(room.game!.scores).toEqual({ [anna]: 2000, [ben]: 90 });
  });

  it("alarms drive the question: live decay, timeout, and the main scores stay as they were", () => {
    const start = finaleRoom();
    const { anna, ben, ids } = start;
    let room = toFirstQuestion(start.room, ids);
    const q = state(room).question!;
    expect(room.usedContentIds).toContain(q.contentId);
    room = unwrap(answer(room, anna, true, 2000, ids));
    // The room's alarms: every phaseEndsAt the module asks for.
    const alarms: number[] = [];
    while (state(room).step === "question") {
      const at = room.phaseEndsAt!;
      expect(isTimerDue(room, at - 1)).toBe(false);
      alarms.push(at - q.startedAt);
      room = unwrap(advance(room, deps(at, ids)));
    }
    expect(alarms).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((s) => s * 1000));
    const s = state(room);
    expect(s.players.find((p) => p.id === anna)!.score).toBe(1250);
    // Ben (250) never answered: −100 decay, −200 → out.
    expect(s.players.find((p) => p.id === ben)!.eliminatedAt).not.toBeNull();
    expect(room.game!.scores).toEqual({ [anna]: 2000, [ben]: 90 });
    // Winner moment, then straight to the game's finale – placed by the elimination order.
    room = unwrap(advance(room, deps(room.phaseEndsAt!, ids)));
    expect(state(room).step).toBe("winner");
    expect(state(room).winnerId).toBe(anna);
    room = unwrap(advance(room, deps(room.phaseEndsAt!, ids)));
    expect(room.phase).toBe("finale");
    const pub = publicGame(room, { role: "host" }, registry)!;
    expect(pub.rankedFinale).toBe(true);
    expect(pub.leaderboard!.map((e) => [e.playerId, e.rankAfter, e.scoreAfter])).toEqual([
      [anna, 1, 2000],
      [ben, 2, 90],
    ]);
  });

  it("the survival round always comes last and only once", () => {
    const quiz = { categoryId: "quiz", questionCount: 3, scoring: GAME_MODULES.quiz.meta.scoring };
    const survival = { categoryId: "survival", questionCount: 1, scoring };
    const rounds = unwrap(sanitizeSettings([survival, quiz, survival, { ...quiz, categoryId: "estimate", scoring: GAME_MODULES.estimate.meta.scoring }]));
    expect(rounds.map((r) => r.categoryId)).toEqual(["quiz", "estimate", "survival"]);
  });

  it("no standings before the finale: the last normal round goes straight into its intro (other rounds keep theirs)", () => {
    let room = createRoomRecord("SUR3", "host-token-0123456789abcdef", T0);
    const r = unwrap(joinPlayer(room, { name: "Anna", avatar }, { now: T0 }));
    room = r.room;
    const ids = [r.player.id];
    const quiz = { categoryId: "quiz", questionCount: 1, scoring: GAME_MODULES.quiz.meta.scoring };
    room = unwrap(updateSettings(room, [quiz, { ...quiz, categoryId: "estimate", scoring: GAME_MODULES.estimate.meta.scoring }, { categoryId: "survival", questionCount: 1, scoring }]));
    room = unwrap(beginGame(room, deps(T0, ids)));
    const phases: string[] = [];
    let now = T0;
    for (let i = 0; i < 60 && !(room.phase === "play" && room.game!.roundIndex === 2); i++) {
      now += 1000;
      const before = `${room.phase}:${room.game!.roundIndex}`;
      room = unwrap(advance(room, deps(now, ids)));
      const after = `${room.phase}:${room.game!.roundIndex}`;
      if (after !== before) phases.push(after);
    }
    expect(phases).toEqual(["play:0", "scoreboard:0", "intro:1", "play:1", "intro:2", "play:2"]);
    expect(state(room).step).toBe("intro");
  });

  it("never plays a question of the running game", () => {
    let room = createRoomRecord("SUR2", "host-token-0123456789abcdef", T0);
    const r = unwrap(joinPlayer(room, { name: "Anna", avatar }, { now: T0 }));
    room = r.room;
    const ids = [r.player.id];
    room = unwrap(
      updateSettings(room, [
        { categoryId: "quiz", questionCount: 5, scoring: GAME_MODULES.quiz.meta.scoring },
        { categoryId: "survival", questionCount: 1, scoring },
      ]),
    );
    room = unwrap(beginGame(room, deps(T0, ids)));
    // Play through the quiz with the host's "Weiter".
    let now = T0;
    for (let i = 0; i < 50 && !(room.phase === "play" && room.game!.roundIndex === 1); i++) {
      now += 1000;
      room = unwrap(advance(room, deps(now, ids)));
    }
    const played = room.game!.contentIds!;
    expect(played.length).toBe(5);
    const s = state(room);
    expect(s.source.queue.some((id) => played.includes(id))).toBe(false);
  });

  it("reconnect: same start time, the decay keeps running, no second answer", () => {
    const start = finaleRoom();
    const { anna, ben, ids } = start;
    let room = toFirstQuestion(start.room, ids);
    const startedAt = state(room).question!.startedAt;
    room = unwrap(answer(room, anna, true, 1000, ids));
    // Ben's phone drops out and comes back: nothing restarts.
    expect(handlePresenceChange(room, deps(startedAt + 3000, [anna]))).toBeNull();
    const view = publicGame(room, { role: "player", playerId: ben }, registry)!.module as SurvivalPublicState;
    expect(view.question).toMatchObject({ startedAt, decayFrom: startedAt + 10_000, timeoutAt: startedAt + 20_000 });
    room = unwrap(advance(room, deps(startedAt + 12_000, ids)));
    expect(state(room).players.find((p) => p.id === ben)!.score).toBe(230);
    // The host's "Weiter" during a question is just another tick – it never skips the question.
    room = unwrap(advance(room, deps(startedAt + 12_000, ids)));
    expect(state(room).step).toBe("question");
    expect(state(room).players.find((p) => p.id === ben)!.score).toBe(230);
    expect(answer(room, anna, true, 13_000, ids)).toEqual({ ok: false, error: "ALREADY_ANSWERED" });
    room = unwrap(answer(room, ben, true, 13_500, ids));
    expect(state(room).players.find((p) => p.id === ben)!.score).toBe(220);
  });
});
