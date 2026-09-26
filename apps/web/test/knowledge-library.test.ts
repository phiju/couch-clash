import { CATEGORY_METAS } from "@couch-clash/games/meta";
import type { CategoryMeta } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import { SETUP_VERSION, mergeLibraryOrder, migrateQuizScoring } from "../src/lib/setup-rules";

// The library cards (the finale has its own switch).
const REGISTRY = (CATEGORY_METAS as readonly CategoryMeta[]).filter((m) => !m.finale).map((m) => m.id);

describe("game library", () => {
  it("a saved order from before keeps its order; the new games land at their library position", () => {
    expect(mergeLibraryOrder(["quiz", "estimate", "fuehrerschein", "bluff"], REGISTRY)).toEqual([
      "quiz",
      "estimate",
      "category-pick",
      "double-or-nothing",
      "bet",
      "steal",
      "fuehrerschein",
      "pixelpanik",
      "bluff",
      "skurril",
    ]);
    // Host moved bluff to the front: stays there (Skurrile Ereignisse lands right after it).
    expect(mergeLibraryOrder(["bluff", "quiz", "estimate", "fuehrerschein"], REGISTRY)).toEqual([
      "bluff",
      "skurril",
      "quiz",
      "estimate",
      "category-pick",
      "double-or-nothing",
      "bet",
      "steal",
      "fuehrerschein",
      "pixelpanik",
    ]);
    expect(mergeLibraryOrder([], REGISTRY)).toEqual(REGISTRY);
    expect(mergeLibraryOrder(["gone", "quiz", "quiz"], REGISTRY)).toEqual(REGISTRY);
  });

  it("old 'quiz' settings load; the old default speed bonus is switched off once", () => {
    const oldDefault = { mode: "absolute", maxPoints: 100, speedModifier: { enabled: true, fastestMultiplier: 1.5, slowestMultiplier: 0.5 } };
    expect(migrateQuizScoring(oldDefault, undefined)?.speedModifier.enabled).toBe(false);
    expect(migrateQuizScoring(oldDefault, undefined)?.maxPoints).toBe(100);
    // Tuned by the host → kept.
    const tuned = { ...oldDefault, speedModifier: { enabled: true, fastestMultiplier: 2, slowestMultiplier: 0.5 } };
    expect(migrateQuizScoring(tuned, undefined)).toEqual(tuned);
    // Saved by this version → the host's choice.
    expect(migrateQuizScoring(oldDefault, SETUP_VERSION)).toEqual(oldDefault);
    expect(migrateQuizScoring(undefined, undefined)).toBeUndefined();
  });
});
