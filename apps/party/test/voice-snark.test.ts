import { SNARK_LINES_DE } from "@couch-clash/content";
import type { LeaderboardEntry, RevealFacts, RevealedAnswer } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import {
  chooseSnark,
  detectSituations,
  isNoteworthy,
  pickSnarkLine,
  situationChoices,
  snarkPoolsFor,
  updateWrongStreaks,
} from "../src/voice/snark";

const ans = (over: Partial<RevealedAnswer> = {}): RevealedAnswer => ({
  text: "x",
  correct: false,
  accuracy: 0,
  points: 0,
  responseMs: 1000,
  ...over,
});
const facts = (answers: Record<string, RevealedAnswer>, over: Partial<RevealFacts> = {}): RevealFacts => ({
  question: "q",
  correctAnswer: "a",
  answers,
  ...over,
});
/** Ranks before/after: ids in order of rankAfter; `before` optionally overrides. */
function board(ids: string[], before: Record<string, number> = {}): LeaderboardEntry[] {
  return ids.map((playerId, i) => ({
    playerId,
    rankAfter: i + 1,
    rankBefore: before[playerId] ?? i + 1,
    scoreAfter: (ids.length - i) * 100,
    pointsGained: 0,
  })) as LeaderboardEntry[];
}
const situations = (hits: ReturnType<typeof detectSituations>) => hits.map((h) => h.situation);

describe("situation detection", () => {
  it("all wrong / all right / nobody answered", () => {
    const ids = ["a", "b"];
    expect(situations(detectSituations({ playerIds: ids, facts: facts({ a: ans(), b: ans() }), leaderboard: board(ids), wrongStreaksBefore: {} }))).toContain("allWrong");
    expect(situations(detectSituations({ playerIds: ids, facts: facts({ a: ans({ correct: true }), b: ans({ correct: true }) }), leaderboard: board(ids), wrongStreaksBefore: {} }))).toEqual(["allRight"]);
    expect(situations(detectSituations({ playerIds: ids, facts: facts({}), leaderboard: board(ids), wrongStreaksBefore: {} }))).toContain("allWrong");
  });

  it("wrong streak ≥ 2, surprise right after a streak, plain wrong is not noteworthy", () => {
    const ids = ["a", "b"];
    const streak = detectSituations({ playerIds: ids, facts: facts({ a: ans({ correct: true }), b: ans() }), leaderboard: board(ids), wrongStreaksBefore: { b: 1 } });
    expect(streak.find((h) => h.situation === "wrongStreak")?.targetIds).toEqual(["b"]);
    const once = detectSituations({ playerIds: ids, facts: facts({ a: ans({ correct: true }), b: ans() }), leaderboard: board(ids), wrongStreaksBefore: {} });
    expect(situations(once)).toEqual(["wrong"]);
    expect(isNoteworthy(once)).toBe(false);
    expect(isNoteworthy(streak)).toBe(true);
    const surprise = detectSituations({ playerIds: ids, facts: facts({ a: ans(), b: ans({ correct: true }) }), leaderboard: board(ids), wrongStreaksBefore: { b: 3 } });
    expect(surprise.find((h) => h.situation === "surpriseRight")?.targetIds).toEqual(["b"]);
  });

  it("the only one right is a surprise – unless already leading", () => {
    const ids = ["a", "b", "c"];
    const answers = { a: ans(), b: ans(), c: ans({ correct: true }) };
    const underdog = detectSituations({ playerIds: ids, facts: facts(answers), leaderboard: board(["a", "b", "c"]), wrongStreaksBefore: {} });
    expect(underdog.find((h) => h.situation === "surpriseRight")?.targetIds).toEqual(["c"]);
    const leader = detectSituations({ playerIds: ids, facts: facts(answers), leaderboard: board(["c", "a", "b"]), wrongStreaksBefore: {} });
    expect(situations(leader)).not.toContain("surpriseRight");
  });

  it("new leader and a new last place", () => {
    const ids = ["a", "b", "c"];
    const hits = detectSituations({
      playerIds: ids,
      facts: facts({ a: ans({ correct: true }), b: ans(), c: ans() }),
      leaderboard: board(["a", "b", "c"], { a: 2, b: 3, c: 1 }),
      wrongStreaksBefore: {},
    });
    expect(hits.find((h) => h.situation === "leader")?.targetIds).toEqual(["a"]);
    expect(hits.find((h) => h.situation === "lastPlace")?.targetIds).toEqual(["c"]);
  });

  it("estimates: wild guess and bullseye", () => {
    const ids = ["a", "b"];
    const hits = detectSituations({
      playerIds: ids,
      facts: facts({ a: ans({ accuracy: 0.99, correct: true }), b: ans({ accuracy: 0 }) }, { answerKind: "estimate" }),
      leaderboard: board(ids),
      wrongStreaksBefore: {},
    });
    expect(hits.find((h) => h.situation === "bullseye")?.targetIds).toEqual(["a"]);
    expect(hits.find((h) => h.situation === "wildEstimate")?.targetIds).toEqual(["b"]);
    // Not an estimate category → no estimate situations.
    const quiz = detectSituations({ playerIds: ids, facts: facts({ a: ans({ accuracy: 1, correct: true }), b: ans() }), leaderboard: board(ids), wrongStreaksBefore: {} });
    expect(situations(quiz)).not.toContain("bullseye");
  });

  it("bluff: fooled many / fooled none", () => {
    const ids = ["a", "b", "c", "d"];
    const hits = detectSituations({
      playerIds: ids,
      facts: facts({ a: ans({ fooled: 2 }), b: ans({ fooled: 0, correct: true }), c: ans({ fooled: 0 }), d: ans({ fooled: 1, correct: true }) }),
      leaderboard: board(ids),
      wrongStreaksBefore: {},
    });
    expect(hits[0]).toEqual({ situation: "fooledMany", targetIds: ["a"] });
    expect(hits.find((h) => h.situation === "fooledNone")?.targetIds).toEqual(["b", "c"]);
  });

  it("wrong streaks count up and reset on a right answer (no answer = wrong)", () => {
    const f = facts({ a: ans({ correct: true }), b: ans() });
    expect(updateWrongStreaks({ a: 3, b: 1, c: 2 }, ["a", "b", "c"], f)).toEqual({ a: 0, b: 2, c: 3 });
  });
});

describe("target rotation", () => {
  const hits = [
    { situation: "wrongStreak" as const, targetIds: ["b"] },
    { situation: "wrong" as const, targetIds: ["b", "c"] },
  ];
  it("never the same target twice in a row", () => {
    expect(situationChoices(hits, "b", 3, () => 0)[0]).toEqual({ situation: "wrong", targetId: "c" });
    expect(situationChoices(hits, "a", 3, () => 0)[0]).toEqual({ situation: "wrongStreak", targetId: "b" });
  });
  it("only the last target qualifies → the line without a name; alone → the name is fine", () => {
    expect(situationChoices([hits[0]!], "b", 2, () => 0)).toEqual([{ situation: "wrongStreak", targetId: null }]);
    expect(situationChoices([hits[0]!], "b", 1, () => 0)).toEqual([{ situation: "wrongStreak", targetId: "b" }]);
  });
});

describe("library lines", () => {
  it("Kids only kids lines, Familie family lines, Party family + party", () => {
    expect(snarkPoolsFor("kids")).toEqual(["kids"]);
    expect(snarkPoolsFor("family")).toEqual(["family"]);
    expect(snarkPoolsFor("party")).toEqual(["family", "party"]);
    for (let i = 0; i < 20; i++) {
      const r = () => i / 20;
      expect(SNARK_LINES_DE.wrong.kids).toContain(pickSnarkLine(SNARK_LINES_DE, "wrong", "kids", [], r));
      expect(SNARK_LINES_DE.wrong.family).toContain(pickSnarkLine(SNARK_LINES_DE, "wrong", "family", [], r));
      expect([...SNARK_LINES_DE.wrong.family, ...SNARK_LINES_DE.wrong.party]).toContain(pickSnarkLine(SNARK_LINES_DE, "wrong", "party", [], r));
    }
    // Party really uses the party lines.
    const seen = new Set(Array.from({ length: 40 }, (_, i) => pickSnarkLine(SNARK_LINES_DE, "wrong", "party", [], () => i / 40)));
    expect(SNARK_LINES_DE.wrong.party.some((l) => seen.has(l))).toBe(true);
  });

  it("never a line twice while fresh ones exist; the next situation before any repeat", () => {
    const used: string[] = [];
    let n = 0;
    const random = () => ((n++ * 0.37) % 1);
    const hits = [
      { situation: "allWrong" as const, targetIds: [] },
      { situation: "wrong" as const, targetIds: ["b"] },
    ];
    const family = SNARK_LINES_DE.allWrong.family.length + SNARK_LINES_DE.wrong.family.length;
    for (let i = 0; i < family; i++) {
      const pick = chooseSnark(hits, null, 2, SNARK_LINES_DE, "family", used, random)!;
      expect(used).not.toContain(pick.text);
      used.push(pick.text);
    }
    // Everything used: a line comes back, but not one of the last five.
    const again = chooseSnark(hits, null, 2, SNARK_LINES_DE, "family", used, random)!;
    expect(used.slice(-5)).not.toContain(again.text);
  });
});
