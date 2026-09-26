import type { SlfPublicState } from "@couch-clash/games/meta";
import { describe, expect, it } from "vitest";
import { allFilled, answerTags, readingCategory, slfAudio, slfSkipLabel } from "../src/games/stadt-land-fluss/logic";

const reveal = {
  aiChecked: true,
  categories: [0, 6_000, 14_000].map((startsAtMs, i) => ({ categoryId: `c${i}`, answers: [], script: "…", startsAtMs })),
};
const state = (step: SlfPublicState["step"]) => ({ step, stepStartedAt: 1_000, reveal });

describe("Stadt, Land, Fluss on the TV and phone", () => {
  it("the TV follows the voice's cue, else its own timing per category", () => {
    expect(readingCategory(state("reveal"), 1_000, "category:2")).toBe(2);
    expect(readingCategory(state("reveal"), 1_000, "category:9")).toBeNull();
    expect(readingCategory(state("reveal"), 1_000, null)).toBe(0);
    expect(readingCategory(state("reveal"), 7_500, null)).toBe(1);
    expect(readingCategory(state("reveal"), 60_000, undefined)).toBe(2);
    expect(readingCategory(state("vote"), 7_500, null)).toBeNull();
  });

  it("tags for an answer", () => {
    expect(answerTags({ verdict: "valid", duplicate: true, only: false, typo: true })).toEqual(["👯 doppelt", "✍️ Tippfehler"]);
    expect(answerTags({ verdict: "valid", duplicate: false, only: true, typo: false })).toEqual(["⭐ als Einzige(r)"]);
    expect(answerTags({ verdict: "letter", duplicate: false, only: false, typo: false })).toEqual(["✗ falscher Buchstabe"]);
    expect(answerTags({ verdict: "empty", duplicate: false, only: false, typo: false })).toEqual([]);
  });

  it("Stopp! only with every field filled", () => {
    expect(allFilled(["Berlin", "Bär", "Bett"], 3)).toBe(true);
    expect(allFilled(["Berlin", " ", "Bett"], 3)).toBe(false);
    expect(allFilled(["Berlin"], 3)).toBe(false);
  });

  it("sound and the host's button per step", () => {
    expect(slfAudio({ step: "write", index: 1 })).toEqual({ key: "write:1", music: "think" });
    expect(slfAudio({ step: "tally", index: 1 })?.enter).toBe("sting");
    expect(slfSkipLabel({ step: "write" })).toBe("Zeit um ⏭");
    expect(slfSkipLabel({ step: "reveal" })).toBe("Abstimmung ⏭");
  });
});
