import { DEFAULT_VOICE_SETTINGS } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import {
  commentHighlights,
  effectiveCheekiness,
  extendedPhaseEnd,
  normalizeRoomVoice,
  planWelcomes,
  rememberTarget,
  shouldComment,
  updateStreaks,
} from "../src/voice/rules";
import type { CommentPlayerFacts } from "../src/voice/prompt";

describe("commentary frequency", () => {
  const commented = (frequency: "selten" | "normal" | "oft", total: number) => {
    const out: number[] = [];
    let last: number | null = null;
    for (let i = 0; i < total; i++) {
      if (shouldComment(frequency, i, total, last)) {
        out.push(i);
        last = i;
      }
    }
    return out;
  };

  it("never after every question, always after the last one", () => {
    expect(commented("oft", 8)).toEqual([1, 3, 5, 7]);
    expect(commented("normal", 8)).toEqual([2, 5, 7]);
    expect(commented("selten", 8)).toEqual([7]);
    expect(commented("oft", 1)).toEqual([0]);
  });
});

describe("Frechheit", () => {
  it("Familie and Party: the host's level", () => {
    expect(effectiveCheekiness({ ...DEFAULT_VOICE_SETTINGS, cheekiness: "gnadenlos" }, "family")).toBe("gnadenlos");
    expect(effectiveCheekiness({ ...DEFAULT_VOICE_SETTINGS, cheekiness: "gnadenlos" }, "party")).toBe("gnadenlos");
    expect(effectiveCheekiness(DEFAULT_VOICE_SETTINGS, "family")).toBe("frech");
  });

  it("Kids: nett or frech, never gnadenlos (the old ageRating rule is gone)", () => {
    expect(effectiveCheekiness({ ...DEFAULT_VOICE_SETTINGS, cheekiness: "gnadenlos" }, "kids")).toBe("nett");
    expect(effectiveCheekiness({ ...DEFAULT_VOICE_SETTINGS, cheekiness: "frech" }, "kids")).toBe("frech");
    expect(effectiveCheekiness({ ...DEFAULT_VOICE_SETTINGS, cheekiness: "nett" }, "kids")).toBe("nett");
  });

  it("defaults to frech and repairs broken settings", () => {
    expect(normalizeRoomVoice(undefined).settings.cheekiness).toBe("frech");
    expect(normalizeRoomVoice({ settings: { enabled: "ja" } as never }).settings).toEqual(DEFAULT_VOICE_SETTINGS);
  });
});

describe("welcome batching", () => {
  it("one line per player while there is room", () => {
    expect(planWelcomes(["a", "b"], 3)).toEqual({ batches: [["a"], ["b"]], rest: [] });
  });

  it("merges the rest into one line when more than 3 wait", () => {
    expect(planWelcomes(["a", "b", "c", "d", "e"], 3)).toEqual({ batches: [["a"], ["b"], ["c", "d", "e"]], rest: [] });
    expect(planWelcomes(["a", "b", "c"], 1)).toEqual({ batches: [["a", "b", "c"]], rest: [] });
  });

  it("waits while the host screen already has 3 welcomes queued", () => {
    expect(planWelcomes(["a", "b"], 0)).toEqual({ batches: [], rest: ["a", "b"] });
  });
});

describe("leaderboard hold", () => {
  it("extends by at most 3 s and never shortens", () => {
    expect(extendedPhaseEnd(10_000, 10_000, 11_000)).toBe(11_300);
    expect(extendedPhaseEnd(10_000, 10_000, 20_000)).toBe(13_000);
    expect(extendedPhaseEnd(10_000, 10_000, 5_000)).toBe(10_000);
    expect(extendedPhaseEnd(12_000, 10_000, 11_000)).toBe(12_000);
  });
});

describe("commentary memory", () => {
  it("counts streaks of right answers", () => {
    const facts = {
      question: "q",
      correctAnswer: "a",
      answers: {
        a: { text: "x", correct: true, accuracy: 1, points: 100, responseMs: 1000 },
        b: { text: "y", correct: false, accuracy: 0, points: 0, responseMs: 2000 },
      },
    };
    expect(updateStreaks({ a: 2, b: 3 }, ["a", "b", "c"], facts)).toEqual({ a: 3, b: 0, c: 0 });
  });

  it("rotates targets", () => {
    expect(rememberTarget(["max"], "tina")).toEqual(["tina", "max"]);
    expect(rememberTarget(["tina", "max"], "tina")).toEqual(["tina", "max"]);
    expect(rememberTarget(["tina"], null)).toEqual(["tina"]);
  });

  it("finds highlights: new leader, big jump, everyone wrong, streaks", () => {
    const p = (o: Partial<CommentPlayerFacts>): CommentPlayerFacts => ({
      name: "X", answer: "a", correct: false, accuracy: 0, seconds: 5, fastest: false,
      points: 0, total: 0, rankBefore: 1, rankAfter: 1, streak: 0, ...o,
    });
    const h = commentHighlights([
      p({ name: "Tina", rankBefore: 3, rankAfter: 1, total: 300, streak: 3, fastest: true, seconds: 2 }),
      p({ name: "Max", rankBefore: 1, rankAfter: 2, total: 200 }),
      p({ name: "Oma", rankBefore: 2, rankAfter: 3, total: 100, answer: null }),
    ]);
    expect(h).toContain("Alle lagen falsch.");
    expect(h).toContain("Neue Führung: Tina.");
    expect(h).toContain("Tina springt von Platz 3 auf 1.");
    expect(h).toContain("Tina hat 3 richtige in Folge.");
    expect(h).toContain("Oma hat nicht geantwortet.");
  });
});
