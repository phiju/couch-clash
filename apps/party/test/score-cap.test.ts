import { describe, expect, it } from "vitest";
import { capScoreDelta } from "../src/game-flow";

describe("global per-question cap", () => {
  it("caps every player's points per question (default 200)", () => {
    expect(capScoreDelta({ a: 250, b: 120, c: 0 }, undefined)).toEqual({ a: 200, b: 120, c: 0 });
    expect(capScoreDelta({ a: 250, b: 120 }, { perQuestionCap: 100 })).toEqual({ a: 100, b: 100 });
    expect(capScoreDelta(undefined, { perQuestionCap: 100 })).toBeUndefined();
  });
});
