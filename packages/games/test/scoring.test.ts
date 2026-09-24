import type { ScoringSettings } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import {
  calculateBaseScore,
  calculateFinalScore,
  calculateSpeedModifier,
  normalizeScoring,
  scoreAnswer,
} from "../src/scoring";
import { estimateMeta } from "../src/estimate/meta";
import { quizMeta } from "../src/quiz/meta";

const LIMIT = 20_000;
const SPEED_ON = { enabled: true, fastestMultiplier: 1.5, slowestMultiplier: 0.5 };
const SPEED_OFF = { ...SPEED_ON, enabled: false };
const absolute = (speed = SPEED_OFF): ScoringSettings => ({ mode: "absolute", maxPoints: 100, speedModifier: speed });
const proximity = (speed = SPEED_OFF): ScoringSettings => ({ mode: "proximity", maxPoints: 100, speedModifier: speed });
const at = (seconds: number) => ({ responseTimeMs: seconds * 1000, timeLimitMs: LIMIT });

describe("base score: absolute", () => {
  it("correct → maxPoints, wrong → 0", () => {
    expect(calculateBaseScore("absolute", { correct: true }, 100)).toBe(100);
    expect(calculateBaseScore("absolute", { correct: false }, 100)).toBe(0);
    expect(calculateBaseScore("absolute", { correct: true }, 250)).toBe(250);
  });

  it("without speed modifier: final = base, response time does not matter", () => {
    expect(scoreAnswer(absolute(), { correct: true }, at(2))).toEqual({ baseScore: 100, speedModifier: 1, finalScore: 100 });
    expect(scoreAnswer(absolute(), { correct: true }, at(19))).toEqual({ baseScore: 100, speedModifier: 1, finalScore: 100 });
    expect(scoreAnswer(absolute(), { correct: false }, at(1))).toEqual({ baseScore: 0, speedModifier: 1, finalScore: 0 });
  });

  it("with speed modifier: correct at 2 s → 140, at 20 s → 50, wrong → 0", () => {
    expect(scoreAnswer(absolute(SPEED_ON), { correct: true }, at(2)).finalScore).toBe(140);
    expect(scoreAnswer(absolute(SPEED_ON), { correct: true }, at(20)).finalScore).toBe(50);
    expect(scoreAnswer(absolute(SPEED_ON), { correct: false }, at(2)).finalScore).toBe(0);
  });
});

describe("speed modifier (time-limit scale)", () => {
  it("20 s limit: 0 → 1.50 · 2 → 1.40 · 5 → 1.25 · 10 → 1.00 · 15 → 0.75 · 20 → 0.50", () => {
    const table: [number, number][] = [
      [0, 1.5],
      [2, 1.4],
      [5, 1.25],
      [10, 1.0],
      [15, 0.75],
      [20, 0.5],
    ];
    for (const [s, expected] of table) expect(calculateSpeedModifier(s * 1000, LIMIT, SPEED_ON)).toBe(expected);
  });

  it("disabled → always 1.0", () => {
    expect(calculateSpeedModifier(0, LIMIT, SPEED_OFF)).toBe(1);
    expect(calculateSpeedModifier(20_000, LIMIT, SPEED_OFF)).toBe(1);
  });

  it("at or after the limit → slowestMultiplier; negative times clamp to fastest", () => {
    expect(calculateSpeedModifier(20_000, LIMIT, SPEED_ON)).toBe(0.5);
    expect(calculateSpeedModifier(25_000, LIMIT, SPEED_ON)).toBe(0.5);
    expect(calculateSpeedModifier(-50, LIMIT, SPEED_ON)).toBe(1.5);
    expect(calculateSpeedModifier(Number.NaN, LIMIT, SPEED_ON)).toBe(0.5);
  });

  it("custom multipliers", () => {
    const s = { enabled: true, fastestMultiplier: 2, slowestMultiplier: 1 };
    expect(calculateSpeedModifier(10_000, LIMIT, s)).toBe(1.5);
  });

  it("same response time → identical modifier, independent of other players", () => {
    const a = calculateSpeedModifier(2000, LIMIT, SPEED_ON);
    const b = calculateSpeedModifier(2300, LIMIT, SPEED_ON);
    expect(calculateSpeedModifier(2000, LIMIT, SPEED_ON)).toBe(a);
    // 2.0 s vs 2.3 s is nearly the same – not ×1.5 vs ×0.5 like a relative scale.
    expect(a).toBe(1.4);
    expect(b).toBe(1.39);
  });
});

describe("base score: proximity", () => {
  it("Eiffel Tower 330 m (zeroRange = 100 % of the answer)", () => {
    const table: [number, number][] = [
      [330, 100],
      [320, 97],
      [300, 91],
      [250, 76],
      [410, 76],
      [660, 0],
      [0, 0],
      [5000, 0],
    ];
    for (const [answer, expected] of table) {
      expect(calculateBaseScore("proximity", { answer, correctAnswer: 330 }, 100), `answer ${answer}`).toBe(expected);
    }
  });

  it("zeroRange override: Apollo 11 (1969, 50 years) and 0 °C (20)", () => {
    expect(calculateBaseScore("proximity", { answer: 1960, correctAnswer: 1969, zeroRange: 50 }, 100)).toBe(82);
    expect(calculateBaseScore("proximity", { answer: 1900, correctAnswer: 1969, zeroRange: 50 }, 100)).toBe(0);
    expect(calculateBaseScore("proximity", { answer: 5, correctAnswer: 0, zeroRange: 20 }, 100)).toBe(75);
  });

  it("exact hit → maxPoints; error ≥ zeroRange → 0, never negative", () => {
    expect(calculateBaseScore("proximity", { answer: 42.195, correctAnswer: 42.195 }, 100)).toBe(100);
    expect(calculateBaseScore("proximity", { answer: 1919, correctAnswer: 1969, zeroRange: 50 }, 100)).toBe(0);
    expect(calculateBaseScore("proximity", { answer: 2019, correctAnswer: 1969, zeroRange: 50 }, 100)).toBe(0);
    expect(calculateBaseScore("proximity", { answer: -1e9, correctAnswer: 330 }, 100)).toBe(0);
  });

  it("too high and too low are treated the same", () => {
    expect(calculateBaseScore("proximity", { answer: 250, correctAnswer: 330 }, 100)).toBe(
      calculateBaseScore("proximity", { answer: 410, correctAnswer: 330 }, 100),
    );
  });

  it("invalid answers (NaN, Infinity) count as no answer", () => {
    expect(calculateBaseScore("proximity", { answer: Number.NaN, correctAnswer: 330 }, 100)).toBe(0);
    expect(calculateBaseScore("proximity", { answer: Infinity, correctAnswer: 330 }, 100)).toBe(0);
  });

  it("with speed modifier: base 80 × 1.25 = 100, base 40 × 1.5 = 60", () => {
    // base 80: error 66 of 330; base 40: error 198 of 330
    expect(scoreAnswer(proximity(SPEED_ON), { answer: 396, correctAnswer: 330 }, at(5))).toEqual({
      baseScore: 80,
      speedModifier: 1.25,
      finalScore: 100,
    });
    expect(scoreAnswer(proximity(SPEED_ON), { answer: 528, correctAnswer: 330 }, at(0))).toEqual({
      baseScore: 40,
      speedModifier: 1.5,
      finalScore: 60,
    });
  });
});

describe("final score", () => {
  it("rounds base × modifier", () => {
    expect(calculateFinalScore(97, 1.25)).toBe(121);
    expect(calculateFinalScore(100, 1)).toBe(100);
  });

  it("base 0 stays 0 with any speed modifier (fast wrong answer = 0)", () => {
    expect(calculateFinalScore(0, 1.5)).toBe(0);
    expect(scoreAnswer(absolute(SPEED_ON), { correct: false }, at(0)).finalScore).toBe(0);
    expect(scoreAnswer(proximity(SPEED_ON), { answer: 5000, correctAnswer: 330 }, at(0)).finalScore).toBe(0);
  });

  it("max per question is maxPoints × fastestMultiplier", () => {
    expect(scoreAnswer(absolute(SPEED_ON), { correct: true }, at(0)).finalScore).toBe(150);
  });

  it("identical inputs always give identical results", () => {
    const run = () => scoreAnswer(proximity(SPEED_ON), { answer: 300, correctAnswer: 330 }, at(7.3));
    expect(run()).toEqual(run());
  });
});

describe("normalizeScoring (old or invalid settings)", () => {
  it("old shapes fall back to the category defaults", () => {
    const old = { basePoints: 200, speedBonus: true, minPercent: 10, estimateScale: "rank" };
    expect(normalizeScoring(estimateMeta, old)).toEqual(estimateMeta.scoring);
    expect(normalizeScoring(quizMeta, undefined)).toEqual(quizMeta.scoring);
    expect(normalizeScoring(quizMeta, { mode: "absolute", maxPoints: -5, speedModifier: SPEED_ON })).toEqual(
      quizMeta.scoring,
    );
  });

  it("keeps valid host edits but never changes the category's mode", () => {
    const s = normalizeScoring(quizMeta, { mode: "proximity", maxPoints: 250, speedModifier: SPEED_OFF });
    expect(s).toEqual({ mode: "absolute", maxPoints: 250, speedModifier: SPEED_OFF });
  });
});
