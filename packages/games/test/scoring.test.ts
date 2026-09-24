import type { ScoringSettings } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import { linearFactor, scoreEstimate, scoreQuiz, timeFactors } from "../src/scoring";

const quizSettings: ScoringSettings = {
  basePoints: 100,
  speedBonus: true,
  minPercent: 10,
  estimateScale: "distance",
};
const estimateSettings: ScoringSettings = { ...quizSettings, speedBonus: false };
const points = (r: Record<string, { points: number }>) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.points]));

describe("linearFactor / timeFactors", () => {
  it("maps best → 1 and worst → minPercent", () => {
    expect(linearFactor(0, 0, 10, 10)).toBe(1);
    expect(linearFactor(10, 0, 10, 10)).toBeCloseTo(0.1);
    expect(linearFactor(5, 0, 10, 0)).toBeCloseTo(0.5);
  });

  it("gives 100 % if best == worst", () => {
    expect(linearFactor(3, 3, 3, 10)).toBe(1);
  });

  it("gives 100 % to a single scorer and when speed bonus is off", () => {
    expect(timeFactors([{ id: "a", at: 5 }], quizSettings).get("a")).toBe(1);
    const off = timeFactors(
      [
        { id: "a", at: 1 },
        { id: "b", at: 9 },
      ],
      { speedBonus: false, minPercent: 10 },
    );
    expect([...off.values()]).toEqual([1, 1]);
  });
});

describe("scoreQuiz", () => {
  it("example: correct after 2 s, 5 s, 8 s → 100, 55, 10", () => {
    const r = scoreQuiz(
      [
        { id: "a", correct: true, at: 2000 },
        { id: "b", correct: true, at: 5000 },
        { id: "c", correct: true, at: 8000 },
      ],
      quizSettings,
    );
    expect(points(r)).toEqual({ a: 100, b: 55, c: 10 });
    expect(r.b!.speed).toBeCloseTo(0.55);
  });

  it("wrong answers get 0 and don't affect the time scale", () => {
    const r = scoreQuiz(
      [
        { id: "wrong-fast", correct: false, at: 1000 },
        { id: "a", correct: true, at: 3000 },
        { id: "b", correct: true, at: 9000 },
      ],
      quizSettings,
    );
    expect(points(r)).toEqual({ "wrong-fast": 0, a: 100, b: 10 });
  });

  it("without speed bonus every correct answer gets basePoints", () => {
    const r = scoreQuiz(
      [
        { id: "a", correct: true, at: 1 },
        { id: "b", correct: true, at: 99999 },
      ],
      { ...quizSettings, speedBonus: false, basePoints: 250 },
    );
    expect(points(r)).toEqual({ a: 250, b: 250 });
  });
});

describe("scoreEstimate", () => {
  it("example: Eiffel Tower 330 m, answers 350, 300, 500 → 100, 94, 10", () => {
    const r = scoreEstimate(
      [
        { id: "a", value: 350, at: 1 },
        { id: "b", value: 300, at: 2 },
        { id: "c", value: 500, at: 3 },
      ],
      330,
      estimateSettings,
    );
    expect(points(r)).toEqual({ a: 100, b: 94, c: 10 });
  });

  it("gives everyone 100 % if all distances are equal (ties)", () => {
    const r = scoreEstimate(
      [
        { id: "a", value: 320, at: 1 },
        { id: "b", value: 340, at: 2 },
      ],
      330,
      estimateSettings,
    );
    expect(points(r)).toEqual({ a: 100, b: 100 });
  });

  it("rank scale is robust against outliers", () => {
    const answers = [
      { id: "a", value: 330, at: 1 },
      { id: "b", value: 400, at: 2 },
      { id: "c", value: 1_000_000, at: 3 },
    ];
    const byDistance = points(scoreEstimate(answers, 330, estimateSettings));
    const byRank = points(scoreEstimate(answers, 330, { ...estimateSettings, estimateScale: "rank" }));
    expect(byDistance.b).toBe(100); // outlier squashes everyone else to ~100 %
    expect(byRank).toEqual({ a: 100, b: 55, c: 10 });
  });

  it("rank scale: ties share a rank and factor", () => {
    const r = scoreEstimate(
      [
        { id: "a", value: 10, at: 1 },
        { id: "b", value: 10, at: 2 },
        { id: "c", value: 50, at: 3 },
      ],
      10,
      { ...estimateSettings, estimateScale: "rank" },
    );
    expect(points(r)).toEqual({ a: 100, b: 100, c: 10 });
  });

  it("combines accuracy and time factor (among all who answered)", () => {
    const r = scoreEstimate(
      [
        { id: "a", value: 330, at: 1000 },
        { id: "b", value: 330, at: 3000 },
      ],
      330,
      { ...estimateSettings, speedBonus: true },
    );
    expect(points(r)).toEqual({ a: 100, b: 10 });
    expect(r.b).toMatchObject({ accuracy: 1 });
  });

  it("returns nothing without answers", () => {
    expect(scoreEstimate([], 1, estimateSettings)).toEqual({});
  });
});
