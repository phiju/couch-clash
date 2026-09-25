import { CONNECTION_CONFIG, type ScoringSettings } from "@couch-clash/shared";
import { GAME_MODULES } from "@couch-clash/games";
import { describe, expect, it } from "vitest";
import {
  advance,
  beginGame,
  endGame,
  handlePlayerAction,
  handlePresenceChange,
  publicGame,
  updateSettings,
  type FlowDeps,
} from "../src/game-flow";
import type { Result } from "../src/result";
import {
  authenticatePlayer,
  claimSeat,
  createRoomRecord,
  effectivePresence,
  endGrace,
  expireGrace,
  joinPlayer,
  kickPlayer,
  nextGraceDeadline,
  normalizeRoomRecord,
  startGrace,
  toPublicState,
  type RoomRecord,
} from "../src/room-logic";

const T0 = 1_700_000_000_000;
const GRACE = CONNECTION_CONFIG.graceMs;
const avatar = { character: "fox", color: "red" } as const;
const scoring: ScoringSettings = {
  mode: "absolute",
  maxPoints: 100,
  speedModifier: { enabled: false, fastestMultiplier: 1.5, slowestMultiplier: 0.5 },
};

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r.value;
}

let n = 0;
const secret = () => `secret-${++n}-0123456789abcdef0123`;
const random = () => 0.42;
const deps = (now: number, connected: Iterable<string>): FlowDeps => ({ now, random, connectedPlayerIds: new Set(connected) });

type QState = { step: string; index: number; questions: { correctIndex: number }[] };
const q = (room: RoomRecord) => room.game!.moduleState as QState;

/** Anna, Ben, Clara playing the quiz (first question open). */
function playing(names = ["Anna", "Ben", "Clara"]) {
  let room = createRoomRecord("ABCD", "host-token-0123456789abcdef", T0);
  const ids: string[] = [];
  for (const name of names) {
    const r = unwrap(joinPlayer(room, { name, avatar }, { now: T0, secret }));
    room = r.room;
    ids.push(r.player.id);
  }
  room = unwrap(updateSettings(room, [{ categoryId: "quiz", questionCount: 5, scoring }]));
  room = unwrap(beginGame(room, deps(T0, ids)));
  room = unwrap(advance(room, deps(T0 + 1000, ids)));
  return { room, ids, start: T0 + 1000 };
}

const answer = (room: RoomRecord, id: string, now: number, connected: Iterable<string>, correct = true) => {
  const s = q(room);
  const right = s.questions[s.index]!.correctIndex;
  return handlePlayerAction(room, id, { type: "answer", value: correct ? right : (right + 1) % 4 }, deps(now, connected));
};

describe("grace period", () => {
  it("a dropped player still counts as connected for 20 s, then not", () => {
    const { room, ids } = playing();
    const [a, b, c] = ids as [string, string, string];
    const dropped = startGrace(room, c, T0, GRACE);
    expect(effectivePresence(dropped, new Set([a, b]), T0 + GRACE - 1)).toEqual(new Set([a, b, c]));
    expect(effectivePresence(dropped, new Set([a, b]), T0 + GRACE)).toEqual(new Set([a, b]));
    expect(nextGraceDeadline(dropped)).toBe(T0 + GRACE);
    expect(expireGrace(dropped, T0 + GRACE - 1)).toBeNull();
    expect(expireGrace(dropped, T0 + GRACE)!.graceUntil).toEqual({});
    // Back online or removed: no grace left.
    expect(endGrace(dropped, c).graceUntil).toEqual({});
    expect(unwrap(kickPlayer(dropped, c)).graceUntil).toEqual({});
  });

  it("a short blip never ends a question early; after the grace the others don't wait", () => {
    const { room, ids, start } = playing();
    const [a, b, c] = ids as [string, string, string];
    let r = unwrap(answer(room, a, start + 1000, ids));
    r = unwrap(answer(r, b, start + 1500, ids));
    expect(q(r).step).toBe("question"); // waiting for Clara
    // Clara's phone drops: within the grace she still counts – nothing happens.
    const dropped = startGrace(r, c, start + 2000, GRACE);
    const during = effectivePresence(dropped, new Set([a, b]), start + 5000);
    expect(handlePresenceChange(dropped, deps(start + 5000, during))).toBeNull();
    // Grace over: all CONNECTED players answered → reveal.
    const over = expireGrace(dropped, start + 2000 + GRACE)!;
    const after = effectivePresence(over, new Set([a, b]), start + 2000 + GRACE);
    expect(q(handlePresenceChange(over, deps(start + 2000 + GRACE, after))!).step).toBe("reveal");
  });

  it("a player who is back while the question is open can still answer", () => {
    const { room, ids, start } = playing();
    const [a, b, c] = ids as [string, string, string];
    const dropped = startGrace(unwrap(answer(room, a, start + 1000, ids)), c, start + 1500, GRACE);
    const back = endGrace(dropped, c);
    const r = unwrap(answer(back, c, start + 3000, [a, b, c]));
    expect(r.game!.moduleState).toBeTruthy();
    expect(unwrap(answer(r, b, start + 3500, [a, b, c])).game!.questionLeaderboard).not.toBeNull();
  });
});

describe("claiming a seat (\"Ich war schon dabei\")", () => {
  it("only seats without an open connection; rotates the secret, keeps id, score and avatar", () => {
    const { room, ids } = playing();
    const [a, , c] = ids as [string, string, string];
    const scored = { ...room, game: { ...room.game!, scores: { ...room.game!.scores, [c]: 300 } } };
    expect(claimSeat(scored, a, new Set([a]), { now: T0, secret })).toEqual({ ok: false, error: "SEAT_TAKEN" });
    expect(claimSeat(scored, "nobody", new Set(), { now: T0, secret })).toEqual({ ok: false, error: "UNKNOWN_PLAYER" });
    const old = scored.players.find((p) => p.id === c)!;
    const { room: claimed, player } = unwrap(claimSeat(scored, c, new Set([a]), { now: T0, secret }));
    expect(player.id).toBe(c);
    expect(player.secret).not.toBe(old.secret);
    expect(player.avatar).toEqual(old.avatar);
    expect(claimed.game!.scores[c]).toBe(300);
    expect(claimed.players).toHaveLength(3);
    // The old secret is invalid, the new one works.
    expect(authenticatePlayer(claimed, c, old.secret)).toEqual({ ok: false, error: "UNKNOWN_PLAYER" });
    expect(authenticatePlayer(claimed, c, player.secret).ok).toBe(true);
  });

  it("guests see which seats are free: online vs. connected (grace)", () => {
    const { room, ids } = playing();
    const [a, b, c] = ids as [string, string, string];
    const dropped = startGrace(room, c, T0, GRACE);
    const state = toPublicState(
      dropped,
      { host: true, playerIds: effectivePresence(dropped, new Set([a, b]), T0 + 1000), online: new Set([a, b]) },
      { role: "guest" },
    );
    expect(state.players.map((p) => [p.name, p.connected, p.online])).toEqual([
      ["Anna", true, true],
      ["Ben", true, true],
      ["Clara", true, false], // in the grace period: still "connected", but claimable
    ]);
    expect(state.lateJoin).toBe(true);
  });
});

describe("late join", () => {
  it("0 points, waits for the next question, doesn't block the running one", () => {
    const { room, ids, start } = playing(["Anna", "Ben"]);
    const [a, b] = ids as [string, string];
    const { room: joined, player: tina, late } = unwrap(joinPlayer(room, { name: "Tina", avatar }, { now: start + 500, secret }));
    expect(late).toBe(true);
    expect(joined.game!.scores[tina.id]).toBe(0);
    expect(publicGame(joined, { role: "host" })!.waitingPlayerIds).toEqual([tina.id]);
    const all = [a, b, tina.id];
    // Not in this question: can't answer, and the others don't wait for her.
    expect(answer(joined, tina.id, start + 1000, all)).toEqual({ ok: false, error: "UNKNOWN_PLAYER" });
    let r = unwrap(answer(joined, a, start + 1000, all));
    r = unwrap(answer(r, b, start + 1500, all));
    expect(q(r).step).toBe("reveal");
    // Next question: she plays.
    r = unwrap(advance(r, deps(start + 10_000, all)));
    r = unwrap(advance(r, deps(start + 15_000, all)));
    expect(q(r).step).toBe("question");
    expect(q(r).index).toBe(1);
    expect(publicGame(r, { role: "host" })!.waitingPlayerIds).toEqual([]);
    expect(r.players.find((p) => p.id === tina.id)!.joinedDuring).toBeUndefined();
    r = unwrap(answer(r, tina.id, start + 16_000, all));
    r = unwrap(answer(r, a, start + 16_500, all, false));
    r = unwrap(answer(r, b, start + 17_000, all, false));
    expect(r.game!.scores[tina.id]).toBe(100);
  });

  it("joining between rounds plays from the next round; the phone sees the game", () => {
    const { room, ids } = playing(["Anna", "Ben"]);
    const scoreboard = { ...room, phase: "scoreboard" as const };
    const { room: joined, player } = unwrap(joinPlayer(scoreboard, { name: "Tina", avatar }, { now: T0, secret }));
    expect(player.joinedDuring).toBeUndefined();
    expect(joined.game!.scores[player.id]).toBe(0);
    const state = toPublicState(joined, { host: true, playerIds: new Set([...ids, player.id]) }, { role: "player", playerId: player.id });
    expect(state.game!.scores[player.id]).toBe(0);
  });
});

describe("every game survives players it has never seen", () => {
  for (const [id, module] of Object.entries(GAME_MODULES)) {
    it(`${id}: a player without history can look at every step`, () => {
      const players = [
        { id: "a", connected: true },
        { id: "b", connected: true },
      ];
      const ctx = (now: number, extra = false) => ({
        now,
        random,
        players: extra ? [...players, { id: "newbie", connected: true }] : players,
        scores: { a: 100, b: 50 },
      });
      let now = T0;
      let update = module.init(ctx(now), { questionCount: 3, scoring: module.meta.scoring, excludeContentIds: [] });
      for (let step = 0; step < 60 && !update.done; step++) {
        const state = update.state;
        expect(() => module.toPublicState(state, { role: "player", playerId: "newbie" })).not.toThrow();
        expect(() => module.onPlayersChanged?.(state, ctx(now, true))).not.toThrow();
        now = (update.phaseEndsAt ?? now) + 1;
        update = module.onTimer(state, ctx(now, step > 5));
      }
    });
  }
});

describe("persistence (Durable Object storage)", () => {
  it("players, secrets, scores, phase and grace periods survive a restart", () => {
    const { room, ids } = playing();
    const withGrace = startGrace(room, ids[2]!, T0, GRACE);
    // Storage keeps a structured clone; JSON is stricter and must round-trip too.
    const restored = normalizeRoomRecord(JSON.parse(JSON.stringify(withGrace)) as RoomRecord);
    expect(restored).toEqual(withGrace);
  });

  it("rooms stored before this version get late join on and no grace periods", () => {
    const { room } = playing();
    const old: Partial<RoomRecord> = { ...room };
    delete old.lateJoin;
    delete old.graceUntil;
    const restored = normalizeRoomRecord(old as RoomRecord);
    expect(restored.lateJoin).toBe(true);
    expect(restored.graceUntil).toEqual({});
  });
});

describe("host reload / rejoin during the early finale", () => {
  it("the restored room still shows the ceremony with the current scores, then goes to the lobby", () => {
    const { room: open, ids, start } = playing();
    const [a, b, c] = ids as [string, string, string];
    let room = unwrap(answer(open, a, start + 500, ids));
    room = unwrap(answer(room, b, start + 600, ids, false));
    room = unwrap(answer(room, c, start + 700, ids, false));
    room = unwrap(endGame(room, start + 1000));
    expect(room.phase).toBe("finale");

    // Durable Object restarted / host screen reloaded: state comes from storage.
    const restored = normalizeRoomRecord(JSON.parse(JSON.stringify(room)) as RoomRecord);
    const host = toPublicState(restored, { host: true, playerIds: new Set(ids) }, { role: "host" });
    expect(host.phase).toBe("finale");
    expect(host.phaseEndsAt).toBe(room.phaseEndsAt);
    expect(host.game!.endedEarly).toBe(true);
    expect(host.game!.leaderboard!.map((e) => e.playerId)[0]).toBe(a);

    // A phone that reconnects sees its place as well.
    const phone = toPublicState(restored, { host: true, playerIds: new Set(ids) }, { role: "player", playerId: b });
    expect(phone.game!.leaderboard!.find((e) => e.playerId === b)!.rankAfter).toBe(2);

    // Timer → lobby with everyone still in.
    const lobby = unwrap(advance(restored, deps(restored.phaseEndsAt!, ids)));
    expect(lobby.phase).toBe("lobby");
    expect(lobby.players.map((p) => p.id)).toEqual(ids);
    expect(authenticatePlayer(lobby, b, restored.players[1]!.secret).ok).toBe(true);
  });
});
