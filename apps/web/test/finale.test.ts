import { buildLeaderboard } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import { buildRankedLeaderboard } from "@couch-clash/shared";
import { EARLY_FINALE_TITLE, placeText, podiumOrder, splitPodium, survivalPodium } from "../src/lib/finale";

const players = ["Anna", "Ben", "Cleo", "Dana", "Emil"].map((name, i) => ({ id: `p${i}`, name }));
const scores = { p0: 300, p1: 740, p2: 120, p3: 740, p4: 0 };
const entries = buildLeaderboard(players, scores, {});

describe("early finale", () => {
  it("headline", () => {
    expect(EARLY_FINALE_TITLE).toBe("Spiel beendet – Zwischenstand");
  });

  it("top 3 on the podium (ties share a rank), the rest in the list", () => {
    const { podium, rest } = splitPodium(entries);
    expect(podium.map((e) => [e.playerId, e.rankAfter])).toEqual([
      ["p1", 1],
      ["p3", 1],
      ["p0", 3],
    ]);
    expect(rest.map((e) => e.playerId)).toEqual(["p2", "p4"]);
    expect(splitPodium(entries.slice(0, 2)).rest).toEqual([]);
  });

  it("podium order: 2nd · 1st · 3rd", () => {
    expect(podiumOrder(["first", "second", "third"])).toEqual(["second", "first", "third"]);
    expect(podiumOrder(["first", "second"])).toEqual(["second", "first"]);
    expect(podiumOrder(["solo"])).toEqual(["solo"]);
  });

  it("phones: own place, e.g. \"Platz 2 von 5 – 740 Punkte\"", () => {
    expect(placeText(entries, "p0")).toBe("Platz 3 von 5 – 300 Punkte");
    expect(placeText(entries, "p3")).toBe("Platz 1 von 5 – 740 Punkte");
    expect(placeText(buildLeaderboard(players, { ...scores, p3: 700 }, {}), "p3")).toBe("Platz 2 von 5 – 700 Punkte");
    expect(placeText(buildLeaderboard(players, { ...scores, p4: 1 }, {}), "p4")).toBe("Platz 5 von 5 – 1 Punkt");
    expect(placeText(buildLeaderboard(players, { ...scores, p1: 1740 }, {}), "p1")).toBe("Platz 1 von 5 – 1.740 Punkte");
    expect(placeText(entries, "nobody")).toBeNull();
  });
});

describe("Survival-Finale ceremony podium", () => {
  it("2 · 1 · 3 by the finale's placing (2 = out last, 3 = before)", () => {
    // Winner p2, out last p0, before that p4, first out p1.
    const ranked = buildRankedLeaderboard(players.slice(0, 5), scores, [
      { playerId: "p2", place: 1 },
      { playerId: "p0", place: 2 },
      { playerId: "p4", place: 3 },
      { playerId: "p3", place: 4 },
      { playerId: "p1", place: 5 },
    ]);
    const slots = survivalPodium(ranked);
    expect(slots.map((s) => [s.step, s.entry?.playerId, s.place])).toEqual([
      [2, "p0", 2],
      [1, "p2", 1],
      [3, "p4", 3],
    ]);
  });

  it("two players: the third step stays empty", () => {
    const ranked = buildRankedLeaderboard(players.slice(0, 2), scores, [
      { playerId: "p1", place: 1 },
      { playerId: "p0", place: 2 },
    ]);
    expect(survivalPodium(ranked).map((s) => [s.step, s.entry?.playerId ?? null])).toEqual([
      [2, "p0"],
      [1, "p1"],
      [3, null],
    ]);
  });
});
