import { HOST_ACTOR_ID, INTRO_MS, type ScoringSettings } from "@couch-clash/shared";
import { betMeta, doubleMeta, stealMeta } from "@couch-clash/games";
import { describe, expect, it } from "vitest";
import { advance, beginGame, capScoreDelta, handlePlayerAction, publicGame, updateSettings, type FlowDeps } from "../src/game-flow";
import { poolSizesFor } from "../src/pools";
import { progressOf } from "../src/progress";
import type { Result } from "../src/result";
import { createRoomRecord, joinPlayer, type GameRound, type RoomRecord } from "../src/room-logic";
import { detectVoiceEvents } from "../src/voice/director";

const T0 = 1_700_000_000_000;
const avatar = { character: "fox", color: "red" } as const;

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r.value;
}

let seed = 11;
const random = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

function room3() {
  let room = createRoomRecord("ABCD", "host-token-0123456789abcdef", T0);
  const ids: string[] = [];
  for (const name of ["Clara", "Max", "Philip"]) {
    const r = unwrap(joinPlayer(room, { name, avatar }, { now: T0 }));
    room = r.room;
    ids.push(r.player.id);
  }
  return { room, ids };
}

const deps = (now: number, connected: string[]): FlowDeps => ({ now, random, connectedPlayerIds: new Set(connected) });

function start(room: RoomRecord, rounds: GameRound[], ids: string[]) {
  const withSettings = unwrap(updateSettings(room, rounds));
  const intro = unwrap(beginGame(withSettings, deps(T0, ids)));
  return unwrap(advance(intro, deps(T0 + INTRO_MS, ids)));
}

type ModuleView = {
  step: string;
  index: number;
  extra: Record<string, unknown>;
  category: string | null;
};

const view = (room: RoomRecord) => publicGame(room, { role: "host" })!.module as ModuleView;

describe("knowledge games in the room", () => {
  it("risk games are exempt from the global cap", () => {
    expect(capScoreDelta({ a: 350, b: -200 }, { perQuestionCap: 200 }, true)).toEqual({ a: 350, b: -200 });
    expect(capScoreDelta({ a: 350, b: -200 }, { perQuestionCap: 200 })).toEqual({ a: 200, b: -200 });
    for (const meta of [doubleMeta, betMeta, stealMeta]) expect(meta.capExempt).toBe(true);
  });

  it("Bet: the module gets the room's scores; an ALL IN above 200 is not capped; the score stays ≥ 0", () => {
    const { room, ids } = room3();
    const scoring = structuredClone(betMeta.scoring) as ScoringSettings;
    const withSettings = unwrap(updateSettings(room, [{ categoryId: "bet", questionCount: 3, scoring }]));
    let intro = unwrap(beginGame(withSettings, deps(T0, ids)));
    // Clara already has 400 points from an earlier round.
    intro = { ...intro, game: { ...intro.game!, scores: { [ids[0]!]: 400, [ids[1]!]: 0, [ids[2]!]: 0 } } };
    let r = unwrap(advance(intro, deps(T0 + INTRO_MS, ids)));
    expect(view(r).extra.maxWagers).toEqual({ [ids[0]!]: 400, [ids[1]!]: 100, [ids[2]!]: 100 });
    expect(view(r).step).toBe("wager");
    for (const [id, amount] of [[ids[0]!, 400], [ids[1]!, 100], [ids[2]!, 50]] as const) {
      r = unwrap(handlePlayerAction(r, id, { type: "wager", amount }, deps(T0 + 5000, ids)));
    }
    expect(view(r).step).toBe("question");
    const state = r.game!.moduleState as { questions: { correctIndex: number }[] };
    const correct = state.questions[0]!.correctIndex;
    r = unwrap(handlePlayerAction(r, ids[0]!, { type: "answer", value: correct }, deps(T0 + 6000, ids)));
    r = unwrap(handlePlayerAction(r, ids[1]!, { type: "answer", value: (correct + 1) % 4 }, deps(T0 + 6000, ids)));
    r = unwrap(handlePlayerAction(r, ids[2]!, { type: "answer", value: (correct + 1) % 4 }, deps(T0 + 6000, ids)));
    expect(view(r).step).toBe("reveal");
    expect(r.game!.scores).toEqual({ [ids[0]!]: 800, [ids[1]!]: 0, [ids[2]!]: 0 });
    expect(r.game!.questionLeaderboard!.find((e) => e.playerId === ids[0])!.pointsGained).toBe(400);
  });

  it("Punkteklau: the target comes from the room's totals", () => {
    const { room, ids } = room3();
    const scoring = structuredClone(stealMeta.scoring) as ScoringSettings;
    const withSettings = unwrap(updateSettings(room, [{ categoryId: "steal", questionCount: 3, scoring }]));
    let intro = unwrap(beginGame(withSettings, deps(T0, ids)));
    intro = { ...intro, game: { ...intro.game!, scores: { [ids[0]!]: 0, [ids[1]!]: 1500, [ids[2]!]: 300 } } };
    const r = unwrap(advance(intro, deps(T0 + INTRO_MS, ids)));
    expect(view(r).extra).toMatchObject({ targetIds: [ids[1]], targetScore: 1500 });
  });

  it("Kategorienvorgabe with the host picking: the host screen's action reaches the module", () => {
    const { room, ids } = room3();
    const scoring = { mode: "absolute", maxPoints: 100, speedModifier: { enabled: false, fastestMultiplier: 1.5, slowestMultiplier: 0.5 } } as ScoringSettings;
    let r = start(room, [{ categoryId: "category-pick", questionCount: 3, scoring, options: { hostPicks: true } }], ids);
    expect(view(r).step).toBe("pick");
    const offer = view(r).extra.offer as string[];
    expect(handlePlayerAction(r, ids[0]!, { type: "pick", category: offer[0] }, deps(T0 + 5000, ids))).toEqual({ ok: false, error: "NOT_AUTHORIZED" });
    r = unwrap(handlePlayerAction(r, HOST_ACTOR_ID, { type: "pick", category: offer[0] }, deps(T0 + 5000, ids)));
    expect(view(r).step).toBe("question");
    expect(view(r).category).toBe(offer[0]);
  });

  it("statistics, ratings and reports of every knowledge game are kept under 'quiz'", () => {
    const { room, ids } = room3();
    const scoring = structuredClone(doubleMeta.scoring) as ScoringSettings;
    let r = start(room, [{ categoryId: "double-or-nothing", questionCount: 3, scoring }], ids);
    r = unwrap(advance(r, deps(T0 + 20_000, ids))); // question 1 (no choice before it) → the reveal
    const p = progressOf(r)!;
    expect(p.categoryId).toBe("double-or-nothing");
    expect(p.contentCategoryId).toBe("quiz");
    expect(p.contentId).toBeTruthy();
  });

  it("pool sizes: the new games share the quiz pool", () => {
    const sizes = poolSizesFor({ mode: "kids", allow16: false, difficulty: "mixed" });
    for (const id of ["category-pick", "double-or-nothing", "bet", "steal"]) expect(sizes[id]).toBe(sizes.quiz);
    expect(sizes.quiz).toBeGreaterThan(250);
  });

  it("the host reads the explanation on the intro card of a new game", () => {
    const { room, ids } = room3();
    const withSettings = unwrap(
      updateSettings(room, [
        { categoryId: "quiz", questionCount: 3, scoring: structuredClone(doubleMeta.scoring) as ScoringSettings },
        { categoryId: "bet", questionCount: 3, scoring: structuredClone(betMeta.scoring) as ScoringSettings },
      ]),
    );
    const intro = unwrap(beginGame(withSettings, deps(T0, ids)));
    expect(detectVoiceEvents(withSettings, intro).map((e) => e.type)).toEqual(["game_start", "intro"]);
    const scoreboard = { ...intro, phase: "scoreboard" as const };
    const next = unwrap(advance(scoreboard, deps(T0 + 1, ids)));
    expect(detectVoiceEvents(scoreboard, next)).toEqual([{ type: "intro", roundIndex: 1 }]);
  });
});
