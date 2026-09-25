import { describe, expect, it } from "vitest";
import { SKURRIL_STORIES_DE, SkurrilStorySchema, type SkurrilStory } from "../src";

const STORY: SkurrilStory = SKURRIL_STORIES_DE.find((s) => s.id === "skurril-001")!;
const parse = (over: Partial<Record<keyof SkurrilStory, unknown>>) => SkurrilStorySchema.safeParse({ ...STORY, ...over }).success;

describe("Skurrile Ereignisse content", () => {
  it("139 stories: 30 kids (6), 80 family (12), 29 party (18, adult)", () => {
    expect(SKURRIL_STORIES_DE).toHaveLength(139);
    const by = (re: RegExp) => SKURRIL_STORIES_DE.filter((s) => re.test(s.id));
    const kids = by(/^skurril-kids-\d{3}$/);
    const family = by(/^skurril-\d{3}$/);
    const party = by(/^skurril-party-\d{3}$/);
    expect([kids.length, family.length, party.length]).toEqual([30, 80, 29]);
    expect(kids.every((s) => s.ageRating === 6 && !s.adult)).toBe(true);
    expect(family.every((s) => s.ageRating === 12 && !s.adult)).toBe(true);
    expect(party.every((s) => s.ageRating === 18 && s.adult)).toBe(true);
  });

  it("unique ids, lengths within the limits, answers without final full stop, https sources", () => {
    expect(new Set(SKURRIL_STORIES_DE.map((s) => s.id)).size).toBe(SKURRIL_STORIES_DE.length);
    for (const s of SKURRIL_STORIES_DE) {
      expect(s.context.length, s.id).toBeLessThanOrEqual(230);
      expect(s.question.length, s.id).toBeLessThanOrEqual(100);
      expect(s.answer.length, s.id).toBeLessThanOrEqual(80);
      expect(s.fact.length, s.id).toBeLessThanOrEqual(220);
      expect(s.answer, s.id).not.toMatch(/\.$/);
      expect(() => new URL(s.source), s.id).not.toThrow();
    }
  });

  it("the schema rejects broken stories", () => {
    expect(parse({})).toBe(true);
    expect(parse({ context: "x".repeat(231) })).toBe(false);
    expect(parse({ question: "x".repeat(101) })).toBe(false);
    expect(parse({ answer: "x".repeat(81) })).toBe(false);
    expect(parse({ answer: "Er schlief ein." })).toBe(false);
    expect(parse({ fact: "x".repeat(221) })).toBe(false);
    expect(parse({ source: "keine url" })).toBe(false);
    expect(parse({ source: "javascript:alert(1)" })).toBe(false);
    expect(parse({ ageRating: 16 })).toBe(false);
    expect(parse({ difficulty: 4 })).toBe(false);
    expect(parse({ year: null })).toBe(true);
    expect(parse({ primaryCategory: "WISSEN" })).toBe(false);
    // adult ⇔ ageRating 18
    expect(parse({ adult: true })).toBe(false);
    expect(parse({ ageRating: 18 })).toBe(false);
    expect(parse({ ageRating: 18, adult: true })).toBe(true);
  });
});
