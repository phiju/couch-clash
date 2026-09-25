import {
  EARLY_FINALE_MS,
  FINALE_MS,
  INTRO_MS,
  REVEAL_ANSWER_MS,
  SCOREBOARD_MS,
  type ScoringSettings,
} from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import {
  advance,
  backToLobby,
  beginGame,
  handlePlayerAction,
  handlePresenceChange,
  endGame,
  isTimerDue,
  publicGame,
  updateSettings,
  type FlowDeps,
} from "../src/game-flow";
import type { Result } from "../src/result";
import { createRoomRecord, joinPlayer, normalizeRoomRecord, type GameRound, type RoomRecord } from "../src/room-logic";

const T0 = 1_700_000_000_000;
const avatar = { character: "fox", color: "red" } as const;
// Flow tests: speed modifier off so a correct answer is exactly 100 points.
const scoring: ScoringSettings = {
  mode: "absolute",
  maxPoints: 100,
  speedModifier: { enabled: false, fastestMultiplier: 1.5, slowestMultiplier: 0.5 },
};

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r.value;
}

let seed = 7;
const random = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

/** Lobby with players Anna + Ben, both connected. */
function setupRoom() {
  let room = createRoomRecord("ABCD", "host-token-0123456789abcdef", T0);
  const ids: string[] = [];
  for (const name of ["Anna", "Ben"]) {
    const r = unwrap(joinPlayer(room, { name, avatar }, { now: T0 }));
    room = r.room;
    ids.push(r.player.id);
  }
  return { room, ids };
}

function deps(now: number, connected: string[]): FlowDeps {
  return { now, random, connectedPlayerIds: new Set(connected) };
}

/** Store settings (as the host does in the lobby) and start. */
function begin(room: RoomRecord, rounds: GameRound[], d: FlowDeps): Result<RoomRecord> {
  const withSettings = updateSettings(room, rounds);
  if (!withSettings.ok) return withSettings;
  return beginGame(withSettings.value, d);
}

type QState = { step: string; index: number; questions: { correctIndex: number }[] };
const moduleState = (room: RoomRecord) => room.game!.moduleState as QState;

describe("settings + beginGame", () => {
  it("starts directly from the lobby with the stored settings", () => {
    const { room, ids } = setupRoom();
    expect(room.phase).toBe("lobby");
    expect(beginGame(room, deps(T0, ids))).toEqual({ ok: false, error: "INVALID_PLAN" });
    const next = unwrap(begin(room, [{ categoryId: "quiz", questionCount: 3, scoring }], deps(T0, ids)));
    expect(next.phase).toBe("intro");
    expect(next.phaseEndsAt).toBe(T0 + INTRO_MS);
    expect(next.game!.scores).toEqual({ [ids[0]!]: 0, [ids[1]!]: 0 });
  });

  it("rejects unknown or duplicate categories and changes while playing", () => {
    const { room, ids } = setupRoom();
    expect(updateSettings(room, [{ categoryId: "nope", questionCount: 3, scoring }]).ok).toBe(false);
    expect(
      updateSettings(room, [
        { categoryId: "quiz", questionCount: 3, scoring },
        { categoryId: "quiz", questionCount: 4, scoring },
      ]).ok,
    ).toBe(false);
    const running = unwrap(begin(room, [{ categoryId: "quiz", questionCount: 3, scoring }], deps(T0, ids)));
    expect(updateSettings(running, [])).toEqual({ ok: false, error: "WRONG_PHASE" });
    expect(beginGame(running, deps(T0, ids))).toEqual({ ok: false, error: "WRONG_PHASE" });
  });

  it("allows empty settings in the lobby but not starting with them", () => {
    const { room, ids } = setupRoom();
    const empty = unwrap(updateSettings(room, []));
    expect(beginGame(empty, deps(T0, ids))).toEqual({ ok: false, error: "INVALID_PLAN" });
  });

  it("needs players", () => {
    const room = unwrap(
      updateSettings(createRoomRecord("ABCD", "host-token-0123456789abcdef", T0), [
        { categoryId: "quiz", questionCount: 3, scoring },
      ]),
    );
    expect(beginGame(room, deps(T0, []))).toEqual({ ok: false, error: "NOT_ENOUGH_PLAYERS" });
  });

  it("clamps question counts and keeps each category's scoring mode", () => {
    const { room } = setupRoom();
    const next = unwrap(
      updateSettings(room, [
        { categoryId: "quiz", questionCount: 999, scoring: { ...scoring, mode: "proximity" } },
        { categoryId: "estimate", questionCount: 1, scoring: { ...scoring, maxPoints: 500 } },
      ]),
    );
    expect(next.settings[0]!.questionCount).toBe(20);
    expect(next.settings[0]!.scoring.mode).toBe("absolute"); // the mode belongs to the category
    expect(next.settings[1]!.questionCount).toBe(3);
    expect(next.settings[1]!.scoring).toMatchObject({ mode: "proximity", maxPoints: 500 });
  });
});

describe("full game flow", () => {
  it("intro → play (questions, reveals) → scoreboard → intro → … → finale → lobby", () => {
    const { room: setup, ids } = setupRoom();
    const [a, b] = ids as [string, string];
    const all = [a, b];
    let room = unwrap(
      begin(
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

    // reveal → leaderboard → Q2 → … → Q3 leaderboard → done (host skips / timeouts).
    for (let i = 0; i < 8; i++) room = unwrap(advance(room, deps((now += 1000), all)));
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

    for (let i = 0; i < 9; i++) room = unwrap(advance(room, deps((now += 1000), all)));
    expect(room.phase).toBe("scoreboard");
    room = unwrap(advance(room, deps((now += 1000), all)));
    expect(room.phase).toBe("finale");
    expect(room.phaseEndsAt).toBe(now + FINALE_MS);
    expect(room.game!.scores[a]).toBe(100);
    expect(publicGame(room, { role: "host" })!.endedEarly).toBe(false);

    // "Zurück zur Lobby": the normal lobby, scores reset, settings + played questions remembered.
    room = unwrap(backToLobby(room, now));
    expect(room.phase).toBe("lobby");
    expect(room.phaseEndsAt).toBeNull();
    expect(room.settings).toHaveLength(2);
    expect(room.game).toBeNull();
    expect(room.usedContentIds).toHaveLength(6);
    expect(room.players).toHaveLength(2);
  });

  it("does not repeat questions in the next game of the same room", () => {
    const { room: setup, ids } = setupRoom();
    const plan = [{ categoryId: "estimate", questionCount: 10, scoring }];
    let room = unwrap(
      begin(setup, plan, deps(T0, ids)));
    room = unwrap(advance(room, deps(T0 + INTRO_MS, ids)));
    const first = new Set(room.usedContentIds);
    room = unwrap(endGame(room, T0 + 10_000));
    expect(room.phase).toBe("lobby");
    room = unwrap(
      begin(room, plan, deps(T0 + 11_000, ids)));
    room = unwrap(advance(room, deps(T0 + 20_000, ids)));
    const second = room.usedContentIds.filter((id) => !first.has(id));
    expect(second).toHaveLength(10);
  });
});

describe("timers, early end and presence", () => {
  function playing() {
    const { room: setup, ids } = setupRoom();
    let room = unwrap(
      begin(setup, [{ categoryId: "quiz", questionCount: 3, scoring }], deps(T0, ids)));
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
    expect(next!.phaseEndsAt).toBe(start + 2000 + REVEAL_ANSWER_MS);
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
    expect(backToLobby(room, T0).ok).toBe(false);
    expect(endGame(room, T0).ok).toBe(false);
  });
});

describe("ending a game: award ceremony, then the lobby", () => {
  const plan: GameRound[] = [
    { categoryId: "quiz", questionCount: 3, scoring },
    { categoryId: "estimate", questionCount: 3, scoring },
  ];

  /** Anna answered Q1 correctly (100), Ben wrong; now in the reveal of Q1. */
  function scored() {
    const { room: lobby, ids } = setupRoom();
    const [a, b] = ids as [string, string];
    let room = unwrap(begin(lobby, plan, deps(T0, ids)));
    let now = T0 + INTRO_MS;
    room = unwrap(advance(room, deps(now, ids)));
    const correct = moduleState(room).questions[0]!.correctIndex;
    room = unwrap(handlePlayerAction(room, a, { type: "answer", value: correct }, deps((now += 1000), ids)));
    room = unwrap(handlePlayerAction(room, b, { type: "answer", value: (correct + 1) % 4 }, deps((now += 1000), ids)));
    return { room, ids: [a, b] as [string, string], now };
  }

  function expectLobbyAfter(room: RoomRecord, ids: readonly string[]) {
    expect(room.phase).toBe("lobby");
    expect(room.phaseEndsAt).toBeNull();
    expect(room.game).toBeNull();
    expect(room.players.map((p) => p.id)).toEqual([...ids]);
    expect(room.settings.map((r) => r.categoryId)).toEqual(["quiz", "estimate"]);
  }

  it("from play: short finale with the current scores, the running question is dropped", () => {
    const { room: reveal, ids, now } = scored();
    // Q2 is running – Ben answers correctly, but the game ends before the reveal.
    let room = unwrap(advance(reveal, deps(now + 1000, ids)));
    room = unwrap(advance(room, deps(now + 2000, ids)));
    expect(moduleState(room).step).toBe("question");
    const correct = moduleState(room).questions[1]!.correctIndex;
    room = unwrap(handlePlayerAction(room, ids[1], { type: "answer", value: correct }, deps(now + 3000, ids)));

    room = unwrap(endGame(room, now + 4000));
    expect(room.phase).toBe("finale");
    expect(room.phaseEndsAt).toBe(now + 4000 + EARLY_FINALE_MS);
    expect(room.game!.moduleState).toBeNull();
    expect(room.game!.scores).toEqual({ [ids[0]]: 100, [ids[1]]: 0 });
    const pub = publicGame(room, { role: "host" })!;
    expect(pub.endedEarly).toBe(true);
    expect(pub.module).toBeNull();
    expect(pub.leaderboard!.map((e) => [e.playerId, e.rankAfter, e.scoreAfter])).toEqual([
      [ids[0], 1, 100],
      [ids[1], 2, 0],
    ]);
    // No actions for the dropped question.
    expect(handlePlayerAction(room, ids[0], { type: "answer", value: 0 }, deps(now + 5000, ids)).ok).toBe(false);

    // Timer (or "Weiter") → lobby.
    expect(isTimerDue(room, now + 4000 + EARLY_FINALE_MS)).toBe(true);
    room = unwrap(advance(room, deps(now + 4000 + EARLY_FINALE_MS, ids)));
    expectLobbyAfter(room, ids);
  });

  it("from the intro and the scoreboard", () => {
    const { room: reveal, ids, now } = scored();
    let room = reveal;
    let t = now;
    while (room.phase !== "scoreboard") room = unwrap(advance(room, deps((t += 1000), ids)));
    const fromScoreboard = unwrap(endGame(room, t));
    expect(fromScoreboard.phase).toBe("finale");
    expect(fromScoreboard.game!.endedEarly).toBe(true);
    expect(publicGame(fromScoreboard, { role: "host" })!.leaderboard![0]).toMatchObject({ playerId: ids[0], pointsGained: 0, scoreAfter: 100 });

    room = unwrap(advance(room, deps((t += 1000), ids)));
    expect(room.phase).toBe("intro");
    const fromIntro = unwrap(endGame(room, t));
    expect(fromIntro.phase).toBe("finale");
    expect(fromIntro.game!.scores[ids[0]]).toBe(100);
    expectLobbyAfter(unwrap(backToLobby(fromIntro, t + 1)), ids);
  });

  it("nobody scored yet: no ceremony, straight to the lobby", () => {
    const { room: lobby, ids } = setupRoom();
    const intro = unwrap(begin(lobby, plan, deps(T0, ids)));
    expectLobbyAfter(unwrap(endGame(intro, T0 + 1000)), ids);
    const play = unwrap(advance(intro, deps(T0 + INTRO_MS, ids)));
    expectLobbyAfter(unwrap(endGame(play, T0 + INTRO_MS + 1000)), ids);
  });

  it("regular finale → lobby by button or after 60 s; the next game starts at 0", () => {
    const { room: reveal, ids, now } = scored();
    let room = reveal;
    let t = now;
    while (room.phase !== "finale") room = unwrap(advance(room, deps((t += 1000), ids)));
    expect(room.game!.endedEarly).toBeUndefined();
    expect(room.phaseEndsAt).toBe(t + FINALE_MS);
    expectLobbyAfter(unwrap(backToLobby(room, t + 1)), ids);
    const lobby = unwrap(advance(room, deps(t + FINALE_MS, ids)));
    expectLobbyAfter(lobby, ids);

    const next = unwrap(beginGame(lobby, deps(t + FINALE_MS + 1000, ids)));
    expect(next.game!.scores).toEqual({ [ids[0]]: 0, [ids[1]]: 0 });
    expect(next.game!.endedEarly).toBeUndefined();
  });

  it("end_game is only possible during a game, back_to_lobby only from the finale", () => {
    const { room: reveal, ids, now } = scored();
    const finale = unwrap(endGame(reveal, now));
    expect(endGame(finale, now)).toEqual({ ok: false, error: "WRONG_PHASE" });
    expect(backToLobby(reveal, now)).toEqual({ ok: false, error: "WRONG_PHASE" });
    const lobby = unwrap(backToLobby(finale, now));
    expect(backToLobby(lobby, now)).toEqual({ ok: false, error: "WRONG_PHASE" });
    expect(updateSettings(lobby, plan).ok).toBe(true);
    expect(updateSettings(finale, plan).ok).toBe(false);
    void ids;
  });

  it("late joiners of the old game play the next game's first question", () => {
    const { room: lobby, ids } = setupRoom();
    let room = unwrap(begin(lobby, plan, deps(T0, ids)));
    room = unwrap(advance(room, deps(T0 + INTRO_MS, ids)));
    const joined = unwrap(joinPlayer(room, { name: "Cleo", avatar }, { now: T0 + INTRO_MS + 1 }));
    expect(joined.player.joinedDuring).toBe("0:0");
    room = unwrap(endGame(joined.room, T0 + INTRO_MS + 2));
    expect(room.phase).toBe("lobby");
    expect(room.players.find((p) => p.id === joined.player.id)!.joinedDuring).toBeUndefined();
  });

  it("rooms stored in the old \"setup\" phase load as the lobby", () => {
    const { room } = setupRoom();
    const stored = { ...room, phase: "setup" } as unknown as RoomRecord;
    const loaded = normalizeRoomRecord(stored);
    expect(loaded.phase).toBe("lobby");
    expect(loaded.game).toBeNull();
    expect(loaded.players).toHaveLength(2);
  });
});

describe("publicGame per viewer", () => {
  it("never contains the correct answer or others' answers during a question", () => {
    const { room: setup, ids } = setupRoom();
    let room = unwrap(
      begin(setup, [{ categoryId: "quiz", questionCount: 3, scoring }], deps(T0, ids)));
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

describe("leaderboard in the public state", () => {
  it("is built after each scored question with before/after ranks", () => {
    const { room: setup, ids } = setupRoom();
    const [a, b] = ids as [string, string];
    let room = unwrap(begin(setup, [{ categoryId: "quiz", questionCount: 3, scoring }], deps(T0, ids)));
    let now = T0 + INTRO_MS;
    room = unwrap(advance(room, deps(now, ids)));
    expect(publicGame(room, { role: "host" })!.leaderboard).toBeNull(); // not during the question

    // Q1: only B correct → B moves up to 1st.
    const correct = moduleState(room).questions[0]!.correctIndex;
    room = unwrap(handlePlayerAction(room, a, { type: "answer", value: (correct + 1) % 4 }, deps(now + 500, ids)));
    room = unwrap(handlePlayerAction(room, b, { type: "answer", value: correct }, deps(now + 1000, ids)));
    const lb = publicGame(room, { role: "player", playerId: a })!.leaderboard!;
    const entry = Object.fromEntries(lb.map((e) => [e.playerId, e]));
    expect(entry[b]).toMatchObject({ scoreBefore: 0, pointsGained: 100, scoreAfter: 100, rankBefore: 1, rankAfter: 1 });
    expect(entry[a]).toMatchObject({ scoreBefore: 0, pointsGained: 0, scoreAfter: 0, rankBefore: 1, rankAfter: 2 });
    // Anna was above Ben before (same score, name order), now below.
    expect([entry[a]!.positionBefore, entry[b]!.positionBefore]).toEqual([0, 1]);
    expect([entry[a]!.positionAfter, entry[b]!.positionAfter]).toEqual([1, 0]);

    // Q2: nobody answers → leaderboard with 0 gains, same order.
    for (let i = 0; i < 3; i++) room = unwrap(advance(room, deps((now += 1000), ids)));
    expect(moduleState(room).step).toBe("reveal");
    const lb2 = publicGame(room, { role: "host" })!.leaderboard!;
    expect(lb2.every((e) => e.pointsGained === 0 && e.rankBefore === e.rankAfter)).toBe(true);
    expect(lb2.find((e) => e.playerId === b)!.scoreBefore).toBe(100);
  });

  it("scoreboard shows the gain of the whole category, finale no gains", () => {
    const { room: setup, ids } = setupRoom();
    const [a] = ids as [string, string];
    let room = unwrap(begin(setup, [{ categoryId: "quiz", questionCount: 3, scoring }], deps(T0, ids)));
    let now = T0 + INTRO_MS;
    room = unwrap(advance(room, deps(now, ids)));
    const correct = moduleState(room).questions[0]!.correctIndex;
    room = unwrap(handlePlayerAction(room, a, { type: "answer", value: correct }, deps(now + 500, [a])));
    while (room.phase === "play") room = unwrap(advance(room, deps((now += 1000), ids)));
    expect(room.phase).toBe("scoreboard");
    const board = publicGame(room, { role: "host" })!.leaderboard!;
    expect(board.find((e) => e.playerId === a)).toMatchObject({ scoreBefore: 0, pointsGained: 100, scoreAfter: 100 });
    room = unwrap(advance(room, deps((now += 1000), ids)));
    expect(room.phase).toBe("finale");
    const final = publicGame(room, { role: "host" })!.leaderboard!;
    expect(final[0]).toMatchObject({ playerId: a, pointsGained: 0, scoreBefore: 100, scoreAfter: 100, rankAfter: 1 });
  });
});
