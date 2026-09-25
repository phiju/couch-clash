import { bluffMeta, categoryAvailable, quizMeta } from "@couch-clash/games/meta";
import { describe, expect, it } from "vitest";
import { bluffAudio, presentHighlight, resultParts } from "../src/games/bluff/logic";

const T0 = 1_000_000;
const present = {
  step: "present" as const,
  options: [{ text: "a" }, { text: "b" }, { text: "c" }],
  stepStartedAt: T0,
  presentLeadMs: 1500,
  presentMsPerOption: 3500,
};

describe("Bluff-Lexikon views", () => {
  it("highlights the option the host is reading (voice cue wins)", () => {
    expect(presentHighlight(present, T0 + 500, null)).toBeNull(); // lead-in
    expect(presentHighlight(present, T0 + 1500, null)).toBe(0);
    expect(presentHighlight(present, T0 + 1500 + 3500, null)).toBe(1);
    expect(presentHighlight(present, T0 + 60_000, null)).toBe(2);
    expect(presentHighlight(present, T0 + 1500, "option:2")).toBe(2);
    expect(presentHighlight(present, T0 + 1500, "option:9")).toBeNull();
    expect(presentHighlight({ ...present, step: "vote" }, T0 + 5000, "option:1")).toBeNull();
  });

  it("explains the points", () => {
    const base = { baseScore: 0, speedModifier: 1, finalScore: 0 };
    expect(resultParts({ ...base, votedCorrect: true, knewIt: false, fooled: 2 }, 100, 0.5)).toEqual([
      "Richtig getippt +100",
      "2 reingelegt +100",
    ]);
    expect(resultParts({ ...base, votedCorrect: false, knewIt: true, fooled: 0 }, 100, 0.5)).toEqual(["Gewusst! +100"]);
    expect(resultParts({ ...base, votedCorrect: false, knewIt: false, fooled: 0 }, 100, 0.5)).toEqual([]);
  });

  it("music: think while writing, sting for the real definition", () => {
    expect(bluffAudio({ step: "write", index: 0 })).toMatchObject({ music: "think" });
    expect(bluffAudio({ step: "solution", index: 2 })).toMatchObject({ key: "solution:2", enter: "sting", music: null });
    expect(bluffAudio({ step: "leaderboard", index: 0 })).toMatchObject({ music: "lobby" });
  });

  it("is not selectable with fewer than 2 players", () => {
    expect(categoryAvailable(bluffMeta, 1)).toBe(false);
    expect(categoryAvailable(bluffMeta, 2)).toBe(true);
    expect(categoryAvailable(quizMeta, 1)).toBe(true);
  });
});
