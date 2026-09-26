import { CATEGORY_METAS, bluffMeta, quizMeta } from "@couch-clash/games/meta";
import { DEFAULT_MODE_SETTINGS, type GameModeSettings } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import { isAvailable } from "../src/lib/setup-rules";
import { summaryText } from "../src/lib/summary";

describe("game mode in the UI helpers", () => {
  it("phone summary starts with the mode", () => {
    expect(summaryText({ mode: "family", categoryIds: ["quiz", "estimate", "bluff"], questionCount: 19, estimatedSeconds: 900 })).toBe(
      "Familie · 3 Kategorien · 19 Fragen · ca. 15 Minuten",
    );
    // A category played twice counts once.
    expect(summaryText({ mode: "kids", categoryIds: ["quiz", "estimate", "quiz"], questionCount: 30, estimatedSeconds: 1800 })).toMatch(
      /^Kids · 2 Kategorien/,
    );
    // The finale is named on its own, not counted as a category.
    expect(summaryText({ mode: "family", categoryIds: ["quiz", "estimate", "survival"], questionCount: 14, estimatedSeconds: 1200 })).toBe(
      "Familie · 2 Kategorien + Survival-Finale · 14 Fragen · ca. 20 Minuten",
    );
  });

  it("availability per mode: bluff not in Kids, the pool must reach the minimum – never the player count", () => {
    const kids: GameModeSettings = { mode: "kids", allow16: false, difficulty: "mixed" };
    expect(isAvailable(quizMeta, kids, { quiz: 2 })).toBe(false);
    expect(isAvailable(quizMeta, kids, { quiz: 85 })).toBe(true);
    expect(isAvailable(bluffMeta, kids, { bluff: 200 })).toBe(false);
    expect(isAvailable(bluffMeta, DEFAULT_MODE_SETTINGS, { bluff: 200 })).toBe(true);
    // Every game can be picked before anyone joined and played alone.
    for (const meta of CATEGORY_METAS) {
      if (meta.modes.includes("family")) expect(isAvailable(meta, DEFAULT_MODE_SETTINGS, null), meta.id).toBe(true);
    }
  });
});
