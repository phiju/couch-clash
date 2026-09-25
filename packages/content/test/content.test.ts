import { describe, expect, it } from "vitest";
import { BLUFF_WORDS_DE, BluffWordSchema, ESTIMATE_QUESTIONS_DE, EstimateQuestionSchema, QUIZ_QUESTIONS_DE } from "../src";
import oldWords from "./fixtures/old-bluff-words.json";

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

describe("bluff words", () => {
  it("has 200 family words + 60 party words (nouns with article, unique ids and words)", () => {
    const family = BLUFF_WORDS_DE.filter((w) => !w.adult);
    const party = BLUFF_WORDS_DE.filter((w) => w.adult);
    expect(family).toHaveLength(200);
    expect(party).toHaveLength(60);
    for (const w of family) expect(w.ageRating).toBe(12);
    for (const w of party) expect(w.ageRating).toBe(18);
    expect(new Set(BLUFF_WORDS_DE.map((w) => w.id)).size).toBe(260);
    expect(new Set(BLUFF_WORDS_DE.map((w) => w.word.toLowerCase())).size).toBe(260);
    for (const w of BLUFF_WORDS_DE) {
      expect(["der", "die", "das"]).toContain(w.article);
      expect(w.word).toMatch(/^\p{Lu}/u); // nouns are capitalized
      if (w.plural) expect(w.article).toBe("die");
    }
  });

  it("definitions are short, without the word itself and without region markers", () => {
    for (const w of BLUFF_WORDS_DE) {
      expect(w.definition.length).toBeLessThanOrEqual(80);
      expect(w.definition.toLowerCase()).not.toContain(w.word.toLowerCase());
      expect(w.definition).not.toMatch(/\((österr|nordd|südd|bair|ugs|veraltet)/);
      expect([2, 3]).toContain(w.difficulty);
    }
  });

  it("none of the old, too easy words is back", () => {
    const current = new Set(BLUFF_WORDS_DE.map((w) => w.word.toLowerCase()));
    const back = (oldWords as string[]).filter((w) => current.has(w.toLowerCase()));
    expect(back).toEqual([]);
    for (const easy of ["Zipperlein", "Tinnef", "Fisimatenten", "Paradeiser", "Kren", "Obers"]) {
      expect(current.has(easy.toLowerCase())).toBe(false);
    }
  });

  it("rejects entries without article or that are not nouns", () => {
    const base = { id: "x", article: "der", word: "Singultus", definition: "Schluckauf", ageRating: 12, tags: ["t"], difficulty: 3 };
    expect(BluffWordSchema.safeParse(base).success).toBe(true);
    expect(BluffWordSchema.safeParse({ ...base, article: undefined }).success).toBe(false);
    expect(BluffWordSchema.safeParse({ ...base, word: "gähnen" }).success).toBe(false);
    expect(BluffWordSchema.safeParse({ ...base, difficulty: 1 }).success).toBe(false);
    expect(BluffWordSchema.safeParse({ ...base, definition: "x".repeat(81) }).success).toBe(false);
  });
});
