import { bluffMeta, quizMeta } from "@couch-clash/games/meta";
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
  });

  it("availability per mode: bluff not in Kids, the pool must reach the minimum, 2+ players for bluff", () => {
    const kids: GameModeSettings = { mode: "kids", allow16: false, difficulty: "mixed" };
    expect(isAvailable(quizMeta, 3, kids, { quiz: 2 })).toBe(false);
    expect(isAvailable(quizMeta, 3, kids, { quiz: 85 })).toBe(true);
    expect(isAvailable(bluffMeta, 3, kids, { bluff: 200 })).toBe(false);
    expect(isAvailable(bluffMeta, 3, DEFAULT_MODE_SETTINGS, { bluff: 200 })).toBe(true);
    expect(isAvailable(bluffMeta, 1, DEFAULT_MODE_SETTINGS, { bluff: 200 })).toBe(false);
  });
});
