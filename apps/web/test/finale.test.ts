import { buildLeaderboard } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import { EARLY_FINALE_TITLE, placeText, podiumOrder, splitPodium } from "../src/lib/finale";

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
