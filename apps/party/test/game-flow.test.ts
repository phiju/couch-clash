import { INTRO_MS, SCOREBOARD_MS, type ScoringSettings } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import {
  advance,
  backToLobby,
  beginGame,
  handlePlayerAction,
  handlePresenceChange,
  isTimerDue,
  playAgain,
  publicGame,
  type FlowDeps,
} from "../src/game-flow";
import type { Result } from "../src/result";
import { createRoomRecord, joinPlayer, startGame, type RoomRecord } from "../src/room-logic";

const T0 = 1_700_000_000_000;
const avatar = { character: "fox", color: "red" } as const;
const scoring: ScoringSettings = { basePoints: 100, speedBonus: true, minPercent: 10, estimateScale: "distance" };

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r.value;
}

let seed = 7;
const random = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

/** Room in setup with players Anna + Ben, both connected. */
function setupRoom() {
  let room = createRoomRecord("ABCD", "host-token-0123456789abcdef", T0);
  const ids: string[] = [];
  for (const name of ["Anna", "Ben"]) {
    const r = unwrap(joinPlayer(room, { name, avatar }, { now: T0 }));
    room = r.room;
    ids.push(r.player.id);
  }
  room = unwrap(startGame(room, T0));
  return { room, ids };
}

function deps(now: number, connected: string[]): FlowDeps {
  return { now, random, connectedPlayerIds: new Set(connected) };
}

type QState = { step: string; index: number; questions: { correctIndex: number }[] };
const moduleState = (room: RoomRecord) => room.game!.moduleState as QState;

describe("beginGame", () => {
  it("validates the plan and starts with the intro", () => {
    const { room, ids } = setupRoom();
    expect(beginGame(room, [], deps(T0, ids))).toEqual({ ok: false, error: "INVALID_PLAN" });
    expect(beginGame(room, [{ categoryId: "nope", questionCount: 3, scoring }], deps(T0, ids)).ok).toBe(false);
    expect(beginGame({ ...room, phase: "lobby" }, [{ categoryId: "quiz", questionCount: 3, scoring }], deps(T0, ids)))
      .toEqual({ ok: false, error: "WRONG_PHASE" });

    const next = unwrap(beginGame(room, [{ categoryId: "quiz", questionCount: 3, scoring }], deps(T0, ids)));
    expect(next.phase).toBe("intro");
    expect(next.phaseEndsAt).toBe(T0 + INTRO_MS);
    expect(next.game!.scores).toEqual({ [ids[0]!]: 0, [ids[1]!]: 0 });
  });

  it("clamps question counts and ignores scoring fields the category doesn't allow", () => {
    const { room, ids } = setupRoom();
    const next = unwrap(
      beginGame(
        room,
        [
          { categoryId: "quiz", questionCount: 999, scoring: { ...scoring, estimateScale: "rank" } },
          { categoryId: "estimate", questionCount: 1, scoring: { ...scoring, basePoints: 500 } },
        ],
        deps(T0, ids),
      ),
    );
    expect(next.game!.rounds[0]!.questionCount).toBe(20);
    expect(next.game!.rounds[0]!.scoring.estimateScale).toBe("distance"); // not editable for quiz
    expect(next.game!.rounds[1]!.questionCount).toBe(3);
    expect(next.game!.rounds[1]!.scoring.basePoints).toBe(500);
  });
});

describe("full game flow", () => {
  it("intro → play (questions, reveals) → scoreboard → intro → … → finale → setup", () => {
    const { room: setup, ids } = setupRoom();
    const [a, b] = ids as [string, string];
    const all = [a, b];
    let room = unwrap(
      beginGame(
        setup,
        [
          { categoryId: "quiz", questionCount: 3, scoring },
          { categoryId: "estimate", questionCount: 3, scoring },
        ],
        deps(T0, all),
      ),
    );

    // Intro timer → first question.
    let now = T0 + INTRO_MS;
    expect(isTimerDue(room, now - 1)).toBe(false);
    expect(isTimerDue(room, now)).toBe(true);
    room = unwrap(advance(room, deps(now, all)));
    expect(room.phase).toBe("play");
    expect(moduleState(room).step).toBe("question");
    expect(room.usedContentIds).toHaveLength(3);

    // Q1: A answers correctly, B wrong → early reveal, A gets 100.
    const correct = moduleState(room).questions[0]!.correctIndex;
    room = unwrap(handlePlayerAction(room, a, { type: "answer", value: correct }, deps(now + 1000, all)));
    room = unwrap(handlePlayerAction(room, b, { type: "answer", value: (correct + 1) % 4 }, deps(now + 2000, all)));
    expect(moduleState(room).step).toBe("reveal");
    expect(room.game!.scores[a]).toBe(100);
    expect(room.game!.roundGain[a]).toBe(100);
    expect(room.game!.scores[b]).toBe(0);

    // Host skips the reveal; Q2 and Q3 time out.
    for (let i = 0; i < 5; i++) room = unwrap(advance(room, deps((now += 1000), all)));
    expect(room.phase).toBe("scoreboard");
    expect(room.phaseEndsAt).toBe(now + SCOREBOARD_MS);
    expect(room.game!.moduleState).toBeNull();

    // Scoreboard → second category intro → play.
    room = unwrap(advance(room, deps((now += SCOREBOARD_MS), all)));
    expect(room.phase).toBe("intro");
    expect(room.game!.roundIndex).toBe(1);
    room = unwrap(advance(room, deps((now += INTRO_MS), all)));
    expect(room.phase).toBe("play");
    expect(room.game!.roundGain).toEqual({});
    expect(room.usedContentIds).toHaveLength(6);

    for (let i = 0; i < 6; i++) room = unwrap(advance(room, deps((now += 1000), all)));
    expect(room.phase).toBe("scoreboard");
    room = unwrap(advance(room, deps((now += 1000), all)));
    expect(room.phase).toBe("finale");
    expect(room.phaseEndsAt).toBeNull();
    expect(room.game!.scores[a]).toBe(100);

    // Nochmal spielen: back to setup, scores reset, played questions remembered.
    room = unwrap(playAgain(room, now));
    expect(room.phase).toBe("setup");
    expect(room.game).toBeNull();
    expect(room.usedContentIds).toHaveLength(6);
    expect(room.players).toHaveLength(2);
  });

  it("does not repeat questions in the next game of the same room", () => {
    const { room: setup, ids } = setupRoom();
    const plan = [{ categoryId: "estimate", questionCount: 10, scoring }];
    let room = unwrap(beginGame(setup, plan, deps(T0, ids)));
    room = unwrap(advance(room, deps(T0 + INTRO_MS, ids)));
    const first = new Set(room.usedContentIds);
    room = unwrap(playAgain(room, T0 + 10_000));
    room = unwrap(beginGame(room, plan, deps(T0 + 11_000, ids)));
    room = unwrap(advance(room, deps(T0 + 20_000, ids)));
    const second = room.usedContentIds.filter((id) => !first.has(id));
    expect(second).toHaveLength(10);
  });
});

describe("timers, early end and presence", () => {
  function playing() {
    const { room: setup, ids } = setupRoom();
    let room = unwrap(beginGame(setup, [{ categoryId: "quiz", questionCount: 3, scoring }], deps(T0, ids)));
    room = unwrap(advance(room, deps(T0 + INTRO_MS, ids)));
    return { room, ids: ids as [string, string], start: T0 + INTRO_MS };
  }

  it("the question ends when its timer runs out", () => {
    const { room, ids, start } = playing();
    expect(room.phaseEndsAt).toBe(start + 20_000);
    const next = unwrap(advance(room, deps(start + 20_000, ids)));
    expect(moduleState(next).step).toBe("reveal");
  });

  it("a disconnect of the last missing player ends the question early", () => {
    const { room, ids, start } = playing();
    const [a, b] = ids;
    const answered = unwrap(handlePlayerAction(room, a, { type: "answer", value: 0 }, deps(start + 1000, ids)));
    expect(moduleState(answered).step).toBe("question");
    expect(handlePresenceChange(answered, deps(start + 2000, [a, b]))).toBeNull();
    const next = handlePresenceChange(answered, deps(start + 2000, [a]));
    expect(moduleState(next!).step).toBe("reveal");
    expect(next!.phaseEndsAt).toBe(start + 2000 + 8000);
  });

  it("rejects answers outside of play and invalid actions", () => {
    const { room, ids, start } = playing();
    expect(handlePlayerAction(room, ids[0], { type: "answer", value: 9 }, deps(start, ids))).toEqual({
      ok: false,
      error: "INVALID_MESSAGE",
    });
    expect(handlePlayerAction(room, ids[0], { type: "answer", value: 0 }, deps(start + 20_001, ids))).toEqual({
      ok: false,
      error: "TOO_LATE",
    });
    const { room: setup } = setupRoom();
    expect(handlePlayerAction(setup, ids[0], { type: "answer", value: 0 }, deps(start, ids)).ok).toBe(false);
  });

  it("advance is rejected outside the game", () => {
    const { room, ids } = setupRoom();
    expect(advance(room, deps(T0, ids))).toEqual({ ok: false, error: "WRONG_PHASE" });
    expect(backToLobby(room, T0).ok).toBe(true);
    expect(playAgain(room, T0).ok).toBe(false);
  });
});

describe("publicGame per viewer", () => {
  it("never contains the correct answer or others' answers during a question", () => {
    const { room: setup, ids } = setupRoom();
    let room = unwrap(beginGame(setup, [{ categoryId: "quiz", questionCount: 3, scoring }], deps(T0, ids)));
    room = unwrap(advance(room, deps(T0 + INTRO_MS, ids)));
    room = unwrap(handlePlayerAction(room, ids[0]!, { type: "answer", value: 3 }, deps(T0 + INTRO_MS + 500, ids)));

    for (const viewer of [
      { role: "host" } as const,
      { role: "guest" } as const,
      { role: "player", playerId: ids[1]! } as const,
    ]) {
      const json = JSON.stringify(publicGame(room, viewer));
      expect(json).not.toContain("correctIndex");
      expect(json).not.toContain('"myAnswer":3');
    }
    const own = publicGame(room, { role: "player", playerId: ids[0]! });
    expect((own!.module as { myAnswer: number }).myAnswer).toBe(3);
  });
});
