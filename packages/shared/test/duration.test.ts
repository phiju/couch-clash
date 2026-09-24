import { describe, expect, it } from "vitest";
import { INTRO_MS, SCOREBOARD_MS, estimateGameSeconds, formatDuration } from "../src";

describe("duration estimate", () => {
  it("sums intro, questions and scoreboard per category", () => {
    const perRound = INTRO_MS / 1000 + SCOREBOARD_MS / 1000;
    const seconds = estimateGameSeconds([
      { meta: { estimatedSecondsPerQuestion: 22 }, questionCount: 8 },
      { meta: { estimatedSecondsPerQuestion: 32 }, questionCount: 6 },
    ]);
    expect(seconds).toBe(8 * 22 + 6 * 32 + 2 * perRound);
  });

  it("is 0 without categories", () => {
    expect(estimateGameSeconds([])).toBe(0);
  });

  it("formats as whole minutes", () => {
    expect(formatDuration(720)).toBe("ca. 12 Minuten");
    expect(formatDuration(10)).toBe("ca. 1 Minute");
    expect(formatDuration(89)).toBe("ca. 1 Minute");
    expect(formatDuration(91)).toBe("ca. 2 Minuten");
  });
});
