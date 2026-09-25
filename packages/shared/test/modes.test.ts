import { describe, expect, it } from "vitest";
import {
  cheekinessForMode,
  DEFAULT_MODE_SETTINGS,
  difficultyWeight,
  eligibleForMode,
  MODE_CHEEKINESS,
  modesFor,
  normalizeModeSettings,
  GameModeSettingsSchema,
  PARTY_CONFIG,
  type GameModeSettings,
} from "../src";

const kids: GameModeSettings = { mode: "kids", allow16: false, difficulty: "mixed" };
const family: GameModeSettings = { mode: "family", allow16: false, difficulty: "mixed" };
const family16: GameModeSettings = { ...family, allow16: true };
const party: GameModeSettings = { mode: "party", allow16: false, difficulty: "mixed" };

describe("mode filter", () => {
  const q = (over: Partial<{ ageRating: number; difficulty: number; alcohol: boolean; adult: boolean }> = {}) => ({
    ageRating: 6,
    difficulty: 1,
    ...over,
  });

  it("kids: age ≤ 6, easy only, no alcohol, nothing adult", () => {
    expect(eligibleForMode(q(), kids)).toBe(true);
    expect(eligibleForMode(q({ difficulty: 2 }), kids)).toBe(false);
    expect(eligibleForMode(q({ ageRating: 12 }), kids)).toBe(false);
    expect(eligibleForMode(q({ alcohol: true }), kids)).toBe(false);
    expect(eligibleForMode(q({ adult: true }), kids)).toBe(false);
  });

  it("kids: kidsMaxDifficulty from the category meta raises the limit", () => {
    const estimate = { id: "estimate", kidsMaxDifficulty: 2 } as const;
    expect(eligibleForMode(q({ difficulty: 2 }), kids, estimate)).toBe(true);
    expect(eligibleForMode(q({ difficulty: 3 }), kids, estimate)).toBe(false);
    expect(eligibleForMode(q({ difficulty: 2, ageRating: 12 }), kids, estimate)).toBe(false);
    expect(eligibleForMode(q({ difficulty: 2 }), kids, { id: "quiz" })).toBe(false);
    expect(modesFor(q({ difficulty: 2 }), false, estimate)).toEqual(["kids", "family", "party"]);
    expect(modesFor(q({ difficulty: 2 }))).toEqual(["family", "party"]);
  });

  it("family: age ≤ 12 (16 if allowed), alcohol ok, nothing adult", () => {
    expect(eligibleForMode(q({ ageRating: 12, difficulty: 3, alcohol: true }), family)).toBe(true);
    expect(eligibleForMode(q({ ageRating: 16 }), family)).toBe(false);
    expect(eligibleForMode(q({ ageRating: 16 }), family16)).toBe(true);
    expect(eligibleForMode(q({ ageRating: 18 }), family16)).toBe(false);
    expect(eligibleForMode(q({ adult: true }), family16)).toBe(false);
  });

  it("party: everything", () => {
    expect(eligibleForMode(q({ ageRating: 18, difficulty: 3, alcohol: true, adult: true }), party)).toBe(true);
  });

  it("modesFor lists where a question can come up", () => {
    expect(modesFor(q())).toEqual(["kids", "family", "party"]);
    expect(modesFor(q({ ageRating: 12 }))).toEqual(["family", "party"]);
    expect(modesFor(q({ ageRating: 18, adult: true }))).toEqual(["party"]);
  });
});

describe("difficulty weighting", () => {
  it("kids ignore it, mixed is flat, easy/hard prefer their end", () => {
    expect(difficultyWeight(3, kids)).toBe(1);
    expect(difficultyWeight(1, family)).toBe(difficultyWeight(3, family));
    expect(difficultyWeight(1, { ...family, difficulty: "easy" })).toBeGreaterThan(difficultyWeight(3, { ...family, difficulty: "easy" }));
    expect(difficultyWeight(3, { ...party, difficulty: "hard" })).toBeGreaterThan(difficultyWeight(1, { ...party, difficulty: "hard" }));
  });
});

describe("Frechheit per mode", () => {
  it("defaults: kids nett, family and party frech", () => {
    expect(MODE_CHEEKINESS.kids.default).toBe("nett");
    expect(MODE_CHEEKINESS.family.default).toBe("frech");
    expect(MODE_CHEEKINESS.party.default).toBe("frech");
  });

  it("kids may pick frech but not gnadenlos", () => {
    expect(cheekinessForMode("frech", "kids")).toBe("frech");
    expect(cheekinessForMode("gnadenlos", "kids")).toBe("nett");
    expect(cheekinessForMode("gnadenlos", "party")).toBe("gnadenlos");
  });
});

describe("settings migration", () => {
  it("old settings without a mode → Familie", () => {
    expect(normalizeModeSettings(undefined)).toEqual(DEFAULT_MODE_SETTINGS);
    expect(normalizeModeSettings({ mode: "rave" })).toEqual(DEFAULT_MODE_SETTINGS);
    expect(normalizeModeSettings(party)).toEqual(party);
    expect(DEFAULT_MODE_SETTINGS.mode).toBe("family");
  });

  it("Party-Anteil: 30 / 50 / 100 % are kept (not stripped), anything else is rejected", () => {
    expect(PARTY_CONFIG.shares).toEqual([0.3, 0.5, 1]);
    for (const partyShare of PARTY_CONFIG.shares) {
      expect(normalizeModeSettings({ ...party, partyShare })).toEqual({ ...party, partyShare });
    }
    expect(GameModeSettingsSchema.safeParse({ ...party, partyShare: 0.7 }).success).toBe(false);
    // Stored settings from before the slider still load (default share).
    expect(normalizeModeSettings(party).partyShare).toBeUndefined();
  });

  it("party items (adult, 18) come up in Party only", () => {
    const item = { ageRating: 18, difficulty: 2, adult: true, alcohol: true };
    expect(modesFor(item, true)).toEqual(["party"]);
    expect(eligibleForMode(item, { ...party, partyShare: 1 })).toBe(true);
  });
});
