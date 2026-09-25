/**
 * Survival-Finale through the room's real game flow (alarms = advance at
 * phaseEndsAt, answers = handlePlayerAction, presence changes). The module
 * is not in the default registry yet, so the tests pass their own.
 */
import { GAME_MODULES, SURVIVAL_CONFIG, survivalModule, type SurvivalPublicState, type SurvivalState } from "@couch-clash/games";
import type { ScoringSettings } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import { advance, beginGame, handlePlayerAction, handlePresenceChange, isTimerDue, publicGame, updateSettings, type FlowDeps } from "../src/game-flow";
import type { Result } from "../src/result";
import { createRoomRecord, joinPlayer, type RoomRecord } from "../src/room-logic";

const T0 = 1_700_000_000_000;
const avatar = { character: "fox", color: "red" } as const;
const registry = { ...GAME_MODULES, survival: survivalModule as unknown as (typeof GAME_MODULES)["quiz"] };
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
    let room = start.room;
    room = unwrap(advance(room, deps(room.phaseEndsAt!, ids)));
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
    // Winner moment, then the finale is done → scoreboard.
    room = unwrap(advance(room, deps(room.phaseEndsAt!, ids)));
    expect(state(room).step).toBe("winner");
    expect(state(room).winnerId).toBe(anna);
    room = unwrap(advance(room, deps(room.phaseEndsAt!, ids)));
    expect(room.phase).toBe("scoreboard");
  });

  it("reconnect: same start time, the decay keeps running, no second answer", () => {
    const start = finaleRoom();
    const { anna, ben, ids } = start;
    let room = start.room;
    room = unwrap(advance(room, deps(room.phaseEndsAt!, ids)));
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
