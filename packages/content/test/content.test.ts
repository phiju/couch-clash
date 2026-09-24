import { describe, expect, it } from "vitest";
import { ESTIMATE_QUESTIONS_DE, EstimateQuestionSchema, QUIZ_QUESTIONS_DE } from "../src";

describe("content", () => {
  it("has enough questions", () => {
    expect(QUIZ_QUESTIONS_DE.length).toBeGreaterThanOrEqual(40);
    expect(ESTIMATE_QUESTIONS_DE.length).toBeGreaterThanOrEqual(30);
  });

  it("has unique ids across all files", () => {
    const ids = [...QUIZ_QUESTIONS_DE, ...ESTIMATE_QUESTIONS_DE].map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has questions suitable for kids", () => {
    expect(QUIZ_QUESTIONS_DE.some((q) => q.ageRating <= 6)).toBe(true);
    expect(ESTIMATE_QUESTIONS_DE.some((q) => q.ageRating <= 6)).toBe(true);
  });

  it("has unique question texts", () => {
    const texts = [...QUIZ_QUESTIONS_DE, ...ESTIMATE_QUESTIONS_DE].map((q) => q.text);
    expect(new Set(texts).size).toBe(texts.length);
  });
});

describe("estimate schema: zeroRange rules", () => {
  const base = {
    id: "x-1",
    text: "Eine Testfrage?",
    ageRating: 12,
    tags: ["test"],
    difficulty: 1,
    unit: "",
  };

  it("year questions must define zeroRange", () => {
    expect(EstimateQuestionSchema.safeParse({ ...base, answer: 1969, format: "year" }).success).toBe(false);
    expect(EstimateQuestionSchema.safeParse({ ...base, answer: 1969, format: "year", zeroRange: 50 }).success).toBe(true);
  });

  it("answer 0 must define zeroRange", () => {
    expect(EstimateQuestionSchema.safeParse({ ...base, answer: 0 }).success).toBe(false);
    expect(EstimateQuestionSchema.safeParse({ ...base, answer: 0, zeroRange: 20 }).success).toBe(true);
  });

  it("zeroRange must be > 0", () => {
    expect(EstimateQuestionSchema.safeParse({ ...base, answer: 5, zeroRange: 0 }).success).toBe(false);
    expect(EstimateQuestionSchema.safeParse({ ...base, answer: 5, zeroRange: -3 }).success).toBe(false);
  });

  it("all shipped year questions define zeroRange", () => {
    const years = ESTIMATE_QUESTIONS_DE.filter((q) => q.format === "year");
    expect(years.length).toBeGreaterThan(0);
    for (const q of years) expect(q.zeroRange, q.id).toBeGreaterThan(0);
  });
});
