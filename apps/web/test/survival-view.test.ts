import { SURVIVAL_PHASES, type SurvivalPublicPlayer, type SurvivalPublicState } from "@couch-clash/games/meta";
import { describe, expect, it } from "vitest";
import {
  conversionValue,
  isFinalTwo,
  isFreshElimination,
  laneGrow,
  laneSize,
  liveScores,
  moodFor,
  survivalAudio,
  survivalSkipLabel,
  timeZone,
  visualHeight,
  zoneText,
} from "../src/games/survival/logic";

const T0 = 1_700_000_000_000;
const P1 = SURVIVAL_PHASES[0]!;
const DEATH = SURVIVAL_PHASES[3]!;

function player(id: string, over: Partial<SurvivalPublicPlayer> = {}): SurvivalPublicPlayer {
  return {
    id,
    lane: 0,
    mainScore: 0,
    startScore: 1200,
    score: 1200,
    danger: "SAFE",
    eliminated: false,
    eliminatedAt: null,
    eliminatedQuestion: null,
    answered: false,
    decayApplied: 0,
    change: null,
    ...over,
  };
}

function state(over: Partial<SurvivalPublicState> = {}): SurvivalPublicState {
  return {
    step: "question",
    stepStartedAt: T0,
    stepEndsAt: T0 + 20_000,
    phaseIndex: 0,
    phase: P1,
    questionsPlayed: 0,
    suddenDeaths: 0,
    players: [player("a"), player("b", { score: 340, startScore: 500 })],
    question: {
      number: 1,
      text: "?",
      options: ["a", "b", "c", "d"],
      startedAt: T0,
      bonusUntil: T0 + 5000,
      decayFrom: T0 + 10_000,
      timeoutAt: T0 + 20_000,
      phase: P1,
      aliveAtStart: ["a", "b"],
    },
    myAnswer: null,
    reveal: null,
    tiebreak: null,
    winnerId: null,
    solo: false,
    ranking: null,
    events: [],
    rules: { wrongAnswerPenalty: 200, scoreDecayPerSecond: 10, moderatorCaptions: false, danger: { warning: 3, critical: 2, imminent: 1 } },
    ...over,
  };
}

describe("visual survival position (never the game score itself)", () => {
  it("0 is the slime, the best start is near the top, more points = higher", () => {
    expect(visualHeight(0, 1200)).toBe(0);
    expect(visualHeight(-40, 1200)).toBe(0);
    const heights = [50, 200, 400, 800, 1200].map((s) => visualHeight(s, 1200));
    for (let i = 1; i < heights.length; i++) expect(heights[i]!).toBeGreaterThan(heights[i - 1]!);
    expect(heights.at(-1)!).toBeLessThanOrEqual(1);
    expect(heights.at(-1)!).toBeGreaterThan(0.9);
  });

  it("the low end is stretched: the last 200 points above the slime get more room than a linear bar", () => {
    expect(visualHeight(200, 1200)).toBeGreaterThan(200 / 1200 + 0.1);
    // −10 near the slime moves visibly more than −10 near the top.
    const low = visualHeight(100, 1200) - visualHeight(90, 1200);
    const high = visualHeight(1100, 1200) - visualHeight(1090, 1200);
    expect(low).toBeGreaterThan(high * 2);
  });
});

describe("live display between server ticks", () => {
  it("unanswered players count down with the rule's formula; answered and eliminated ones stand still", () => {
    const s = state({ players: [player("a", { answered: true, score: 1250 }), player("b", { score: 340 })] });
    expect(liveScores(s, T0 + 9_000)).toEqual({ a: 1250, b: 340 });
    expect(liveScores(s, T0 + 13_500)).toEqual({ a: 1250, b: 310 });
    // The server already booked 20 of it: no double deduction.
    const booked = state({ players: [player("a"), player("b", { score: 320, decayApplied: 20 })] });
    expect(liveScores(booked, T0 + 13_500).b).toBe(310);
    expect(liveScores(state({ step: "reveal" }), T0 + 19_000).b).toBe(340);
  });
});

describe("clock zones (phones + TV)", () => {
  const q = state().question!;
  it("bonus → neutral → −10 per second → over, with the matching hints", () => {
    expect([T0 + 1000, T0 + 5000, T0 + 7000, T0 + 10_000, T0 + 10_001, T0 + 20_000].map((t) => timeZone(q, t))).toEqual([
      "bonus",
      "bonus",
      "neutral",
      "neutral",
      "decay",
      "over",
    ]);
    expect(zoneText("bonus", q, 10)).toBe("SCHNELLANTWORT +50");
    expect(zoneText("decay", q, 10)).toBe("−10 PRO SEKUNDE");
  });
  it("DEATH MODE: no speed bonus hint – the drain instead", () => {
    const death = { ...q, phase: DEATH, bonusUntil: T0 + 2000, decayFrom: T0 + 4000, timeoutAt: T0 + 8000 };
    expect(timeZone(death, T0 + 1000)).toBe("neutral");
    expect(zoneText("neutral", death, 10)).toContain("−50");
  });
});

describe("show", () => {
  it("moods follow danger and the last answer", () => {
    expect(moodFor(player("a"))).toBe("confident");
    expect(moodFor(player("a", { danger: "ELIMINATION_IMMINENT" }))).toBe("panic");
    expect(moodFor(player("a", { change: { bonus: 50, decay: 0, penalty: 0, drain: 0, total: 50 } }))).toBe("cheering");
    expect(moodFor(player("a", { change: { bonus: 0, decay: 0, penalty: 200, drain: 0, total: -200 } }))).toBe("shocked");
    expect(moodFor(player("a", { eliminated: true }))).toBe("gone");
  });

  it("final two: two big lanes, the eliminated step back; sizes by player count", () => {
    const s = state({ players: [player("a"), player("b"), player("c", { eliminated: true, eliminatedAt: T0 })] });
    expect(isFinalTwo(s)).toBe(true);
    expect(isFinalTwo(state())).toBe(false);
    expect(laneGrow(player("a"), true)).toBeGreaterThan(laneGrow(player("c", { eliminated: true }), true) * 4);
    expect([2, 4, 6, 9].map((n) => laneSize(n, false))).toEqual(["xl", "lg", "md", "sm"]);
  });

  it("splashes only for fresh eliminations (a reloaded TV doesn't replay them)", () => {
    expect(isFreshElimination(T0, T0 + 1000)).toBe(true);
    expect(isFreshElimination(T0, T0 + 10_000)).toBe(false);
    expect(isFreshElimination(null, T0)).toBe(false);
  });

  it("the host can't skip a running question; music per step", () => {
    expect(survivalSkipLabel(state())).toBeNull();
    expect(survivalSkipLabel(state({ step: "reveal" }))).toBe("Weiter ⏭");
    expect(survivalAudio(state())?.music).toBe("think");
    expect(survivalAudio(state({ step: "winner" }))).toMatchObject({ music: null });
    expect(survivalAudio(state({ step: "winner" }))?.enter).toBeUndefined();
  });

  it("intro count from main-game points to life energy", () => {
    expect(conversionValue(2000, 1200, 0)).toBe(2000);
    expect(conversionValue(2000, 1200, 1)).toBe(1200);
    expect(conversionValue(90, 250, 0.5)).toBeGreaterThan(90);
  });
});
