import { describe, expect, it } from "vitest";
import { KNOWLEDGE_CATEGORIES, KNOWLEDGE_CATEGORY_LABELS } from "@couch-clash/shared";
import {
  BLUFF_WORDS_DE,
  BluffWordSchema,
  ESTIMATE_QUESTIONS_DE,
  EstimateQuestionSchema,
  FUEHRERSCHEIN_QUESTIONS_DE,
  FuehrerscheinQuestionSchema,
  QUIZ_QUESTIONS_DE,
  QuizQuestionSchema,
} from "../src";
import oldWords from "./fixtures/old-bluff-words.json";

describe("content", () => {
  it("has enough questions", () => {
    expect(QUIZ_QUESTIONS_DE.length).toBeGreaterThanOrEqual(800);
    expect(ESTIMATE_QUESTIONS_DE.length).toBeGreaterThanOrEqual(300);
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

  it("quiz: 4 distinct options, correctIndex 0–3", () => {
    for (const q of QUIZ_QUESTIONS_DE) {
      expect(new Set(q.options.map((o) => o.trim().toLowerCase())).size, q.id).toBe(4);
      expect(q.correctIndex, q.id).toBeGreaterThanOrEqual(0);
      expect(q.correctIndex, q.id).toBeLessThanOrEqual(3);
    }
  });

  it("estimate: numeric answer, zeroRange > 0 where set", () => {
    for (const q of ESTIMATE_QUESTIONS_DE) {
      expect(Number.isFinite(q.answer), q.id).toBe(true);
      if (q.zeroRange !== undefined) expect(q.zeroRange, q.id).toBeGreaterThan(0);
    }
  });

  it("every shipped question has a primary category and no 'wissen' tag", () => {
    for (const q of [...QUIZ_QUESTIONS_DE, ...ESTIMATE_QUESTIONS_DE]) {
      expect(KNOWLEDGE_CATEGORIES, q.id).toContain(q.primaryCategory);
      expect(q.tags, q.id).not.toContain("wissen");
    }
  });
});

describe("primaryCategory", () => {
  const quiz = { id: "x-1", text: "Eine Testfrage?", ageRating: 12, tags: ["test"], difficulty: 1, options: ["a", "b", "c", "d"], correctIndex: 0 };

  it("is optional and must be a known id", () => {
    expect(QuizQuestionSchema.safeParse(quiz).success).toBe(true);
    expect(QuizQuestionSchema.safeParse({ ...quiz, primaryCategory: "MUSIC" }).success).toBe(true);
    expect(QuizQuestionSchema.safeParse({ ...quiz, primaryCategory: "COOKING" }).success).toBe(false);
    expect(EstimateQuestionSchema.safeParse({ ...quiz, answer: 3, unit: "", primaryCategory: "SPORTS" }).success).toBe(true);
    expect(EstimateQuestionSchema.safeParse({ ...quiz, answer: 3, unit: "", primaryCategory: "sports" }).success).toBe(false);
  });

  it("has a German label for all 15 ids", () => {
    expect(KNOWLEDGE_CATEGORIES).toHaveLength(15);
    for (const id of KNOWLEDGE_CATEGORIES) expect(KNOWLEDGE_CATEGORY_LABELS[id]).toBeTruthy();
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

describe("Führerscheinprüfung", () => {
  const all = FUEHRERSCHEIN_QUESTIONS_DE;
  const kind = (q: (typeof all)[number]) => q.media?.kind ?? "text";

  it("has 155 valid questions: text, sign and scene", () => {
    expect(all).toHaveLength(155);
    expect(all.filter((q) => kind(q) === "text").length).toBeGreaterThanOrEqual(50);
    expect(all.filter((q) => kind(q) === "sign").length).toBeGreaterThanOrEqual(50);
    expect(all.filter((q) => kind(q) === "scene").length).toBeGreaterThanOrEqual(40);
    for (const q of all) expect(FuehrerscheinQuestionSchema.safeParse(q).success, q.id).toBe(true);
  });

  it("ids are unique, also across the other files", () => {
    const ids = [...all, ...QUIZ_QUESTIONS_DE, ...ESTIMATE_QUESTIONS_DE].map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("text + picture is unique (texts like 'Was bedeutet dieses Verkehrszeichen?' repeat)", () => {
    const keys = all.map((q) => `${q.text}|${JSON.stringify(q.media)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every question is MOBILITY and tagged führerschein", () => {
    for (const q of all) {
      expect(q.primaryCategory, q.id).toBe("MOBILITY");
      expect(q.tags, q.id).toContain("führerschein");
    }
  });

  it("26 questions are for kids (ageRating 6), the rest 12", () => {
    expect(all.filter((q) => q.ageRating === 6)).toHaveLength(26);
    for (const q of all) expect([6, 12]).toContain(q.ageRating);
  });

  it("scene vehicles have unique colours and ids", () => {
    for (const q of all) {
      if (q.media?.kind !== "scene") continue;
      const v = q.media.vehicles;
      expect(new Set(v.map((x) => x.color)).size, q.id).toBe(v.length);
      expect(new Set(v.map((x) => x.id)).size, q.id).toBe(v.length);
    }
  });

  describe("media schema", () => {
    const scene = {
      kind: "scene",
      arms: ["N", "E", "S", "W"],
      signs: {},
      priorityPath: null,
      vehicles: [
        { id: "rot", type: "car", color: "rot", from: "S", turn: "straight" },
        { id: "blau", type: "car", color: "blau", from: "E", turn: "left" },
      ],
    };
    const q = {
      id: "fs-x",
      text: "Wer darf zuerst fahren?",
      ageRating: 12,
      tags: ["führerschein"],
      difficulty: 1,
      options: ["a", "b", "c", "d"],
      correctIndex: 0,
      explanation: "Rechts vor links.",
    };
    const ok = (media: unknown) => FuehrerscheinQuestionSchema.safeParse({ ...q, media }).success;

    it("accepts null, sign and scene", () => {
      expect(ok(null)).toBe(true);
      expect(ok({ kind: "sign", signs: ["206"] })).toBe(true);
      expect(ok({ kind: "sign", signs: ["274-53", "1020-30"] })).toBe(true);
      expect(ok(scene)).toBe(true);
    });

    it("rejects broken media", () => {
      expect(ok(undefined)).toBe(false);
      expect(ok({ kind: "video" })).toBe(false);
      expect(ok({ kind: "sign", signs: [] })).toBe(false);
      expect(ok({ kind: "sign", signs: ["../etc"] })).toBe(false);
      const v = scene.vehicles;
      expect(ok({ ...scene, vehicles: [v[0], { ...v[1], color: "rot" }] })).toBe(false); // same colour twice
      expect(ok({ ...scene, vehicles: [v[0], { ...v[1], id: "rot" }] })).toBe(false);
      expect(ok({ ...scene, arms: ["E", "S", "W"], vehicles: [{ ...v[0], from: "N" }] })).toBe(false); // missing arm
      expect(ok({ ...scene, arms: ["E", "S", "W"], vehicles: [v[0]] })).toBe(false); // S straight → N is missing
      expect(ok({ ...scene, signs: { X: ["205"] } })).toBe(false);
      expect(ok({ ...scene, priorityPath: ["N", "N"] })).toBe(false);
      expect(ok({ ...scene, vehicles: [{ ...v[0], siren: true }] })).toBe(false); // only police
      expect(ok({ ...scene, pedestrians: [{ at: "Q", crossing: true }] })).toBe(false);
    });

    it("needs an explanation", () => {
      expect(FuehrerscheinQuestionSchema.safeParse({ ...q, media: null, explanation: undefined }).success).toBe(false);
    });
  });
});
