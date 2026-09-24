import { describe, expect, it } from "vitest";
import { ESTIMATE_QUESTIONS_DE, QUIZ_QUESTIONS_DE } from "../src";

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
