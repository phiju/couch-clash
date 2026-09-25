import { skurrilMeta } from "@couch-clash/games/meta";
import { describe, expect, it } from "vitest";
import { bluffAudio, presentHighlight, resultParts } from "../src/games/bluff/logic";
import { LEXIKON_TEXTS, SKURRIL_TEXTS } from "../src/games/bluff/texts";

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
    const base = {
      baseScore: 0,
      speedModifier: 1,
      finalScore: 0,
      votedCorrect: false,
      knewIt: false,
      fooled: 0,
      eligibleVoters: 9,
      realPickers: 0,
      findPoints: 0,
      foolBonus: 0,
      knowPoints: 0,
      knowBonus: 0,
    };
    expect(resultParts({ ...base, votedCorrect: true, findPoints: 100, fooled: 5, foolBonus: 56, finalScore: 156 })).toEqual([
      "Richtig getippt +100",
      "+56 (5 von 9 reingelegt)",
    ]);
    expect(resultParts({ ...base, knewIt: true, knowPoints: 100, realPickers: 3, knowBonus: 33, finalScore: 133 })).toEqual([
      "Gewusst! +100",
      "+33 (3 von 9 fanden die echte)",
    ]);
    expect(resultParts(base)).toEqual([]);
    // Capped at 200 per word
    expect(resultParts({ ...base, votedCorrect: true, findPoints: 100, fooled: 9, foolBonus: 150, finalScore: 200 })).toEqual([
      "Richtig getippt +100",
      "+150 (9 von 9 reingelegt)",
      "Höchstens 200 pro Wort",
    ]);
  });

  it("music: think while writing, sting for the real definition", () => {
    expect(bluffAudio({ step: "write", index: 0 })).toMatchObject({ music: "think" });
    expect(bluffAudio({ step: "solution", index: 2 })).toMatchObject({ key: "solution:2", enter: "sting", music: null });
    expect(bluffAudio({ step: "leaderboard", index: 0 })).toMatchObject({ music: "lobby" });
  });

});

describe("Skurrile Ereignisse views", () => {
  it("own texts for the shared bluff components; the Bluff-Lexikon texts stay", () => {
    expect(LEXIKON_TEXTS.writeLabel).toBe("Deine erfundene Erklärung:");
    expect(LEXIKON_TEXTS.hints.write).toBe("Schreibt eine glaubwürdige Erklärung aufs Handy!");
    expect(SKURRIL_TEXTS.counter).toBe("Geschichte");
    expect(SKURRIL_TEXTS.writeLabel).toBe("Deine erfundene Antwort:");
  });

  it("points per story", () => {
    const capped = {
      baseScore: 0,
      speedModifier: 1,
      finalScore: 200,
      votedCorrect: true,
      knewIt: false,
      fooled: 2,
      eligibleVoters: 2,
      realPickers: 0,
      findPoints: 150,
      foolBonus: 100,
      knowPoints: 0,
      knowBonus: 0,
    };
    expect(resultParts(capped, SKURRIL_TEXTS.counter).at(-1)).toBe("Höchstens 200 pro Geschichte");
  });

  it("also offered in Kids", () => {
    expect(skurrilMeta.modes).toContain("kids");
  });
});
