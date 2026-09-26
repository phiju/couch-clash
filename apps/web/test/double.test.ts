import type { DoubleExtra, DoublePlayerView } from "@couch-clash/games/meta";
import { describe, expect, it } from "vitest";
import {
  flames,
  isSidelined,
  levelLabel,
  levelWarning,
  outLabel,
  potMoment,
  potReaction,
  sidelinedText,
  stakeText,
  type DoubleState,
} from "../src/games/double/logic";

const view = (over: Partial<DoublePlayerView> = {}): DoublePlayerView => ({
  pot: 300,
  status: "active",
  potBefore: 300,
  banked: null,
  lost: 0,
  auto: false,
  ...over,
});

function state(step: DoubleState["step"], extra: Partial<DoubleExtra> = {}, over: Partial<DoubleState> = {}): DoubleState {
  return {
    step,
    index: 2,
    total: 5,
    stepStartedAt: 0,
    questionStartedAt: 0,
    stepEndsAt: 0,
    category: null,
    question: null,
    answeredPlayerIds: [],
    actedPlayerIds: [],
    myAnswer: null,
    reveal: null,
    extra: {
      level: 3,
      maxLevel: 5,
      players: {
        a: view(),
        b: view({ status: "cashed_out", banked: 100, pot: 100, potBefore: 100 }),
        c: view({ status: "busted", pot: 0, lost: 100, potBefore: 0 }),
      },
      decisions: null,
      myDecision: null,
      points: { bonus: 100 },
      ...extra,
    },
    ...over,
  };
}

const reveal = (results: string[]) => ({
  correctIndex: 0,
  answers: {},
  results: Object.fromEntries(results.map((id) => [id, { baseScore: 0, speedModifier: 1, finalScore: 0, correct: true, answered: true }])),
});

describe("Double or Nothing on the TV and phones", () => {
  it("level: flames, label, a warning from level 4 on", () => {
    expect(flames(3)).toEqual([true, true, true, false, false]);
    expect(levelLabel(1)).toBe("Stufe 1 · leicht");
    expect(levelLabel(5)).toBe("Stufe 5 · sehr schwer");
    expect(levelWarning(3, false)).toBeNull();
    expect(levelWarning(4, false)).toContain("fies");
    expect(levelWarning(5, true)).toContain("knifflig");
  });

  it("what's at stake before the choice: current pot → possible pot", () => {
    expect(stakeText(0, 100)).toBe("0 → 100");
    expect(stakeText(700, 100)).toBe("700 → 1.500");
    expect(stakeText(1500, 100)).toBe("1.500 → 3.100");
  });

  it("out of the round: greyed out with 'kassiert: X' or 'pleite'", () => {
    expect(outLabel(view({ status: "cashed_out", banked: 700 }))).toBe("kassiert: 700");
    expect(outLabel(view({ status: "busted" }))).toBe("pleite");
    expect(potReaction("out", view({ status: "busted" }))).toMatchObject({ dimmed: true, expression: "enttaeuscht" });
    expect(potReaction("out", view({ status: "cashed_out" }))).toMatchObject({ dimmed: true, highlight: false });
    expect(potReaction("deciding", view())).toMatchObject({ dimmed: false, highlight: true });
  });

  it("moments: the choice stays hidden until the showdown", () => {
    const decide = state("decide", {}, { actedPlayerIds: ["a"] });
    expect(potMoment(decide, "a")).toBe("decided");
    expect(potMoment(decide, "b")).toBe("out");
    expect(potMoment(decide, "x")).toBe("watch");
    const showdown = state("showdown", { decisions: { a: "bet", b: "cash" }, players: { ...decide.extra.players, b: view({ status: "cashed_out", banked: 300 }) } });
    expect(potMoment(showdown, "a")).toBe("bet");
    expect(potMoment(showdown, "b")).toBe("cash");
    expect(potMoment(showdown, "c")).toBe("out");
    expect(potReaction("cash", view()).expression).toBe("jubelnd");
  });

  it("reveal: the pot grows for winners, bursts for losers (disappointed face)", () => {
    const s = state("reveal", {
      players: { a: view({ pot: 700, potBefore: 300 }), c: view({ status: "busted", pot: 0, lost: 300, potBefore: 300 }) },
    }, { reveal: reveal(["a", "c"]) });
    expect(potMoment(s, "a")).toBe("won");
    expect(potMoment(s, "c")).toBe("busted");
    expect(potReaction("busted", s.extra.players.c).expression).toBe("enttaeuscht");
    expect(potReaction("won", s.extra.players.a).expression).toBe("jubelnd");
  });

  it("phones: players who are out only see their status, no input", () => {
    const q = state("question");
    expect(isSidelined(q, "a")).toBe(false);
    expect(isSidelined(q, "b")).toBe(true);
    expect(isSidelined(q, "c")).toBe(true);
    expect(isSidelined(q, "late")).toBe(true);
    expect(isSidelined(state("decide"), "b")).toBe(true);
    // The moment itself is still theirs: just cashed out, just busted.
    expect(isSidelined(state("showdown", { decisions: { b: "cash" } }), "b")).toBe(false);
    expect(isSidelined(state("reveal", {}, { reveal: reveal(["c"]) }), "c")).toBe(false);
    expect(sidelinedText(view({ status: "cashed_out", banked: 700 })).title).toBe("Du hast 700 Punkte kassiert");
    expect(sidelinedText(view({ status: "busted" })).emoji).toBe("💥");
  });
});
