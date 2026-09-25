import { describe, expect, it } from "vitest";
import {
  BLUFF_WORDS_DE,
  ESTIMATE_QUESTIONS_DE,
  FUEHRERSCHEIN_QUESTIONS_DE,
  QUIZ_QUESTIONS_DE,
  SKURRIL_STORIES_DE,
} from "../src";

/** Party content is only about alcohol and sex / love – always 18+ and flagged adult. */
const FILES = {
  quiz: { items: QUIZ_QUESTIONS_DE, prefix: "quiz-party-", count: 159 },
  estimate: { items: ESTIMATE_QUESTIONS_DE, prefix: "estimate-party-", count: 60 },
  fuehrerschein: { items: FUEHRERSCHEIN_QUESTIONS_DE, prefix: "fs-party-", count: 25 },
  // Older party stories / words (before the alcohol + love focus) are tagged by topic only.
  skurril: { items: SKURRIL_STORIES_DE, prefix: "skurril-party-", count: 48, taggedFrom: 30 },
  bluff: { items: BLUFF_WORDS_DE, prefix: "bluff-party-", count: 85, taggedFrom: 61 },
} as const;

type Item = { id: string; ageRating: number; adult?: boolean; tags: readonly string[] };

describe.each(Object.entries(FILES))("party content: %s", (_name, file) => {
  const { items, prefix, count } = file;
  const taggedFrom = "taggedFrom" in file ? file.taggedFrom : 1;
  const all = items as readonly Item[];
  const party = all.filter((q) => q.id.startsWith(prefix));

  it(`has ${count} party items, all adult, 18+, tagged party + topic`, () => {
    expect(party).toHaveLength(count);
    for (const q of party) {
      expect(q.adult, q.id).toBe(true);
      expect(q.ageRating, q.id).toBe(18);
      if (Number(q.id.slice(prefix.length)) < taggedFrom) continue;
      expect(q.tags, q.id).toContain("party");
      expect(q.tags.some((t) => ["alkohol", "sex", "liebe"].includes(t)), q.id).toBe(true);
    }
  });

  it("every adult item is a party item (nothing adult hides in the family pool)", () => {
    for (const q of all.filter((x) => x.adult)) expect(q.id.startsWith(prefix), q.id).toBe(true);
  });
});

describe("party content: removed skurril stories", () => {
  it("the six off-topic party stories are gone", () => {
    const ids = new Set(SKURRIL_STORIES_DE.map((s) => s.id));
    for (const n of ["007", "008", "012", "020", "022", "028"]) expect(ids.has(`skurril-party-${n}`)).toBe(false);
  });
});
