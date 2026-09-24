import { describe, expect, it } from "vitest";
import { buildLeaderboard, rankByScore } from "../src";

const players = [
  { id: "c", name: "Chris" },
  { id: "a", name: "Anna" },
  { id: "b", name: "Ben" },
  { id: "d", name: "Dana" },
];

const byId = <T extends { playerId: string }>(entries: T[]) =>
  Object.fromEntries(entries.map((e) => [e.playerId, e]));

describe("rankByScore", () => {
  it("sorts by score, ties share a rank, secondary order by name", () => {
    const ranked = rankByScore(players, { a: 50, b: 100, c: 50, d: 10 });
    expect(ranked).toEqual([
      { id: "b", rank: 1, position: 0 },
      { id: "a", rank: 2, position: 1 }, // Anna before Chris (same score)
      { id: "c", rank: 2, position: 2 },
      { id: "d", rank: 4, position: 3 },
    ]);
  });

  it("everyone shares rank 1 at the start", () => {
    expect(rankByScore(players, {}).map((r) => r.rank)).toEqual([1, 1, 1, 1]);
    expect(rankByScore(players, {}).map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("orders names case-insensitively", () => {
    const r = rankByScore(
      [
        { id: "1", name: "bob" },
        { id: "2", name: "Anna" },
      ],
      {},
    );
    expect(r.map((x) => x.id)).toEqual(["2", "1"]);
  });
});

describe("buildLeaderboard", () => {
  it("computes before/after scores, ranks and positions", () => {
    const lb = buildLeaderboard(players, { a: 100, b: 80, c: 60, d: 0 }, { c: 100, d: 55, a: 0 });
    expect(lb.map((e) => e.playerId)).toEqual(["c", "a", "b", "d"]);
    const e = byId(lb);
    expect(e.c).toMatchObject({
      scoreBefore: 60,
      pointsGained: 100,
      scoreAfter: 160,
      rankBefore: 3,
      rankAfter: 1,
      positionBefore: 2,
      positionAfter: 0,
    });
    expect(e.a).toMatchObject({ rankBefore: 1, rankAfter: 2, pointsGained: 0, scoreAfter: 100 });
    expect(e.b).toMatchObject({ rankBefore: 2, rankAfter: 3 });
    expect(e.d).toMatchObject({ scoreBefore: 0, scoreAfter: 55, rankBefore: 4, rankAfter: 4 });
  });

  it("handles ties before and after", () => {
    const lb = byId(buildLeaderboard(players, { a: 10, b: 10, c: 0, d: 0 }, { c: 10, d: 5 }));
    // after: a, b, c = 10 (rank 1), d = 5 (rank 4)
    expect([lb.a!.rankAfter, lb.b!.rankAfter, lb.c!.rankAfter, lb.d!.rankAfter]).toEqual([1, 1, 1, 4]);
    expect([lb.a!.rankBefore, lb.b!.rankBefore, lb.c!.rankBefore, lb.d!.rankBefore]).toEqual([1, 1, 3, 3]);
    // tie order by name: Anna, Ben, Chris
    expect([lb.a!.positionAfter, lb.b!.positionAfter, lb.c!.positionAfter]).toEqual([0, 1, 2]);
  });

  it("without gains before == after (final ranking)", () => {
    const lb = buildLeaderboard(players, { a: 3, b: 2, c: 1, d: 0 }, {});
    for (const e of lb) {
      expect(e.rankBefore).toBe(e.rankAfter);
      expect(e.positionBefore).toBe(e.positionAfter);
      expect(e.scoreBefore).toBe(e.scoreAfter);
    }
  });

  it("positions are unique permutations", () => {
    const lb = buildLeaderboard(players, { a: 5, b: 5, c: 5, d: 5 }, { d: 1 });
    expect(lb.map((e) => e.positionBefore).sort()).toEqual([0, 1, 2, 3]);
    expect(lb.map((e) => e.positionAfter)).toEqual([0, 1, 2, 3]);
  });
});
